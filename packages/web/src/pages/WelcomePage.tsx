/**
 * Welcome 页（路径 `/`）
 *
 * 行为（CP8.1 调整）：
 *   - **无 Project**：显示 CTA "Create your first Project"
 *   - **有 Project**：自动 redirect 到第一个 Project 的 `/p/{firstProject.name}`
 *     （ProjectIndexPage 会进一步跳到第一个 channel）
 *   - Cursor / Codex backend 都不可用时显示黄色警告条
 *
 * Project 内的 channel/agent 列表移到 ProjectIndexPage。
 */

import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import type { CursorBackendStatus, RuntimeDetection } from '@slark/shared';
import { getCursorSettings, getRuntimes } from '../lib/api';
import { useProjectsStore } from '../stores/projects';
import { OpenProjectDialog } from '../components/OpenProjectDialog';
import { projectIndexPath } from '../lib/routes';

export function WelcomePage() {
  const projects = useProjectsStore((s) => s.projects);
  const projectsLoaded = useProjectsStore((s) => s.loaded);
  const [runtimes, setRuntimes] = useState<RuntimeDetection[]>([]);
  const [cursorBackend, setCursorBackend] = useState<CursorBackendStatus | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    void getRuntimes().then(setRuntimes).catch(() => {});
    void getCursorSettings(false).then(setCursorBackend).catch(() => {});
  }, []);

  const cursor = runtimes.find((r) => r.id === 'cursor');
  const codex = runtimes.find((r) => r.id === 'codex');
  const cliReady = cursor?.installed;
  const sdkReady = cursorBackend?.backend === 'sdk' && cursorBackend?.hasApiKey;
  const cursorReady = cliReady || sdkReady;
  const codexReady = Boolean(codex?.installed && codex?.enabled_in_slark);
  const codingRuntimeReady = cursorReady || codexReady;

  // 等 store 加载完成再判断（否则刷新会闪一下 CTA）
  if (!projectsLoaded) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-secondary font-mono">
        Loading…
      </div>
    );
  }

  // 有 Project：redirect 到第一个
  const firstProject = projects[0];
  if (firstProject) {
    return <Navigate to={projectIndexPath(firstProject.name)} replace />;
  }

  // 无 Project：CTA
  return (
    <div className="flex-1 flex items-center justify-center p-8 overflow-y-auto">
      <div className="max-w-xl w-full bg-bg-card border-2 border-black rounded-xl p-8 shadow-[6px_6px_0_0_#000]">
        <h1 className="text-3xl font-bold mb-2">Welcome to Slark</h1>
        <p className="text-text-secondary mb-6">
          Programmable AI Team OS — set a goal, AI configures a team, team designs its own workflow.
        </p>

        {!codingRuntimeReady && (
          <div className="mb-6 p-4 bg-accent-yellow border-2 border-black rounded">
            <div className="font-bold mb-1">⚠ Coding runtime not configured</div>
            <div className="text-sm space-y-1.5">
              <div>选一种方式让 Slark 调用本地 coding agent：</div>
              <ul className="list-disc list-inside space-y-0.5 text-[13px]">
                <li>
                  本机安装 <code className="font-mono">codex</code> 并登录（Codex CLI）
                </li>
                <li>
                  本机安装 <code className="font-mono">cursor-agent</code> 并登录（默认 CLI
                  模式，零配置）
                </li>
                <li>
                  或在{' '}
                  <Link to="/settings" className="underline font-bold hover:text-accent-pink">
                    Settings
                  </Link>{' '}
                  里配置 Cursor API key 切到 SDK 模式（无需安装 cursor-agent）
                </li>
              </ul>
              <div className="text-[12px] text-text-secondary mt-1">
                未配置也可以先创建 Project，Team Architect 会展示默认团队，配置好后再开始对话即可。
              </div>
            </div>
          </div>
        )}
        {sdkReady && (
          <div className="mb-6 p-4 bg-green-100 border-2 border-black rounded">
            <div className="font-bold mb-0.5">✓ Cursor SDK ready</div>
            <div className="text-[13px] text-text-secondary">
              使用 <code className="font-mono">@cursor/sdk</code> 直连，
              <Link to="/settings" className="underline ml-1 hover:text-accent-pink">
                Settings
              </Link>{' '}
              里可切换 backend / 修改 API key。
            </div>
          </div>
        )}

        <div className="space-y-4">
          <div className="text-sm text-text-secondary">
            No projects yet. Create one to spawn your first AI team.
          </div>
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="w-full px-4 py-3 border-2 border-black rounded bg-accent-pink font-bold text-lg hover:brightness-105 shadow-[4px_4px_0_0_#000]"
          >
            📂 Open a project folder
          </button>
          <div className="text-[12px] font-mono text-text-muted">
            Pick any local code folder. Slark creates a workspace + default <span className="font-mono">#general</span> channel
            instantly. Describe the goal & build an AI team afterwards from Project Settings.
          </div>
        </div>

        <div className="mt-6 text-xs text-text-muted font-mono">
          Slark v1.0 · local-only · no login · programmable AI team OS
        </div>
      </div>

      <OpenProjectDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  );
}
