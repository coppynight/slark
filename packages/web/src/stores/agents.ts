import { create } from 'zustand';
import type { Agent, AgentRunStatus, AgentStatus } from '@slark/shared';
import { listAgents } from '../lib/api';

/**
 * Agents store
 *
 * v1.0 CP8.3：agents.status 字段已从 schema 移除；状态完全由 agent_runs 派生。
 * Per-channel run 状态来自 WebSocket `agent_status` 事件（含 channel_id）。
 *
 * - `runByAgentChannel`: Map<agent_id, Map<channel_id, AgentRunStatus>>
 * - `getDerivedStatus(agentId)`: 任意活跃 run 优先（working > thinking > error > stopped）；否则 'idle'
 * - `getChannelRunStatus(agentId, channelId)`: 该 channel 当前 run 状态（无活跃 run 返回 undefined）
 */

/** Sprint 8 / Lo-22: 单条活跃 run 的运行时元数据，用于 banner 显示 elapsed time */
export interface ActiveRun {
  agentId: string;
  channelId: string;
  status: AgentRunStatus;
  /** 该 status 第一次进入活跃态（thinking 或 working）的时间戳；status 切换不重置 */
  startedAt: number;
}

interface AgentsState {
  agents: Agent[];
  loaded: boolean;
  /** Per-channel 活跃 run 状态：Map<agent_id, Map<channel_id, status>> */
  runByAgentChannel: Map<string, Map<string, AgentRunStatus>>;
  /**
   * Sprint 8 / Lo-22: per (agent, channel) 第一次进入活跃态的时间戳。
   * 用于 Active Agents Banner 显示 "Architect is thinking... (0:42)"。
   * status 在 thinking ↔ working 切换时**不重置**，让用户看到连续累加的等待感。
   * idle / 清除 run 时也清除这个 entry。
   */
  runStartedAtByAgentChannel: Map<string, Map<string, number>>;

  refresh: () => Promise<void>;
  upsert: (agent: Agent) => void;
  remove: (id: string) => void;
  setChannelRunStatus: (agentId: string, channelId: string, status: AgentRunStatus) => void;
  clearChannelRun: (agentId: string, channelId: string) => void;
  /** 是否有任意活跃 run（thinking / working） */
  isAgentActive: (agentId: string) => boolean;
  /** 派生该 agent 的展示状态（任意活跃 run 优先；否则 'idle'） */
  getDerivedStatus: (agentId: string) => AgentStatus;
  /** 该 agent 在指定 channel 的 run 状态（无活跃 run 返回 undefined） */
  getChannelRunStatus: (agentId: string, channelId: string) => AgentRunStatus | undefined;
  /** Sprint 8 / Lo-22: 该 channel 内所有活跃 (status != idle) 的 runs */
  getActiveRunsInChannel: (channelId: string) => ActiveRun[];
  getById: (id: string) => Agent | undefined;
}

const RUN_PRIORITY: AgentRunStatus[] = ['working', 'thinking', 'error', 'stopped'];

export const useAgentsStore = create<AgentsState>((set, get) => ({
  agents: [],
  loaded: false,
  runByAgentChannel: new Map(),
  runStartedAtByAgentChannel: new Map(),

  refresh: async () => {
    const agents = await listAgents();
    set({ agents, loaded: true });
  },
  upsert: (agent) =>
    set((s) => {
      const idx = s.agents.findIndex((a) => a.id === agent.id);
      if (idx >= 0) {
        const next = [...s.agents];
        next[idx] = agent;
        return { agents: next };
      }
      return { agents: [...s.agents, agent] };
    }),
  remove: (id) =>
    set((s) => {
      const nextMap = new Map(s.runByAgentChannel);
      nextMap.delete(id);
      const nextStart = new Map(s.runStartedAtByAgentChannel);
      nextStart.delete(id);
      return {
        agents: s.agents.filter((a) => a.id !== id),
        runByAgentChannel: nextMap,
        runStartedAtByAgentChannel: nextStart,
      };
    }),

  setChannelRunStatus: (agentId, channelId, status) =>
    set((s) => {
      const nextMap = new Map(s.runByAgentChannel);
      const inner = new Map(nextMap.get(agentId) ?? new Map<string, AgentRunStatus>());
      inner.set(channelId, status);
      nextMap.set(agentId, inner);

      // Sprint 8 / Lo-22: 仅当 active run **首次进入** thinking/working 时记 startedAt；
      // thinking → working 切换不重置（保留连续等待感）
      const nextStart = new Map(s.runStartedAtByAgentChannel);
      const innerStart = new Map(
        nextStart.get(agentId) ?? new Map<string, number>(),
      );
      const isActive = status === 'thinking' || status === 'working';
      if (isActive && !innerStart.has(channelId)) {
        innerStart.set(channelId, Date.now());
        nextStart.set(agentId, innerStart);
      } else if (!isActive) {
        innerStart.delete(channelId);
        if (innerStart.size === 0) nextStart.delete(agentId);
        else nextStart.set(agentId, innerStart);
      }
      return {
        runByAgentChannel: nextMap,
        runStartedAtByAgentChannel: nextStart,
      };
    }),

  clearChannelRun: (agentId, channelId) =>
    set((s) => {
      const inner = s.runByAgentChannel.get(agentId);
      if (!inner || !inner.has(channelId)) return {};
      const nextMap = new Map(s.runByAgentChannel);
      const nextInner = new Map(inner);
      nextInner.delete(channelId);
      if (nextInner.size === 0) nextMap.delete(agentId);
      else nextMap.set(agentId, nextInner);
      // 同步清 startedAt
      const nextStart = new Map(s.runStartedAtByAgentChannel);
      const innerStart = nextStart.get(agentId);
      if (innerStart && innerStart.has(channelId)) {
        const nextInnerStart = new Map(innerStart);
        nextInnerStart.delete(channelId);
        if (nextInnerStart.size === 0) nextStart.delete(agentId);
        else nextStart.set(agentId, nextInnerStart);
      }
      return {
        runByAgentChannel: nextMap,
        runStartedAtByAgentChannel: nextStart,
      };
    }),

  isAgentActive: (agentId) => {
    const inner = get().runByAgentChannel.get(agentId);
    if (!inner) return false;
    for (const s of inner.values()) {
      if (s === 'thinking' || s === 'working') return true;
    }
    return false;
  },

  getDerivedStatus: (agentId) => {
    const inner = get().runByAgentChannel.get(agentId);
    if (!inner || inner.size === 0) return 'idle';
    let bestIdx = RUN_PRIORITY.length;
    let best: AgentStatus = 'idle';
    for (const s of inner.values()) {
      const idx = RUN_PRIORITY.indexOf(s);
      if (idx >= 0 && idx < bestIdx) {
        bestIdx = idx;
        best = s;
      }
    }
    return best;
  },

  getChannelRunStatus: (agentId, channelId) => {
    return get().runByAgentChannel.get(agentId)?.get(channelId);
  },

  getActiveRunsInChannel: (channelId) => {
    const state = get();
    const result: ActiveRun[] = [];
    for (const [agentId, inner] of state.runByAgentChannel.entries()) {
      const status = inner.get(channelId);
      if (!status || (status !== 'thinking' && status !== 'working')) continue;
      const startedAt =
        state.runStartedAtByAgentChannel.get(agentId)?.get(channelId) ?? Date.now();
      result.push({ agentId, channelId, status, startedAt });
    }
    return result.sort((a, b) => a.startedAt - b.startedAt);
  },

  getById: (id) => get().agents.find((a) => a.id === id),
}));
