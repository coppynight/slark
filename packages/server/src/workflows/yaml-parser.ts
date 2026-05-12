/**
 * Workflow YAML Parser & Validator（Sprint 2 CP2）
 *
 * 解析 workflows.definition_yaml 为 WorkflowDefinition；做引用合法性校验。
 * Q-4 决议：YAML 顶层 `version: "1"` 是软声明，缺失时默认 "1"。
 */

import { parse as parseYaml } from 'yaml';
import type { Agent, WorkflowDefinition, WorkflowStep } from '@slark/shared';

export class WorkflowYamlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowYamlError';
  }
}

const VALID_ACTIONS = new Set(['approve_or_reject', 'close_thread']);
const COMMAND_RE = /^\/[a-z][a-z0-9-]*$/;

export function parseWorkflowYaml(yamlText: string): WorkflowDefinition {
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlText);
  } catch (e) {
    throw new WorkflowYamlError(`YAML syntax error: ${(e as Error).message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new WorkflowYamlError('top-level must be a mapping');
  }
  const obj = parsed as Record<string, unknown>;

  // version
  const version = typeof obj.version === 'string' ? obj.version : '1';
  if (version !== '1') {
    throw new WorkflowYamlError(
      `unsupported workflow version "${version}" (only "1" is supported in Sprint 2)`,
    );
  }

  // name
  if (typeof obj.name !== 'string' || !obj.name.trim()) {
    throw new WorkflowYamlError('`name` is required and must be a non-empty string');
  }

  // description
  const description =
    typeof obj.description === 'string' ? obj.description : undefined;

  // trigger.command
  const trigger = obj.trigger;
  if (
    !trigger ||
    typeof trigger !== 'object' ||
    Array.isArray(trigger) ||
    typeof (trigger as Record<string, unknown>).command !== 'string'
  ) {
    throw new WorkflowYamlError('`trigger.command` is required (string)');
  }
  const command = (trigger as Record<string, unknown>).command as string;
  if (!COMMAND_RE.test(command)) {
    throw new WorkflowYamlError(
      `trigger.command "${command}" must match /^\\/[a-z][a-z0-9-]*$/ (e.g. "/new-feature")`,
    );
  }

  // steps
  if (!Array.isArray(obj.steps) || obj.steps.length === 0) {
    throw new WorkflowYamlError('`steps` must be a non-empty array');
  }
  const steps: WorkflowStep[] = [];
  const ids = new Set<string>();
  for (const [i, raw] of obj.steps.entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new WorkflowYamlError(`steps[${i}] must be a mapping`);
    }
    const s = raw as Record<string, unknown>;
    if (typeof s.id !== 'string' || !s.id.trim()) {
      throw new WorkflowYamlError(`steps[${i}].id is required (non-empty string)`);
    }
    if (ids.has(s.id)) {
      throw new WorkflowYamlError(`duplicate step id "${s.id}"`);
    }
    ids.add(s.id);

    const action = typeof s.action === 'string' ? s.action : undefined;
    if (action && !VALID_ACTIONS.has(action)) {
      throw new WorkflowYamlError(
        `steps[${i}].action "${action}" must be one of: ${[...VALID_ACTIONS].join(', ')}`,
      );
    }

    if (action !== 'close_thread') {
      // close_thread 可以省略 owner
      if (typeof s.owner !== 'string' || !s.owner.trim()) {
        throw new WorkflowYamlError(
          `steps[${i}] (id="${s.id}").owner is required (e.g. "@Architect" or "local-user")`,
        );
      }
    }

    steps.push({
      id: s.id,
      owner: typeof s.owner === 'string' ? s.owner : '',
      action: action as WorkflowStep['action'],
      on_complete: optString(s.on_complete),
      on_approve: optString(s.on_approve),
      on_reject: optString(s.on_reject),
      input: optString(s.input),
      output: optString(s.output),
      description: optString(s.description),
    });
  }

  // 引用合法性
  for (const s of steps) {
    if (s.action === 'approve_or_reject') {
      if (!s.on_approve) {
        throw new WorkflowYamlError(
          `step "${s.id}" has action=approve_or_reject but no on_approve`,
        );
      }
      if (!s.on_reject) {
        throw new WorkflowYamlError(
          `step "${s.id}" has action=approve_or_reject but no on_reject`,
        );
      }
    }
    // owner='local-user' 仅在 approve_or_reject 步骤合法（Sprint 2 范围）
    if (s.owner === 'local-user' && s.action !== 'approve_or_reject') {
      throw new WorkflowYamlError(
        `step "${s.id}" owner is "local-user" but action != approve_or_reject; ` +
          'Sprint 2 only supports local-user for approval steps.',
      );
    }
    for (const ref of [s.on_complete, s.on_approve, s.on_reject, s.input]) {
      if (ref && !ids.has(ref)) {
        throw new WorkflowYamlError(`step "${s.id}" references unknown step "${ref}"`);
      }
    }
  }

  return {
    version,
    name: obj.name.trim(),
    description,
    trigger: { command },
    steps,
  };
}

function optString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

/** 找 owner 引用的 agent 名（"@Foo" → "Foo"）；非 @ 前缀返回 null */
export function parseAgentMention(owner: string): string | null {
  if (owner.startsWith('@')) return owner.slice(1);
  return null;
}

/**
 * Sprint 8 / Lo-26 修复：把 workflow step.owner（`@X`）解析到 channel 内具体 agent。
 *
 * 双路径解析：
 *   1. 先按 agent.name 大小写不敏感匹配（保留 pre-v0.3 行为，兼容 `@Architect` 等命名引用）
 *   2. 退化按 agent.role 大小写不敏感匹配（让 builtin templates 可用 `@implementer` 这种角色占位符）
 *
 * 命中后 `matchedBy` 标识匹配通道，用于 telemetry / 错误信息构造。
 */
export function resolveOwnerToAgent(
  channelAgents: Agent[],
  ownerRef: string,
): { agent: Agent; matchedBy: 'name' | 'role' } | null {
  const ref = parseAgentMention(ownerRef);
  if (!ref) return null;
  const lower = ref.toLowerCase();
  const byName = channelAgents.find((a) => a.name.toLowerCase() === lower);
  if (byName) return { agent: byName, matchedBy: 'name' };
  const byRole = channelAgents.find(
    (a) => typeof a.role === 'string' && a.role.toLowerCase() === lower,
  );
  if (byRole) return { agent: byRole, matchedBy: 'role' };
  return null;
}

/**
 * 构造可读的"找不到 agent"错误：列出当前 team 名字+角色，便于 UI 提示用户调整。
 */
export function formatOwnerResolveError(
  stepId: string,
  ownerRef: string,
  channelAgents: Agent[],
): string {
  const ref = parseAgentMention(ownerRef) ?? ownerRef;
  if (channelAgents.length === 0) {
    return `step "${stepId}": no agents in this channel (workflow needs @${ref})`;
  }
  const summary = channelAgents
    .map((a) => (a.role ? `@${a.name} (role=${a.role})` : `@${a.name}`))
    .join(', ');
  return (
    `step "${stepId}": no agent matches @${ref} ` +
    `(by name or role). Current team: ${summary}. ` +
    `Hint: rename an agent to @${ref} or set its role="${ref}".`
  );
}
