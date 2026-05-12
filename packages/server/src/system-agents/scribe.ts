/**
 * Scribe — 第二个 System Agent（Sprint 4 CP2 / D-15 / D-20 Delivery Loop）
 *
 * 职责：在 Workflow Run 完成 / Thread 解决 / 用户 /sediment 时被调用，回扫 thread
 * 内全部消息（含 system message + agent reply + tool_calls 摘要），提炼出可沉淀的
 * decisions（项目级决策）和 lessons（经验条目）。
 *
 * 输入：
 *   - thread 完整消息序列（按时间序）
 *   - workflow_run 的 workflow.name + initial_input
 *
 * 输出（严格 JSON）：
 *   {
 *     "decisions": [{ title, body, audience?, confidence }],
 *     "lessons":   [{ kind, title, body, audience?, tags?, confidence }]
 *   }
 *
 * 兜底：spawn 失败 / 超时 / JSON 解析失败 → 返回空数组（不阻塞 workflow 流程）。
 *
 * 状态：
 *   Scribe 写入的条目默认 review_status='pending' + recorded_by='scribe'，
 *   等用户在 Intelligence Tab 手动 approve 后才注入 prompt。
 */

import { SCRIBE_TIMEOUT_MS } from '@slark/shared';
import type {
  ChatMessage,
  Decision,
  Lesson,
  LessonKind,
} from '@slark/shared';
import { createSystemAdapter } from '../agents/adapter-factory.js';
import { runWithAdapter } from '../agents/runner.js';
import { decisionRepo, lessonRepo } from '../db/repos.js';
import type { Database } from 'better-sqlite3';

export interface ScribeInput {
  // D-21：project_id 不再需要 — db 已经是 per-project handle
  /** 触发场景，影响 prompt 提示语 */
  trigger:
    | { kind: 'workflow_run'; workflow_name: string; initial_input?: string; run_id: number }
    | { kind: 'thread'; thread_summary: string }
    | { kind: 'manual'; reason?: string };
  /** thread 内全部消息（按时间序）—— Scribe 只读此切片 */
  thread_messages: ChatMessage[];
  /** Agent name → role 的简单映射，用于解读 thread */
  agent_role_map?: Record<string, string>;
}

export interface ScribeOutput {
  decisions: Array<{
    title: string;
    body: string;
    audience: string;
    confidence: number;
    source_message_id: string | null;
  }>;
  lessons: Array<{
    kind: LessonKind;
    title: string;
    body: string;
    audience: string;
    tags: string[];
    confidence: number;
    source_message_id: string | null;
  }>;
  is_fallback: boolean;
  fallback_reason?: string;
}

/**
 * 调用 Scribe 处理 thread；不写 db。
 * Caller（runner / route）负责把结果写入 decisions / lessons 表（review_status='pending'）。
 */
export async function runScribe(input: ScribeInput): Promise<ScribeOutput> {
  const { adapter, install, noRuntimeAvailable } = await createSystemAdapter();
  if (noRuntimeAvailable) {
    console.warn(
      '[scribe] no coding runtime available (cursor/codex both missing); skipping sediment',
    );
    return emptyOutput(
      'no coding runtime available (install cursor-agent or codex CLI, or set SLARK_SYSTEM_RUNTIME)',
    );
  }
  if (!install.installed) {
    return emptyOutput(
      `${adapter.name} not available${install.error ? `: ${install.error}` : ''}`,
    );
  }

  if (input.thread_messages.length === 0) {
    return emptyOutput('thread is empty');
  }

  const prompt = buildScribePrompt(input);

  try {
    const result = await runWithAdapter(
      adapter,
      { prompt, permissive: false },
      { timeoutMs: SCRIBE_TIMEOUT_MS },
    );
    if (result.timedOut) return emptyOutput('Scribe spawn timed out');
    if (result.aborted) return emptyOutput('Scribe spawn aborted');
    if (result.events.some((e) => e.type === 'error')) {
      const err = result.events.find((e) => e.type === 'error');
      const msg = err && err.type === 'error' ? err.message : 'Scribe CLI error';
      return emptyOutput(msg);
    }
    const parsed = parseScribeOutput(result.fullText);
    if (!parsed) {
      return emptyOutput('Scribe returned unparseable output');
    }
    return { ...parsed, is_fallback: false };
  } catch (e) {
    return emptyOutput(`Scribe spawn failed: ${(e as Error).message}`);
  }
}

/**
 * 把 Scribe 的输出写入 db（pending review 状态，等用户手动审批）。
 * 返回创建的实体数量。
 */
export function persistScribeOutput(
  db: Database,
  output: ScribeOutput,
  context: { source_run_id: number | null },
): { decisions: Decision[]; lessons: Lesson[] } {
  const decisions: Decision[] = [];
  const lessons: Lesson[] = [];

  for (const d of output.decisions) {
    const created = decisionRepo.create(db, {
      title: d.title,
      body: d.body,
      audience: d.audience,
      source_run_id: context.source_run_id,
      source_message_id: d.source_message_id,
      confidence: d.confidence,
      review_status: 'pending',
      recorded_by: 'scribe',
    });
    decisions.push(created);
  }

  for (const l of output.lessons) {
    const created = lessonRepo.create(db, {
      kind: l.kind,
      title: l.title,
      body: l.body,
      audience: l.audience,
      tags: l.tags,
      source_run_id: context.source_run_id,
      source_message_id: l.source_message_id,
      confidence: l.confidence,
      review_status: 'pending',
      recorded_by: 'scribe',
    });
    lessons.push(created);
  }

  return { decisions, lessons };
}

// =============================================================================
// Prompt 构造
// =============================================================================

function buildScribePrompt(input: ScribeInput): string {
  const triggerLine =
    input.trigger.kind === 'workflow_run'
      ? `Workflow run completed: "${input.trigger.workflow_name}"${input.trigger.initial_input ? ` — user request: "${input.trigger.initial_input}"` : ''}`
      : input.trigger.kind === 'thread'
        ? `Thread sediment requested: ${input.trigger.thread_summary}`
        : `Manual sediment requested${input.trigger.reason ? `: ${input.trigger.reason}` : ''}`;

  const transcript = serializeThread(input.thread_messages, input.agent_role_map);

  return [
    'You are the Scribe for an AI engineering team in Slark. Your job is to skim a finished thread and',
    'extract durable knowledge: decisions (one-shot choices the team made) and lessons (reusable insights).',
    '',
    triggerLine,
    '',
    '--- THREAD TRANSCRIPT ---',
    transcript,
    '--- END TRANSCRIPT ---',
    '',
    'Rules:',
    '- Only sediment things that are likely useful next time. Skip pleasantries, status updates, restating the goal.',
    '- A decision is a specific committed choice (e.g. "Use PKCE flow for SPA OAuth").',
    '- A lesson is a reusable insight ("dont": pitfalls; "do": good practices; "pattern": reusable structures; "pitfall": warnings).',
    '- "audience": who should see this next time. Use one of: "all" (everyone), "team" (any agent), or an agent role like "Architect" / "Reviewer".',
    '- Keep titles ≤ 80 chars. Bodies ≤ 400 chars.',
    '- "source_message_id": copy the closest message id from the transcript when applicable; otherwise null.',
    '- "confidence": 0.0-1.0. Use ≤ 0.5 if the thread is ambiguous.',
    '',
    'Reply with STRICT JSON ONLY. No markdown fences, no commentary.',
    'Schema:',
    '{',
    '  "decisions": [',
    '    { "title": "...", "body": "...", "audience": "all", "confidence": 0.8, "source_message_id": "..." }',
    '  ],',
    '  "lessons": [',
    '    { "kind": "do", "title": "...", "body": "...", "audience": "Reviewer", "tags": ["security"], "confidence": 0.7, "source_message_id": null }',
    '  ]',
    '}',
    '',
    'If nothing is worth sedimenting, return { "decisions": [], "lessons": [] }.',
    'Return JSON ONLY.',
  ].join('\n');
}

function serializeThread(
  msgs: ChatMessage[],
  roles?: Record<string, string>,
): string {
  const lines: string[] = [];
  for (const m of msgs) {
    const senderLabel =
      m.sender_type === 'user'
        ? '[user]'
        : m.sender_type === 'system'
          ? '[system]'
          : `[agent ${roles?.[m.sender_id ?? ''] ?? m.sender_id ?? ''}]`;
    const id = `(${m.id.slice(0, 8)})`;
    const content = m.content.length > 1500 ? `${m.content.slice(0, 1500)}…` : m.content;
    lines.push(`${senderLabel} ${id} ${content}`);
  }
  return lines.join('\n\n');
}

// =============================================================================
// JSON 解析
// =============================================================================

function parseScribeOutput(raw: string): Omit<ScribeOutput, 'is_fallback'> | null {
  const cleaned = stripJSONFences(raw).trim();
  if (!cleaned) return null;
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first < 0 || last <= first) return null;
  const candidate = cleaned.slice(first, last + 1);

  let obj: unknown;
  try {
    obj = JSON.parse(candidate);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;

  const decisions: ScribeOutput['decisions'] = [];
  if (Array.isArray(o.decisions)) {
    for (const raw of o.decisions) {
      if (!raw || typeof raw !== 'object') continue;
      const d = raw as Record<string, unknown>;
      const title = typeof d.title === 'string' ? d.title.trim() : '';
      const body = typeof d.body === 'string' ? d.body.trim() : '';
      if (!title || !body) continue;
      decisions.push({
        title: title.slice(0, 200),
        body: body.slice(0, 2000),
        audience: typeof d.audience === 'string' && d.audience.trim() ? d.audience.trim() : 'all',
        confidence: clampConfidence(d.confidence),
        source_message_id:
          typeof d.source_message_id === 'string' && d.source_message_id.trim()
            ? d.source_message_id.trim()
            : null,
      });
    }
  }

  const lessons: ScribeOutput['lessons'] = [];
  if (Array.isArray(o.lessons)) {
    for (const raw of o.lessons) {
      if (!raw || typeof raw !== 'object') continue;
      const l = raw as Record<string, unknown>;
      const title = typeof l.title === 'string' ? l.title.trim() : '';
      const body = typeof l.body === 'string' ? l.body.trim() : '';
      if (!title || !body) continue;
      const kindRaw = typeof l.kind === 'string' ? l.kind.trim() : '';
      const kind: LessonKind =
        kindRaw === 'do' || kindRaw === 'dont' || kindRaw === 'pattern' || kindRaw === 'pitfall'
          ? kindRaw
          : 'do';
      const tagsRaw = Array.isArray(l.tags) ? l.tags : [];
      const tags = tagsRaw
        .filter((t): t is string => typeof t === 'string')
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
        .slice(0, 8);
      lessons.push({
        kind,
        title: title.slice(0, 200),
        body: body.slice(0, 2000),
        audience: typeof l.audience === 'string' && l.audience.trim() ? l.audience.trim() : 'all',
        tags,
        confidence: clampConfidence(l.confidence),
        source_message_id:
          typeof l.source_message_id === 'string' && l.source_message_id.trim()
            ? l.source_message_id.trim()
            : null,
      });
    }
  }

  return { decisions, lessons };
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

function emptyOutput(reason: string): ScribeOutput {
  return {
    decisions: [],
    lessons: [],
    is_fallback: true,
    fallback_reason: reason,
  };
}
