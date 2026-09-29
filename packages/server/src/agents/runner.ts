/**
 * CLIRunner — spawn CLI 进程并流式解析输出。从 spike 迁移，加 abort 支持。
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { PROCESS_TIMEOUT_MS } from '@slark/shared';
import { toSpawnable } from '../cli-resolve.js';
import type {
  BuildCommandParams,
  CLIAdapter,
  CLIEvent,
  RunnerOptions,
  RunnerResult,
  SpawnSpec,
} from './types.js';

export interface RunningProcess {
  child: ChildProcess;
  abort: () => void;
}

/**
 * 统一入口（推荐）：根据 adapter 类型自动选择 spawn-派 / api-direct 派路径。
 *
 * - adapter.runDirect 存在 → 直接调用（CursorSdkAdapter 等）
 * - 否则 → buildCommand + spawn 子进程（CursorAdapter / CodexAdapter / ClaudeAdapter）
 *
 * 新代码统一用此函数，老代码渐进迁移。
 */
export async function runWithAdapter(
  adapter: CLIAdapter,
  params: BuildCommandParams,
  options: RunnerOptions = {},
): Promise<RunnerResult> {
  if (adapter.runDirect) {
    return adapter.runDirect(params, options);
  }
  const spec = adapter.buildCommand(params);
  return runCLI(adapter, spec, options);
}

export async function runCLI(
  adapter: CLIAdapter,
  spec: SpawnSpec,
  options: RunnerOptions = {},
): Promise<RunnerResult> {
  const timeoutMs = options.timeoutMs ?? PROCESS_TIMEOUT_MS;
  const start = Date.now();
  // Windows 上 npm 安装的 CLI 是 .cmd shim，需要解析成可直接 spawn 的入口（见 cli-resolve.ts）
  const spawnable = await toSpawnable(spec.command, spec.args);

  return new Promise((resolve) => {
    const events: CLIEvent[] = [];
    let fullText = '';
    let deltaBuffer = '';
    let completedBuffer = '';
    let stdoutBuf = '';
    let timedOut = false;
    let aborted = false;

    const child: ChildProcess = spawn(spawnable.command, spawnable.args, {
      cwd: spec.cwd,
      env: spec.env ? { ...process.env, ...spec.env } : process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
      }, 2000);
    }, timeoutMs);

    options.signal?.addEventListener('abort', () => {
      aborted = true;
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
      }, 2000);
    });

    if (spec.stdin !== undefined) {
      child.stdin?.write(spec.stdin);
    }
    child.stdin?.end();

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString('utf8');
      let idx: number;
      while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
        const line = stdoutBuf.slice(0, idx);
        stdoutBuf = stdoutBuf.slice(idx + 1);
        processLine(line);
      }
    });

    function processLine(line: string) {
      if (!line.trim()) return;
      options.onRawLine?.(line);
      const parsed = adapter.parseLine(line);
      for (const event of parsed) {
        events.push(event);
        if (event.type === 'text.delta') {
          deltaBuffer += event.text;
          fullText = deltaBuffer;
        }
        if (event.type === 'text.completed') {
          if (adapter.capabilities.supportsTextDelta) {
            fullText = event.text;
          } else {
            completedBuffer += (completedBuffer ? '\n\n' : '') + event.text;
            fullText = completedBuffer;
          }
        }
        options.onEvent?.(event);
      }
    }

    child.stderr?.on('data', (chunk: Buffer) => {
      const s = chunk.toString('utf8');
      for (const line of s.split('\n')) {
        if (line.trim()) options.onStderr?.(line);
      }
    });

    child.on('error', (err) => {
      clearTimeout(timeoutHandle);
      const errEvent: CLIEvent = {
        type: 'error',
        message: err.message,
        code: 'spawn_error',
      };
      events.push(errEvent);
      options.onEvent?.(errEvent);
      resolve({
        exitCode: null,
        fullText,
        events,
        duration_ms: Date.now() - start,
        timedOut: false,
        aborted,
      });
    });

    child.on('close', (code) => {
      clearTimeout(timeoutHandle);
      if (stdoutBuf.trim()) processLine(stdoutBuf);

      if (deltaBuffer && !events.some((e) => e.type === 'text.completed')) {
        const ev: CLIEvent = { type: 'text.completed', text: deltaBuffer };
        events.push(ev);
        fullText = deltaBuffer;
        options.onEvent?.(ev);
      }

      if (timedOut) {
        const ev: CLIEvent = {
          type: 'error',
          message: `Process timed out after ${timeoutMs}ms`,
          code: 'timeout',
        };
        events.push(ev);
        options.onEvent?.(ev);
      }

      if (aborted) {
        const ev: CLIEvent = {
          type: 'error',
          message: 'Process aborted by user',
          code: 'aborted',
          recoverable: true,
        };
        events.push(ev);
        options.onEvent?.(ev);
      }

      resolve({
        exitCode: code,
        fullText,
        events,
        duration_ms: Date.now() - start,
        timedOut,
        aborted,
      });
    });
  });
}
