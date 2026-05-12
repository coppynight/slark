-- Slark per-project SQLite schema
-- 对齐 docs/per-project-storage-design.md (D-21~D-25)
--
-- ★ 重要 ★：本 schema 是 per-project 版本。每个 <workspace>/.slark/slark.db 都用这套 schema。
-- 项目元数据（id / name / display_name / goal / team_rules / color / created_at / workspace_path）
-- 不在 db 里 —— 它们在 <workspace>/.slark/project.json 中。
-- 因此本 schema 移除了 projects 表，所有原 project_id FK / project_id 列 / 相关 INDEX。

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- =============================================================================
-- 1. channels
-- =============================================================================
CREATE TABLE IF NOT EXISTS channels (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT,
  type            TEXT NOT NULL CHECK(type IN ('channel','dm')),
  created_at      INTEGER NOT NULL
);

-- =============================================================================
-- 2. agents
-- =============================================================================
CREATE TABLE IF NOT EXISTS agents (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  -- Sprint 8 / Lo-26 修复：团队角色标签（implementer / reviewer / qa / architect / scribe / ...）。
  -- Workflow YAML 用 @implementer 等占位符按 role 解析到具体 agent。NULL = legacy / 用户未指定。
  role            TEXT,
  avatar          TEXT,
  description     TEXT,
  runtime         TEXT NOT NULL,
  model           TEXT,
  reasoning       TEXT,
  -- Sprint 4-ext / Phase A：对齐 Cursor IDE Options 面板的额外 model 维度。
  -- thinking / context 通过 SDK ModelSelection.params 透传；CLI 模式下被忽略。
  thinking        INTEGER,        -- 0/1/NULL；NULL=未设
  context         TEXT,           -- '300k' | '1m' | NULL
  env_vars_json   TEXT,
  created_at      INTEGER NOT NULL
);
-- Sprint 8 / Lo-26: idx_agents_role 创建放在 applyMigrations（db/index.ts）里，
-- 因为它依赖 role 列，而老 db（v1）需要先 ALTER TABLE 才能建索引。

-- =============================================================================
-- 3. channel_agents (many-to-many)
-- =============================================================================
CREATE TABLE IF NOT EXISTS channel_agents (
  channel_id      TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  agent_id        TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  PRIMARY KEY (channel_id, agent_id)
);

-- =============================================================================
-- 4. messages
-- =============================================================================
CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  channel_id      TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  sender_type     TEXT NOT NULL CHECK(sender_type IN ('user','agent','system')),
  sender_id       TEXT,
  content         TEXT NOT NULL,
  metadata_json   TEXT,
  parent_id       TEXT REFERENCES messages(id) ON DELETE CASCADE,
  reply_count     INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_thread  ON messages(parent_id) WHERE parent_id IS NOT NULL;

-- =============================================================================
-- 5. tasks
-- =============================================================================
CREATE TABLE IF NOT EXISTS tasks (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id          TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'todo'
                      CHECK(status IN ('todo','in_progress','in_review','done')),
  assignee_agent_id   TEXT REFERENCES agents(id) ON DELETE SET NULL,
  created_by          TEXT NOT NULL,
  source_message_id   TEXT REFERENCES messages(id) ON DELETE SET NULL,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_channel_status ON tasks(channel_id, status);

-- =============================================================================
-- 6. agent_activity
-- =============================================================================
CREATE TABLE IF NOT EXISTS agent_activity (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  channel_id  TEXT REFERENCES channels(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK(type IN ('thinking','working','output','error','idle')),
  detail      TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_agent ON agent_activity(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_agent_channel ON agent_activity(agent_id, channel_id, created_at DESC);

-- =============================================================================
-- 7. saved_messages
-- =============================================================================
CREATE TABLE IF NOT EXISTS saved_messages (
  message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  saved_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_saved_by_time ON saved_messages(saved_at DESC);

-- =============================================================================
-- 8. meta（schema 版本，per-project）
-- =============================================================================
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- =============================================================================
-- 9. agent_runs
-- =============================================================================
CREATE TABLE IF NOT EXISTS agent_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  channel_id  TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  status      TEXT NOT NULL CHECK(status IN ('thinking','working','error','stopped')),
  started_at  INTEGER NOT NULL,
  ended_at    INTEGER,
  error_msg   TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_active
  ON agent_runs(agent_id, channel_id)
  WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_agent_runs_by_channel
  ON agent_runs(channel_id, started_at DESC);

-- =============================================================================
-- 10. workflows
-- =============================================================================
CREATE TABLE IF NOT EXISTS workflows (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT,
  trigger_command TEXT NOT NULL UNIQUE,
  definition_yaml TEXT NOT NULL,
  source          TEXT NOT NULL DEFAULT 'user'
                  CHECK(source IN ('builtin','user')),
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

-- =============================================================================
-- 11. workflow_runs
-- =============================================================================
CREATE TABLE IF NOT EXISTS workflow_runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id     TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  channel_id      TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  thread_id       TEXT REFERENCES messages(id) ON DELETE CASCADE,
  status          TEXT NOT NULL
                  CHECK(status IN ('running','awaiting_approval','completed','aborted','failed')),
  current_step    TEXT,
  started_by      TEXT NOT NULL,
  started_at      INTEGER NOT NULL,
  ended_at        INTEGER,
  state_json      TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_channel ON workflow_runs(channel_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_thread ON workflow_runs(thread_id);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_active
  ON workflow_runs(channel_id, status)
  WHERE status IN ('running','awaiting_approval');

-- =============================================================================
-- 12. responsibilities
-- =============================================================================
CREATE TABLE IF NOT EXISTS responsibilities (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id     TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  step_id         TEXT NOT NULL,
  agent_id        TEXT NOT NULL,
  role            TEXT NOT NULL CHECK(role IN ('executor','approver','reviewer','informed')),
  authority       TEXT CHECK(authority IN ('must_approve','optional_approve','no_authority')),
  created_at      INTEGER NOT NULL,
  UNIQUE(workflow_id, step_id, agent_id, role)
);
CREATE INDEX IF NOT EXISTS idx_responsibilities_workflow ON responsibilities(workflow_id);
CREATE INDEX IF NOT EXISTS idx_responsibilities_agent ON responsibilities(agent_id);

-- =============================================================================
-- 13. decisions
-- =============================================================================
CREATE TABLE IF NOT EXISTS decisions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  audience        TEXT NOT NULL DEFAULT 'all',
  source_run_id   INTEGER REFERENCES workflow_runs(id) ON DELETE SET NULL,
  source_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  confidence      REAL,
  review_status   TEXT NOT NULL DEFAULT 'pending'
                  CHECK(review_status IN ('pending','approved','rejected')),
  recorded_by     TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  reviewed_at     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_decisions_created ON decisions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_decisions_review ON decisions(review_status);

-- =============================================================================
-- 14. lessons
-- =============================================================================
CREATE TABLE IF NOT EXISTS lessons (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  kind            TEXT NOT NULL CHECK(kind IN ('do','dont','pattern','pitfall')),
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  audience        TEXT NOT NULL DEFAULT 'all',
  tags_json       TEXT,
  source_run_id   INTEGER REFERENCES workflow_runs(id) ON DELETE SET NULL,
  source_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  confidence      REAL,
  review_status   TEXT NOT NULL DEFAULT 'pending'
                  CHECK(review_status IN ('pending','approved','rejected')),
  recorded_by     TEXT NOT NULL,
  use_count       INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  reviewed_at     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_lessons_created ON lessons(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lessons_review ON lessons(review_status);
CREATE INDEX IF NOT EXISTS idx_lessons_audience ON lessons(audience);

-- =============================================================================
-- 15. agent_observations
-- =============================================================================
CREATE TABLE IF NOT EXISTS agent_observations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id        TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  polarity        TEXT NOT NULL CHECK(polarity IN ('positive','negative','neutral')),
  tag             TEXT NOT NULL,
  body            TEXT NOT NULL,
  source_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  source_run_id   INTEGER REFERENCES workflow_runs(id) ON DELETE SET NULL,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_observations_agent
  ON agent_observations(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_observations_tag
  ON agent_observations(agent_id, tag);

-- =============================================================================
-- 16. agent_feedback
-- =============================================================================
CREATE TABLE IF NOT EXISTS agent_feedback (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id              TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  period_start          INTEGER NOT NULL,
  period_end            INTEGER NOT NULL,
  summary               TEXT NOT NULL,
  rationale             TEXT NOT NULL,
  description_before    TEXT NOT NULL,
  description_after     TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'pending'
                        CHECK(status IN ('pending','applied','rejected','rolled_back')),
  confidence            REAL,
  reviewed_by           TEXT,
  applied_at            INTEGER,
  rejected_at           INTEGER,
  rolled_back_at        INTEGER,
  created_at            INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_agent
  ON agent_feedback(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_status
  ON agent_feedback(agent_id, status);

-- =============================================================================
-- 17. project_onboarding（per-project db 内只有 1 行；singleton id=1）
-- =============================================================================
CREATE TABLE IF NOT EXISTS project_onboarding (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  overview        TEXT NOT NULL,
  tech_stack_json TEXT NOT NULL DEFAULT '[]',
  conventions     TEXT,
  ready           INTEGER NOT NULL DEFAULT 1,
  generated_at    INTEGER NOT NULL
);

-- =============================================================================
-- 18. agent_skills
-- =============================================================================
CREATE TABLE IF NOT EXISTS agent_skills (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id        TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  skill_key       TEXT NOT NULL,
  touch_count     INTEGER NOT NULL DEFAULT 0,
  last_touched    INTEGER NOT NULL,
  UNIQUE(agent_id, skill_key)
);
CREATE INDEX IF NOT EXISTS idx_skills_agent
  ON agent_skills(agent_id, touch_count DESC);
CREATE INDEX IF NOT EXISTS idx_skills_key
  ON agent_skills(skill_key);

-- =============================================================================
-- 19. workflow_sessions
-- =============================================================================
CREATE TABLE IF NOT EXISTS workflow_sessions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  goal_input      TEXT NOT NULL,
  draft_yaml      TEXT,
  rationale       TEXT,
  status          TEXT NOT NULL DEFAULT 'drafting'
                  CHECK(status IN ('drafting','awaiting_approval','approved','rejected','failed','archived')),
  workflow_id     TEXT REFERENCES workflows(id) ON DELETE SET NULL,
  fallback_reason TEXT,
  started_by      TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  ended_at        INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sessions_created ON workflow_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON workflow_sessions(status);
