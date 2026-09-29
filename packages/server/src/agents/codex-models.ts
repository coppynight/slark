/**
 * Codex 模型目录：从本机 Codex CLI 读取「当前登录账号可用」的模型，而不是写死一份清单。
 *
 * 写死的清单会过期（新模型发布后看不到），也会包含当前账号用不了的模型
 * （例如用 ChatGPT 账号登录时 `gpt-5.3-codex` 会被 400 拒绝）。
 * `codex debug models` 输出的是 CLI 自己在用的目录，只保留 visibility === 'list' 的条目，
 * 按 priority 排序（越靠前越推荐）。
 */

import { execCli } from '../cli-resolve.js';

export interface CodexModelInfo {
  slug: string;
  displayName: string;
  description: string;
}

/** 较老的 Codex CLI 没有 `debug models` 子命令时的回退清单（保持旧行为）。 */
export const STATIC_CODEX_MODELS = [
  'gpt-5.5',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.3-codex',
  'gpt-5.3-codex-spark',
  'gpt-5.2',
];

const CACHE_TTL_MS = 10 * 60_000;
let cache: { value: CodexModelInfo[]; expiresAt: number } | undefined;

/** 读取失败时返回空数组，调用方据此回退到 STATIC_CODEX_MODELS。 */
export async function loadCodexModels(): Promise<CodexModelInfo[]> {
  if (cache && cache.expiresAt > Date.now()) return cache.value;
  let value: CodexModelInfo[] = [];
  try {
    // 输出里带每个模型的 base_instructions，体积在几百 KB 量级
    const { stdout } = await execCli('codex', ['debug', 'models'], {
      timeout: 15_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    value = parseCodexModelCatalog(stdout);
  } catch {
    value = [];
  }
  cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

export function parseCodexModelCatalog(json: string): CodexModelInfo[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  const models = (raw as { models?: unknown } | null)?.models;
  if (!Array.isArray(models)) return [];

  return models
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
    .filter((m) => m.visibility === 'list' && typeof m.slug === 'string' && m.slug !== '')
    .sort((a, b) => priorityOf(a) - priorityOf(b))
    .map((m) => ({
      slug: m.slug as string,
      displayName: typeof m.display_name === 'string' ? m.display_name : (m.slug as string),
      description: typeof m.description === 'string' ? m.description : '',
    }));
}

function priorityOf(m: Record<string, unknown>): number {
  return typeof m.priority === 'number' ? m.priority : Number.MAX_SAFE_INTEGER;
}

/** Codex 报「这个模型不能用」的错误（账号不支持 / 模型不存在）。 */
export function isUnsupportedModelError(message: string): boolean {
  return (
    /model/i.test(message) &&
    /not supported|does not exist|not found|unknown model|invalid model/i.test(message)
  );
}
