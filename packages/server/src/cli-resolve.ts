/**
 * 跨平台解析本地 coding CLI（cursor-agent / codex …）的可执行入口。
 *
 * macOS / Linux：`which <cmd>`，直接 spawn 命令名。
 * Windows：没有 `which`，npm 全局安装的 CLI 是 `.cmd` shim —— 不带 shell 的
 * spawn / execFile 找不到它；而带 shell 又会让 cmd.exe 改写 prompt 参数里的
 * 引号、换行和 `%`。所以在 Windows 上：
 *   1. 用 `where <cmd>` 找候选路径
 *   2. 有 `.exe` 直接用
 *   3. 是 npm 生成的 `.cmd` shim 时，解析出它指向的 JS 入口，改为
 *      `node <entry.js> ...args` 直接 spawn（不经过 shell）
 */

import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ResolvedCli {
  /** 实际 spawn 的可执行文件 */
  command: string;
  /** 放在调用方参数前面的固定参数（Windows npm shim 时是 JS 入口路径） */
  prefixArgs: string[];
  /** 展示给用户的安装路径 */
  path: string;
}

const cache = new Map<string, { value: ResolvedCli | null; expiresAt: number }>();
const CACHE_TTL_MS = 30_000;

export async function resolveCli(cmd: string): Promise<ResolvedCli | null> {
  const cached = cache.get(cmd);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = process.platform === 'win32' ? await resolveWindows(cmd) : await resolvePosix(cmd);
  cache.set(cmd, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

/** 把「命令名 + 参数」换成可直接 spawn 的形式；解析不到时原样返回，让 spawn 自己报 ENOENT。 */
export async function toSpawnable(
  cmd: string,
  args: string[],
): Promise<{ command: string; args: string[] }> {
  const resolved = await resolveCli(cmd);
  if (!resolved) return { command: cmd, args };
  return { command: resolved.command, args: [...resolved.prefixArgs, ...args] };
}

/** execFile 的跨平台版本，用于 `--version` / `--list-models` 这类短命令。 */
export async function execCli(
  cmd: string,
  args: string[],
  options: { timeout: number; maxBuffer?: number },
): Promise<{ stdout: string; stderr: string }> {
  const { command, args: fullArgs } = await toSpawnable(cmd, args);
  return execFileAsync(command, fullArgs, { ...options, windowsHide: true });
}

async function resolvePosix(cmd: string): Promise<ResolvedCli | null> {
  try {
    const { stdout } = await execFileAsync('which', [cmd], { timeout: 3000 });
    const path = stdout.trim();
    return path ? { command: cmd, prefixArgs: [], path } : null;
  } catch {
    return null;
  }
}

async function resolveWindows(cmd: string): Promise<ResolvedCli | null> {
  let candidates: string[];
  try {
    const { stdout } = await execFileAsync('where', [cmd], { timeout: 3000, windowsHide: true });
    candidates = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return null;
  }

  const exe = candidates.find((p) => extname(p).toLowerCase() === '.exe');
  if (exe) return { command: exe, prefixArgs: [], path: exe };

  for (const shim of candidates.filter((p) => extname(p).toLowerCase() === '.cmd')) {
    const entry = npmShimEntry(shim);
    if (entry) return { command: process.execPath, prefixArgs: [entry], path: shim };
  }
  return null;
}

/**
 * 解析 npm（cmd-shim）生成的 `.cmd` 文件，取出它启动的 JS 入口。
 * shim 末行形如：`"%_prog%"  "%dp0%\node_modules\@openai\codex\bin\codex.js" %*`
 */
export function npmShimEntry(shimPath: string): string | null {
  let text: string;
  try {
    text = readFileSync(shimPath, 'utf8');
  } catch {
    return null;
  }
  const match = text.match(/"%(?:~?dp0)%\\([^"]+\.(?:c|m)?js)"/i);
  return match?.[1] ? resolve(dirname(shimPath), match[1]) : null;
}
