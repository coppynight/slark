/**
 * Per-Project SQLite Handle Pool
 *
 * 重构（D-21）：每个 Project 一个独立 SQLite db，文件位于 `<workspace>/.slark/slark.db`。
 * 不再有"中央 ~/.slark/slark.db"。db 句柄通过 LRU 池管理，按 workspace_path 缓存。
 *
 * 关键 API：
 *   - openProjectDb(workspacePath)  — 打开 / 创建 db；首次 mkdir + apply schema
 *   - closeProjectDb(workspacePath) — 关闭 db 句柄
 *   - listOpenDbs()                  — 全局视图聚合用：列举所有当前打开的 (path, db)
 *
 * 句柄池：
 *   - LRU max=20；超过则淘汰最久未使用的 db.close()
 *   - 30min idle close（每分钟检查）
 *   - 主动 close 后下次 openProjectDb 重新打开（lazy）
 *
 * Schema 版本：
 *   - per-project schema 内部维护 schema_version，写在 meta 表
 *   - v1: per-project storage 起步
 *   - v2: Sprint 8 / Lo-26 修复 —— agents 表加 `role` 字段 + `idx_agents_role` 索引
 */

import Database from 'better-sqlite3';
import type { Database as DB } from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectSlarkDir } from '../config/project-meta.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_CANDIDATES = [
  pathResolve(__dirname, 'schema.sql'),
  pathResolve(__dirname, '../../src/db/schema.sql'),
];
const SCHEMA_PATH = SCHEMA_CANDIDATES.find((p) => existsSync(p));

const PER_PROJECT_SCHEMA_VERSION = '2';
const POOL_MAX = 20;
const IDLE_CLOSE_MS = 30 * 60 * 1000; // 30 min

interface PoolEntry {
  db: DB;
  workspacePath: string;
  lastUsed: number;
}

const pool = new Map<string, PoolEntry>();

function normalizePath(workspacePath: string): string {
  return pathResolve(workspacePath);
}

/** 打开 / 创建 per-project db。首次会 mkdir <ws>/.slark/ + apply schema。*/
export function openProjectDb(workspacePath: string): DB {
  const norm = normalizePath(workspacePath);
  const existing = pool.get(norm);
  if (existing) {
    existing.lastUsed = Date.now();
    return existing.db;
  }

  // 首次打开：保证 .slark/ 目录存在
  const slarkDir = projectSlarkDir(norm);
  mkdirSync(slarkDir, { recursive: true });
  const dbFile = pathResolve(slarkDir, 'slark.db');

  const db = new Database(dbFile);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  if (!SCHEMA_PATH) {
    throw new Error(`schema.sql not found. Checked: ${SCHEMA_CANDIDATES.join(', ')}`);
  }
  const schemaSql = readFileSync(SCHEMA_PATH, 'utf-8');
  db.exec(schemaSql);

  const stmt = db.prepare<[string], { value: string }>(
    'SELECT value FROM meta WHERE key = ?',
  );
  const row = stmt.get('schema_version');
  // 用 fromVersion='0' 兜底 fresh db（meta 表里还没记录）；fresh db 也要跑 applyMigrations
  // 以确保依赖新列的 INDEX 被创建（这些 INDEX 不能直接放 schema.sql，否则老 db 升级时会因
  // "列不存在"先于 ALTER TABLE 报错）。applyMigrations 内部所有 DDL 都是幂等的。
  const fromVersion = row?.value ?? '0';
  if (fromVersion !== PER_PROJECT_SCHEMA_VERSION) {
    applyMigrations(db, fromVersion, PER_PROJECT_SCHEMA_VERSION);
    if (!row) {
      db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run(
        'schema_version',
        PER_PROJECT_SCHEMA_VERSION,
      );
    } else {
      db.prepare('UPDATE meta SET value = ? WHERE key = ?').run(
        PER_PROJECT_SCHEMA_VERSION,
        'schema_version',
      );
    }
  }

  pool.set(norm, { db, workspacePath: norm, lastUsed: Date.now() });
  evictIfNeeded();
  return db;
}

export function closeProjectDb(workspacePath: string): void {
  const norm = normalizePath(workspacePath);
  const entry = pool.get(norm);
  if (!entry) return;
  try {
    entry.db.close();
  } catch {
    /* ignore */
  }
  pool.delete(norm);
}

/** 全局视图聚合用：列出所有当前打开的 (path, db)。不会触发懒加载。*/
export function listOpenDbs(): Array<{ workspacePath: string; db: DB }> {
  return Array.from(pool.values()).map((e) => ({
    workspacePath: e.workspacePath,
    db: e.db,
  }));
}

/**
 * 资源反查：给定 (table, id) 在所有已打开的 db 中找哪个 db 拥有该行。
 * 用于 routes/messaging 等只拿到 channel_id / agent_id 时反向 resolve project db。
 * 性能：N 个 open db × SELECT 1 by index → < 1ms / project。
 *
 * 限制：必须 db 已打开。建议 server 启动期 warm-up 所有 recent projects。
 */
export function findDbByResource(
  table: 'channels' | 'agents' | 'workflows' | 'messages' | 'tasks' | 'workflow_runs' | 'agent_observations' | 'agent_feedback',
  id: string | number,
): { workspacePath: string; db: DB } | null {
  for (const entry of pool.values()) {
    try {
      const row = entry.db.prepare(`SELECT 1 FROM ${table} WHERE id = ? LIMIT 1`).get(id);
      if (row) {
        entry.lastUsed = Date.now();
        return { workspacePath: entry.workspacePath, db: entry.db };
      }
    } catch {
      /* table 不存在或其他错误，跳过 */
    }
  }
  return null;
}

/** 关闭全部 db 句柄（server shutdown 用） */
export function closeAllDbs(): void {
  for (const entry of pool.values()) {
    try {
      entry.db.close();
    } catch {
      /* ignore */
    }
  }
  pool.clear();
}

/**
 * 轻量 in-place migration。schema.sql 用 `CREATE ... IF NOT EXISTS` 处理新表/新索引；
 * 已存在表加列时这里补 ALTER TABLE 兜底（schema.sql 已声明的列在 fresh db 自然存在）。
 *
 * 设计约束：
 *   - 每条 migration **必须幂等** —— 老 db / fresh db 都会跑同一条迁移
 *   - 依赖"新列"的 INDEX 必须放在这里（不能放 schema.sql），因为老 db 要先 ALTER TABLE
 *     才能建索引；schema.sql 一次性 exec 时顺序无法保证列在前、索引在后
 */
function applyMigrations(db: DB, fromVersion: string, toVersion: string): void {
  // v1 → v2 / fresh → v2: agents 加 role 字段 + idx_agents_role 索引
  if (fromVersion === '1' || fromVersion === '0') {
    try {
      db.exec('ALTER TABLE agents ADD COLUMN role TEXT;');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/duplicate column name/i.test(msg)) {
        throw e;
      }
    }
    // 索引创建幂等（IF NOT EXISTS），fresh db / 老 db 都跑一次确保索引存在
    db.exec(
      'CREATE INDEX IF NOT EXISTS idx_agents_role ON agents(role) WHERE role IS NOT NULL;',
    );
  }
  void toVersion;
}

function evictIfNeeded(): void {
  if (pool.size <= POOL_MAX) return;
  // 找 lastUsed 最早的 entry 淘汰
  let oldest: PoolEntry | null = null;
  for (const e of pool.values()) {
    if (!oldest || e.lastUsed < oldest.lastUsed) oldest = e;
  }
  if (oldest) closeProjectDb(oldest.workspacePath);
}

// 每分钟检查 idle，关闭超过 IDLE_CLOSE_MS 的 db
setInterval(() => {
  const now = Date.now();
  for (const [path, entry] of pool.entries()) {
    if (now - entry.lastUsed > IDLE_CLOSE_MS) {
      try {
        entry.db.close();
      } catch {
        /* ignore */
      }
      pool.delete(path);
    }
  }
}, 60 * 1000).unref();
