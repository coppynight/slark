/**
 * Cursor adapter factory（Sprint 4 ext / S-1）
 *
 * 统一构造点：根据环境变量 `SLARK_CURSOR_BACKEND` 在 cursor-agent 子进程派 / @cursor/sdk
 * 直连派之间切换。`engine.ts` 和所有 System Agent 都通过此 factory 拿 adapter，
 * 避免散落的 `new CursorAdapter()` 直接构造。
 *
 * 取值：
 *   - `cli`（默认）→ `CursorAdapter`（spawn cursor-agent，向后兼容）
 *   - `sdk`        → `CursorSdkAdapter`（直接调 @cursor/sdk，需要 CURSOR_API_KEY）
 *
 * 后续可扩展为 `auto` 模式：cursor-agent 不可用 + CURSOR_API_KEY 存在 → 自动 SDK fallback
 * （需要异步 healthcheck，超出本次范围；见 docs/cursorsdkadapter.md §S-1）。
 */

import { CursorAdapter } from './cursor-adapter.js';
import { CursorSdkAdapter } from './cursor-sdk-adapter.js';
import { CodexAdapter } from './codex-adapter.js';
import type { Runtime } from '@slark/shared';
import type { CLIAdapter } from './types.js';

export function createCursorAdapter(): CLIAdapter {
  const backend = (process.env.SLARK_CURSOR_BACKEND ?? 'cli').toLowerCase();
  if (backend === 'sdk') return new CursorSdkAdapter();
  return new CursorAdapter();
}

export function createCodexAdapter(): CLIAdapter {
  return new CodexAdapter();
}

export function createAdapterForRuntime(runtime: Runtime): CLIAdapter | null {
  if (runtime === 'cursor') return createCursorAdapter();
  if (runtime === 'codex') return createCodexAdapter();
  return null;
}

/**
 * 系统 agent 的 runtime 检测结果。
 *
 * Review B-3：把 `install` 一起返回，调用方可以直接复用，无需再次调用
 * `adapter.checkInstallation()`。这避免了 SDK 模式下每个 system agent 都
 * 再发一次 `Cursor.me()` 网络调用。
 *
 * Review B-4：当 cursor 与 codex 都不可用时，`noRuntimeAvailable=true` 让
 * 调用方明确知晓"两个 runtime 都没装"，可以记录 warn 日志而不是无声跳过。
 */
export interface SystemAdapterPick {
  adapter: CLIAdapter;
  install: {
    installed: boolean;
    version?: string;
    path?: string;
    error?: string;
  };
  /** cursor 与 codex 都未安装且未通过 SLARK_SYSTEM_RUNTIME 显式指定时为 true */
  noRuntimeAvailable?: boolean;
}

export async function createSystemAdapter(): Promise<SystemAdapterPick> {
  const configured = (process.env.SLARK_SYSTEM_RUNTIME ?? '').toLowerCase();
  if (configured === 'cursor') {
    const adapter = createCursorAdapter();
    return { adapter, install: await adapter.checkInstallation() };
  }
  if (configured === 'codex') {
    const adapter = createCodexAdapter();
    return { adapter, install: await adapter.checkInstallation() };
  }

  const cursor = createCursorAdapter();
  const cursorInstall = await cursor.checkInstallation();
  if (cursorInstall.installed) {
    return { adapter: cursor, install: cursorInstall };
  }

  const codex = createCodexAdapter();
  const codexInstall = await codex.checkInstallation();
  if (codexInstall.installed) {
    return { adapter: codex, install: codexInstall };
  }

  return { adapter: cursor, install: cursorInstall, noRuntimeAvailable: true };
}

export function runtimeForAdapter(adapter: CLIAdapter): Runtime {
  return adapter.name === 'codex' ? 'codex' : 'cursor';
}
