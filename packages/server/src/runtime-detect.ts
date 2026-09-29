/**
 * Runtime 检测：通过 resolveCli（macOS/Linux 用 `which`，Windows 用 `where`）判断本地 CLI 是否安装。
 *
 * MVP 只有 Cursor 会被实际 spawn；其他 runtime 即使检测到也不可用（返回给前端显示 "coming soon"）。
 */

import type { Runtime } from '@slark/shared';
import { execCli, resolveCli } from './cli-resolve.js';

const RUNTIME_COMMANDS: Record<Runtime, string> = {
  cursor: 'cursor-agent',
  codex: 'codex',
  claude: 'claude',
  kimi: 'kimi',
  copilot: 'copilot',
  gemini: 'gemini',
};

export interface RuntimeDetectResult {
  installed: boolean;
  version?: string;
  path?: string;
  error?: string;
}

const cache = new Map<Runtime, { value: RuntimeDetectResult; expiresAt: number }>();
const CACHE_TTL_MS = 30_000;

export async function detectRuntime(runtime: Runtime): Promise<RuntimeDetectResult> {
  const cached = cache.get(runtime);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  const value = await doDetect(runtime);
  cache.set(runtime, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

async function doDetect(runtime: Runtime): Promise<RuntimeDetectResult> {
  const cmd = RUNTIME_COMMANDS[runtime];
  const resolved = await resolveCli(cmd);
  if (!resolved) return { installed: false };

  // 尝试获取版本号
  let version: string | undefined;
  try {
    const { stdout } = await execCli(cmd, ['--version'], { timeout: 10_000 });
    version = stdout.trim().split('\n')[0];
  } catch {
    // 部分 CLI 的 --version 未必走 0 退出码，忽略
  }

  return { installed: true, path: resolved.path, version };
}
