/**
 * Active Agents Banner — channel / thread 顶部活跃 agent 进度条
 *
 * Sprint 8 / Lo-22：解决 cold start "60 秒黑屏"焦虑。
 *   - 只在该 channel 有 thinking/working run 时显示，否则 return null
 *   - 单 agent：`Architect is thinking… (0:42)`
 *   - 多 agent：`Architect, Dev are working… (0:13)`（按最早 startedAt 取 elapsed）
 *   - 每 1s tick 更新 elapsed time，没有活跃 run 时不开 timer
 */

import { useEffect, useMemo, useState } from 'react';
import type { AgentRunStatus } from '@slark/shared';
import { useAgentsStore, type ActiveRun } from '../stores/agents';

interface Props {
  channelId: string;
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function statusVerb(status: AgentRunStatus): string {
  if (status === 'thinking') return 'thinking';
  if (status === 'working') return 'working';
  return status;
}

export function ActiveAgentsBanner({ channelId }: Props) {
  // 订阅原始 state 而非 selector 派生（避免每次 store set 都重算 + 触发 re-render）
  const runByAgentChannel = useAgentsStore((s) => s.runByAgentChannel);
  const runStartedAtByAgentChannel = useAgentsStore(
    (s) => s.runStartedAtByAgentChannel,
  );
  const agents = useAgentsStore((s) => s.agents);

  const activeRuns = useMemo<ActiveRun[]>(() => {
    const result: ActiveRun[] = [];
    for (const [agentId, inner] of runByAgentChannel.entries()) {
      const status = inner.get(channelId);
      if (!status || (status !== 'thinking' && status !== 'working')) continue;
      const startedAt =
        runStartedAtByAgentChannel.get(agentId)?.get(channelId) ?? Date.now();
      result.push({ agentId, channelId, status, startedAt });
    }
    return result.sort((a, b) => a.startedAt - b.startedAt);
  }, [runByAgentChannel, runStartedAtByAgentChannel, channelId]);

  const agentsById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);

  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (activeRuns.length === 0) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [activeRuns.length]);

  if (activeRuns.length === 0) return null;

  const earliestStartedAt = activeRuns.reduce<number>(
    (acc, r) => Math.min(acc, r.startedAt),
    activeRuns[0]!.startedAt,
  );
  const elapsed = formatElapsed(now - earliestStartedAt);

  const names = activeRuns
    .map((r) => agentsById.get(r.agentId)?.name ?? 'Agent')
    .slice(0, 3);
  const overflow = activeRuns.length - names.length;
  const namesLabel =
    overflow > 0 ? `${names.join(', ')} +${overflow}` : names.join(', ');

  const verbCounts = activeRuns.reduce<Record<string, number>>((acc, r) => {
    const v = statusVerb(r.status);
    acc[v] = (acc[v] ?? 0) + 1;
    return acc;
  }, {});
  const verb = pickDominantVerb(verbCounts, activeRuns);
  const verbLabel = activeRuns.length > 1 ? `${verb} (${describeMix(activeRuns)})` : verb;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 px-4 py-1.5 border-b-2 border-black bg-[#fff8d8]"
    >
      <span className="relative inline-flex w-2.5 h-2.5">
        <span className="absolute inline-flex w-full h-full rounded-full bg-amber-500 opacity-75 animate-ping" />
        <span className="relative inline-flex w-2.5 h-2.5 rounded-full bg-amber-600" />
      </span>
      <span className="font-mono text-xs font-bold truncate">
        {namesLabel} {activeRuns.length > 1 ? 'are' : 'is'} {verbLabel}…
      </span>
      <span className="font-mono text-xs tabular-nums text-text-secondary ml-auto">
        {elapsed}
      </span>
    </div>
  );
}

function pickDominantVerb(
  counts: Record<string, number>,
  activeRuns: ActiveRun[],
): string {
  if (activeRuns.some((r) => r.status === 'working')) return 'working';
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'thinking';
}

function describeMix(activeRuns: ActiveRun[]): string {
  const t = activeRuns.filter((r) => r.status === 'thinking').length;
  const w = activeRuns.filter((r) => r.status === 'working').length;
  const parts: string[] = [];
  if (w) parts.push(`${w} working`);
  if (t) parts.push(`${t} thinking`);
  return parts.join(' • ');
}
