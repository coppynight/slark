/**
 * BuildTeamDialog —— 给已有 Project 触发 Team Architect 推荐 + Approve 创建 agents
 *
 * 与旧 CreateProjectDialog 三步向导的关系：
 *   - 旧 CreateProjectDialog 在创建 Project 时一并 build team（Step 1 + 2 + 3）
 *   - 新 OpenProjectDialog 把 Project 创建简化到 1 步（无 team）
 *   - BuildTeamDialog 是后续补 team 的入口，由 ProjectSettingsPage 的 Team section 调用
 *
 * 流程：
 *   Step A. 接入时若 project.goal 是占位符（OpenProjectDialog 写的 "(Goal not set yet — ...)"），
 *          先让用户改 goal，PATCH /api/projects 持久化
 *   Step B. 调 suggestTeam → 展示推荐卡片（同 CreateProjectDialog Step 2 视觉）
 *   Step C. Approve → 批量 createAgent（带 thinking/context）+ join 该 project 的 #general channel
 *           （或第一个 channel）
 *
 * 关闭条件：creating 中禁止关闭，避免半成品 Project。
 */

import { useEffect, useState } from 'react';
import type { Project, Runtime, TeamSuggestion } from '@slark/shared';
import { GOAL_MAX_LENGTH } from '@slark/shared';
import {
  createAgent,
  joinChannel,
  listChannels,
  suggestTeam,
  updateProject,
} from '../lib/api';
import { useAgentsStore } from '../stores/agents';
import { useProjectsStore } from '../stores/projects';
import { Dialog } from './Dialog';
import { cn } from '../lib/cn';

interface Props {
  open: boolean;
  onClose: () => void;
  project: Project;
  onCreated?: () => void | Promise<void>;
}

const PLACEHOLDER_GOAL_PREFIX = '(Goal not set yet';

type Phase = 'goal' | 'suggesting' | 'review' | 'creating' | 'done';

export function BuildTeamDialog({ open, onClose, project, onCreated }: Props) {
  const upsertProject = useProjectsStore((s) => s.upsert);
  const upsertAgent = useAgentsStore((s) => s.upsert);

  const [phase, setPhase] = useState<Phase>('goal');
  const [goal, setGoal] = useState('');
  const [suggestion, setSuggestion] = useState<TeamSuggestion | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      const isPlaceholder = (project.goal ?? '').startsWith(PLACEHOLDER_GOAL_PREFIX);
      setGoal(isPlaceholder ? '' : project.goal ?? '');
      setSuggestion(null);
      setError(null);
      setPhase('goal');
    }
  }, [open, project.id, project.goal]);

  const goalValid = goal.trim().length > 0 && goal.trim().length <= GOAL_MAX_LENGTH;

  const handleSuggestTeam = async () => {
    if (!goalValid) return;
    setPhase('suggesting');
    setError(null);
    try {
      // 先持久化 goal（如果发生改动）
      if (goal.trim() !== (project.goal ?? '')) {
        const updated = await updateProject(project.id, { goal: goal.trim() });
        upsertProject(updated);
      }
      const res = await suggestTeam({
        goal: goal.trim(),
        workspace_path: project.workspace_path,
      });
      setSuggestion(res);
      setPhase('review');
    } catch (e) {
      setError(`Team Architect failed: ${(e as Error).message}`);
      setPhase('goal');
    }
  };

  const handleApprove = async () => {
    if (!suggestion) return;
    setPhase('creating');
    setError(null);
    try {
      // 找 project 的第一个 channel（OpenProjectDialog 创建时会 seed #general；
      // 若用户后来改了，仍取第一个作为新 agent 的归属）
      const channels = await listChannels(project.id);
      const targetChannel = channels[0];
      if (!targetChannel) {
        throw new Error('Project 没有任何 channel；请先创建一个');
      }

      const created = await Promise.all(
        suggestion.agents.map((a) =>
          createAgent({
            name: ensureUniqueName(a.name),
            description: a.description,
            runtime: (a.runtime || 'cursor') as Runtime,
            model: a.model || undefined,
            reasoning: a.reasoning,
            thinking: a.thinking ?? null,
            context: a.context ?? null,
            project_id: project.id,
          }),
        ),
      );
      created.forEach(upsertAgent);

      await Promise.all(created.map((a) => joinChannel(targetChannel.id, a.id)));

      if (onCreated) await onCreated();
      setPhase('done');
      onClose();
    } catch (e) {
      setError(`Failed to create agents: ${(e as Error).message}`);
      setPhase('review');
    }
  };

  const handleClose = () => {
    if (phase === 'creating' || phase === 'suggesting') return;
    onClose();
  };

  const title =
    phase === 'review' ? 'Review recommended team' : '✨ Build Team from Goal';

  return (
    <Dialog open={open} title={title} onClose={handleClose} maxWidth={680}>
      {phase === 'goal' && (
        <div className="p-5 space-y-4">
          <div className="text-sm text-text-secondary">
            Describe what this project is about. Team Architect will recommend 3–5 AI agents
            with role-matched models (claude-opus / gpt-5.5 / gemini-3.1-pro etc.).
          </div>
          <label className="block">
            <div className="text-xs font-bold mb-1.5">PROJECT GOAL</div>
            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={5}
              maxLength={GOAL_MAX_LENGTH}
              autoFocus
              placeholder="例：一个本地 AI Team OS。用户填 Goal，AI 自动配团队，团队自己设计 Workflow…"
              className="w-full px-3 py-2 border-2 border-black rounded font-mono text-sm bg-bg-main focus:outline-none focus:bg-white resize-y"
            />
            <div className="text-[11px] font-mono text-text-muted mt-1 text-right">
              {goal.length} / {GOAL_MAX_LENGTH}
            </div>
          </label>
          {error && (
            <div className="border-2 border-red-700 rounded p-2 bg-red-50 text-sm text-red-700">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 border-2 border-black rounded bg-bg-card font-bold hover:bg-accent-yellow"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSuggestTeam()}
              disabled={!goalValid}
              className={cn(
                'px-5 py-2 border-2 border-black rounded font-bold shadow-[3px_3px_0_0_#000]',
                goalValid
                  ? 'bg-accent-pink hover:brightness-105'
                  : 'bg-[#f5bfd2] opacity-60 cursor-not-allowed',
              )}
            >
              Recommend Team →
            </button>
          </div>
        </div>
      )}

      {phase === 'suggesting' && (
        <div className="p-8 text-center">
          <div className="animate-pulse font-mono text-sm">
            Team Architect is analyzing your goal…
          </div>
          <div className="text-[11px] font-mono text-text-secondary mt-2">
            Spawning Cursor backend (timeout 30s)
          </div>
        </div>
      )}

      {phase === 'review' && suggestion && (
        <div className="p-5 space-y-4">
          {suggestion.is_fallback && (
            <div className="p-3 border-2 border-black rounded bg-accent-yellow text-sm">
              <div className="font-bold mb-1">⚠ Team Suggestion unavailable</div>
              <div className="text-[13px]">
                Showing default team. Configure model / reasoning per agent in Profile after creation.
              </div>
              {suggestion.fallback_reason && (
                <div className="text-[11px] font-mono text-text-secondary mt-2">
                  reason: {suggestion.fallback_reason}
                </div>
              )}
            </div>
          )}
          {!suggestion.is_fallback && suggestion.rationale && (
            <div className="text-[13px] text-text-secondary border-l-2 border-black pl-3 italic">
              {suggestion.rationale}
            </div>
          )}
          <div className="space-y-2">
            <div className="section-header">RECOMMENDED TEAM</div>
            {suggestion.agents.map((agent, i) => (
              <div key={i} className="p-3 border-2 border-black rounded bg-bg-card">
                <div className="flex items-center justify-between mb-1 gap-2">
                  <div className="font-bold flex-shrink-0">{agent.name}</div>
                  <div className="flex gap-1 flex-wrap justify-end">
                    <Tag>{agent.role}</Tag>
                    {agent.model && <Tag>{agent.model}</Tag>}
                    {agent.reasoning && <Tag>{agent.reasoning}</Tag>}
                    {agent.thinking === true && <Tag>thinking</Tag>}
                    {agent.context && <Tag>{agent.context.toUpperCase()}</Tag>}
                  </div>
                </div>
                <div className="text-[12px] text-text-secondary font-mono">
                  {agent.description}
                </div>
              </div>
            ))}
          </div>
          {error && (
            <div className="border-2 border-red-700 rounded p-2 bg-red-50 text-sm text-red-700">
              {error}
            </div>
          )}
          <div className="flex justify-between gap-2 pt-3 border-t-2 border-black/10 -mx-5 px-5">
            <button
              type="button"
              onClick={() => setPhase('goal')}
              className="px-4 py-2 border-2 border-black rounded bg-bg-card font-bold hover:bg-accent-yellow"
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={() => void handleApprove()}
              className="px-5 py-2 border-2 border-black rounded bg-accent-pink font-bold hover:brightness-105 shadow-[3px_3px_0_0_#000]"
            >
              Approve & Create
            </button>
          </div>
        </div>
      )}

      {phase === 'creating' && (
        <div className="p-8 text-center">
          <div className="animate-pulse font-mono text-sm">Creating agents…</div>
        </div>
      )}
    </Dialog>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block px-2 py-0.5 border-2 border-black rounded bg-accent-teal text-[11px] font-mono">
      {children}
    </span>
  );
}

/** 重名追加 -2/-3... 由 server `getByName` 校验 + 这里前置避免 409；与 OpenProjectDialog 同思路 */
function ensureUniqueName(base: string): string {
  const all = useAgentsStore.getState().agents;
  const used = new Set(all.map((a) => a.name));
  if (!used.has(base)) return base;
  let i = 2;
  while (used.has(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}
