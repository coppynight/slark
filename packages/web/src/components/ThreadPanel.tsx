/**
 * Thread Panel — 右侧第 3 栏
 * 参考: docs/ui-reference/screenshots/50-thread-panel-desktop.png
 *
 * URL 参数：?thread={rootMessageId}
 * 点击 "N replies" 按钮打开，点 X 关闭
 */

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ChatMessage, MessageMetadata } from '@slark/shared';
import { getChannelMessages } from '../lib/api';
import { useMessagesStore } from '../stores/messages';
import { useAgentsStore } from '../stores/agents';
import { wsClient } from '../lib/ws';
import { useChannelCommands } from '../lib/useChannelCommands';
import { ActiveAgentsBanner } from './ActiveAgentsBanner';
import { ApprovalCard } from './ApprovalCard';
import { Message } from './Message';
import { MessageInput } from './MessageInput';
import { WorkflowProgress } from './WorkflowProgress';

interface Props {
  channelId: string;
}

export function ThreadPanel({ channelId }: Props) {
  const [params, setParams] = useSearchParams();
  const threadId = params.get('thread');
  const agents = useAgentsStore((s) => s.agents);
  const streamBuffers = useMessagesStore((s) => s.streamBuffers);
  const byChannel = useMessagesStore((s) => s.byChannel);
  const upsertMessage = useMessagesStore((s) => s.upsertMessage);
  const finalizeMessage = useMessagesStore((s) => s.finalizeMessage);
  const [rootMessage, setRootMessage] = useState<ChatMessage | null>(null);
  const [threadMessages, setThreadMessages] = useState<ChatMessage[]>([]);

  const agentsById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);

  useEffect(() => {
    if (!threadId) {
      setRootMessage(null);
      setThreadMessages([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const msgs = await getChannelMessages(channelId, { parent_id: threadId });
        if (cancelled) return;
        const root = msgs[0] ?? null;
        const replies = msgs.slice(1);
        setRootMessage(root);
        setThreadMessages(replies);
      } catch (e) {
        console.error('failed to load thread', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [threadId, channelId]);

  // 订阅实时消息：新消息如果 parent_id === threadId，加入 thread
  useEffect(() => {
    if (!threadId) return;
    // 监听 store 内的 channel 消息；新的 thread reply 其实也会进 byChannel（Message Router 的 create
    // 带上 parent_id，广播事件中就有这条 message）
    const channelMessages = byChannel.get(channelId) ?? [];
    const threadReplies = channelMessages.filter((m) => m.parent_id === threadId);
    if (threadReplies.length > 0) {
      // 合并去重
      setThreadMessages((prev) => {
        const ids = new Set(prev.map((m) => m.id));
        const merged = [...prev];
        for (const m of threadReplies) {
          if (!ids.has(m.id)) merged.push(m);
          else {
            // 更新
            const idx = merged.findIndex((x) => x.id === m.id);
            if (idx >= 0) merged[idx] = m;
          }
        }
        merged.sort((a, b) => a.created_at - b.created_at);
        return merged;
      });
    }
  }, [byChannel, channelId, threadId]);

  // 不必要： WS bridge 已经负责接收 message / message_done
  // Thread Panel 自己的 state 靠上面的 effect 同步
  void upsertMessage;
  void finalizeMessage;

  const close = () => {
    const next = new URLSearchParams(params);
    next.delete('thread');
    setParams(next);
  };

  const send = (content: string) => {
    if (!threadId) return;
    wsClient.send({
      type: 'send_message',
      channel_id: channelId,
      thread_id: threadId,
      content,
    });
  };

  // Hooks must be called unconditionally (before early returns)
  const threadCommands = useChannelCommands(channelId, true);

  if (!threadId) return null;

  const rootAgent = rootMessage?.sender_id ? agentsById.get(rootMessage.sender_id) : undefined;
  const rootLabel = rootMessage
    ? rootMessage.sender_type === 'agent'
      ? `@${rootAgent?.name ?? 'Agent'}`
      : 'user'
    : '';

  return (
    <aside className="w-96 border-l-2 border-black bg-bg-main flex flex-col h-full min-w-0">
      <header className="border-b-2 border-black bg-bg-card px-4 py-3 flex items-center gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="font-bold">Thread</span>
          {rootLabel && (
            <span className="text-text-secondary text-sm truncate">— {rootLabel}</span>
          )}
        </div>
        <button
          className="w-8 h-8 flex items-center justify-center border-2 border-black rounded hover:bg-accent-yellow"
          onClick={close}
          aria-label="Close thread"
          title="Close thread"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </header>

      <ActiveAgentsBanner channelId={channelId} />
      <WorkflowProgress channelId={channelId} threadId={threadId} />

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {rootMessage ? (
          <>
            <Message
              message={rootMessage}
              agent={rootMessage.sender_id ? agentsById.get(rootMessage.sender_id) : undefined}
              streamingText={streamBuffers.get(rootMessage.id)}
            />
            {threadMessages.length > 0 && (
              <div className="my-3 border-t-2 border-dashed border-black/30 pt-1 text-xs font-mono text-text-secondary">
                {threadMessages.length} {threadMessages.length === 1 ? 'reply' : 'replies'}
              </div>
            )}
            {threadMessages.map((m) => (
              <Message
                key={m.id}
                message={m}
                agent={m.sender_id ? agentsById.get(m.sender_id) : undefined}
                streamingText={streamBuffers.get(m.id)}
              />
            ))}
            <ApprovalCard channelId={channelId} threadId={threadId} />
          </>
        ) : (
          <div className="text-text-secondary font-mono text-sm py-6 text-center">
            Loading thread...
          </div>
        )}
      </div>

      <MessageInput
        placeholder="Message thread"
        showAsTask={false}
        onSend={send}
        commands={threadCommands}
      />
    </aside>
  );
}

// 辅助：使 Message 组件不显示 "N replies" 按钮（thread 内部不需要）
export function isInThread(meta: MessageMetadata | null): boolean {
  return !!meta; // 只是占位，真实逻辑在父组件
}
