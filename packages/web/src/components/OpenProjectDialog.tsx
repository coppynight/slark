/**
 * OpenProjectDialog — Cursor IDE 风格的极简 "Open Folder" 入口
 *
 * 设计目标（参考 Cursor IDE "Open Folder"）：
 *   - 用户只输入一件事：workspace 文件夹路径
 *   - name / display_name / goal 占位符 / color 全部自动生成
 *   - 立即创建 Project + 默认 #general channel + 跳转
 *   - Team / Goal 是后置可选步骤，由 ProjectIndexPage 顶部 banner 引导
 *
 * 与旧 CreateProjectDialog 三步向导的区别：
 *   - 旧：必填 Name + Goal + Workspace + 等待 Team Architect → Approve → 创建
 *   - 新：只填 Workspace → 立即进入空 Project（< 2s 体验）
 *
 * 用户后续触发 Team Architect 推荐：
 *   - ProjectIndexPage 顶部 "✨ Build your AI team" banner → 跳 Project Settings → "Build Team" 按钮
 *   - 旧 CreateProjectDialog 文件保留供 Team 构建复用（Phase 4）
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Project } from '@slark/shared';
import { createChannel, listChannels, listProjects } from '../lib/api';
import { useChannelsStore } from '../stores/channels';
import { useProjectsStore } from '../stores/projects';
import { projectIndexPath } from '../lib/routes';

interface Props {
  open: boolean;
  onClose: () => void;
}

const PATH_PLACEHOLDER = '/Users/you/code/my-project';

export function OpenProjectDialog({ open, onClose }: Props) {
  const navigate = useNavigate();
  const refreshProjects = useProjectsStore((s) => s.refresh);
  const upsertChannel = useChannelsStore((s) => s.upsert);
  const setCurrentProject = useProjectsStore((s) => s.setCurrent);

  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPath('');
      setError(null);
      setBusy(false);
    }
  }, [open]);

  if (!open) return null;

  const trimmed = path.trim();
  const isValid = trimmed.length > 0 && trimmed.startsWith('/');
  const previewName = isValid ? deriveProjectName(trimmed) : '';
  const previewDisplay = isValid ? deriveDisplayName(trimmed) : '';

  const handleOpen = async () => {
    if (!isValid) return;
    setBusy(true);
    setError(null);
    try {
      // 名字唯一：用 trimmed path 末段 slugify，重名追加 -2/-3...
      const existing = await listProjects();
      const baseName = deriveProjectName(trimmed);
      const finalName = ensureUniqueName(
        baseName,
        new Set(existing.map((p) => p.name)),
      );

      // POST /api/projects/open：服务端检测 <path>/.slark/ 是否已存在 → reopen 或新建
      // 前端 createProject wrapper 会先 then((res) => res.project)，但我们需要 is_new
      // 直接调 fetch 避免封装吞掉
      const res = await fetch('/api/projects/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: finalName,
          display_name: deriveDisplayName(trimmed),
          workspace_path: trimmed,
          // Sprint 8 / Lo-13: 不写占位文本，保持空字符串表示"未设置"，
          // 避免污染 Team Architect 推荐输入；Build Team 入口会校验非空再调用
          goal: '',
          color: hashColor(trimmed),
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`${res.status} ${res.statusText}: ${body}`);
      }
      const { project, is_new: isNew } = (await res.json()) as {
        project: Project;
        is_new: boolean;
      };

      if (isNew) {
        // 新建项目：seed 默认 #general channel
        const channel = await createChannel({
          name: 'general',
          description: 'Project-wide discussion',
          type: 'channel',
          project_id: project.id,
        });
        upsertChannel(channel);
      } else {
        // Reopen：channel 已经在 .slark/slark.db 中；仅刷新 store
        try {
          const channels = await listChannels(project.id);
          channels.forEach(upsertChannel);
        } catch {
          /* ignore */
        }
      }

      await refreshProjects();
      setCurrentProject(project.id);
      navigate(projectIndexPath(project.name));
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-bg-card border-2 border-black rounded-xl shadow-[6px_6px_0_0_#000] w-full max-w-xl">
        <header className="flex items-center justify-between px-5 py-3 border-b-2 border-black">
          <div className="font-bold text-lg flex items-center gap-2">
            <span>📂</span>
            <span>Open Project Folder</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="w-7 h-7 flex items-center justify-center border-2 border-black rounded hover:bg-accent-yellow disabled:opacity-50"
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="p-5 space-y-4">
          <div className="text-sm text-text-secondary">
            Pick a code folder. Slark will create a Project bound to it and a default
            <span className="font-mono mx-1">#general</span>
            channel — you can describe the goal and build an AI team afterwards from Project Settings.
          </div>

          <label className="block">
            <span className="block text-xs font-bold mb-1.5">WORKSPACE PATH</span>
            <input
              type="text"
              autoFocus
              value={path}
              onChange={(e) => setPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && isValid && !busy) void handleOpen();
              }}
              placeholder={PATH_PLACEHOLDER}
              className="w-full px-3 py-2 border-2 border-black rounded font-mono text-sm bg-bg-main focus:outline-none focus:bg-white"
            />
            <p className="text-[11px] text-text-muted mt-1.5">
              绝对路径，如 <code className="font-mono">{PATH_PLACEHOLDER}</code>。文件夹不存在时也能创建（路径会原样存入 Project，spawn agent 时若不存在再报错）。
            </p>
          </label>

          {isValid && (
            <div className="border-2 border-black rounded p-3 bg-bg-main text-[13px] space-y-1.5">
              <div className="font-bold text-xs uppercase text-text-secondary">Auto-generated</div>
              <div>
                <span className="text-text-secondary mr-2">name:</span>
                <code className="font-mono">{previewName}</code>
              </div>
              <div>
                <span className="text-text-secondary mr-2">display:</span>
                <span>{previewDisplay}</span>
              </div>
              <div>
                <span className="text-text-secondary mr-2">goal:</span>
                <span className="text-text-muted italic">
                  (placeholder — set later in Project Settings)
                </span>
              </div>
            </div>
          )}

          {error && (
            <div className="border-2 border-red-700 rounded p-2 bg-red-50 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-between gap-2 px-5 py-3 border-t-2 border-black">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 border-2 border-black rounded bg-bg-card font-bold hover:bg-accent-yellow disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleOpen()}
            disabled={!isValid || busy}
            className={`px-5 py-2 border-2 border-black rounded font-bold shadow-[3px_3px_0_0_#000] ${
              isValid && !busy
                ? 'bg-accent-pink hover:brightness-105'
                : 'bg-[#f5bfd2] opacity-60 cursor-not-allowed'
            }`}
          >
            {busy ? 'Opening…' : 'Open'}
          </button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// helpers
// =============================================================================

const NAME_SLUG_RE = /^[a-z0-9_-]+$/;

/** workspace 末段 → URL-safe slug（小写 + - + _ + 数字）*/
function deriveProjectName(absPath: string): string {
  const last = absPath.replace(/\/+$/, '').split('/').pop() ?? 'project';
  const slug = last
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  if (!slug || !NAME_SLUG_RE.test(slug)) return 'project';
  return slug;
}

/** workspace 末段 → 友好显示名（保留原大小写 + 空格）*/
function deriveDisplayName(absPath: string): string {
  const last = absPath.replace(/\/+$/, '').split('/').pop() ?? 'Project';
  return last.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** 重名追加 -2 / -3 ... 直到不冲突 */
function ensureUniqueName(base: string, existing: Set<string>): string {
  if (!existing.has(base)) return base;
  let i = 2;
  while (existing.has(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}

/** 简单 hash → 一组预设颜色（与 Sidebar Avatar 风格一致）*/
function hashColor(seed: string): string {
  const colors = ['#FFD93D', '#FF6B9D', '#6BCB77', '#4D96FF', '#C780FA', '#FF9F1C', '#2EC4B6'];
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return colors[h % colors.length] ?? '#FFD93D';
}
