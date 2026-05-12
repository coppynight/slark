/**
 * Workflow Runner（Sprint 2 CP3）
 *
 * 状态机：running ↔ awaiting_approval → completed / aborted / failed
 *
 * 入口：
 *   - startWorkflowRun(): MessageRouter 检测到 trigger_command 时调用
 *   - advanceWithUserAction(): 用户在 awaiting_approval 时输入 /approve 或 /reject
 *   - abortWorkflowRun(): 用户 /abort 或 REST POST .../abort
 *
 * Step 推进流程：
 *   1. 写一条 system "header" 消息到 thread（"⚙ Step N: <step.id> → @owner"）
 *   2. 调 triggerAgent(owner) — 把 header msg 当 triggerMessage
 *   3. agent 完成 → 写 state.step_outputs[step.id] → 找 next step → executeStep（异步链）
 *   4. close_thread → 完成 run，emit workflow_finished system msg
 *   5. approve_or_reject → run.status='awaiting_approval'，emit "Waiting for approval"，return
 *
 * 单 run 内 step 串行；多 run 之间天然并行。
 */

import type { Database } from 'better-sqlite3';
import type {
  Agent,
  ChatMessage,
  MessageMetadata,
  Workflow,
  WorkflowDefinition,
  WorkflowRun,
  WorkflowRunState,
  WorkflowStep,
} from '@slark/shared';
import { LOCAL_USER_ID } from '@slark/shared';
import {
  agentRepo,
  messageRepo,
  workflowRepo,
  workflowRunRepo,
} from '../db/repos.js';
import { hub } from '../ws/hub.js';
import { abortChannelAgentRuns, triggerAgent } from '../agents/engine.js';
import {
  formatOwnerResolveError,
  parseAgentMention,
  parseWorkflowYaml,
  resolveOwnerToAgent,
} from './yaml-parser.js';
import { persistScribeOutput, runScribe } from '../system-agents/scribe.js';

interface RunnerLogger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

const consoleLog: RunnerLogger = {
  info: (m) => console.log(m),
  warn: (m) => console.warn(m),
  error: (m) => console.error(m),
};

// =============================================================================
// Public API
// =============================================================================

/**
 * 启动新 workflow run。
 *
 * 同步部分：
 *   - 解析 YAML
 *   - 创建 workflow_run 记录（status='running'）
 *   - 写 "Workflow started" header system msg
 *
 * 异步部分（fire-and-forget）：
 *   - executeStep(firstStep)
 *
 * @returns 新建的 run（status='running'，current_step=firstStep.id）
 */
export async function startWorkflowRun(
  db: Database,
  input: {
    workflow_id: string;
    channel_id: string;
    started_by: string;
    /** 触发消息 id（用户的 /command 消息）；用作 thread root */
    trigger_message_id: string;
    /** 指令尾巴，如 `/new-feature add OAuth` 中的 "add OAuth" */
    initial_input?: string;
  },
  logger: RunnerLogger = consoleLog,
): Promise<WorkflowRun> {
  const wf = workflowRepo.getById(db, input.workflow_id);
  if (!wf) throw new Error(`workflow ${input.workflow_id} not found`);

  const def = parseWorkflowYaml(wf.definition_yaml);
  const firstStep = def.steps[0];
  if (!firstStep) throw new Error(`workflow ${wf.name} has no steps`);

  const triggerMessage = messageRepo.getById(db, input.trigger_message_id);
  if (!triggerMessage) {
    throw new Error(`trigger message ${input.trigger_message_id} not found`);
  }

  // 创建 run 记录（thread_id = 用户触发消息 id，所有 step 消息 parent_id = 该消息 id）
  const initialState: WorkflowRunState = {
    initial_input: input.initial_input,
    step_outputs: {},
  };
  const run = workflowRunRepo.create(db, {
    workflow_id: wf.id,
    channel_id: input.channel_id,
    thread_id: triggerMessage.id,
    started_by: input.started_by,
    current_step: firstStep.id,
    state_json: JSON.stringify(initialState),
  });

  // header system 消息：workflow_started
  emitSystemMessage(db, run, triggerMessage.id, {
    content: `⚙ Workflow "${wf.name}" started — ${def.steps.length} step(s)`,
    metadata: {
      system_event: {
        type: 'workflow_started',
        run_id: run.id,
        workflow_name: wf.name,
      },
      workflow_ref: {
        run_id: run.id,
        workflow_id: wf.id,
        step_id: firstStep.id,
        kind: 'header',
      },
    },
  });

  broadcastRunUpdate(db, run.id);

  // 异步执行第一步（不阻塞 caller）
  void executeStep(db, run, wf, def, firstStep, logger).catch((e: Error) => {
    logger.error(`[workflow] run ${run.id} executeStep failed: ${e.message}`);
    failRun(db, run.id, e.message);
  });

  return workflowRunRepo.getById(db, run.id) ?? run;
}

/**
 * 用户在 awaiting_approval 状态下回复 /approve 或 /reject 时由 MessageRouter 调用。
 */
export async function advanceWithUserAction(
  db: Database,
  runId: number,
  action: 'approve' | 'reject',
  reason: string | undefined,
  logger: RunnerLogger = consoleLog,
): Promise<WorkflowRun> {
  const run = workflowRunRepo.getById(db, runId);
  if (!run) throw new Error(`workflow run ${runId} not found`);
  if (run.status !== 'awaiting_approval') {
    throw new Error(`run ${runId} is ${run.status}, not awaiting_approval`);
  }
  const wf = workflowRepo.getById(db, run.workflow_id);
  if (!wf) throw new Error(`workflow ${run.workflow_id} not found`);
  const def = parseWorkflowYaml(wf.definition_yaml);

  const currentStepId = run.current_step;
  if (!currentStepId) throw new Error(`run ${runId} has no current_step`);
  const step = def.steps.find((s) => s.id === currentStepId);
  if (!step) {
    throw new Error(`current_step "${currentStepId}" not found in YAML`);
  }
  if (step.action !== 'approve_or_reject') {
    throw new Error(
      `current_step "${currentStepId}" is not an approval step; cannot advance with user action`,
    );
  }

  const nextStepId = action === 'approve' ? step.on_approve : step.on_reject;
  if (!nextStepId) {
    throw new Error(`step "${currentStepId}" missing on_${action} target`);
  }
  const nextStep = def.steps.find((s) => s.id === nextStepId);
  if (!nextStep) throw new Error(`unknown next step "${nextStepId}"`);

  // 更新 state
  const state = parseState(run.state_json);
  state.step_outputs[step.id] = {
    message_id: '', // local-user 的 /approve 消息 id 不重要
    summary: action === 'reject' ? `rejected: ${reason ?? '(no reason)'}` : 'approved',
    ended_at: Date.now(),
    status: action === 'approve' ? 'approved' : 'rejected',
  };
  if (action === 'reject') {
    state.last_rejection_reason = reason;
  } else {
    state.last_rejection_reason = undefined;
  }

  workflowRunRepo.update(db, runId, {
    status: 'running',
    current_step: nextStep.id,
    state_json: JSON.stringify(state),
  });
  broadcastRunUpdate(db, runId);

  // emit progress system msg
  emitSystemMessage(db, run, run.thread_id, {
    content:
      action === 'approve'
        ? `✓ Approval received — proceeding to step "${nextStep.id}"`
        : `↩ Rejected — going back to step "${nextStep.id}"${reason ? ` (reason: ${reason})` : ''}`,
    metadata: {
      workflow_ref: {
        run_id: runId,
        workflow_id: wf.id,
        step_id: nextStep.id,
        kind: 'header',
      },
    },
  });

  const fresh = workflowRunRepo.getById(db, runId);
  if (!fresh) throw new Error(`run ${runId} disappeared`);

  // 异步推进到 nextStep
  void executeStep(db, fresh, wf, def, nextStep, logger).catch((e: Error) => {
    logger.error(`[workflow] run ${runId} executeStep failed: ${e.message}`);
    failRun(db, runId, e.message);
  });

  return fresh;
}

/**
 * 用户 /abort 或 REST POST .../abort。
 * 已 ended 的 run 不再生效（idempotent）。
 *
 * Sprint 3 CP3：除标 status='aborted' 外，会调 abortChannelAgentRuns()
 * 把 channel 内活跃的 cursor-agent 子进程 kill 掉（清掉 Sprint 2 TD-7）。
 */
export function abortWorkflowRun(
  db: Database,
  runId: number,
  reason: string,
): void {
  const run = workflowRunRepo.getById(db, runId);
  if (!run) throw new Error(`workflow run ${runId} not found`);
  if (run.status !== 'running' && run.status !== 'awaiting_approval') return;

  // 1. 先标 status，让 executeStep 的 stale 检查跳过任何 in-flight 推进
  const state = parseState(run.state_json);
  state.abort_reason = reason;
  workflowRunRepo.update(db, runId, {
    status: 'aborted',
    state_json: JSON.stringify(state),
    ended: true,
  });

  // 2. kill 该 channel 内活跃的 agent_runs（实际终止 cursor-agent 进程）
  const killed = abortChannelAgentRuns(db, run.channel_id);

  emitSystemMessage(db, run, run.thread_id, {
    content:
      killed > 0
        ? `⛔ Workflow aborted — ${reason} (killed ${killed} active agent run${killed === 1 ? '' : 's'})`
        : `⛔ Workflow aborted — ${reason}`,
    metadata: {
      system_event: {
        type: 'workflow_finished',
        run_id: runId,
        status: 'aborted',
      },
      workflow_ref: {
        run_id: runId,
        workflow_id: run.workflow_id,
        step_id: run.current_step ?? '',
        kind: 'finished',
      },
    },
  });

  broadcastRunUpdate(db, runId);
}

/**
 * 用户 /override [reason]：跳过当前 step。
 *
 * 当前实现：
 *   - awaiting_approval：等同 /approve，并把 reason 标记到 state（[override] 前缀）
 *   - running：拒绝（提示用户先 /abort 或等 step 自然完成）
 *
 * running 状态下的 override 涉及 kill agent + 跳 next step 的精细同步，会在
 * Sprint 3 后续或独立 CP 评估扩展。
 */
export async function overrideWorkflowRun(
  db: Database,
  runId: number,
  reason: string | undefined,
  logger: RunnerLogger = consoleLog,
): Promise<{ ok: boolean; run: WorkflowRun | null; reason?: string }> {
  const run = workflowRunRepo.getById(db, runId);
  if (!run) throw new Error(`workflow run ${runId} not found`);
  if (run.status !== 'running' && run.status !== 'awaiting_approval') {
    return { ok: false, run, reason: `run is ${run.status}, not active` };
  }
  if (run.status === 'running') {
    return {
      ok: false,
      run,
      reason:
        '/override only works while awaiting approval; use /abort to cancel a running step.',
    };
  }
  // awaiting_approval → 等同 approve，但备注 override
  const overrideNote = `[override] ${reason ?? ''}`.trim();
  const next = await advanceWithUserAction(db, runId, 'approve', overrideNote, logger);
  return { ok: true, run: next };
}

// =============================================================================
// Internal step engine
// =============================================================================

/**
 * 执行 step：
 *   - close_thread → complete run
 *   - approve_or_reject → 暂停 run（awaiting_approval），等用户消息驱动 advanceWithUserAction
 *   - 普通 owner=@Foo → spawn agent，agent 完成后递归推进 next step
 */
async function executeStep(
  db: Database,
  run: WorkflowRun,
  wf: Workflow,
  def: WorkflowDefinition,
  step: WorkflowStep,
  logger: RunnerLogger,
): Promise<void> {
  // 重新读取 run 防止 stale（例如刚被 abort）
  const fresh = workflowRunRepo.getById(db, run.id);
  if (!fresh || fresh.status === 'aborted' || fresh.status === 'failed') {
    logger.info(`[workflow] run ${run.id} no longer active, skip step ${step.id}`);
    return;
  }

  // 同步 current_step（如果跟 fresh 不一致，以参数为准）
  if (fresh.current_step !== step.id) {
    workflowRunRepo.update(db, fresh.id, { current_step: step.id });
  }

  if (step.action === 'close_thread') {
    completeRun(db, fresh.id, step.id, wf.id);
    return;
  }

  if (step.action === 'approve_or_reject') {
    workflowRunRepo.update(db, fresh.id, { status: 'awaiting_approval' });
    emitSystemMessage(db, fresh, fresh.thread_id, {
      content: `⏸ Waiting for approval at step "${step.id}". Reply "/approve" or "/reject [reason]" in this thread.`,
      metadata: {
        system_event: {
          type: 'workflow_awaiting_approval',
          run_id: fresh.id,
          step_id: step.id,
        },
        workflow_ref: {
          run_id: fresh.id,
          workflow_id: wf.id,
          step_id: step.id,
          kind: 'await_approval',
        },
      },
    });
    broadcastRunUpdate(db, fresh.id);
    return;
  }

  // 普通执行 step：spawn owner agent
  if (!parseAgentMention(step.owner)) {
    failRun(
      db,
      fresh.id,
      `step "${step.id}" owner "${step.owner}" is not a "@AgentName" reference`,
    );
    return;
  }

  // Sprint 8 / Lo-26: 双路径解析 —— 先 byName，再 byRole（让 @implementer 等占位符可用）
  const channelAgents = agentRepo.listInChannel(db, fresh.channel_id);
  const resolved = resolveOwnerToAgent(channelAgents, step.owner);
  if (!resolved) {
    failRun(
      db,
      fresh.id,
      formatOwnerResolveError(step.id, step.owner, channelAgents),
    );
    return;
  }
  const agent = resolved.agent;

  // 写 step header system 消息（同时作为 triggerAgent 的 triggerMessage）
  const headerMsg = emitSystemMessage(db, fresh, fresh.thread_id, {
    content: buildStepHeader(def, step, agent),
    metadata: {
      system_event: {
        type: 'workflow_step',
        run_id: fresh.id,
        step_id: step.id,
        owner: step.owner,
      },
      workflow_ref: {
        run_id: fresh.id,
        workflow_id: wf.id,
        step_id: step.id,
        kind: 'header',
      },
    },
  });

  // 注：triggerAgent 内部会创建 agent 占位消息并 spawn CLI；
  //     完成后我们读 fullText 写入 state，并推进 next step。
  const result = await triggerAgent(
    agent.id,
    {
      channelId: fresh.channel_id,
      triggerMessage: buildVirtualTrigger(headerMsg, fresh, def, step, logger),
      parentMessageId: fresh.thread_id ?? undefined,
      chainDepth: 1,
    },
    { db, logger },
  );

  // run 可能在 spawn 期间被 abort
  const after = workflowRunRepo.getById(db, fresh.id);
  if (!after || after.status === 'aborted' || after.status === 'failed') {
    logger.info(
      `[workflow] run ${fresh.id} status changed during step ${step.id}; not advancing`,
    );
    return;
  }

  if (!result.ok) {
    failRun(
      db,
      fresh.id,
      `step "${step.id}" agent ${agent.name} failed: ${result.errorMessage ?? 'unknown'}`,
    );
    return;
  }

  // 写 step output
  const state = parseState(after.state_json);
  state.step_outputs[step.id] = {
    message_id: result.agentReplyMessage.id,
    summary: summarize(result.fullText),
    ended_at: Date.now(),
    status: 'completed',
  };
  state.last_rejection_reason = undefined;
  workflowRunRepo.update(db, after.id, { state_json: JSON.stringify(state) });

  // 找下一 step
  if (!step.on_complete) {
    // 没有 on_complete → 视为终止（隐式完成）
    completeRun(db, after.id, step.id, wf.id);
    return;
  }
  const nextStep = def.steps.find((s) => s.id === step.on_complete);
  if (!nextStep) {
    failRun(
      db,
      after.id,
      `step "${step.id}" on_complete points to unknown step "${step.on_complete}"`,
    );
    return;
  }

  // 递归推进
  workflowRunRepo.update(db, after.id, { current_step: nextStep.id });
  broadcastRunUpdate(db, after.id);
  await executeStep(db, after, wf, def, nextStep, logger);
}

// =============================================================================
// Helpers
// =============================================================================

function parseState(raw: string): WorkflowRunState {
  try {
    const parsed = JSON.parse(raw) as Partial<WorkflowRunState>;
    return {
      initial_input: parsed.initial_input,
      step_outputs: parsed.step_outputs ?? {},
      last_rejection_reason: parsed.last_rejection_reason,
      abort_reason: parsed.abort_reason,
    };
  } catch {
    return { step_outputs: {} };
  }
}

function emitSystemMessage(
  db: Database,
  run: WorkflowRun,
  parentId: string | null,
  input: { content: string; metadata: MessageMetadata | null },
): ChatMessage {
  const sysMsg = messageRepo.create(db, {
    channel_id: run.channel_id,
    sender_type: 'system',
    sender_id: LOCAL_USER_ID,
    content: input.content,
    metadata: input.metadata,
    parent_id: parentId ?? null,
  });
  hub.broadcast(run.channel_id, { type: 'message', message: sysMsg });
  if (input.metadata?.system_event) {
    hub.broadcast(run.channel_id, {
      type: 'system_event',
      event: { channel_id: run.channel_id, ...input.metadata.system_event },
    });
  }
  return sysMsg;
}

function broadcastRunUpdate(db: Database, runId: number): void {
  const run = workflowRunRepo.getById(db, runId);
  if (!run) return;
  hub.broadcast(run.channel_id, { type: 'workflow_run_update', run });
}

function completeRun(
  db: Database,
  runId: number,
  lastStepId: string,
  workflowId: string,
): void {
  workflowRunRepo.update(db, runId, {
    status: 'completed',
    current_step: lastStepId,
    ended: true,
  });
  const run = workflowRunRepo.getById(db, runId);
  if (!run) return;
  emitSystemMessage(db, run, run.thread_id, {
    content: '✅ Workflow completed.',
    metadata: {
      system_event: {
        type: 'workflow_finished',
        run_id: runId,
        status: 'completed',
      },
      workflow_ref: {
        run_id: runId,
        workflow_id: workflowId,
        step_id: lastStepId,
        kind: 'finished',
      },
    },
  });
  broadcastRunUpdate(db, runId);

  // Sprint 4 CP3：自动触发 Scribe 沉淀（fire-and-forget）
  void scribeRunInBackground(db, runId);
}

/**
 * 后台跑 Scribe 提炼 thread 知识，结果以 review_status='pending' 写入 db。
 * 失败不影响 workflow run 的状态。
 */
async function scribeRunInBackground(db: Database, runId: number): Promise<void> {
  const run = workflowRunRepo.getById(db, runId);
  if (!run || run.status !== 'completed') return;
  if (!run.thread_id) return;
  const wf = workflowRepo.getById(db, run.workflow_id);
  if (!wf) return;

  const threadMessages = messageRepo.listThread(db, run.thread_id);
  const projectAgents = agentRepo.list(db);
  const roleMap: Record<string, string> = {};
  for (const a of projectAgents) {
    roleMap[a.id] = a.name;
  }

  const state = parseState(run.state_json);

  try {
    const output = await runScribe({
      trigger: {
        kind: 'workflow_run',
        workflow_name: wf.name,
        initial_input: state.initial_input,
        run_id: runId,
      },
      thread_messages: threadMessages,
      agent_role_map: roleMap,
    });

    if (output.is_fallback) return; // 静默失败，不污染 thread

    const persisted = persistScribeOutput(db, output, {
      source_run_id: runId,
    });
    if (persisted.decisions.length === 0 && persisted.lessons.length === 0) {
      return;
    }
    // emit 一条小 system msg 让用户知道 Intelligence Tab 有新东西要审
    const summary = `📚 Scribe sedimented ${persisted.decisions.length} decision(s) + ${persisted.lessons.length} lesson(s) — review them in Intelligence.`;
    emitSystemMessage(db, run, run.thread_id, {
      content: summary,
      metadata: null,
    });
  } catch {
    /* 已在 runScribe 内部 catch；这里再吞一次保险 */
  }
}

function failRun(db: Database, runId: number, reason: string): void {
  const run = workflowRunRepo.getById(db, runId);
  if (!run) return;
  if (run.status !== 'running' && run.status !== 'awaiting_approval') return;
  const state = parseState(run.state_json);
  state.abort_reason = reason;
  workflowRunRepo.update(db, runId, {
    status: 'failed',
    state_json: JSON.stringify(state),
    ended: true,
  });
  emitSystemMessage(db, run, run.thread_id, {
    content: `⚠ Workflow failed — ${reason}`,
    metadata: {
      system_event: {
        type: 'workflow_finished',
        run_id: runId,
        status: 'failed',
      },
      workflow_ref: {
        run_id: runId,
        workflow_id: run.workflow_id,
        step_id: run.current_step ?? '',
        kind: 'finished',
      },
    },
  });
  broadcastRunUpdate(db, runId);
}

function buildStepHeader(
  def: WorkflowDefinition,
  step: WorkflowStep,
  agent: Agent,
): string {
  const totalSteps = def.steps.filter((s) => s.action !== 'close_thread').length;
  const idx = def.steps
    .filter((s) => s.action !== 'close_thread')
    .findIndex((s) => s.id === step.id);
  const pos = idx >= 0 ? `${idx + 1}/${totalSteps}` : '?';
  const desc = step.description ? `\n${step.description}` : '';
  return `⚙ Step ${pos}: ${step.id} → @${agent.name}${desc}`;
}

/**
 * 构造 triggerAgent 用的 "virtual" trigger 消息：
 * 实际 system header 消息已写入 db，直接用它做 trigger，但 ContextBuilder 会读取它的
 * `content` 作为用户问题。我们用拼接好的 prompt 文本作为 content 注入。
 *
 * 但 system 消息已写入并广播给前端，前端 UI 看到的是简洁 header；
 * 而我们构造一个内存中的镜像消息（不写 db）传给 triggerAgent，content 为更长的 prompt。
 */
function buildVirtualTrigger(
  realHeader: ChatMessage,
  run: WorkflowRun,
  def: WorkflowDefinition,
  step: WorkflowStep,
  logger: RunnerLogger,
): ChatMessage {
  const state = parseState(run.state_json);
  const lines: string[] = [];

  lines.push(`[Workflow: ${def.name}] Step "${step.id}"`);
  if (step.description) lines.push(step.description);
  if (state.initial_input) {
    lines.push('');
    lines.push(`User's original request: ${state.initial_input}`);
  }

  if (step.input) {
    const prev = state.step_outputs[step.input];
    if (prev?.summary) {
      lines.push('');
      lines.push(`Previous step "${step.input}" output:`);
      lines.push(prev.summary);
    } else {
      logger.warn(
        `[workflow] step "${step.id}" references input "${step.input}" with no prior output`,
      );
    }
  }

  if (state.last_rejection_reason) {
    lines.push('');
    lines.push(
      `User feedback on previous attempt (please address): ${state.last_rejection_reason}`,
    );
  }

  return {
    ...realHeader,
    content: lines.join('\n'),
  };
}

function summarize(text: string, max = 1000): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}\n... [truncated ${trimmed.length - max} chars]`;
}
