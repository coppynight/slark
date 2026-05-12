/**
 * AgentEngine — 把 Adapter / Runner / ContextBuilder / ActivityRecorder / Queue 整合起来
 *
 * 核心 API：trigger(agentId, triggerCtx) — 被 Message Router 调用
 *
 * 内部流程：
 *   1. 查 agent + 构建 context（description + 团队 + history + trigger message）
 *   2. 创建占位 agent message（streaming=true）并广播 `message` 事件
 *   3. 更新 status=thinking → 广播 agent_status
 *   4. 进入并发队列 → spawn CLI
 *   5. CLI 事件回调：
 *        text.delta / thinking.delta → 广播 message_stream（frontend 累加渲染）
 *        text.completed → 更新占位消息 content，广播 message_done
 *        error / timeout → status=error + 红色 system message
 *   6. CLI 退出 → status=idle → 广播
 *   7. 返回完整文本 & metadata（供 Message Router 继续链式触发解析）
 */

import type { Database } from 'better-sqlite3';
import type { AgentStatus, ChatMessage, MessageMetadata, Runtime } from '@slark/shared';
import { LOCAL_USER_ID } from '@slark/shared';
import {
  agentRepo,
  agentRunRepo,
  channelRepo,
  decisionRepo,
  lessonRepo,
  messageRepo,
  skillRepo,
} from '../db/repos.js';
import { listOpenDbs } from '../db/index.js';
import { projectsService } from '../config/projects-service.js';
import { hub } from '../ws/hub.js';
import { buildContext } from './context-builder.js';
import { ActivityRecorder } from './activity-recorder.js';
import { concurrencyQueue } from './queue.js';
import { runWithAdapter } from './runner.js';
import { createAdapterForRuntime } from './adapter-factory.js';
import type { CLIAdapter, CLIEvent } from './types.js';

// Sprint 3 CP3：活跃 agent_runs 的 AbortController，支持 /abort 与 workflow override 时
// kill 正在跑的 cursor-agent 进程。key = agent_runs.id（数据库自增）。
const activeAborters = new Map<number, AbortController>();

/** 中止指定 agent_run。返回是否真的有正在跑的进程被发了 abort 信号。 */
export function abortAgentRun(agentRunId: number): boolean {
  const aborter = activeAborters.get(agentRunId);
  if (!aborter) return false;
  try {
    aborter.abort();
  } catch {
    /* ignore */
  }
  return true;
}

/** 中止某 channel 内所有活跃 agent_runs，返回成功发出 abort 的 run 数。 */
export function abortChannelAgentRuns(db: Database, channelId: string): number {
  const runs = agentRunRepo.listActiveInChannel(db, channelId);
  let count = 0;
  for (const r of runs) {
    if (abortAgentRun(r.id)) count += 1;
  }
  return count;
}

// Runtime registry. Cursor can use either cursor-agent (default) or @cursor/sdk;
// Codex uses the local `codex exec --json` CLI path.
export function getAdapterFor(runtime: Runtime): CLIAdapter | null {
  return createAdapterForRuntime(runtime);
}

export interface TriggerContext {
  channelId: string;
  /** 触发消息（用户发的那条，或上游 agent 回复） */
  triggerMessage: ChatMessage;
  /** 可选：thread 根消息 id（如果回复应放进 thread） */
  parentMessageId?: string;
  /** 链式深度（0 = 用户首次） */
  chainDepth?: number;
}

export interface TriggerResult {
  agentReplyMessage: ChatMessage;
  fullText: string;
  duration_ms: number;
  ok: boolean;
  errorMessage?: string;
}

export interface AgentEngineDeps {
  db: Database;
  logger?: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
}

/**
 * 触发 agent 响应。返回完整结果 (fullText 可用于后续链式触发解析)。
 */
export async function triggerAgent(
  agentId: string,
  ctx: TriggerContext,
  deps: AgentEngineDeps,
): Promise<TriggerResult> {
  const { db, logger } = deps;
  const log = logger ?? {
    info: (m: string) => console.log(m),
    warn: (m: string) => console.warn(m),
    error: (m: string) => console.error(m),
  };

  const agent = agentRepo.getById(db, agentId);
  if (!agent) {
    return {
      agentReplyMessage: null as unknown as ChatMessage,
      fullText: '',
      duration_ms: 0,
      ok: false,
      errorMessage: `agent ${agentId} not found`,
    };
  }

  // CP8.3：v1.0 模型下 agent 没有"全局 stopped"概念，run 状态完全由 agent_runs 表派生。
  // 如未来需要"禁用某 agent"，应新增独立 disabled 字段而非复用 status。

  const adapter = getAdapterFor(agent.runtime);
  if (!adapter) {
    const errMsg = `runtime "${agent.runtime}" is not implemented in this MVP`;
    emitSystemError(db, ctx.channelId, agent.name, errMsg);
    return {
      agentReplyMessage: null as unknown as ChatMessage,
      fullText: '',
      duration_ms: 0,
      ok: false,
      errorMessage: errMsg,
    };
  }

  // 1. 构建上下文
  const channel = channelRepo.getById(db, ctx.channelId);
  const teamAgents = channel ? agentRepo.listInChannel(db, channel.id) : [];
  // D-21：从 db handle 反查 project meta（db pool 维护 path → handle 映射）
  const project = resolveProjectFromDb(db);
  // 取最近 50 条历史（context-builder 会再按 token 预算裁剪）
  const history = ctx.parentMessageId
    ? messageRepo.listThread(db, ctx.parentMessageId)
    : messageRepo.listChannelMain(db, ctx.channelId, 50);

  // 排除触发消息自身与触发消息之后的历史
  const historyBeforeTrigger = history.filter(
    (m) => m.created_at < ctx.triggerMessage.created_at,
  );

  // Sprint 4 CP5：注入 audience 匹配的 lessons + 最新 decisions（仅 approved）
  const audiences = ['all', 'team', agent.name, agent.id];
  const lessons = lessonRepo.listForInjection(db, audiences, 20);
  const decisions = decisionRepo.list(db, { review_status: 'approved', limit: 5 });

  const built = buildContext({
    targetAgent: agent,
    teamAgents,
    history: historyBeforeTrigger,
    triggerMessage: ctx.triggerMessage,
    project,
    lessons,
    decisions,
  });

  // 标记被注入的 lessons 已被使用（用于 listForInjection 的 ORDER BY use_count）
  if (lessons.length > 0) {
    lessonRepo.bumpUseCount(db, lessons.map((l) => l.id));
  }

  log.info(
    `[engine] triggering ${agent.name} (chain_depth=${ctx.chainDepth ?? 0}, ctx=${built.estimatedTokens}t)`,
  );

  // 2. 创建占位 agent message
  const placeholderMetadata: MessageMetadata = {
    streaming: true,
    chain_depth: ctx.chainDepth ?? 0,
    triggered_by_message_id: ctx.triggerMessage.id,
    agent_meta: {
      runtime: agent.runtime,
      model: agent.model ?? 'default',
      total_duration_ms: 0,
    },
  };

  const placeholder = messageRepo.create(db, {
    channel_id: ctx.channelId,
    sender_type: 'agent',
    sender_id: agent.id,
    content: '',
    metadata: placeholderMetadata,
    parent_id: ctx.parentMessageId ?? null,
  });

  hub.broadcast(ctx.channelId, { type: 'message', message: placeholder });

  // 3. 启动 agent_run（v1.0 per-channel status 派生，D-1 / D-18）
  //    CP8.3 起仅记录 agent_runs，不再双写 agents.status。
  const run = agentRunRepo.start(db, {
    agent_id: agent.id,
    channel_id: ctx.channelId,
    status: 'thinking',
  });
  broadcastAgentStatus(agent.id, 'thinking', ctx.channelId);

  // 4. cwd 解析（D-21）：从 db handle 反查 project workspace_path
  let cwd: string;
  try {
    cwd = resolveCwd(db, ctx.channelId);
  } catch (e) {
    const errMsg = (e as Error).message;
    log.warn(`[engine] resolveCwd failed: ${errMsg}`);
    agentRunRepo.end(db, run.id, errMsg);
    broadcastAgentStatus(agent.id, 'error', ctx.channelId);
    finalizeError(db, placeholder, errMsg);
    emitSystemError(db, ctx.channelId, agent.name, errMsg);
    return {
      agentReplyMessage: placeholder,
      fullText: '',
      duration_ms: 0,
      ok: false,
      errorMessage: errMsg,
    };
  }

  // 5. 并发队列 + spawn
  const activity = new ActivityRecorder(db, agent.id, ctx.channelId);
  activity.spawnStart(
    `Spawning ${agent.runtime}${agent.model ? ` with model=${agent.model}` : ''}`,
  );

  let streamedChars = 0;
  let hasSwitchedToWorking = false;

  // CP3：注册 abort controller，给 abortAgentRun / abortChannelAgentRuns 用
  const aborter = new AbortController();
  activeAborters.set(run.id, aborter);

  const runResult = await concurrencyQueue.run(() =>
    runWithAdapter(
      adapter,
      {
        prompt: built.prompt,
        model: agent.model,
        reasoning: agent.reasoning,
        thinking: agent.thinking,
        context: agent.context,
        workingDirectory: cwd,
        envVars: agent.env_vars,
        permissive: true,
      },
      {
        signal: aborter.signal,
        onEvent: (event: CLIEvent) => {
          activity.recordEvent(event);

          // 状态切换：首个 text/thinking delta → working
          if (
            !hasSwitchedToWorking &&
            (event.type === 'text.delta' ||
              event.type === 'thinking.delta' ||
              event.type === 'tool.started')
          ) {
            hasSwitchedToWorking = true;
            agentRunRepo.updateStatus(db, run.id, 'working');
            broadcastAgentStatus(agent.id, 'working', ctx.channelId);
          }

          // 流式文本 → 广播 message_stream
          if (event.type === 'text.delta') {
            streamedChars += event.text.length;
            hub.broadcast(ctx.channelId, {
              type: 'message_stream',
              message_id: placeholder.id,
              delta: event.text,
            });
          }

          // 工具调用状态 → system event 可选，MVP 仅通过 activity 记录（前端 Profile 页看）
          if (event.type === 'error') {
            log.warn(`[engine] agent ${agent.name} error: ${event.message}`);
          }
        },
        onStderr: (line) => {
          // Codex 的 stdin 提示等，不需要上报
          if (!line.includes('Reading additional input')) {
            log.warn(`[${agent.name} stderr] ${line.slice(0, 200)}`);
          }
        },
      },
    ),
  );

  // 进程已退出（正常或被 abort），可以解除注册
  activeAborters.delete(run.id);

  // 6. 队列满
  if (!runResult.ok) {
    agentRunRepo.end(db, run.id, 'queue_full');
    broadcastAgentStatus(agent.id, 'error', ctx.channelId);
    const errMsg = 'Too many concurrent requests. Please try again later.';
    finalizeError(db, placeholder, errMsg);
    emitSystemError(db, ctx.channelId, agent.name, errMsg);
    return {
      agentReplyMessage: placeholder,
      fullText: '',
      duration_ms: 0,
      ok: false,
      errorMessage: errMsg,
    };
  }

  const result = runResult.result;
  const fullText = result.fullText.trim();
  const hasError = result.events.some((e) => e.type === 'error');
  const finalOk = !result.timedOut && !hasError && (result.exitCode === 0 || result.exitCode === null);

  // 7. 更新占位消息的最终 content / metadata
  const finalMetadata: MessageMetadata = {
    streaming: false,
    chain_depth: ctx.chainDepth ?? 0,
    triggered_by_message_id: ctx.triggerMessage.id,
    agent_meta: {
      runtime: agent.runtime,
      model: agent.model ?? 'default',
      total_duration_ms: result.duration_ms,
      input_tokens_estimate: built.estimatedTokens,
      output_tokens_estimate: Math.ceil(fullText.length / 4),
    },
    tool_calls: result.events
      .filter((e): e is Extract<CLIEvent, { type: 'tool.completed' }> => e.type === 'tool.completed')
      .map((e) => ({
        tool: e.tool,
        args: {},
        result: e.result,
        success: e.success,
        duration_ms: e.duration_ms,
      })),
  };

  // Sprint 6 CP4：从 tool_call 自动累积 agent_skills
  if (project) {
    try {
      const keys = collectSkillKeysFromEvents(result.events, project.workspace_path);
      for (const key of keys) {
        skillRepo.bumpTouch(db, agent.id, key);
      }
    } catch (e) {
      log.warn(`[engine] skill tracking failed: ${(e as Error).message}`);
    }
  }

  const finalContent = fullText || (finalOk ? '(no response)' : 'Agent failed to produce a response.');
  messageRepo.updateContent(db, placeholder.id, finalContent, finalMetadata);
  const updated = messageRepo.getById(db, placeholder.id) ?? placeholder;

  hub.broadcast(ctx.channelId, {
    type: 'message_done',
    message_id: placeholder.id,
    final_content: finalContent,
    metadata: finalMetadata,
  });

  // 8. 最终状态（CP8.3：仅 agent_runs 表是事实来源；WS 广播给前端派生）
  if (finalOk) {
    agentRunRepo.end(db, run.id);
    broadcastAgentStatus(agent.id, 'idle', ctx.channelId);
  } else {
    const errEvent = result.events.find((e) => e.type === 'error');
    const errMsg = errEvent && 'message' in errEvent ? errEvent.message : 'Unknown error';
    agentRunRepo.end(db, run.id, errMsg);
    broadcastAgentStatus(agent.id, 'error', ctx.channelId);
    emitSystemError(db, ctx.channelId, agent.name, errMsg);
  }

  log.info(
    `[engine] ${agent.name} done: ok=${finalOk} chars=${streamedChars} duration=${result.duration_ms}ms`,
  );

  return {
    agentReplyMessage: updated,
    fullText: finalContent,
    duration_ms: result.duration_ms,
    ok: finalOk,
    errorMessage: finalOk ? undefined : 'Agent responded with error',
  };
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * 广播 agent 状态变更（CP8.3）
 *
 * 仅 emit WebSocket 事件；不再写 agents.status（字段已删除，状态从 agent_runs 派生）。
 * 前端通过 ws-bridge 接收事件并维护 per-channel run map（D-1 / D-18）。
 */
function broadcastAgentStatus(
  agentId: string,
  status: AgentStatus,
  channelId: string,
): void {
  hub.broadcast(channelId, {
    type: 'agent_status',
    agent_id: agentId,
    status,
    channel_id: channelId,
  });
}

/**
 * 解析 Agent spawn 的工作目录（D-21）：从 db handle 反查 project workspace_path。
 */
function resolveCwd(db: Database, channelId: string): string {
  const project = resolveProjectFromDb(db);
  if (!project?.workspace_path) {
    throw new Error(
      `channel ${channelId}'s db is not associated with any project (D-21). Re-open the project from Sidebar.`,
    );
  }
  return project.workspace_path;
}

/** D-21：从 db handle 反查项目 meta（per-project handle pool） */
function resolveProjectFromDb(db: Database) {
  for (const open of listOpenDbs()) {
    if (open.db === db) {
      return projectsService.getByPath(open.workspacePath);
    }
  }
  return null;
}

/**
 * Sprint 6 CP4：从 tool_call.completed 事件抽取 skill_key（顶级 / 二级路径段）。
 *
 * 启发式：
 *   - 找 args 里的 path / file / cwd 字段（adapter 解析后通常会塞 args，可惜 cursor-adapter
 *     在 result.events 里没附带 args，只在 metadata.tool_calls 中。这里改读 result.result 文本
 *     近似匹配 workspace 内相对路径的写法。
 *
 * 折中：result 文本里抓 `<workspace>/foo/bar/...` 的相对路径头一两段。
 *   - 若结果文本没有路径，则 skip。
 *   - dedup 后返回（同一 spawn 内多次写同一目录只 +1）。
 */
function collectSkillKeysFromEvents(
  events: ReadonlyArray<CLIEvent>,
  workspacePath: string,
): string[] {
  const keys = new Set<string>();
  const wsAbs = workspacePath.replace(/\/$/, '');
  for (const e of events) {
    if (e.type !== 'tool.completed') continue;
    const haystack = `${e.result ?? ''}`;
    if (!haystack) continue;
    // 抓所有看起来像 workspace 内相对路径的片段
    // 形式 1：绝对路径包含 workspacePath
    const absRe = new RegExp(
      `${escapeRegex(wsAbs)}\\/([\\w.-]+(?:\\/[\\w.-]+)?)`,
      'g',
    );
    let m;
    while ((m = absRe.exec(haystack))) {
      const seg = m[1];
      if (seg) keys.add(normalizeKey(seg));
    }
    // 形式 2：相对路径直接出现（启发式：以 src/ tests/ scripts/ 等开头）
    const relRe = /(?:^|[\s,(])((?:src|tests?|spec|scripts?|packages|apps|lib|docs|public)\/[\w.-]+(?:\/[\w.-]+)?)/g;
    while ((m = relRe.exec(haystack))) {
      const seg = m[1];
      if (seg) keys.add(normalizeKey(seg));
    }
  }
  return Array.from(keys).slice(0, 12);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeKey(seg: string): string {
  // 取前两段，掐掉文件扩展名
  const parts = seg.split('/').slice(0, 2);
  if (parts[1] && /\./.test(parts[1])) {
    // 是文件 → 只留 dir
    return parts[0] ?? seg;
  }
  return parts.join('/');
}

function emitSystemError(
  db: Database,
  channelId: string,
  agentName: string,
  message: string,
): void {
  const sysMsg = messageRepo.create(db, {
    channel_id: channelId,
    sender_type: 'system',
    sender_id: LOCAL_USER_ID,
    content: `⚠ @${agentName} error: ${message}`,
    metadata: {
      system_event: {
        type: 'agent_error',
        agent: agentName,
        message,
      },
    },
  });
  hub.broadcast(channelId, { type: 'message', message: sysMsg });
}

function finalizeError(db: Database, placeholder: ChatMessage, reason: string): void {
  const meta: MessageMetadata = {
    streaming: false,
  };
  messageRepo.updateContent(db, placeholder.id, `⚠ ${reason}`, meta);
  hub.broadcast(placeholder.channel_id, {
    type: 'message_done',
    message_id: placeholder.id,
    final_content: `⚠ ${reason}`,
    metadata: meta,
  });
}
