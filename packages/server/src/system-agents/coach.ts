/**
 * Coach — 第四个 System Agent（Sprint 5 CP3 / D-15 / D-20 Evolution Loop）
 *
 * 职责：聚合 Evaluator 写入的 agent_observations，找出"反复出现的 negative tag"
 * （≥ COACH_NEGATIVE_THRESHOLD），用 cursor-agent 生成一份 description 修改建议
 * （description_after），落库到 agent_feedback（status='pending'）。
 *
 * 触发：
 *   - Evaluator 每轮跑完后串行调用 runCoachForAgent
 *   - 也可手动 runCoachOnce(db, agentId)
 *
 * 兜底：cursor-agent 不可用 / 解析失败 → 跳过。
 *
 * Q-6 决议：
 *   - description_before 在 agent_feedback 创建时即快照保存；Apply 后即使
 *     description 又被改过，回滚仍能恢复到这条 feedback 之前的状态。
 *   - 若同 agent 已有 status='pending' 的 feedback，本轮跳过（避免堆积）。
 */

import { COACH_NEGATIVE_THRESHOLD, COACH_TIMEOUT_MS, EVALUATOR_WINDOW_MS } from '@slark/shared';
import type { Agent, AgentFeedback, AgentObservation } from '@slark/shared';
import type { Database } from 'better-sqlite3';
import { createSystemAdapter } from '../agents/adapter-factory.js';
import { runWithAdapter } from '../agents/runner.js';
import {
  agentRepo,
  feedbackRepo,
  observationRepo,
} from '../db/repos.js';

interface CoachLogger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

const consoleLog: CoachLogger = {
  info: (m) => console.log(m),
  warn: (m) => console.warn(m),
  error: (m) => console.error(m),
};

export interface CoachRunSummary {
  evaluated: number;
  proposals_created: number;
  skipped: Array<{ agent: string; reason: string }>;
}

/** 跑一轮：遍历所有 agent，触发条件满足的产 description 建议 */
export async function runCoachOnce(
  db: Database,
  logger: CoachLogger = consoleLog,
): Promise<CoachRunSummary> {
  const summary: CoachRunSummary = {
    evaluated: 0,
    proposals_created: 0,
    skipped: [],
  };
  const { adapter, install, noRuntimeAvailable } = await createSystemAdapter();
  if (noRuntimeAvailable) {
    logger.warn(
      '[coach] no coding runtime available (cursor/codex both missing); skipping this tick',
    );
    return summary;
  }
  if (!install.installed) {
    logger.warn(
      `[coach] ${adapter.name} not available${install.error ? `: ${install.error}` : ''}; skipping this tick`,
    );
    return summary;
  }

  const since = Date.now() - EVALUATOR_WINDOW_MS;
  const agents = agentRepo.list(db);
  for (const agent of agents) {
    summary.evaluated += 1;
    try {
      const proposal = await runCoachForAgent(db, agent, since, logger);
      if (proposal) {
        summary.proposals_created += 1;
        logger.info(
          `[coach] new feedback for ${agent.name}: "${proposal.summary}" (id=${proposal.id})`,
        );
      }
    } catch (e) {
      const reason = (e as Error).message;
      summary.skipped.push({ agent: agent.name, reason });
      logger.warn(`[coach] ${agent.name} skipped: ${reason}`);
    }
  }
  return summary;
}

/**
 * 给单个 agent 跑一次 Coach；返回新建的 feedback（pending）。
 * 没达到触发阈值或已有 pending → 返回 null。
 */
export async function runCoachForAgent(
  db: Database,
  agent: Agent,
  since: number,
  logger: CoachLogger = consoleLog,
): Promise<AgentFeedback | null> {
  // 已有 pending 跳过
  const existing = feedbackRepo
    .listByAgent(db, agent.id)
    .find((f) => f.status === 'pending');
  if (existing) {
    logger.info(`[coach] ${agent.name}: pending feedback already exists, skip`);
    return null;
  }

  // 阈值检查：找窗口内出现 ≥ COACH_NEGATIVE_THRESHOLD 次的 negative tag
  const tagCounts = observationRepo.countByTag(db, agent.id, since, 'negative');
  const hot = tagCounts.filter((t) => t.count >= COACH_NEGATIVE_THRESHOLD);
  if (hot.length === 0) return null;

  const observations = observationRepo.listByAgent(db, agent.id, { since, limit: 50 });
  if (observations.length === 0) return null;

  const { adapter, install, noRuntimeAvailable } = await createSystemAdapter();
  if (noRuntimeAvailable) {
    logger.warn(`[coach] ${agent.name}: no coding runtime available; skipping`);
    return null;
  }
  if (!install.installed) {
    logger.warn(
      `[coach] ${agent.name}: ${adapter.name} not available${install.error ? `: ${install.error}` : ''}; skipping`,
    );
    return null;
  }
  const prompt = buildCoachPrompt(agent, observations, hot);
  const result = await runWithAdapter(
    adapter,
    { prompt, permissive: false },
    { timeoutMs: COACH_TIMEOUT_MS },
  );
  if (result.timedOut || result.aborted) {
    throw new Error(result.timedOut ? 'coach timed out' : 'coach aborted');
  }
  if (result.events.some((e) => e.type === 'error')) {
    const err = result.events.find((e) => e.type === 'error');
    throw new Error(err && err.type === 'error' ? err.message : 'coach CLI error');
  }
  const parsed = parseCoachOutput(result.fullText);
  if (!parsed) throw new Error('unparseable coach output');

  const periodStart = since;
  const periodEnd = Date.now();

  return feedbackRepo.create(db, {
    agent_id: agent.id,
    period_start: periodStart,
    period_end: periodEnd,
    summary: parsed.summary,
    rationale: parsed.rationale,
    description_before: agent.description ?? '',
    description_after: parsed.description_after,
    confidence: parsed.confidence,
  });
}

// =============================================================================
// Prompt
// =============================================================================

function buildCoachPrompt(
  agent: Agent,
  observations: AgentObservation[],
  hotTags: Array<{ tag: string; count: number }>,
): string {
  const obsLines = observations
    .map(
      (o) =>
        `- [${o.polarity.toUpperCase()}] (${o.tag}) ${o.body.length > 240 ? `${o.body.slice(0, 240)}…` : o.body}`,
    )
    .join('\n');
  const hotLines = hotTags
    .map((t) => `- ${t.tag}: ${t.count} occurrences`)
    .join('\n');
  return [
    'You are the Coach for an AI engineering agent in Slark. Your job is to propose a small,',
    'targeted edit to the agent\'s system prompt (description) that addresses recurring issues',
    'observed by the Evaluator, while preserving the agent\'s identity and useful traits.',
    '',
    `Agent name: ${agent.name}`,
    'Current description (system prompt):',
    agent.description ?? '(none)',
    '',
    'Recurring negative patterns (≥ threshold):',
    hotLines,
    '',
    'All recent observations (newest first):',
    obsLines,
    '',
    'Rules:',
    '- "summary": ≤ 80 chars, what this proposal changes (e.g. "Always wrap async in try/catch").',
    '- "rationale": 2-4 sentences, explain why and what evidence supports it.',
    '- "description_after": full revised description (do not truncate). Keep changes additive when possible — append new guidance or tighten phrasing rather than rewriting.',
    '- "confidence": 0.0-1.0.',
    '- DO NOT propose a change unless ≥ 1 hot pattern is genuinely actionable. If unsure, return null fields and confidence ≤ 0.3 for the user to discard.',
    '',
    'Reply with STRICT JSON ONLY. No markdown fences, no commentary.',
    'Schema:',
    '{',
    '  "summary": "...",',
    '  "rationale": "...",',
    '  "description_after": "...",',
    '  "confidence": 0.7',
    '}',
    '',
    'Return JSON ONLY.',
  ].join('\n');
}

interface CoachProposal {
  summary: string;
  rationale: string;
  description_after: string;
  confidence: number;
}

function parseCoachOutput(raw: string): CoachProposal | null {
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
  const summary = typeof o.summary === 'string' ? o.summary.trim().slice(0, 200) : '';
  const rationale = typeof o.rationale === 'string' ? o.rationale.trim().slice(0, 2000) : '';
  const descriptionAfter =
    typeof o.description_after === 'string' ? o.description_after.trim() : '';
  const confidence = clampConfidence(o.confidence);
  if (!summary || !rationale || !descriptionAfter) return null;
  if (confidence < 0.3) return null; // 不够 confident 就丢
  return { summary, rationale, description_after: descriptionAfter, confidence };
}

function clampConfidence(v: unknown): number {
  const n = typeof v === 'number' ? v : 0.5;
  if (Number.isNaN(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

function stripJSONFences(text: string): string {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return match ? match[1] ?? '' : text;
}
