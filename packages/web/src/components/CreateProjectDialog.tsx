/**
 * Create Project 三步向导（Sprint 1 CP5a）
 *
 * Step 1: Project basics（Name slug / Display Name / Workspace Path / Goal / Team Rules）
 * Step 2: Team Suggestion（调 POST /api/projects/suggest-team，展示推荐 Team 卡片，兜底提示）
 * Step 3: Create（创建 Project + 创建 #general channel + 批量创建 Agents + 加入 channel）
 *
 * 对齐 product-brief.md §3 场景 A / D-3 / D-19。
 * 对齐 PLAN.md Sprint 1 §1.3.2。
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Project, TeamSuggestion, TeamSuggestionAgent } from '@slark/shared';
import { GOAL_MAX_LENGTH } from '@slark/shared';
import {
  createAgent,
  createChannel,
  createProject,
  joinChannel,
  suggestTeam,
} from '../lib/api';
import { useChannelsStore } from '../stores/channels';
import { useAgentsStore } from '../stores/agents';
import { useProjectsStore } from '../stores/projects';
import { cn } from '../lib/cn';
import { projectChannelPath } from '../lib/routes';
import { Dialog } from './Dialog';

interface Props {
  open: boolean;
  onClose: () => void;
}

type Step = 1 | 2 | 3;

const SLUG_RE = /^[a-z0-9_-]+$/;

function toSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function CreateProjectDialog({ open, onClose }: Props) {
  const navigate = useNavigate();
  const upsertProject = useProjectsStore((s) => s.upsert);
  const upsertChannel = useChannelsStore((s) => s.upsert);
  const upsertAgent = useAgentsStore((s) => s.upsert);

  const [step, setStep] = useState<Step>(1);

  // Step 1 fields
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [workspacePath, setWorkspacePath] = useState('');
  const [goal, setGoal] = useState('');
  const [teamRules, setTeamRules] = useState('');

  // Step 2 state
  const [suggestion, setSuggestion] = useState<TeamSuggestion | null>(null);
  const [loadingSuggest, setLoadingSuggest] = useState(false);

  // Step 3 state
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameSlug = toSlug(name);
  const step1Valid =
    nameSlug.length > 0 &&
    SLUG_RE.test(nameSlug) &&
    workspacePath.trim().length > 0 &&
    goal.trim().length > 0 &&
    goal.trim().length <= GOAL_MAX_LENGTH;

  const reset = () => {
    setStep(1);
    setName('');
    setDisplayName('');
    setWorkspacePath('');
    setGoal('');
    setTeamRules('');
    setSuggestion(null);
    setLoadingSuggest(false);
    setCreating(false);
    setError(null);
  };

  const handleClose = () => {
    if (creating) return; // 正在 creating 时阻止关闭
    reset();
    onClose();
  };

  const goStep2 = async () => {
    if (!step1Valid) return;
    setStep(2);
    setSuggestion(null);
    setLoadingSuggest(true);
    setError(null);
    try {
      const res = await suggestTeam({
        goal: goal.trim(),
        workspace_path: workspacePath.trim(),
      });
      setSuggestion(res);
    } catch (e) {
      setError(`Failed to get team suggestion: ${(e as Error).message}`);
    } finally {
      setLoadingSuggest(false);
    }
  };

  const handleApprove = async () => {
    if (!suggestion) return;
    setCreating(true);
    setError(null);
    try {
      // 1. 创建 Project
      const project: Project = await createProject({
        name: nameSlug,
        display_name: displayName.trim() || null,
        workspace_path: workspacePath.trim(),
        goal: goal.trim(),
        team_rules: teamRules.trim() || null,
      });
      upsertProject(project);

      // 2. 创建 #general channel（绑定 project_id）
      const channel = await createChannel({
        name: 'general',
        description: `General channel for ${project.display_name ?? project.name}`,
        type: 'channel',
        project_id: project.id,
      });
      upsertChannel(channel);

      // 3. 批量创建 Agents
      const createdAgents = await Promise.all(
        suggestion.agents.map(async (a) => {
          // 兜底 runtime 为空的 Agent 也要创建，但写 'cursor' 作为占位（用户 Approve 后还需编辑）。
          // 如果后端检测到 Codex 可用，fallback/suggestion 会直接返回 runtime='codex'。
          const runtime = a.runtime || 'cursor';
          const payload = {
            name: ensureUniqueName(a.name),
            role: a.role ?? undefined,
            description: a.description,
            runtime,
            model: a.model || undefined,
            reasoning: a.reasoning,
            thinking: a.thinking ?? null,
            context: a.context ?? null,
            project_id: project.id,
          };
          return createAgent(payload);
        }),
      );
      createdAgents.forEach(upsertAgent);

      // 4. 把 Agents 加入 #general channel
      await Promise.all(createdAgents.map((a) => joinChannel(channel.id, a.id)));

      // 5. 切换到新 Project 并导航到 channel（CP8.1 — Project scope 路由）
      useProjectsStore.getState().setCurrent(project.id);
      navigate(projectChannelPath(project.name, channel.id));
      reset();
      onClose();
    } catch (e) {
      setError(`Failed to create project: ${(e as Error).message}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} title={`CREATE PROJECT — STEP ${step}/3`} onClose={handleClose} maxWidth={560}>
      {step === 1 && (
        <Step1
          name={name}
          setName={setName}
          nameSlug={nameSlug}
          displayName={displayName}
          setDisplayName={setDisplayName}
          workspacePath={workspacePath}
          setWorkspacePath={setWorkspacePath}
          goal={goal}
          setGoal={setGoal}
          teamRules={teamRules}
          setTeamRules={setTeamRules}
          canProceed={step1Valid}
          onNext={() => void goStep2()}
          onCancel={handleClose}
        />
      )}
      {step === 2 && (
        <Step2
          goal={goal}
          suggestion={suggestion}
          loading={loadingSuggest}
          error={error}
          creating={creating}
          onBack={() => setStep(1)}
          onApprove={() => void handleApprove()}
        />
      )}
      {step === 3 && null /* 目前 Step 3 合并到 Step 2 的 Approve 动作里，创建完直接跳转频道 */}
    </Dialog>
  );
}

// 防止 Agent name 跟已有 Agent 重名（简单递增 "-1" / "-2"）
function ensureUniqueName(desired: string): string {
  const existing = useAgentsStore.getState().agents.map((a) => a.name);
  if (!existing.includes(desired)) return desired;
  let n = 2;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for (const _ of existing) {
    const candidate = `${desired}-${n}`;
    if (!existing.includes(candidate)) return candidate;
    n += 1;
  }
  return `${desired}-${Date.now()}`;
}

// =============================================================================
// Step 1
// =============================================================================
function Step1({
  name,
  setName,
  nameSlug,
  displayName,
  setDisplayName,
  workspacePath,
  setWorkspacePath,
  goal,
  setGoal,
  teamRules,
  setTeamRules,
  canProceed,
  onNext,
  onCancel,
}: {
  name: string;
  setName: (v: string) => void;
  nameSlug: string;
  displayName: string;
  setDisplayName: (v: string) => void;
  workspacePath: string;
  setWorkspacePath: (v: string) => void;
  goal: string;
  setGoal: (v: string) => void;
  teamRules: string;
  setTeamRules: (v: string) => void;
  canProceed: boolean;
  onNext: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="p-5 space-y-4">
      <FieldLabel label="NAME" required hint="URL slug: lowercase, digits, _ and - only" />
      <div className="space-y-1">
        <input
          type="text"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. my-project"
          className="w-full px-3 py-2 border-2 border-black rounded bg-bg-card focus:outline-none focus:ring-2 focus:ring-accent-pink"
        />
        {name && nameSlug !== name && (
          <div className="text-[11px] font-mono text-text-secondary">
            will use: <code className="bg-accent-yellow px-1 rounded">{nameSlug}</code>
          </div>
        )}
      </div>

      <FieldLabel label="DISPLAY NAME" optional />
      <input
        type="text"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        placeholder="e.g. My Project"
        className="w-full px-3 py-2 border-2 border-black rounded bg-bg-card focus:outline-none focus:ring-2 focus:ring-accent-pink"
      />

      <FieldLabel label="WORKSPACE PATH" required hint="absolute path to the code repository" />
      <input
        type="text"
        value={workspacePath}
        onChange={(e) => setWorkspacePath(e.target.value)}
        placeholder="/Users/you/code/my-project"
        className="w-full px-3 py-2 border-2 border-black rounded bg-bg-card font-mono text-sm focus:outline-none focus:ring-2 focus:ring-accent-pink"
      />

      <FieldLabel
        label="GOAL"
        required
        hint={`what this project sets out to do (max ${GOAL_MAX_LENGTH} chars)`}
      />
      <div className="space-y-1">
        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="e.g. Build an OAuth SSO service for internal tools"
          rows={3}
          maxLength={GOAL_MAX_LENGTH + 50}
          className="w-full px-3 py-2 border-2 border-black rounded bg-bg-card resize-none focus:outline-none focus:ring-2 focus:ring-accent-pink"
        />
        <div
          className={cn(
            'text-right text-[10px] font-mono',
            goal.length > GOAL_MAX_LENGTH ? 'text-accent-red' : 'text-text-muted',
          )}
        >
          {goal.length}/{GOAL_MAX_LENGTH}
        </div>
      </div>

      <FieldLabel label="TEAM RULES" optional hint="ground rules injected into every agent prompt" />
      <textarea
        value={teamRules}
        onChange={(e) => setTeamRules(e.target.value)}
        placeholder="e.g. All agents reply in English. Ask for approval before making destructive changes."
        rows={2}
        className="w-full px-3 py-2 border-2 border-black rounded bg-bg-card resize-none focus:outline-none focus:ring-2 focus:ring-accent-pink"
      />

      <div className="flex justify-end gap-2 pt-3 border-t-2 border-black/10 -mx-5 px-5">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 border-2 border-black rounded bg-bg-card font-bold hover:bg-accent-yellow"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!canProceed}
          className={cn(
            'px-4 py-2 border-2 border-black rounded font-bold',
            canProceed
              ? 'bg-accent-pink hover:brightness-105'
              : 'bg-[#f5bfd2] opacity-60 cursor-not-allowed',
          )}
        >
          Next: Suggest Team →
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// Step 2
// =============================================================================
function Step2({
  goal,
  suggestion,
  loading,
  error,
  creating,
  onBack,
  onApprove,
}: {
  goal: string;
  suggestion: TeamSuggestion | null;
  loading: boolean;
  error: string | null;
  creating: boolean;
  onBack: () => void;
  onApprove: () => void;
}) {
  return (
    <div className="p-5 space-y-4">
      <div className="text-sm">
        <span className="section-header">GOAL</span>
        <div className="p-3 border-2 border-black rounded bg-bg-main mt-1 font-mono text-[13px]">
          {goal}
        </div>
      </div>

      {loading && (
        <div className="p-6 text-center border-2 border-black rounded bg-bg-main">
          <div className="animate-pulse font-mono text-sm">
            Team Architect is analyzing your goal…
          </div>
          <div className="text-[11px] font-mono text-text-secondary mt-2">
            Spawning local coding runtime (timeout 30s)
          </div>
        </div>
      )}

      {!loading && suggestion && (
        <>
          {suggestion.is_fallback && (
            <div className="p-3 border-2 border-black rounded bg-accent-yellow text-sm">
              <div className="font-bold mb-1">⚠ Team Suggestion unavailable</div>
              <div className="text-[13px]">
                Showing default team. Please configure{' '}
                <span className="font-mono">runtime</span> /{' '}
                <span className="font-mono">model</span> for each agent after creation.
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
              <AgentCard key={i} agent={agent} />
            ))}
            <div className="text-[11px] font-mono text-text-secondary pl-1">
              ℹ Approve 之后可在 Sidebar 的 Members tab 点 agent 头像，进 Profile 调整
              model / reasoning。
            </div>
          </div>
        </>
      )}

      {error && (
        <div className="p-3 border-2 border-accent-red rounded bg-accent-red/20 text-sm">
          {error}
        </div>
      )}

      <div className="flex justify-between gap-2 pt-3 border-t-2 border-black/10 -mx-5 px-5">
        <button
          type="button"
          onClick={onBack}
          disabled={creating}
          className="px-4 py-2 border-2 border-black rounded bg-bg-card font-bold hover:bg-accent-yellow disabled:opacity-50"
        >
          ← Back
        </button>
        <button
          type="button"
          onClick={onApprove}
          disabled={!suggestion || creating}
          className={cn(
            'px-4 py-2 border-2 border-black rounded font-bold',
            suggestion && !creating
              ? 'bg-accent-pink hover:brightness-105'
              : 'bg-[#f5bfd2] opacity-60 cursor-not-allowed',
          )}
        >
          {creating ? 'Creating…' : 'Approve & Create'}
        </button>
      </div>
    </div>
  );
}

function AgentCard({ agent }: { agent: TeamSuggestionAgent }) {
  return (
    <div className="p-3 border-2 border-black rounded bg-bg-card">
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
      <div className="text-[12px] text-text-secondary font-mono">{agent.description}</div>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-1.5 py-0.5 text-[10px] font-mono border-2 border-black rounded bg-accent-teal">
      {children}
    </span>
  );
}

function FieldLabel({
  label,
  required,
  optional,
  hint,
}: {
  label: string;
  required?: boolean;
  optional?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <label className="section-header block">
        {label}
        {required && <span className="text-accent-pink"> *</span>}
        {optional && (
          <span className="text-text-muted text-[11px] font-mono normal-case ml-1">(optional)</span>
        )}
      </label>
      {hint && (
        <div className="text-[11px] font-mono text-text-muted mt-0.5 normal-case">{hint}</div>
      )}
    </div>
  );
}
