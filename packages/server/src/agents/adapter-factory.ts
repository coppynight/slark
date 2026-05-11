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

export async function createSystemAdapter(): Promise<CLIAdapter> {
  const configured = (process.env.SLARK_SYSTEM_RUNTIME ?? '').toLowerCase();
  if (configured === 'cursor') return createCursorAdapter();
  if (configured === 'codex') return createCodexAdapter();

  const cursor = createCursorAdapter();
  const cursorInstall = await cursor.checkInstallation();
  if (cursorInstall.installed) return cursor;

  const codex = createCodexAdapter();
  const codexInstall = await codex.checkInstallation();
  if (codexInstall.installed) return codex;

  return cursor;
}

export function runtimeForAdapter(adapter: CLIAdapter): Runtime {
  return adapter.name === 'codex' ? 'codex' : 'cursor';
}
