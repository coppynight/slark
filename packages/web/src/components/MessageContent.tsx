/**
 * Markdown 消息内容渲染
 *
 * 自定义:
 *   - @mention     → 黄底黑字加框的 inline tag
 *   - #N (任务号)  → 紫底黑字加框的 inline tag
 *   - inline code  → 浅底黑字加框等宽
 *   - code block   → 白底黑边圆角跨行
 */

import { memo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from './CodeBlock';

const MENTION_RE = /@([A-Za-z0-9_\-\u4e00-\u9fa5]+)/g;
const TASK_RE = /#(\d+)\b/g;

interface InlineContext {
  onTaskClick?: (id: string) => void;
}

function renderInlineTokens(text: string, ctx: InlineContext): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let cursor = 0;

  type Match = { start: number; end: number; kind: 'mention' | 'task'; value: string };
  const matches: Match[] = [];
  for (const m of text.matchAll(MENTION_RE)) {
    if (m.index === undefined) continue;
    matches.push({ start: m.index, end: m.index + m[0].length, kind: 'mention', value: m[1]! });
  }
  for (const m of text.matchAll(TASK_RE)) {
    if (m.index === undefined) continue;
    matches.push({ start: m.index, end: m.index + m[0].length, kind: 'task', value: m[1]! });
  }
  matches.sort((a, b) => a.start - b.start);

  for (const m of matches) {
    if (m.start < cursor) continue;
    if (cursor < m.start) {
      nodes.push(text.slice(cursor, m.start));
    }
    if (m.kind === 'mention') {
      nodes.push(
        <span
          key={`m-${m.start}`}
          className="inline-flex items-center px-1.5 py-0.5 bg-accent-yellow border-2 border-black rounded font-medium font-mono text-[0.9em]"
        >
          @{m.value}
        </span>,
      );
    } else {
      nodes.push(
        <button
          key={`t-${m.start}`}
          onClick={(e) => {
            e.stopPropagation();
            ctx.onTaskClick?.(m.value);
          }}
          className="inline-flex items-center px-1.5 py-0.5 bg-accent-purple border-2 border-black rounded font-mono text-[0.9em] hover:brightness-95 cursor-pointer"
          title={`Open task #${m.value}`}
        >
          #{m.value}
        </button>,
      );
    }
    cursor = m.end;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));

  return nodes;
}

function transformChildren(children: React.ReactNode, ctx: InlineContext): React.ReactNode {
  if (typeof children === 'string') {
    return renderInlineTokens(children, ctx);
  }
  if (Array.isArray(children)) {
    return children.map((c, i) => {
      if (typeof c === 'string') {
        return (
          <span key={`tx-${i}`}>
            {renderInlineTokens(c, ctx)}
          </span>
        );
      }
      return c;
    });
  }
  return children;
}

interface Props {
  content: string;
  isStreaming?: boolean;
}

export const MessageContent = memo(function MessageContent({ content, isStreaming }: Props) {
  const navigate = useNavigate();
  const { channelId } = useParams<{ channelId: string }>();

  const onTaskClick = (id: string) => {
    if (channelId) {
      // 当前已在 ChannelPage 内，URL 已是 /p/:projectName/channel/:channelId
      // 仅切换 query 参数，相对路径修改 search 即可
      navigate({ search: `?chatTab=tasks&task=${encodeURIComponent(id)}` });
    } else {
      navigate(`/tasks`);
    }
  };
  const ctx: InlineContext = { onTaskClick };

  // Sprint 8 / Lo-22：streaming 但内容为空时显式提示，避免 60s cold start 黑屏感
  const isEmpty = content.trim().length === 0;
  if (isStreaming && isEmpty) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="inline-flex items-center gap-2 px-2 py-1 border-2 border-black rounded bg-[#fff8d8] font-mono text-xs"
      >
        <Spinner />
        <span>Generating…</span>
      </div>
    );
  }

  return (
    <div className="prose prose-sm max-w-none text-black leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="my-0">{transformChildren(children, ctx)}</p>,
          li: ({ children }) => <li>{transformChildren(children, ctx)}</li>,
          em: ({ children }) => <em>{transformChildren(children, ctx)}</em>,
          strong: ({ children }) => <strong className="font-bold">{transformChildren(children, ctx)}</strong>,
          code: ({ className, children, ...props }) => {
            const inline = !className;
            if (inline) {
              return (
                <code
                  className="px-1.5 py-0.5 bg-bg-card border-2 border-black rounded font-mono text-[0.9em]"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            // 块级代码：由 pre 包起，在 pre 里处理高亮
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
          pre: ({ children }) => {
            // 提取 <code class="language-XYZ"> 的 className
            const codeEl = Array.isArray(children) ? children[0] : children;
            let lang: string | undefined;
            let code = '';
            if (
              codeEl &&
              typeof codeEl === 'object' &&
              'props' in codeEl &&
              codeEl.props &&
              typeof codeEl.props === 'object'
            ) {
              const props = codeEl.props as { className?: string; children?: React.ReactNode };
              const m = /language-([\w-]+)/.exec(props.className ?? '');
              if (m) lang = m[1];
              code =
                typeof props.children === 'string'
                  ? props.children
                  : Array.isArray(props.children)
                    ? props.children.join('')
                    : String(props.children ?? '');
            }
            if (!code) {
              return (
                <pre className="bg-bg-card border-2 border-black rounded p-3 my-2 overflow-x-auto font-mono text-sm">
                  {children}
                </pre>
              );
            }
            return <CodeBlock code={code.replace(/\n$/, '')} lang={lang} />;
          },
          ul: ({ children }) => <ul className="list-disc pl-5 my-1 space-y-0.5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5 my-1 space-y-0.5">{children}</ol>,
          a: ({ children, ...props }) => (
            <a
              className="text-accent-pink underline font-medium"
              target="_blank"
              rel="noopener noreferrer"
              {...props}
            >
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
      {isStreaming && (
        <span className="inline-block w-1.5 h-4 bg-black animate-pulse ml-0.5 align-middle" />
      )}
    </div>
  );
});

function Spinner() {
  return (
    <svg
      className="animate-spin"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" />
    </svg>
  );
}
