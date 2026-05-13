import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { ChatMessage } from '@slark/shared';
import { useChannelsStore } from '../stores/channels';
import { useAgentsStore } from '../stores/agents';
import { useProjectsStore } from '../stores/projects';
import { useMessagesStore } from '../stores/messages';
import { wsClient } from '../lib/ws';
import { getChannelAgents, stopAllAgents } from '../lib/api';
import { projectChannelPath, projectIndexPath, projectSettingsPath } from '../lib/routes';
import { useChannelCommands } from '../lib/useChannelCommands';
import { useWorkflowsStore } from '../stores/workflows';
import { ChannelHeader } from '../components/ChannelHeader';
import { ActiveAgentsBanner } from '../components/ActiveAgentsBanner';
import { MessageList } from '../components/MessageList';
import { MessageInput } from '../components/MessageInput';
import { ThreadPanel } from '../components/ThreadPanel';
import { AgentProfilePanel } from '../components/AgentProfilePanel';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { TasksPanel } from '../components/TasksPanel';
import { ChannelSettingsDialog } from '../components/ChannelSettingsDialog';

const EMPTY_MESSAGES: ChatMessage[] = [];

export function ChannelPage() {
  const { projectName, channelId } = useParams<{ projectName: string; channelId: string }>();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const threadId = params.get('thread');
  const chatTab = (params.get('chatTab') ?? 'chat') as 'chat' | 'tasks';
  const profileParam = params.get('profile'); // 形如 "agent:{id}"
  const profileAgentId = profileParam?.startsWith('agent:') ? profileParam.slice(6) : null;
  const channels = useChannelsStore((s) => s.channels);
  const channelsLoaded = useChannelsStore((s) => s.loaded);
  const allAgents = useAgentsStore((s) => s.agents);
  const profileAgent = profileAgentId ? allAgents.find((a) => a.id === profileAgentId) : null;
  const projects = useProjectsStore((s) => s.projects);
  // 关键：selector 返回稳定引用（不在 selector 里创建新数组），避免 re-render 循环
  const byChannel = useMessagesStore((s) => s.byChannel);
  const messages = channelId ? byChannel.get(channelId) ?? EMPTY_MESSAGES : EMPTY_MESSAGES;
  const streamBuffers = useMessagesStore((s) => s.streamBuffers);
  const fetchChannel = useMessagesStore((s) => s.fetchChannel);

  const channel = channels.find((c) => c.id === channelId);
  const upsertChannel = useChannelsStore((s) => s.upsert);
  const removeChannel = useChannelsStore((s) => s.remove);
  const [stopAllOpen, setStopAllOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState<{ open: boolean; tab: 'settings' | 'members' }>({
    open: false,
    tab: 'settings',
  });

  useEffect(() => {
    if (!channelId) return;
    void fetchChannel(channelId);
    wsClient.send({ type: 'subscribe_channel', channel_id: channelId });
    return () => {
      wsClient.send({ type: 'unsubscribe_channel', channel_id: channelId });
    };
  }, [channelId, fetchChannel]);

  // 真实 channel-agent 成员（fix: header 右上角人数从全局 11 改为 channel 真实成员数）
  const [channelAgentIds, setChannelAgentIds] = useState<string[]>([]);
  useEffect(() => {
    if (!channelId) {
      setChannelAgentIds([]);
      return;
    }
    let cancelled = false;
    void getChannelAgents(channelId)
      .then((rows) => {
        if (!cancelled) setChannelAgentIds(rows.map((r) => r.id));
      })
      .catch(() => {
        if (!cancelled) setChannelAgentIds([]);
      });
    return () => {
      cancelled = true;
    };
  }, [channelId]);

  const agentsById = useMemo(
    () => new Map(allAgents.map((a) => [a.id, a])),
    [allAgents],
  );

  // hook：必须在所有 early return 之前调用
  const channelCommands = useChannelCommands(channelId ?? null, false);

  // CP5：监听 workflow runs，新触发的 run 自动跳到对应 thread（清掉 TD-11）
  const runsByThread = useWorkflowsStore((s) => s.runsByThread);
  const markAutoJumped = useWorkflowsStore((s) => s.markAutoJumped);
  const hasAutoJumped = useWorkflowsStore((s) => s.hasAutoJumped);

  useEffect(() => {
    if (!channelId) return;
    if (threadId) return; // 用户已经在 thread 里
    // 找该 channel 内最近一个未自动跳过的 active run
    let candidate: { runId: number; threadId: string } | null = null;
    let bestStart = 0;
    for (const r of runsByThread.values()) {
      if (r.channel_id !== channelId) continue;
      if (!r.thread_id) continue;
      if (r.status !== 'running' && r.status !== 'awaiting_approval') continue;
      if (hasAutoJumped(r.id)) continue;
      // 5 秒窗口避免老 run（页面刚加载时 fetch 出来的旧 active run）
      if (Date.now() - r.started_at > 5000) continue;
      if (r.started_at > bestStart) {
        bestStart = r.started_at;
        candidate = { runId: r.id, threadId: r.thread_id };
      }
    }
    if (candidate) {
      markAutoJumped(candidate.runId);
      const next = new URLSearchParams(params);
      next.set('thread', candidate.threadId);
      setParams(next, { replace: true });
    }
  }, [channelId, threadId, runsByThread, markAutoJumped, hasAutoJumped, params, setParams]);

  // Sprint 8 / Ro-5 fix：所有 useMemo 必须在 early return 之前调用，避免 React Hooks 顺序违规。
  // 之前 channelAgentIdSet / channelAgents / projectAgentCount / goalIsPlaceholder 被放在
  // `if (!channel)` 等 early return 之后，导致路由切换 / loading state 时 hook count 漂移，
  // 抛 "Rendered more hooks than during the previous render"。
  const channelAgentIdSet = useMemo(() => new Set(channelAgentIds), [channelAgentIds]);
  const channelAgents = useMemo(
    () => allAgents.filter((a) => channelAgentIdSet.has(a.id)),
    [allAgents, channelAgentIdSet],
  );
  const projectAgentCount = useMemo(() => {
    if (!channel?.project_id) return allAgents.length;
    return allAgents.filter((a) => a.project_id === channel.project_id).length;
  }, [allAgents, channel?.project_id]);
  // Sprint 8 / Lo-13: goal 未设置（空字符串）或仍是 r1 老 project 残留的占位文本时，
  // BuildTeamBanner 提示用户去 Settings 填 goal 再触发 Team Architect。
  const goalIsPlaceholder = useMemo(() => {
    const proj = projects.find((p) => p.id === channel?.project_id);
    const g = (proj?.goal ?? '').trim();
    return g.length === 0 || g.startsWith('(Goal not set yet');
  }, [projects, channel?.project_id]);

  if (!channelId || !projectName) return null;

  // 等 channels 加载完再判断 not-found，避免刷新时闪一下错误页
  if (!channelsLoaded) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-secondary font-mono">
        Loading…
      </div>
    );
  }

  if (!channel) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-secondary font-mono">
        Channel not found.
      </div>
    );
  }

  // 校验 channel 是否属于 URL 中的 project（CP8.1 跨 Project URL 安全）
  // v0 兼容数据可能 channel.project_id 为 null，此时不强制校验
  if (channel.project_id) {
    const project = projects.find((p) => p.name === projectName);
    if (!project || channel.project_id !== project.id) {
      // channel 不属于该 project：跳到该 channel 自己的 project
      const realProject = projects.find((p) => p.id === channel.project_id);
      if (realProject) {
        return <Navigate to={projectChannelPath(realProject.name, channel.id)} replace />;
      }
      return <Navigate to="/" replace />;
    }
  }

  const send = (content: string, opts?: { asTask?: boolean }) => {
    wsClient.send({
      type: 'send_message',
      channel_id: channelId,
      content,
      as_task: opts?.asTask,
    });
  };

  const handleStopAll = () => setStopAllOpen(true);

  const confirmStopAll = async () => {
    if (!channelId) return;
    await stopAllAgents(channelId);
  };

  const openThread = (messageId: string) => {
    const next = new URLSearchParams(params);
    next.set('thread', messageId);
    setParams(next);
  };

  return (
    <div className="flex-1 flex min-w-0 min-h-0">
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <ChannelHeader
          channel={channel}
          memberCount={channelAgents.length + 1}
          onStopAll={handleStopAll}
          onEditChannel={() => setSettingsOpen({ open: true, tab: 'settings' })}
          onManageMembers={() => setSettingsOpen({ open: true, tab: 'members' })}
        />
        <ActiveAgentsBanner channelId={channelId} />
        {(projectAgentCount === 0 || goalIsPlaceholder) && (
          <BuildTeamBanner
            projectName={projectName}
            agentCount={projectAgentCount}
            goalIsPlaceholder={goalIsPlaceholder}
          />
        )}
        {chatTab === 'tasks' ? (
          <TasksPanel channelId={channelId} agents={allAgents} />
        ) : (
          <>
            <MessageList
              messages={messages}
              agentsById={agentsById}
              streamBuffers={streamBuffers}
              onOpenThread={openThread}
              emptyHint={`No messages yet. Try "@${channelAgents[0]?.name ?? 'Agent'} hello".`}
            />
            <MessageInput
              placeholder={`Message #${channel.name} — @AgentName 或 @all 触发响应`}
              onSend={send}
              commands={channelCommands}
            />
          </>
        )}
      </div>
      {/* 右侧第 3 栏：Thread 和 Profile 互斥 */}
      {threadId && channelId && <ThreadPanel channelId={channelId} />}
      {!threadId && profileAgent && <AgentProfilePanel agent={profileAgent} />}

      <ConfirmDialog
        open={stopAllOpen}
        title="STOP ALL AGENTS"
        description={`This will immediately stop all running agents in #${channel.name}. You can provide new guidance before resuming them.`}
        confirmLabel="Stop All Agents"
        danger
        onClose={() => setStopAllOpen(false)}
        onConfirm={confirmStopAll}
      />
      <ChannelSettingsDialog
        open={settingsOpen.open}
        channel={channel}
        initialTab={settingsOpen.tab}
        onClose={() => setSettingsOpen({ open: false, tab: 'settings' })}
        onUpdated={(c) => upsertChannel(c)}
        onDeleted={(id) => {
          removeChannel(id);
          // 删除后回到 Project index（自动跳到下一个 channel）
          navigate(projectIndexPath(projectName));
        }}
      />
    </div>
  );
}

/**
 * 当前 Project 还没有 agent 或 goal 是 OpenProjectDialog 写的占位符时显示的引导 banner。
 * 点击直接跳到 Project Settings 页（用户可以输入 goal + Build Team）。
 */
function BuildTeamBanner({
  projectName,
  agentCount,
  goalIsPlaceholder,
}: {
  projectName: string;
  agentCount: number;
  goalIsPlaceholder: boolean;
}) {
  let message: string;
  if (agentCount === 0) {
    message = goalIsPlaceholder
      ? 'Project 还没有 goal 也没有 AI 团队。打开 Settings 填写 goal，让 Team Architect 推荐合适的成员。'
      : 'Project 还没有 AI 团队。打开 Settings 让 Team Architect 基于 goal 推荐成员。';
  } else {
    message =
      'Goal 还是占位符 — 设置真实 goal 才能让 Team Architect 推荐更准的团队。';
  }
  return (
    <Link
      to={projectSettingsPath(projectName)}
      className="block px-4 py-2 bg-accent-yellow border-b-2 border-black hover:brightness-105"
    >
      <div className="flex items-center gap-2 text-sm">
        <span>✨</span>
        <span className="flex-1">{message}</span>
        <span className="font-bold">Open Settings →</span>
      </div>
    </Link>
  );
}
