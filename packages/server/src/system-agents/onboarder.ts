/**
 * Onboarder — 第五个 System Agent（Sprint 6 CP2 / D-15 / D-20 Onboarding Loop）
 *
 * 职责：Project 创建后扫 workspace_path 下的 README / package.json /
 * 最近 commit history，spawn cursor-agent 总结成 overview + tech_stack + conventions，
 * 落到 project_onboarding（1 row per project）。
 *
 * 兜底：cursor-agent 不可用 / 解析失败 → 写一个最小 fallback overview，标 ready=false。
 *
 * 调用：Project 创建后在后端异步 fire；用户也可触发 POST /api/projects/:id/onboard。
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { ONBOARDER_TIMEOUT_MS } from '@slark/shared';
import type { Project } from '@slark/shared';
import type { Database } from 'better-sqlite3';
import { createSystemAdapter } from '../agents/adapter-factory.js';
import { runWithAdapter } from '../agents/runner.js';
import { onboardingRepo } from '../db/repos.js';

interface OnboarderLogger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
}

const consoleLog: OnboarderLogger = {
  info: (m) => console.log(m),
  warn: (m) => console.warn(m),
};

export async function runOnboarderForProject(
  db: Database,
  project: Project,
  logger: OnboarderLogger = consoleLog,
): Promise<void> {
  // 1. 收集 workspace 信息（文件读取出错时 graceful 降级）
  const ws = project.workspace_path;
  let readme = '';
  let pkgJson = '';
  let recentCommits: string[] = [];
  try {
    readme = safeRead(resolve(ws, 'README.md'), 8000);
  } catch {
    /* ignore */
  }
  try {
    pkgJson = safeRead(resolve(ws, 'package.json'), 4000);
  } catch {
    /* ignore */
  }
  try {
    recentCommits = safeGitLog(ws, 20);
  } catch {
    /* ignore */
  }

  // 没装 cursor backend 或 workspace 完全空白 → 写一个 fallback
  const adapter = await createSystemAdapter();
  const install = await adapter.checkInstallation();
  if (!install.installed || (!readme && !pkgJson && recentCommits.length === 0)) {
    onboardingRepo.upsert(db, {
      overview: project.goal,
      tech_stack: deriveQuickStack(pkgJson),
      conventions: null,
    });
    logger.info(`[onboarder] ${project.name}: minimal fallback (no cursor backend or empty workspace)`);
    return;
  }

  // 2. 跑 cursor backend（cli/sdk 二选一）
  const prompt = buildOnboarderPrompt(project.name, project.goal, readme, pkgJson, recentCommits);
  try {
    const result = await runWithAdapter(
      adapter,
      { prompt, permissive: false },
      { timeoutMs: ONBOARDER_TIMEOUT_MS },
    );
    if (result.timedOut || result.aborted) {
      logger.warn(`[onboarder] ${project.name}: timed out / aborted; using fallback`);
      onboardingRepo.upsert(db, {
        overview: project.goal,
        tech_stack: deriveQuickStack(pkgJson),
        conventions: null,
      });
      return;
    }
    const parsed = parseOnboarderOutput(result.fullText);
    if (!parsed) {
      logger.warn(`[onboarder] ${project.name}: unparseable output; using fallback`);
      onboardingRepo.upsert(db, {
        overview: project.goal,
        tech_stack: deriveQuickStack(pkgJson),
        conventions: null,
      });
      return;
    }
    onboardingRepo.upsert(db, {
      overview: parsed.overview,
      tech_stack: parsed.tech_stack,
      conventions: parsed.conventions,
    });
    logger.info(`[onboarder] ${project.name}: onboarding generated (${parsed.tech_stack.join(', ')})`);
  } catch (e) {
    logger.warn(`[onboarder] ${project.name}: spawn failed: ${(e as Error).message}`);
  }
}

// =============================================================================
// helpers
// =============================================================================

function safeRead(path: string, max: number): string {
  const st = statSync(path);
  if (!st.isFile()) return '';
  const text = readFileSync(path, 'utf8');
  return text.length > max ? `${text.slice(0, max)}\n…[truncated]` : text;
}

function safeGitLog(cwd: string, n: number): string[] {
  const out = execFileSync('git', ['log', `-${n}`, '--pretty=format:%h %s'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 5000,
  });
  return out
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function deriveQuickStack(pkgJson: string): string[] {
  const stack = new Set<string>();
  if (!pkgJson) return [];
  try {
    const parsed = JSON.parse(pkgJson) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...parsed.dependencies, ...parsed.devDependencies };
    const names = Object.keys(deps);
    if (names.includes('react')) stack.add('react');
    if (names.includes('vite')) stack.add('vite');
    if (names.includes('vue')) stack.add('vue');
    if (names.includes('next')) stack.add('next.js');
    if (names.includes('typescript')) stack.add('typescript');
    if (names.includes('fastify')) stack.add('fastify');
    if (names.includes('express')) stack.add('express');
    if (names.includes('better-sqlite3')) stack.add('sqlite');
    if (names.includes('tailwindcss')) stack.add('tailwind');
  } catch {
    /* ignore */
  }
  return Array.from(stack);
}

function buildOnboarderPrompt(
  name: string,
  goal: string,
  readme: string,
  pkg: string,
  commits: string[],
): string {
  return [
    'You are the Onboarder for a Slark Project. Read the workspace artefacts below and produce',
    'an onboarding summary that helps both human users and other AI agents understand this project.',
    '',
    `Project name: ${name}`,
    `Project goal: ${goal}`,
    '',
    '--- README.md (truncated) ---',
    readme || '(none)',
    '',
    '--- package.json (truncated) ---',
    pkg || '(none)',
    '',
    '--- Recent git log (newest first) ---',
    commits.length ? commits.join('\n') : '(no git history)',
    '--- end ---',
    '',
    'Rules:',
    '- "overview": 2-4 sentences in plain English. Start with what the project IS, then what it DOES.',
    '- "tech_stack": short list of detected frameworks / runtimes / DBs. ≤ 8 items.',
    '- "conventions": one paragraph describing observable conventions (commit style, branch naming, code patterns). null if not enough signal.',
    '',
    'Reply with STRICT JSON ONLY. No markdown fences, no commentary.',
    'Schema:',
    '{ "overview": "...", "tech_stack": ["..."], "conventions": "..." | null }',
    '',
    'Return JSON ONLY.',
  ].join('\n');
}

function parseOnboarderOutput(
  raw: string,
): { overview: string; tech_stack: string[]; conventions: string | null } | null {
  const cleaned = stripJSONFences(raw).trim();
  if (!cleaned) return null;
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first < 0 || last <= first) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(cleaned.slice(first, last + 1));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  const overview = typeof o.overview === 'string' ? o.overview.trim() : '';
  if (!overview) return null;
  const stack = Array.isArray(o.tech_stack)
    ? o.tech_stack.filter((x): x is string => typeof x === 'string').slice(0, 8)
    : [];
  const conventions =
    typeof o.conventions === 'string' && o.conventions.trim() ? o.conventions.trim() : null;
  return { overview, tech_stack: stack, conventions };
}

function stripJSONFences(text: string): string {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return match ? match[1] ?? '' : text;
}
