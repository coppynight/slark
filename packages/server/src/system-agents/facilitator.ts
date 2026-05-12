/**
 * Facilitator — 第六个 System Agent（Sprint 7 / D-15 / 核心差异化）
 *
 * 职责：根据 Project 现有 Team 成员 + 用户输入的 goal，模拟一次"团队讨论"，
 * 产出一份合规的 Workflow YAML draft。用户在 UI 中 Approve 后，YAML 才落到
 * `workflows` 表。
 *
 * 实现说明（Sprint 7 MVP）：
 *   - **单次 spawn**，prompt 内让 cursor-agent 扮演 Facilitator + 各 Team 成员的
 *     圆桌讨论；最终 emit 一份完整 YAML。
 *   - 对比 product-brief §D-4 的"真正多 agent 多轮讨论"，这是简化版；下一阶段
 *     可扩展为多轮串行 spawn（Sprint 8+）。
 *
 * 兜底：cursor-agent 不可用 / 解析失败 → 返回 fallback，Caller（runner）写
 * status='failed' + fallback_reason，UI 提示用户走 Sprint 2 Template 路径。
 */

import { FACILITATOR_TIMEOUT_MS } from '@slark/shared';
import type { Agent, Project } from '@slark/shared';
import { createSystemAdapter } from '../agents/adapter-factory.js';
import { runWithAdapter } from '../agents/runner.js';
import { parseWorkflowYaml, WorkflowYamlError } from '../workflows/yaml-parser.js';

interface FacilitatorLogger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
}

const consoleLog: FacilitatorLogger = {
  info: (m) => console.log(m),
  warn: (m) => console.warn(m),
};

export interface FacilitatorInput {
  project: Project;
  agents: Agent[];
  goal_input: string;
}

export interface FacilitatorOutput {
  ok: boolean;
  yaml?: string;
  rationale?: string;
  fallback_reason?: string;
}

export async function runFacilitator(
  input: FacilitatorInput,
  logger: FacilitatorLogger = consoleLog,
): Promise<FacilitatorOutput> {
  const { adapter, install, noRuntimeAvailable } = await createSystemAdapter();
  if (noRuntimeAvailable) {
    logger.warn(
      '[facilitator] no coding runtime available (cursor/codex both missing); falling back',
    );
    return {
      ok: false,
      fallback_reason:
        'no coding runtime available (install cursor-agent or codex CLI, or set SLARK_SYSTEM_RUNTIME)',
    };
  }
  if (!install.installed) {
    return {
      ok: false,
      fallback_reason: `${adapter.name} not available${install.error ? `: ${install.error}` : ''}`,
    };
  }
  if (input.agents.length === 0) {
    return { ok: false, fallback_reason: 'project has no agents to design a workflow with' };
  }

  const prompt = buildFacilitatorPrompt(input);
  try {
    const result = await runWithAdapter(
      adapter,
      { prompt, permissive: false },
      { timeoutMs: FACILITATOR_TIMEOUT_MS },
    );
    if (result.timedOut) return { ok: false, fallback_reason: 'Facilitator timed out' };
    if (result.aborted) return { ok: false, fallback_reason: 'Facilitator aborted' };
    if (result.events.some((e) => e.type === 'error')) {
      const err = result.events.find((e) => e.type === 'error');
      return {
        ok: false,
        fallback_reason:
          err && err.type === 'error' ? err.message : 'Facilitator CLI error',
      };
    }
    const parsed = parseFacilitatorOutput(result.fullText);
    if (!parsed) return { ok: false, fallback_reason: 'Facilitator returned unparseable output' };

    // 最终验证 YAML：必须能通过 workflow YAML parser
    try {
      parseWorkflowYaml(parsed.yaml);
    } catch (e) {
      const msg = e instanceof WorkflowYamlError ? e.message : (e as Error).message;
      logger.warn(`[facilitator] generated YAML rejected by parser: ${msg}`);
      return { ok: false, fallback_reason: `generated YAML invalid: ${msg}` };
    }

    return { ok: true, yaml: parsed.yaml, rationale: parsed.rationale };
  } catch (e) {
    return { ok: false, fallback_reason: `Facilitator spawn failed: ${(e as Error).message}` };
  }
}

// =============================================================================
// Prompt
// =============================================================================

function buildFacilitatorPrompt(input: FacilitatorInput): string {
  const team = input.agents
    .map(
      (a) =>
        `- @${a.name} (${a.runtime}) — ${a.description ? a.description.split(/[\n。.]/)[0]?.slice(0, 120) : 'no description'}`,
    )
    .join('\n');

  return [
    'You are the Facilitator for an AI engineering team in Slark. Your job is to host a',
    "short round-table discussion among the team members and emit a Workflow YAML draft",
    'that captures the consensus of how this group would deliver the goal.',
    '',
    `Project: ${input.project.display_name ?? input.project.name}`,
    `Project goal: ${input.project.goal}`,
    `Workspace: ${input.project.workspace_path}`,
    '',
    'Team members:',
    team,
    '',
    `User's request for THIS workflow: ${input.goal_input}`,
    '',
    'Style rules:',
    '- Internally simulate one round of discussion (each agent speaks briefly), but do NOT include',
    '  the dialogue in your reply — only the final YAML and a one-paragraph rationale.',
    '- Include exactly one "await_approval" step where it makes sense (typically after a design or',
    '  spec step). Wire its on_approve and on_reject targets correctly.',
    '- End with an "id: done" step that uses action: close_thread.',
    '- Use existing team member names with @ prefix as step owners. If a step requires the user,',
    '  set owner: "local-user" with action: approve_or_reject.',
    '',
    'Emit STRICT JSON ONLY. No markdown fences, no extra prose.',
    'Schema:',
    '{',
    '  "yaml": "<full workflow yaml as a single string with \\n line breaks>",',
    '  "rationale": "one paragraph"',
    '}',
    '',
    'YAML must follow Slark schema: top-level keys version (string "1"), name, description?,',
    'trigger.command (slash-prefixed slug), and steps[] each with id + owner + optional action /',
    'on_complete / on_approve / on_reject / input / description.',
    '',
    'Return JSON ONLY.',
  ].join('\n');
}

interface ParsedFacilitator {
  yaml: string;
  rationale: string;
}

function parseFacilitatorOutput(raw: string): ParsedFacilitator | null {
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
  const yaml = typeof o.yaml === 'string' ? o.yaml.trim() : '';
  const rationale = typeof o.rationale === 'string' ? o.rationale.trim() : '';
  if (!yaml) return null;
  return { yaml, rationale };
}

function stripJSONFences(text: string): string {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return match ? match[1] ?? '' : text;
}
