/**
 * Evaluator — 第三个 System Agent（Sprint 5 CP2 / D-15 / D-20 Evolution Loop）
 *
 * 职责：周期性扫描每个 agent 在评估窗口内的近 N 条 message + tool_calls，
 * 给出标记化的 observations（polarity + tag + body），落库 agent_observations。
 *
 * Coach（CP3）会从 agent_observations 聚合产出 description 修改建议。
 *
 * 调度：
 *   - 启动时立刻评估一次（针对 EVALUATOR_WINDOW_MS 窗口内活动）
 *   - 之后每 EVALUATOR_WINDOW_MS 评估一次（默认 24h）
 *   - 也提供 runEvaluatorOnce(db) 给 REST 手动触发用
 *
 * 兜底：cursor-agent 不可用 → 跳过该轮（不阻塞）。
 */

import { EVALUATOR_TIMEOUT_MS, EVALUATOR_WINDOW_MS } from '@slark/shared';
import type {
  Agent,
  ChatMessage,
  ObservationPolarity,
} from '@slark/shared';
import type { Database } from 'better-sqlite3';
import { createSystemAdapter } from '../agents/adapter-factory.js';
import { runWithAdapter } from '../agents/runner.js';
import type { CLIAdapter } from '../agents/types.js';
import { agentRepo, messageRepo, observationRepo } from '../db/repos.js';
import { runCoachOnce } from './coach.js';

interface EvaluatorLogger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

const consoleLog: EvaluatorLogger = {
  info: (m) => console.log(m),
  warn: (m) => console.warn(m),
  error: (m) => console.error(m),
};

let evaluatorTimer: NodeJS.Timeout | null = null;

/**
 * D-21：scheduler 不再持有单一 db handle；tick 时遍历所有 open project db 各跑一轮。
 */
export function startEvaluatorScheduler(logger: EvaluatorLogger = consoleLog): void {
  if (evaluatorTimer) return;
  const tick = async () => {
    try {
      // 延迟导入避免循环依赖
      const { listOpenDbs } = await import('../db/index.js');
      for (const open of listOpenDbs()) {
        try {
          await runEvaluatorOnce(open.db, logger);
          await runCoachOnce(open.db, logger);
        } catch (e) {
          logger.error(
            `[evaluator] project ${open.workspacePath} tick failed: ${(e as Error).message}`,
          );
        }
      }
    } catch (e) {
      logger.error(`[evaluator] tick failed: ${(e as Error).message}`);
    }
  };
  setTimeout(() => {
    void tick();
    evaluatorTimer = setInterval(() => void tick(), EVALUATOR_WINDOW_MS);
    if (typeof evaluatorTimer.unref === 'function') evaluatorTimer.unref();
  }, 60_000);
}

export function stopEvaluatorScheduler(): void {
  if (evaluatorTimer) {
    clearInterval(evaluatorTimer);
    evaluatorTimer = null;
  }
}

export interface EvaluatorRunSummary {
  agents_evaluated: number;
  observations_created: number;
  skipped: Array<{ agent: string; reason: string }>;
}

/**
 * 跑一轮评估：遍历所有 agent，对每个有近期活动的 agent 产 observations。
 * 失败的 agent 被跳过；返回汇总。
 */
export async function runEvaluatorOnce(
  db: Database,
  logger: EvaluatorLogger = consoleLog,
): Promise<EvaluatorRunSummary> {
  const { adapter, install, noRuntimeAvailable } = await createSystemAdapter();
  if (noRuntimeAvailable) {
    logger.warn(
      '[evaluator] no coding runtime available (cursor/codex both missing); skipping',
    );
    return { agents_evaluated: 0, observations_created: 0, skipped: [] };
  }
  if (!install.installed) {
    logger.warn(
      `[evaluator] ${adapter.name} not available${install.error ? `: ${install.error}` : ''}; skipping`,
    );
    return { agents_evaluated: 0, observations_created: 0, skipped: [] };
  }

  const since = Date.now() - EVALUATOR_WINDOW_MS;
  const agents = agentRepo.list(db);
  let observationsCreated = 0;
  let evaluated = 0;
  const skipped: Array<{ agent: string; reason: string }> = [];

  for (const agent of agents) {
    const recentMsgs = recentAgentMessages(db, agent.id, since, 30);
    if (recentMsgs.length === 0) {
      continue;
    }
    evaluated += 1;
    try {
      const obs = await evaluateAgent(adapter, agent, recentMsgs);
      if (obs.length === 0) continue;
      for (const o of obs) {
        observationRepo.create(db, {
          agent_id: agent.id,
          polarity: o.polarity,
          tag: o.tag,
          body: o.body,
          source_message_id: o.source_message_id,
        });
        observationsCreated += 1;
      }
      logger.info(
        `[evaluator] ${agent.name}: ${obs.length} observation(s) recorded`,
      );
    } catch (e) {
      const reason = (e as Error).message;
      skipped.push({ agent: agent.name, reason });
      logger.warn(`[evaluator] ${agent.name} skipped: ${reason}`);
    }
  }

  return { agents_evaluated: evaluated, observations_created: observationsCreated, skipped };
}

// =============================================================================
// 单个 agent 的评估
// =============================================================================

interface EvaluatorObservation {
  polarity: ObservationPolarity;
  tag: string;
  body: string;
  source_message_id: string | null;
}

async function evaluateAgent(
  adapter: CLIAdapter,
  agent: Agent,
  msgs: ChatMessage[],
): Promise<EvaluatorObservation[]> {
  const prompt = buildEvaluatorPrompt(agent, msgs);
  const result = await runWithAdapter(
    adapter,
    { prompt, permissive: false },
    { timeoutMs: EVALUATOR_TIMEOUT_MS },
  );
  if (result.timedOut || result.aborted) {
    throw new Error(result.timedOut ? 'evaluator timed out' : 'evaluator aborted');
  }
  if (result.events.some((e) => e.type === 'error')) {
    const err = result.events.find((e) => e.type === 'error');
    throw new Error(err && err.type === 'error' ? err.message : 'evaluator CLI error');
  }
  const parsed = parseEvaluatorOutput(result.fullText);
  if (!parsed) throw new Error('unparseable evaluator output');
  return parsed;
}

function buildEvaluatorPrompt(agent: Agent, msgs: ChatMessage[]): string {
  const transcript = msgs
    .map((m) => {
      const speaker =
        m.sender_type === 'user' ? '[user]' : m.sender_type === 'system' ? '[system]' : '[agent]';
      const content = m.content.length > 1200 ? `${m.content.slice(0, 1200)}…` : m.content;
      return `${speaker} (${m.id.slice(0, 8)}) ${content}`;
    })
    .join('\n\n');

  return [
    `You are the Evaluator. Look at recent messages produced by an agent and tag specific observations.`,
    '',
    `Agent name: ${agent.name}`,
    `Agent description (current system prompt):`,
    agent.description ?? '(none)',
    '',
    '--- RECENT TRANSCRIPT (most recent first) ---',
    transcript,
    '--- END TRANSCRIPT ---',
    '',
    'Rules:',
    '- Only emit observations that are SPECIFIC and ACTIONABLE.',
    '- "polarity": "negative" for issues, "positive" for noteworthy strengths, "neutral" for facts.',
    '- "tag": short snake_case label (e.g. "missing_error_handling", "good_test_coverage", "verbose_replies").',
    '- "body": one or two sentences with concrete evidence; cite a message id if obvious.',
    '- "source_message_id": an 8-char prefix is fine; we will resolve full id ourselves. null if not applicable.',
    '- Limit to ≤ 5 observations per call. Skip nothing-to-say cases (return []).',
    '',
    'Reply with STRICT JSON ONLY. No markdown fences, no commentary.',
    'Schema:',
    '{ "observations": [ { "polarity": "negative", "tag": "...", "body": "...", "source_message_id": null } ] }',
    '',
    'Return JSON ONLY.',
  ].join('\n');
}

function parseEvaluatorOutput(raw: string): EvaluatorObservation[] | null {
  const cleaned = stripJSONFences(raw).trim();
  if (!cleaned) return null;
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first < 0 || last <= first) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(cleaned.slice(first, last + 1));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  if (!Array.isArray(o.observations)) return null;
  const out: EvaluatorObservation[] = [];
  for (const raw of o.observations.slice(0, 5)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const polarity =
      typeof r.polarity === 'string' &&
      (r.polarity === 'positive' || r.polarity === 'negative' || r.polarity === 'neutral')
        ? r.polarity
        : 'neutral';
    const tag = typeof r.tag === 'string' ? r.tag.trim().slice(0, 80) : '';
    const body = typeof r.body === 'string' ? r.body.trim().slice(0, 500) : '';
    if (!tag || !body) continue;
    out.push({
      polarity,
      tag,
      body,
      source_message_id:
        typeof r.source_message_id === 'string' && r.source_message_id.trim()
          ? r.source_message_id.trim()
          : null,
    });
  }
  return out;
}

function stripJSONFences(text: string): string {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return match ? match[1] ?? '' : text;
}

/**
 * 找该 agent 在 since 之后发出的最近 N 条 agent 消息（不含 system / user）。
 * SQL: messages WHERE sender_type='agent' AND sender_id=? AND created_at>=?
 */
function recentAgentMessages(
  db: Database,
  agentId: string,
  since: number,
  limit: number,
): ChatMessage[] {
  // 复用 messageRepo 没有现成方法，直接查 db
  const rows = db
    .prepare(
      `SELECT * FROM messages
       WHERE sender_type='agent' AND sender_id=? AND created_at >= ?
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(agentId, since, limit) as Array<{
    id: string;
    channel_id: string;
    sender_type: string;
    sender_id: string | null;
    content: string;
    metadata_json: string | null;
    parent_id: string | null;
    reply_count: number;
    created_at: number;
  }>;
  return rows.map((r) => {
    return messageRepo.getById(db, r.id) ?? {
      id: r.id,
      channel_id: r.channel_id,
      sender_type: 'agent',
      sender_id: r.sender_id,
      content: r.content,
      metadata: null,
      parent_id: r.parent_id,
      reply_count: r.reply_count,
      created_at: r.created_at,
    };
  });
}
