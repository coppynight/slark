/**
 * Derive responsibilities from a workflow's YAML definition (Sprint 3 CP1)
 *
 * 规则：
 *   - step.action === 'close_thread'                    → 不写 responsibility
 *   - step.owner === 'local-user' (action=approve_or_reject) → role='approver', authority='must_approve'
 *   - step.owner === '@AgentName'                       → role='executor', authority='no_authority'
 *
 * 找不到对应 agent 时，记 'unresolved:<mention>' 占位，运行时 Runner 会发出 system error。
 *
 * 调用时机：
 *   - workflow 创建（POST /api/projects/:id/workflows）
 *   - workflow 更新（PATCH /api/workflows/:id 当 definition_yaml 变化时）
 */

import type { Database } from 'better-sqlite3';
import type {
  Responsibility,
  ResponsibilityAuthority,
  ResponsibilityRole,
} from '@slark/shared';
import { agentRepo, responsibilityRepo, workflowRepo } from '../db/repos.js';
import {
  parseAgentMention,
  parseWorkflowYaml,
  resolveOwnerToAgent,
} from './yaml-parser.js';

export interface DeriveResult {
  /** 写入的责任行（已 INSERT） */
  rows: Responsibility[];
  /** YAML 引用了项目内不存在的 agent name；UI 可警告用户 */
  unresolved: Array<{ step_id: string; mention: string }>;
}

export function deriveResponsibilitiesForWorkflow(
  db: Database,
  workflowId: string,
): DeriveResult {
  const wf = workflowRepo.getById(db, workflowId);
  if (!wf) throw new Error(`workflow ${workflowId} not found`);

  const def = parseWorkflowYaml(wf.definition_yaml);
  const projectAgents = agentRepo.list(db);

  const newRows: Array<{
    step_id: string;
    agent_id: string;
    role: ResponsibilityRole;
    authority: ResponsibilityAuthority | null;
  }> = [];
  const unresolved: Array<{ step_id: string; mention: string }> = [];

  for (const step of def.steps) {
    if (step.action === 'close_thread') continue;

    if (step.owner === 'local-user') {
      newRows.push({
        step_id: step.id,
        agent_id: 'local-user',
        role: 'approver',
        authority: 'must_approve',
      });
      continue;
    }

    const mention = parseAgentMention(step.owner);
    if (!mention) continue;

    // Sprint 8 / Lo-26: 与 Runner 一致的双路径解析（byName → byRole）。
    // 注：这里在"全 project agents"范围内（不局限 channel），用法跟 Runner 不同但解析规则一致。
    const resolved = resolveOwnerToAgent(projectAgents, step.owner);

    if (resolved) {
      newRows.push({
        step_id: step.id,
        agent_id: resolved.agent.id,
        role: 'executor',
        authority: 'no_authority',
      });
    } else {
      newRows.push({
        step_id: step.id,
        agent_id: `unresolved:${mention}`,
        role: 'executor',
        authority: 'no_authority',
      });
      unresolved.push({ step_id: step.id, mention });
    }
  }

  const rows = responsibilityRepo.replaceForWorkflow(db, workflowId, newRows);
  return { rows, unresolved };
}
