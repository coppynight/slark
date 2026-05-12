/**
 * Repository 层 — 封装各表的 CRUD。
 *
 * 设计原则：
 *   - 每个函数返回强类型对象（@slark/shared 的 Channel / Agent / ChatMessage 等）
 *   - JSON 字段（metadata_json / env_vars_json）自动序列化 / 反序列化
 *   - 时间戳字段由 repo 填（调用方无需传 created_at）
 *   - 不做业务校验（业务校验在 service 层）
 */

import type { Database } from 'better-sqlite3';
import { nanoid } from 'nanoid';
import type {
  Agent,
  AgentActivity,
  AgentFeedback,
  AgentFeedbackStatus,
  AgentObservation,
  AgentRun,
  AgentRunStatus,
  AgentSkill,
  ActivityType,
  Channel,
  ChatMessage,
  Decision,
  Lesson,
  LessonKind,
  MessageMetadata,
  ObservationPolarity,
  ProjectOnboarding,
  Responsibility,
  ResponsibilityAuthority,
  ResponsibilityRole,
  ReviewStatus,
  Task,
  Workflow,
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowSession,
  WorkflowSessionStatus,
  WorkflowSource,
} from '@slark/shared';
import type {
  ReasoningEffort,
  Runtime,
  SenderType,
  TaskStatus,
} from '@slark/shared';
import { ACTIVITY_RETENTION_PER_AGENT } from '@slark/shared';

const now = (): number => Date.now();

// =============================================================================
// Projects（D-21）：项目元数据已迁移到 <workspace>/.slark/project.json，
// 不再存放在 SQLite。本文件不再 export projectRepo；改用 config/project-meta.ts +
// config/projects-store.ts。
// =============================================================================

// =============================================================================
// Channels
// =============================================================================

interface ChannelRow {
  id: string;
  name: string;
  description: string | null;
  type: 'channel' | 'dm';
  created_at: number;
}

function rowToChannel(r: ChannelRow): Channel {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    type: r.type,
    project_id: null, // D-21：per-project db 内本来只有一个 project，project_id 由 server 注入
    created_at: r.created_at,
  };
}

export const channelRepo = {
  list(db: Database): Channel[] {
    return (db.prepare('SELECT * FROM channels ORDER BY created_at ASC').all() as ChannelRow[])
      .map(rowToChannel);
  },

  getById(db: Database, id: string): Channel | null {
    const row = db.prepare('SELECT * FROM channels WHERE id = ?').get(id) as ChannelRow | undefined;
    return row ? rowToChannel(row) : null;
  },

  create(
    db: Database,
    input: {
      id?: string;
      name: string;
      description?: string | null;
      type: 'channel' | 'dm';
    },
  ): Channel {
    const id = input.id ?? nanoid();
    const ts = now();
    db.prepare(
      'INSERT INTO channels (id, name, description, type, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(id, input.name, input.description ?? null, input.type, ts);
    return {
      id,
      name: input.name,
      description: input.description ?? null,
      type: input.type,
      project_id: null,
      created_at: ts,
    };
  },

  update(
    db: Database,
    id: string,
    patch: { name?: string; description?: string | null },
  ): Channel | null {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (patch.name !== undefined) {
      fields.push('name = ?');
      values.push(patch.name);
    }
    if (patch.description !== undefined) {
      fields.push('description = ?');
      values.push(patch.description);
    }
    if (!fields.length) return this.getById(db, id);
    values.push(id);
    db.prepare(`UPDATE channels SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.getById(db, id);
  },

  remove(db: Database, id: string): void {
    db.prepare('DELETE FROM channels WHERE id = ?').run(id);
  },
};

// =============================================================================
// Agents
// =============================================================================

interface AgentRow {
  id: string;
  name: string;
  role: string | null;
  avatar: string | null;
  description: string | null;
  runtime: string;
  model: string | null;
  reasoning: string | null;
  thinking: number | null;
  context: string | null;
  env_vars_json: string | null;
  created_at: number;
}

function rowToAgent(r: AgentRow): Agent {
  return {
    id: r.id,
    name: r.name,
    role: r.role ?? null,
    avatar: r.avatar,
    description: r.description,
    runtime: r.runtime as Runtime,
    model: r.model,
    reasoning: r.reasoning as ReasoningEffort | null,
    thinking: r.thinking === null ? null : r.thinking === 1,
    context: r.context as Agent['context'],
    env_vars: r.env_vars_json ? (JSON.parse(r.env_vars_json) as Record<string, string>) : {},
    project_id: null, // D-21：per-project db 内的 agent 都属于该 project
    created_at: r.created_at,
  };
}

export const agentRepo = {
  list(db: Database): Agent[] {
    return (db.prepare('SELECT * FROM agents ORDER BY created_at ASC').all() as AgentRow[])
      .map(rowToAgent);
  },

  getById(db: Database, id: string): Agent | null {
    const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow | undefined;
    return row ? rowToAgent(row) : null;
  },

  getByName(db: Database, name: string): Agent | null {
    const row = db.prepare('SELECT * FROM agents WHERE name = ?').get(name) as AgentRow | undefined;
    return row ? rowToAgent(row) : null;
  },

  create(
    db: Database,
    input: {
      id?: string;
      name: string;
      role?: string | null;
      avatar?: string | null;
      description?: string | null;
      runtime: Runtime;
      model?: string | null;
      reasoning?: ReasoningEffort | null;
      thinking?: boolean | null;
      context?: Agent['context'];
      env_vars?: Record<string, string>;
    },
  ): Agent {
    const id = input.id ?? nanoid();
    const ts = now();
    const thinkingInt =
      input.thinking === undefined || input.thinking === null
        ? null
        : input.thinking
          ? 1
          : 0;
    db.prepare(
      `INSERT INTO agents (id, name, role, avatar, description, runtime, model, reasoning, thinking, context, env_vars_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.name,
      input.role ?? null,
      input.avatar ?? null,
      input.description ?? null,
      input.runtime,
      input.model ?? null,
      input.reasoning ?? null,
      thinkingInt,
      input.context ?? null,
      input.env_vars ? JSON.stringify(input.env_vars) : null,
      ts,
    );
    return {
      id,
      name: input.name,
      role: input.role ?? null,
      avatar: input.avatar ?? null,
      description: input.description ?? null,
      runtime: input.runtime,
      model: input.model ?? null,
      reasoning: input.reasoning ?? null,
      thinking: input.thinking ?? null,
      context: input.context ?? null,
      env_vars: input.env_vars ?? {},
      project_id: null,
      created_at: ts,
    };
  },

  update(
    db: Database,
    id: string,
    patch: Partial<Omit<Agent, 'id' | 'created_at'>>,
  ): Agent | null {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (patch.name !== undefined) {
      fields.push('name = ?');
      values.push(patch.name);
    }
    if (patch.role !== undefined) {
      fields.push('role = ?');
      values.push(patch.role);
    }
    if (patch.avatar !== undefined) {
      fields.push('avatar = ?');
      values.push(patch.avatar);
    }
    if (patch.description !== undefined) {
      fields.push('description = ?');
      values.push(patch.description);
    }
    if (patch.runtime !== undefined) {
      fields.push('runtime = ?');
      values.push(patch.runtime);
    }
    if (patch.model !== undefined) {
      fields.push('model = ?');
      values.push(patch.model);
    }
    if (patch.reasoning !== undefined) {
      fields.push('reasoning = ?');
      values.push(patch.reasoning);
    }
    if (patch.thinking !== undefined) {
      fields.push('thinking = ?');
      values.push(patch.thinking === null ? null : patch.thinking ? 1 : 0);
    }
    if (patch.context !== undefined) {
      fields.push('context = ?');
      values.push(patch.context);
    }
    if (patch.env_vars !== undefined) {
      fields.push('env_vars_json = ?');
      values.push(JSON.stringify(patch.env_vars));
    }
    // CP8.3：agents.status 字段已删除；状态从 agent_runs 派生
    if (!fields.length) return this.getById(db, id);
    values.push(id);
    db.prepare(`UPDATE agents SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.getById(db, id);
  },

  remove(db: Database, id: string): void {
    db.prepare('DELETE FROM agents WHERE id = ?').run(id);
  },

  // channel_agents 关联表
  listInChannel(db: Database, channelId: string): Agent[] {
    return (
      db
        .prepare(
          `SELECT a.* FROM agents a
           JOIN channel_agents ca ON ca.agent_id = a.id
           WHERE ca.channel_id = ?
           ORDER BY a.created_at ASC`,
        )
        .all(channelId) as AgentRow[]
    ).map(rowToAgent);
  },

  addToChannel(db: Database, channelId: string, agentId: string): void {
    db.prepare(
      'INSERT OR IGNORE INTO channel_agents (channel_id, agent_id) VALUES (?, ?)',
    ).run(channelId, agentId);
  },

  removeFromChannel(db: Database, channelId: string, agentId: string): void {
    db.prepare('DELETE FROM channel_agents WHERE channel_id = ? AND agent_id = ?').run(
      channelId,
      agentId,
    );
  },
};

// =============================================================================
// Messages
// =============================================================================

interface MessageRow {
  id: string;
  channel_id: string;
  sender_type: string;
  sender_id: string | null;
  content: string;
  metadata_json: string | null;
  parent_id: string | null;
  reply_count: number;
  created_at: number;
}

function rowToMessage(r: MessageRow): ChatMessage {
  return {
    id: r.id,
    channel_id: r.channel_id,
    sender_type: r.sender_type as SenderType,
    sender_id: r.sender_id,
    content: r.content,
    metadata: r.metadata_json ? (JSON.parse(r.metadata_json) as MessageMetadata) : null,
    parent_id: r.parent_id,
    reply_count: r.reply_count,
    created_at: r.created_at,
  };
}

export const messageRepo = {
  /** 查询频道主线消息（parent_id IS NULL），按时间倒序 */
  listChannelMain(
    db: Database,
    channelId: string,
    limit = 50,
    before?: string,
  ): ChatMessage[] {
    const rows = before
      ? (db
          .prepare(
            `SELECT * FROM messages
             WHERE channel_id = ? AND parent_id IS NULL
               AND created_at < (SELECT created_at FROM messages WHERE id = ?)
             ORDER BY created_at DESC LIMIT ?`,
          )
          .all(channelId, before, limit) as MessageRow[])
      : (db
          .prepare(
            `SELECT * FROM messages
             WHERE channel_id = ? AND parent_id IS NULL
             ORDER BY created_at DESC LIMIT ?`,
          )
          .all(channelId, limit) as MessageRow[]);
    return rows.map(rowToMessage).reverse();
  },

  /** 查询 Thread 内所有消息（包括根消息），按时间正序 */
  listThread(db: Database, rootMessageId: string): ChatMessage[] {
    const root = db
      .prepare('SELECT * FROM messages WHERE id = ?')
      .get(rootMessageId) as MessageRow | undefined;
    if (!root) return [];
    const replies = db
      .prepare('SELECT * FROM messages WHERE parent_id = ? ORDER BY created_at ASC')
      .all(rootMessageId) as MessageRow[];
    return [rowToMessage(root), ...replies.map(rowToMessage)];
  },

  getById(db: Database, id: string): ChatMessage | null {
    const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow | undefined;
    return row ? rowToMessage(row) : null;
  },

  create(
    db: Database,
    input: {
      id?: string;
      channel_id: string;
      sender_type: SenderType;
      sender_id: string | null;
      content: string;
      metadata?: MessageMetadata | null;
      parent_id?: string | null;
    },
  ): ChatMessage {
    const id = input.id ?? nanoid();
    const ts = now();

    db.prepare(
      `INSERT INTO messages (id, channel_id, sender_type, sender_id, content, metadata_json, parent_id, reply_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    ).run(
      id,
      input.channel_id,
      input.sender_type,
      input.sender_id,
      input.content,
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.parent_id ?? null,
      ts,
    );

    // 如果有 parent，更新父消息 reply_count
    if (input.parent_id) {
      db.prepare('UPDATE messages SET reply_count = reply_count + 1 WHERE id = ?').run(
        input.parent_id,
      );
    }

    return {
      id,
      channel_id: input.channel_id,
      sender_type: input.sender_type,
      sender_id: input.sender_id,
      content: input.content,
      metadata: input.metadata ?? null,
      parent_id: input.parent_id ?? null,
      reply_count: 0,
      created_at: ts,
    };
  },

  updateContent(
    db: Database,
    id: string,
    content: string,
    metadata?: MessageMetadata | null,
  ): void {
    db.prepare('UPDATE messages SET content = ?, metadata_json = ? WHERE id = ?').run(
      content,
      metadata !== undefined
        ? metadata === null
          ? null
          : JSON.stringify(metadata)
        : undefined,
      id,
    );
  },
};

// =============================================================================
// Tasks
// =============================================================================

interface TaskRow {
  id: number;
  channel_id: string;
  title: string;
  status: string;
  assignee_agent_id: string | null;
  created_by: string;
  source_message_id: string | null;
  created_at: number;
  updated_at: number;
}

function rowToTask(r: TaskRow): Task {
  return {
    id: r.id,
    channel_id: r.channel_id,
    title: r.title,
    status: r.status as TaskStatus,
    assignee_agent_id: r.assignee_agent_id,
    created_by: r.created_by,
    source_message_id: r.source_message_id,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export const taskRepo = {
  list(
    db: Database,
    filter: { channel_id?: string; status?: TaskStatus } = {},
  ): Task[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.channel_id) {
      where.push('channel_id = ?');
      params.push(filter.channel_id);
    }
    if (filter.status) {
      where.push('status = ?');
      params.push(filter.status);
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    return (
      db.prepare(`SELECT * FROM tasks ${whereSql} ORDER BY id ASC`).all(...params) as TaskRow[]
    ).map(rowToTask);
  },

  getById(db: Database, id: number): Task | null {
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
    return row ? rowToTask(row) : null;
  },

  create(
    db: Database,
    input: {
      channel_id: string;
      title: string;
      assignee_agent_id?: string | null;
      created_by: string;
      source_message_id?: string | null;
    },
  ): Task {
    const ts = now();
    const result = db
      .prepare(
        `INSERT INTO tasks (channel_id, title, status, assignee_agent_id, created_by, source_message_id, created_at, updated_at)
         VALUES (?, ?, 'todo', ?, ?, ?, ?, ?)`,
      )
      .run(
        input.channel_id,
        input.title,
        input.assignee_agent_id ?? null,
        input.created_by,
        input.source_message_id ?? null,
        ts,
        ts,
      );
    const id = Number(result.lastInsertRowid);
    return {
      id,
      channel_id: input.channel_id,
      title: input.title,
      status: 'todo',
      assignee_agent_id: input.assignee_agent_id ?? null,
      created_by: input.created_by,
      source_message_id: input.source_message_id ?? null,
      created_at: ts,
      updated_at: ts,
    };
  },

  update(
    db: Database,
    id: number,
    patch: { title?: string; status?: TaskStatus; assignee_agent_id?: string | null },
  ): Task | null {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (patch.title !== undefined) {
      fields.push('title = ?');
      values.push(patch.title);
    }
    if (patch.status !== undefined) {
      fields.push('status = ?');
      values.push(patch.status);
    }
    if (patch.assignee_agent_id !== undefined) {
      fields.push('assignee_agent_id = ?');
      values.push(patch.assignee_agent_id);
    }
    if (!fields.length) return this.getById(db, id);
    fields.push('updated_at = ?');
    values.push(now());
    values.push(id);
    db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.getById(db, id);
  },

  remove(db: Database, id: number): void {
    db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  },
};

// =============================================================================
// Agent Activity
// =============================================================================

interface ActivityRow {
  id: number;
  agent_id: string;
  channel_id: string | null;
  type: string;
  detail: string | null;
  created_at: number;
}

function rowToActivity(r: ActivityRow): AgentActivity {
  return {
    id: r.id,
    agent_id: r.agent_id,
    channel_id: r.channel_id ?? null,
    type: r.type as ActivityType,
    detail: r.detail,
    created_at: r.created_at,
  };
}

export const activityRepo = {
  list(
    db: Database,
    agentId: string,
    limit = 50,
    before?: number,
    channelId?: string,
  ): AgentActivity[] {
    const where: string[] = ['agent_id = ?'];
    const params: unknown[] = [agentId];
    if (before !== undefined) {
      where.push('id < ?');
      params.push(before);
    }
    if (channelId) {
      where.push('channel_id = ?');
      params.push(channelId);
    }
    params.push(limit);
    const rows = db
      .prepare(
        `SELECT * FROM agent_activity
         WHERE ${where.join(' AND ')}
         ORDER BY id DESC LIMIT ?`,
      )
      .all(...params) as ActivityRow[];
    return rows.map(rowToActivity);
  },

  append(
    db: Database,
    input: {
      agent_id: string;
      type: ActivityType;
      detail?: string | null;
      channel_id?: string | null;
    },
  ): AgentActivity {
    const ts = now();
    const result = db
      .prepare(
        'INSERT INTO agent_activity (agent_id, channel_id, type, detail, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(
        input.agent_id,
        input.channel_id ?? null,
        input.type,
        input.detail ?? null,
        ts,
      );
    const id = Number(result.lastInsertRowid);

    // 保留策略（D-3）：超过 500 条删除最旧（全 channel 合并）
    db.prepare(
      `DELETE FROM agent_activity
       WHERE agent_id = ? AND id NOT IN (
         SELECT id FROM agent_activity WHERE agent_id = ? ORDER BY id DESC LIMIT ?
       )`,
    ).run(input.agent_id, input.agent_id, ACTIVITY_RETENTION_PER_AGENT);

    return {
      id,
      agent_id: input.agent_id,
      channel_id: input.channel_id ?? null,
      type: input.type,
      detail: input.detail ?? null,
      created_at: ts,
    };
  },
};

// =============================================================================
// Agent Runs (v1.0 新增，对齐 D-1 / D-18)
//
// 替代 v0 的 agents.status 单值字段。每次 spawn 开一个 run，结束时更新 ended_at。
// 查询 Agent 在指定 channel 的当前状态：
//   SELECT status FROM agent_runs WHERE agent_id=? AND channel_id=? AND ended_at IS NULL
//   ORDER BY started_at DESC LIMIT 1
// =============================================================================

interface AgentRunRow {
  id: number;
  agent_id: string;
  channel_id: string;
  status: string;
  started_at: number;
  ended_at: number | null;
  error_msg: string | null;
}

function rowToAgentRun(r: AgentRunRow): AgentRun {
  return {
    id: r.id,
    agent_id: r.agent_id,
    channel_id: r.channel_id,
    status: r.status as AgentRunStatus,
    started_at: r.started_at,
    ended_at: r.ended_at,
    error_msg: r.error_msg,
  };
}

export const agentRunRepo = {
  /** 开启一个 run，返回 id */
  start(
    db: Database,
    input: { agent_id: string; channel_id: string; status: AgentRunStatus },
  ): AgentRun {
    const ts = now();
    const result = db
      .prepare(
        `INSERT INTO agent_runs (agent_id, channel_id, status, started_at, ended_at, error_msg)
         VALUES (?, ?, ?, ?, NULL, NULL)`,
      )
      .run(input.agent_id, input.channel_id, input.status, ts);
    return {
      id: Number(result.lastInsertRowid),
      agent_id: input.agent_id,
      channel_id: input.channel_id,
      status: input.status,
      started_at: ts,
      ended_at: null,
      error_msg: null,
    };
  },

  /** 更新活跃 run 的 status（如 thinking → working） */
  updateStatus(db: Database, id: number, status: AgentRunStatus): void {
    db.prepare('UPDATE agent_runs SET status = ? WHERE id = ?').run(status, id);
  },

  /** 结束一个 run（设置 ended_at） */
  end(db: Database, id: number, errorMsg?: string | null): void {
    const ts = now();
    db.prepare(
      'UPDATE agent_runs SET ended_at = ?, error_msg = ? WHERE id = ?',
    ).run(ts, errorMsg ?? null, id);
  },

  /** 查找 Agent 在指定 channel 的当前活跃 run（若有） */
  getActive(db: Database, agentId: string, channelId: string): AgentRun | null {
    const row = db
      .prepare(
        `SELECT * FROM agent_runs
         WHERE agent_id = ? AND channel_id = ? AND ended_at IS NULL
         ORDER BY started_at DESC LIMIT 1`,
      )
      .get(agentId, channelId) as AgentRunRow | undefined;
    return row ? rowToAgentRun(row) : null;
  },

  /** 列出 Agent 所有活跃 run（跨 channel）—— Sidebar 判断"任意 channel 在跑"用 */
  listActiveForAgent(db: Database, agentId: string): AgentRun[] {
    const rows = db
      .prepare(
        `SELECT * FROM agent_runs
         WHERE agent_id = ? AND ended_at IS NULL
         ORDER BY started_at DESC`,
      )
      .all(agentId) as AgentRunRow[];
    return rows.map(rowToAgentRun);
  },

  /** 列出 Channel 所有活跃 run（Stop All 用） */
  listActiveInChannel(db: Database, channelId: string): AgentRun[] {
    const rows = db
      .prepare(
        `SELECT * FROM agent_runs
         WHERE channel_id = ? AND ended_at IS NULL
         ORDER BY started_at DESC`,
      )
      .all(channelId) as AgentRunRow[];
    return rows.map(rowToAgentRun);
  },
};

// =============================================================================
// Workflows (Sprint 2 / D-16)
// =============================================================================

interface WorkflowRow {
  id: string;
  name: string;
  description: string | null;
  trigger_command: string;
  definition_yaml: string;
  source: string;
  created_at: number;
  updated_at: number;
}

function rowToWorkflow(r: WorkflowRow): Workflow {
  return {
    id: r.id,
    project_id: '', // D-21：per-project db 内 workflow 都属于该 project；server 注入真实 id
    name: r.name,
    description: r.description,
    trigger_command: r.trigger_command,
    definition_yaml: r.definition_yaml,
    source: r.source as WorkflowSource,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export const workflowRepo = {
  list(db: Database): Workflow[] {
    return (db.prepare('SELECT * FROM workflows ORDER BY created_at ASC').all() as WorkflowRow[])
      .map(rowToWorkflow);
  },

  getById(db: Database, id: string): Workflow | null {
    const row = db.prepare('SELECT * FROM workflows WHERE id = ?').get(id) as
      | WorkflowRow
      | undefined;
    return row ? rowToWorkflow(row) : null;
  },

  /** 按 trigger 查（用于 MessageRouter 命令分发）*/
  getByTrigger(db: Database, triggerCommand: string): Workflow | null {
    const row = db
      .prepare('SELECT * FROM workflows WHERE trigger_command = ?')
      .get(triggerCommand) as WorkflowRow | undefined;
    return row ? rowToWorkflow(row) : null;
  },

  create(
    db: Database,
    input: {
      id?: string;
      name: string;
      description?: string | null;
      trigger_command: string;
      definition_yaml: string;
      source?: WorkflowSource;
    },
  ): Workflow {
    const id = input.id ?? nanoid();
    const ts = now();
    db.prepare(
      `INSERT INTO workflows (id, name, description, trigger_command, definition_yaml, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.name,
      input.description ?? null,
      input.trigger_command,
      input.definition_yaml,
      input.source ?? 'user',
      ts,
      ts,
    );
    const wf = this.getById(db, id);
    if (!wf) throw new Error(`workflow ${id} insert failed`);
    return wf;
  },

  update(
    db: Database,
    id: string,
    patch: Partial<{
      name: string;
      description: string | null;
      trigger_command: string;
      definition_yaml: string;
    }>,
  ): Workflow | null {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (patch.name !== undefined) {
      fields.push('name = ?');
      values.push(patch.name);
    }
    if (patch.description !== undefined) {
      fields.push('description = ?');
      values.push(patch.description);
    }
    if (patch.trigger_command !== undefined) {
      fields.push('trigger_command = ?');
      values.push(patch.trigger_command);
    }
    if (patch.definition_yaml !== undefined) {
      fields.push('definition_yaml = ?');
      values.push(patch.definition_yaml);
    }
    if (!fields.length) return this.getById(db, id);
    fields.push('updated_at = ?');
    values.push(now());
    values.push(id);
    db.prepare(`UPDATE workflows SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.getById(db, id);
  },

  remove(db: Database, id: string): void {
    db.prepare('DELETE FROM workflows WHERE id = ?').run(id);
  },
};

// =============================================================================
// Workflow Runs (Sprint 2)
// =============================================================================

interface WorkflowRunRow {
  id: number;
  workflow_id: string;
  channel_id: string;
  thread_id: string | null;
  status: string;
  current_step: string | null;
  started_by: string;
  started_at: number;
  ended_at: number | null;
  state_json: string;
}

function rowToWorkflowRun(r: WorkflowRunRow): WorkflowRun {
  return {
    id: r.id,
    workflow_id: r.workflow_id,
    channel_id: r.channel_id,
    thread_id: r.thread_id,
    status: r.status as WorkflowRunStatus,
    current_step: r.current_step,
    started_by: r.started_by,
    started_at: r.started_at,
    ended_at: r.ended_at,
    state_json: r.state_json,
  };
}

export const workflowRunRepo = {
  getById(db: Database, id: number): WorkflowRun | null {
    const row = db.prepare('SELECT * FROM workflow_runs WHERE id = ?').get(id) as
      | WorkflowRunRow
      | undefined;
    return row ? rowToWorkflowRun(row) : null;
  },

  listByWorkflow(db: Database, workflowId: string, limit = 50): WorkflowRun[] {
    const rows = db
      .prepare(
        'SELECT * FROM workflow_runs WHERE workflow_id = ? ORDER BY started_at DESC LIMIT ?',
      )
      .all(workflowId, limit) as WorkflowRunRow[];
    return rows.map(rowToWorkflowRun);
  },

  listByChannel(db: Database, channelId: string, limit = 50): WorkflowRun[] {
    const rows = db
      .prepare(
        'SELECT * FROM workflow_runs WHERE channel_id = ? ORDER BY started_at DESC LIMIT ?',
      )
      .all(channelId, limit) as WorkflowRunRow[];
    return rows.map(rowToWorkflowRun);
  },

  /** 列出全局活跃 runs（跨 channel / project）—— Inbox 视图用 */
  listActive(db: Database, opts?: { status?: WorkflowRunStatus }): WorkflowRun[] {
    if (opts?.status) {
      const rows = db
        .prepare(
          'SELECT * FROM workflow_runs WHERE status = ? ORDER BY started_at DESC',
        )
        .all(opts.status) as WorkflowRunRow[];
      return rows.map(rowToWorkflowRun);
    }
    const rows = db
      .prepare(
        `SELECT * FROM workflow_runs
         WHERE status IN ('running','awaiting_approval')
         ORDER BY started_at DESC`,
      )
      .all() as WorkflowRunRow[];
    return rows.map(rowToWorkflowRun);
  },

  /** 找 channel 当前活跃 run（running / awaiting_approval），可选按 thread 过滤 */
  getActive(
    db: Database,
    channelId: string,
    threadId?: string | null,
  ): WorkflowRun | null {
    const sql = threadId
      ? `SELECT * FROM workflow_runs
         WHERE channel_id = ? AND thread_id = ?
         AND status IN ('running','awaiting_approval')
         ORDER BY started_at DESC LIMIT 1`
      : `SELECT * FROM workflow_runs
         WHERE channel_id = ? AND status IN ('running','awaiting_approval')
         ORDER BY started_at DESC LIMIT 1`;
    const row = (
      threadId
        ? db.prepare(sql).get(channelId, threadId)
        : db.prepare(sql).get(channelId)
    ) as WorkflowRunRow | undefined;
    return row ? rowToWorkflowRun(row) : null;
  },

  create(
    db: Database,
    input: {
      workflow_id: string;
      channel_id: string;
      thread_id?: string | null;
      started_by: string;
      current_step: string;
      state_json?: string;
    },
  ): WorkflowRun {
    const ts = now();
    const result = db
      .prepare(
        `INSERT INTO workflow_runs
         (workflow_id, channel_id, thread_id, status, current_step, started_by, started_at, ended_at, state_json)
         VALUES (?, ?, ?, 'running', ?, ?, ?, NULL, ?)`,
      )
      .run(
        input.workflow_id,
        input.channel_id,
        input.thread_id ?? null,
        input.current_step,
        input.started_by,
        ts,
        input.state_json ?? '{}',
      );
    const run = this.getById(db, Number(result.lastInsertRowid));
    if (!run) throw new Error('workflow_run insert failed');
    return run;
  },

  /** 更新 status / current_step / state_json（部分） */
  update(
    db: Database,
    id: number,
    patch: Partial<{
      status: WorkflowRunStatus;
      current_step: string | null;
      state_json: string;
      thread_id: string | null;
      ended: boolean;
    }>,
  ): WorkflowRun | null {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (patch.status !== undefined) {
      fields.push('status = ?');
      values.push(patch.status);
    }
    if (patch.current_step !== undefined) {
      fields.push('current_step = ?');
      values.push(patch.current_step);
    }
    if (patch.state_json !== undefined) {
      fields.push('state_json = ?');
      values.push(patch.state_json);
    }
    if (patch.thread_id !== undefined) {
      fields.push('thread_id = ?');
      values.push(patch.thread_id);
    }
    if (patch.ended) {
      fields.push('ended_at = ?');
      values.push(now());
    }
    if (!fields.length) return this.getById(db, id);
    values.push(id);
    db.prepare(`UPDATE workflow_runs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.getById(db, id);
  },
};

// =============================================================================
// Responsibilities (Sprint 3 / D-17)
// =============================================================================

interface ResponsibilityRow {
  id: number;
  workflow_id: string;
  step_id: string;
  agent_id: string;
  role: string;
  authority: string | null;
  created_at: number;
}

function rowToResponsibility(r: ResponsibilityRow): Responsibility {
  return {
    id: r.id,
    workflow_id: r.workflow_id,
    step_id: r.step_id,
    agent_id: r.agent_id,
    role: r.role as ResponsibilityRole,
    authority: r.authority as ResponsibilityAuthority | null,
    created_at: r.created_at,
  };
}

export const responsibilityRepo = {
  listByWorkflow(db: Database, workflowId: string): Responsibility[] {
    const rows = db
      .prepare(
        'SELECT * FROM responsibilities WHERE workflow_id = ? ORDER BY id ASC',
      )
      .all(workflowId) as ResponsibilityRow[];
    return rows.map(rowToResponsibility);
  },

  listByAgent(db: Database, agentId: string): Responsibility[] {
    const rows = db
      .prepare(
        'SELECT * FROM responsibilities WHERE agent_id = ? ORDER BY workflow_id, step_id',
      )
      .all(agentId) as ResponsibilityRow[];
    return rows.map(rowToResponsibility);
  },

  /**
   * 替换 workflow 的全部 responsibilities（先清空再插入）。
   * 用于 workflow 创建 / definition_yaml 更新时的 auto-derive。
   */
  replaceForWorkflow(
    db: Database,
    workflowId: string,
    rows: Array<{
      step_id: string;
      agent_id: string;
      role: ResponsibilityRole;
      authority: ResponsibilityAuthority | null;
    }>,
  ): Responsibility[] {
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM responsibilities WHERE workflow_id = ?').run(workflowId);
      const ts = now();
      const stmt = db.prepare(
        `INSERT INTO responsibilities (workflow_id, step_id, agent_id, role, authority, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const r of rows) {
        stmt.run(workflowId, r.step_id, r.agent_id, r.role, r.authority, ts);
      }
    });
    tx();
    return this.listByWorkflow(db, workflowId);
  },

  remove(db: Database, id: number): void {
    db.prepare('DELETE FROM responsibilities WHERE id = ?').run(id);
  },
};

// =============================================================================
// Decisions (Sprint 4 / D-20)
// =============================================================================

interface DecisionRow {
  id: number;
  title: string;
  body: string;
  audience: string;
  source_run_id: number | null;
  source_message_id: string | null;
  confidence: number | null;
  review_status: string;
  recorded_by: string;
  created_at: number;
  reviewed_at: number | null;
}

function rowToDecision(r: DecisionRow): Decision {
  return {
    id: r.id,
    project_id: '', // D-21：per-project db 内的 decision 都属于该 project
    title: r.title,
    body: r.body,
    audience: r.audience,
    source_run_id: r.source_run_id,
    source_message_id: r.source_message_id,
    confidence: r.confidence,
    review_status: r.review_status as ReviewStatus,
    recorded_by: r.recorded_by,
    created_at: r.created_at,
    reviewed_at: r.reviewed_at,
  };
}

export const decisionRepo = {
  list(
    db: Database,
    opts?: { review_status?: ReviewStatus; limit?: number },
  ): Decision[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (opts?.review_status) {
      where.push('review_status = ?');
      params.push(opts.review_status);
    }
    const limit = opts?.limit ?? 200;
    params.push(limit);
    const sql = where.length
      ? `SELECT * FROM decisions WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?`
      : `SELECT * FROM decisions ORDER BY created_at DESC LIMIT ?`;
    const rows = db.prepare(sql).all(...params) as DecisionRow[];
    return rows.map(rowToDecision);
  },

  getById(db: Database, id: number): Decision | null {
    const row = db.prepare('SELECT * FROM decisions WHERE id = ?').get(id) as
      | DecisionRow
      | undefined;
    return row ? rowToDecision(row) : null;
  },

  create(
    db: Database,
    input: {
      title: string;
      body: string;
      audience?: string;
      source_run_id?: number | null;
      source_message_id?: string | null;
      confidence?: number | null;
      review_status?: ReviewStatus;
      recorded_by: string;
    },
  ): Decision {
    const ts = now();
    const result = db
      .prepare(
        `INSERT INTO decisions (title, body, audience, source_run_id, source_message_id, confidence, review_status, recorded_by, created_at, reviewed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.title,
        input.body,
        input.audience ?? 'all',
        input.source_run_id ?? null,
        input.source_message_id ?? null,
        input.confidence ?? null,
        input.review_status ?? 'pending',
        input.recorded_by,
        ts,
        input.review_status === 'approved' || input.review_status === 'rejected' ? ts : null,
      );
    const d = this.getById(db, Number(result.lastInsertRowid));
    if (!d) throw new Error('decision insert failed');
    return d;
  },

  updateReview(
    db: Database,
    id: number,
    status: ReviewStatus,
    patch?: { title?: string; body?: string; audience?: string },
  ): Decision | null {
    const fields: string[] = ['review_status = ?', 'reviewed_at = ?'];
    const values: unknown[] = [status, now()];
    if (patch?.title !== undefined) {
      fields.push('title = ?');
      values.push(patch.title);
    }
    if (patch?.body !== undefined) {
      fields.push('body = ?');
      values.push(patch.body);
    }
    if (patch?.audience !== undefined) {
      fields.push('audience = ?');
      values.push(patch.audience);
    }
    values.push(id);
    db.prepare(`UPDATE decisions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.getById(db, id);
  },

  remove(db: Database, id: number): void {
    db.prepare('DELETE FROM decisions WHERE id = ?').run(id);
  },
};

// =============================================================================
// Lessons (Sprint 4 / D-20)
// =============================================================================

interface LessonRow {
  id: number;
  kind: string;
  title: string;
  body: string;
  audience: string;
  tags_json: string | null;
  source_run_id: number | null;
  source_message_id: string | null;
  confidence: number | null;
  review_status: string;
  recorded_by: string;
  use_count: number;
  created_at: number;
  reviewed_at: number | null;
}

function rowToLesson(r: LessonRow): Lesson {
  let tags: string[] = [];
  if (r.tags_json) {
    try {
      const parsed = JSON.parse(r.tags_json);
      if (Array.isArray(parsed)) tags = parsed.filter((x) => typeof x === 'string');
    } catch {
      /* ignore */
    }
  }
  return {
    id: r.id,
    project_id: '', // D-21：per-project db 内的 lesson 都属于该 project
    kind: r.kind as LessonKind,
    title: r.title,
    body: r.body,
    audience: r.audience,
    tags,
    source_run_id: r.source_run_id,
    source_message_id: r.source_message_id,
    confidence: r.confidence,
    review_status: r.review_status as ReviewStatus,
    recorded_by: r.recorded_by,
    use_count: r.use_count,
    created_at: r.created_at,
    reviewed_at: r.reviewed_at,
  };
}

export const lessonRepo = {
  list(
    db: Database,
    opts?: {
      review_status?: ReviewStatus;
      audience?: string;
      kind?: LessonKind;
      limit?: number;
    },
  ): Lesson[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (opts?.review_status) {
      where.push('review_status = ?');
      params.push(opts.review_status);
    }
    if (opts?.audience) {
      where.push('audience = ?');
      params.push(opts.audience);
    }
    if (opts?.kind) {
      where.push('kind = ?');
      params.push(opts.kind);
    }
    const limit = opts?.limit ?? 500;
    params.push(limit);
    const sql = where.length
      ? `SELECT * FROM lessons WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?`
      : `SELECT * FROM lessons ORDER BY created_at DESC LIMIT ?`;
    const rows = db.prepare(sql).all(...params) as LessonRow[];
    return rows.map(rowToLesson);
  },

  /** ContextBuilder 用：取已审批且 audience 匹配的最近 N 条 */
  listForInjection(
    db: Database,
    audiences: string[],
    limit = 20,
  ): Lesson[] {
    if (audiences.length === 0) return [];
    const placeholders = audiences.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT * FROM lessons
         WHERE review_status = 'approved'
         AND audience IN (${placeholders})
         ORDER BY use_count DESC, created_at DESC
         LIMIT ?`,
      )
      .all(...audiences, limit) as LessonRow[];
    return rows.map(rowToLesson);
  },

  getById(db: Database, id: number): Lesson | null {
    const row = db.prepare('SELECT * FROM lessons WHERE id = ?').get(id) as
      | LessonRow
      | undefined;
    return row ? rowToLesson(row) : null;
  },

  create(
    db: Database,
    input: {
      kind: LessonKind;
      title: string;
      body: string;
      audience?: string;
      tags?: string[];
      source_run_id?: number | null;
      source_message_id?: string | null;
      confidence?: number | null;
      review_status?: ReviewStatus;
      recorded_by: string;
    },
  ): Lesson {
    const ts = now();
    const reviewed = input.review_status === 'approved' || input.review_status === 'rejected';
    const result = db
      .prepare(
        `INSERT INTO lessons (kind, title, body, audience, tags_json, source_run_id, source_message_id, confidence, review_status, recorded_by, created_at, reviewed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.kind,
        input.title,
        input.body,
        input.audience ?? 'all',
        input.tags?.length ? JSON.stringify(input.tags) : null,
        input.source_run_id ?? null,
        input.source_message_id ?? null,
        input.confidence ?? null,
        input.review_status ?? 'pending',
        input.recorded_by,
        ts,
        reviewed ? ts : null,
      );
    const l = this.getById(db, Number(result.lastInsertRowid));
    if (!l) throw new Error('lesson insert failed');
    return l;
  },

  updateReview(
    db: Database,
    id: number,
    status: ReviewStatus,
    patch?: {
      title?: string;
      body?: string;
      audience?: string;
      kind?: LessonKind;
      tags?: string[];
    },
  ): Lesson | null {
    const fields: string[] = ['review_status = ?', 'reviewed_at = ?'];
    const values: unknown[] = [status, now()];
    if (patch?.title !== undefined) {
      fields.push('title = ?');
      values.push(patch.title);
    }
    if (patch?.body !== undefined) {
      fields.push('body = ?');
      values.push(patch.body);
    }
    if (patch?.audience !== undefined) {
      fields.push('audience = ?');
      values.push(patch.audience);
    }
    if (patch?.kind !== undefined) {
      fields.push('kind = ?');
      values.push(patch.kind);
    }
    if (patch?.tags !== undefined) {
      fields.push('tags_json = ?');
      values.push(patch.tags.length ? JSON.stringify(patch.tags) : null);
    }
    values.push(id);
    db.prepare(`UPDATE lessons SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.getById(db, id);
  },

  bumpUseCount(db: Database, ids: number[]): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(
      `UPDATE lessons SET use_count = use_count + 1 WHERE id IN (${placeholders})`,
    ).run(...ids);
  },

  remove(db: Database, id: number): void {
    db.prepare('DELETE FROM lessons WHERE id = ?').run(id);
  },
};

// =============================================================================
// Agent Observations (Sprint 5 / D-20 Evolution Loop)
// =============================================================================

interface ObservationRow {
  id: number;
  agent_id: string;
  polarity: string;
  tag: string;
  body: string;
  source_message_id: string | null;
  source_run_id: number | null;
  created_at: number;
}

function rowToObservation(r: ObservationRow): AgentObservation {
  return {
    id: r.id,
    agent_id: r.agent_id,
    polarity: r.polarity as ObservationPolarity,
    tag: r.tag,
    body: r.body,
    source_message_id: r.source_message_id,
    source_run_id: r.source_run_id,
    created_at: r.created_at,
  };
}

export const observationRepo = {
  listByAgent(
    db: Database,
    agentId: string,
    opts?: { since?: number; limit?: number },
  ): AgentObservation[] {
    const where: string[] = ['agent_id = ?'];
    const params: unknown[] = [agentId];
    if (opts?.since !== undefined) {
      where.push('created_at >= ?');
      params.push(opts.since);
    }
    const limit = opts?.limit ?? 200;
    params.push(limit);
    const rows = db
      .prepare(
        `SELECT * FROM agent_observations WHERE ${where.join(' AND ')}
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(...params) as ObservationRow[];
    return rows.map(rowToObservation);
  },

  create(
    db: Database,
    input: {
      agent_id: string;
      polarity: ObservationPolarity;
      tag: string;
      body: string;
      source_message_id?: string | null;
      source_run_id?: number | null;
    },
  ): AgentObservation {
    const ts = now();
    const result = db
      .prepare(
        `INSERT INTO agent_observations
         (agent_id, polarity, tag, body, source_message_id, source_run_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.agent_id,
        input.polarity,
        input.tag,
        input.body,
        input.source_message_id ?? null,
        input.source_run_id ?? null,
        ts,
      );
    return {
      id: Number(result.lastInsertRowid),
      agent_id: input.agent_id,
      polarity: input.polarity,
      tag: input.tag,
      body: input.body,
      source_message_id: input.source_message_id ?? null,
      source_run_id: input.source_run_id ?? null,
      created_at: ts,
    };
  },

  /** 给 Coach 聚合用：按 tag 统计该 agent 在窗口内 negative observation 数量 */
  countByTag(
    db: Database,
    agentId: string,
    since: number,
    polarity?: ObservationPolarity,
  ): Array<{ tag: string; count: number }> {
    const where: string[] = ['agent_id = ?', 'created_at >= ?'];
    const params: unknown[] = [agentId, since];
    if (polarity) {
      where.push('polarity = ?');
      params.push(polarity);
    }
    const rows = db
      .prepare(
        `SELECT tag, COUNT(*) AS count FROM agent_observations
         WHERE ${where.join(' AND ')}
         GROUP BY tag ORDER BY count DESC`,
      )
      .all(...params) as Array<{ tag: string; count: number }>;
    return rows;
  },
};

// =============================================================================
// Agent Feedback (Sprint 5 / D-20 Evolution Loop)
// =============================================================================

interface FeedbackRow {
  id: number;
  agent_id: string;
  period_start: number;
  period_end: number;
  summary: string;
  rationale: string;
  description_before: string;
  description_after: string;
  status: string;
  confidence: number | null;
  reviewed_by: string | null;
  applied_at: number | null;
  rejected_at: number | null;
  rolled_back_at: number | null;
  created_at: number;
}

function rowToFeedback(r: FeedbackRow): AgentFeedback {
  return {
    id: r.id,
    agent_id: r.agent_id,
    period_start: r.period_start,
    period_end: r.period_end,
    summary: r.summary,
    rationale: r.rationale,
    description_before: r.description_before,
    description_after: r.description_after,
    status: r.status as AgentFeedbackStatus,
    confidence: r.confidence,
    reviewed_by: r.reviewed_by,
    applied_at: r.applied_at,
    rejected_at: r.rejected_at,
    rolled_back_at: r.rolled_back_at,
    created_at: r.created_at,
  };
}

export const feedbackRepo = {
  listByAgent(db: Database, agentId: string): AgentFeedback[] {
    const rows = db
      .prepare(
        'SELECT * FROM agent_feedback WHERE agent_id = ? ORDER BY created_at DESC',
      )
      .all(agentId) as FeedbackRow[];
    return rows.map(rowToFeedback);
  },

  getById(db: Database, id: number): AgentFeedback | null {
    const row = db.prepare('SELECT * FROM agent_feedback WHERE id = ?').get(id) as
      | FeedbackRow
      | undefined;
    return row ? rowToFeedback(row) : null;
  },

  create(
    db: Database,
    input: {
      agent_id: string;
      period_start: number;
      period_end: number;
      summary: string;
      rationale: string;
      description_before: string;
      description_after: string;
      confidence?: number | null;
    },
  ): AgentFeedback {
    const ts = now();
    const result = db
      .prepare(
        `INSERT INTO agent_feedback
         (agent_id, period_start, period_end, summary, rationale,
          description_before, description_after, status, confidence, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .run(
        input.agent_id,
        input.period_start,
        input.period_end,
        input.summary,
        input.rationale,
        input.description_before,
        input.description_after,
        input.confidence ?? null,
        ts,
      );
    const f = this.getById(db, Number(result.lastInsertRowid));
    if (!f) throw new Error('feedback insert failed');
    return f;
  },

  setStatus(
    db: Database,
    id: number,
    status: AgentFeedbackStatus,
    reviewer: string | null,
  ): AgentFeedback | null {
    const ts = now();
    const fields: string[] = ['status = ?', 'reviewed_by = ?'];
    const values: unknown[] = [status, reviewer];
    if (status === 'applied') {
      fields.push('applied_at = ?');
      values.push(ts);
    } else if (status === 'rejected') {
      fields.push('rejected_at = ?');
      values.push(ts);
    } else if (status === 'rolled_back') {
      fields.push('rolled_back_at = ?');
      values.push(ts);
    }
    values.push(id);
    db.prepare(`UPDATE agent_feedback SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.getById(db, id);
  },
};

// =============================================================================
// Project Onboarding (Sprint 6 / D-20)
// =============================================================================

interface OnboardingRow {
  id: number;
  overview: string;
  tech_stack_json: string;
  conventions: string | null;
  ready: number;
  generated_at: number;
}

function rowToOnboarding(r: OnboardingRow): ProjectOnboarding {
  let stack: string[] = [];
  try {
    const parsed = JSON.parse(r.tech_stack_json);
    if (Array.isArray(parsed)) stack = parsed.filter((x) => typeof x === 'string');
  } catch {
    /* ignore */
  }
  return {
    project_id: '', // D-21：per-project db 内的 onboarding 都属于该 project
    overview: r.overview,
    tech_stack: stack,
    conventions: r.conventions,
    ready: r.ready === 1,
    generated_at: r.generated_at,
  };
}

export const onboardingRepo = {
  /** D-21：per-project db 内 project_onboarding 是 singleton（id=1） */
  get(db: Database): ProjectOnboarding | null {
    const row = db
      .prepare('SELECT * FROM project_onboarding WHERE id = 1')
      .get() as OnboardingRow | undefined;
    return row ? rowToOnboarding(row) : null;
  },

  upsert(
    db: Database,
    input: {
      overview: string;
      tech_stack: string[];
      conventions?: string | null;
    },
  ): ProjectOnboarding {
    const ts = now();
    db.prepare(
      `INSERT INTO project_onboarding (id, overview, tech_stack_json, conventions, ready, generated_at)
       VALUES (1, ?, ?, ?, 1, ?)
       ON CONFLICT(id) DO UPDATE SET
         overview = excluded.overview,
         tech_stack_json = excluded.tech_stack_json,
         conventions = excluded.conventions,
         ready = 1,
         generated_at = excluded.generated_at`,
    ).run(input.overview, JSON.stringify(input.tech_stack), input.conventions ?? null, ts);
    const got = this.get(db);
    if (!got) throw new Error('onboarding upsert failed');
    return got;
  },

  remove(db: Database): void {
    db.prepare('DELETE FROM project_onboarding WHERE id = 1').run();
  },
};

// =============================================================================
// Agent Skills (Sprint 6 / D-20 Skill Matrix)
// =============================================================================

interface SkillRow {
  id: number;
  agent_id: string;
  skill_key: string;
  touch_count: number;
  last_touched: number;
}

function rowToSkill(r: SkillRow): AgentSkill {
  return {
    id: r.id,
    agent_id: r.agent_id,
    project_id: '', // D-21：per-project db 内的 skill 都属于该 project
    skill_key: r.skill_key,
    touch_count: r.touch_count,
    last_touched: r.last_touched,
  };
}

export const skillRepo = {
  listByAgent(db: Database, agentId: string, limit = 50): AgentSkill[] {
    const rows = db
      .prepare(
        `SELECT * FROM agent_skills WHERE agent_id = ?
         ORDER BY touch_count DESC, last_touched DESC LIMIT ?`,
      )
      .all(agentId, limit) as SkillRow[];
    return rows.map(rowToSkill);
  },

  list(db: Database, limit = 200): AgentSkill[] {
    const rows = db
      .prepare(
        `SELECT * FROM agent_skills
         ORDER BY touch_count DESC, last_touched DESC LIMIT ?`,
      )
      .all(limit) as SkillRow[];
    return rows.map(rowToSkill);
  },

  /** 按 keyword 推荐 agent：在 project 内匹配 skill_key 包含 keyword 的 agent，按 count 排序 */
  suggestAgents(
    db: Database,
    keyword: string,
    limit = 5,
  ): Array<{ agent_id: string; total_count: number; matched_keys: string[] }> {
    if (!keyword.trim()) return [];
    const rows = db
      .prepare(
        `SELECT agent_id, SUM(touch_count) AS total_count,
                GROUP_CONCAT(skill_key, '|') AS keys
         FROM agent_skills
         WHERE skill_key LIKE ?
         GROUP BY agent_id
         ORDER BY total_count DESC LIMIT ?`,
      )
      .all(`%${keyword.trim()}%`, limit) as Array<{
      agent_id: string;
      total_count: number;
      keys: string;
    }>;
    return rows.map((r) => ({
      agent_id: r.agent_id,
      total_count: r.total_count,
      matched_keys: r.keys.split('|'),
    }));
  },

  /** 增加 agent 在 skill_key 的 touch_count（per-project db 内的 skill 已是 project-scoped）*/
  bumpTouch(db: Database, agentId: string, skillKey: string): void {
    const ts = now();
    db.prepare(
      `INSERT INTO agent_skills (agent_id, skill_key, touch_count, last_touched)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(agent_id, skill_key) DO UPDATE SET
         touch_count = touch_count + 1,
         last_touched = excluded.last_touched`,
    ).run(agentId, skillKey, ts);
  },
};

// =============================================================================
// Workflow Sessions (Sprint 7 / D-15 Facilitator)
// =============================================================================

interface SessionRow {
  id: number;
  goal_input: string;
  draft_yaml: string | null;
  rationale: string | null;
  status: string;
  workflow_id: string | null;
  fallback_reason: string | null;
  started_by: string;
  created_at: number;
  ended_at: number | null;
}

function rowToSession(r: SessionRow): WorkflowSession {
  return {
    id: r.id,
    project_id: '', // D-21：per-project db 内的 session 都属于该 project
    goal_input: r.goal_input,
    draft_yaml: r.draft_yaml,
    rationale: r.rationale,
    status: r.status as WorkflowSessionStatus,
    workflow_id: r.workflow_id,
    fallback_reason: r.fallback_reason,
    started_by: r.started_by,
    created_at: r.created_at,
    ended_at: r.ended_at,
  };
}

export const workflowSessionRepo = {
  list(db: Database, limit = 50): WorkflowSession[] {
    const rows = db
      .prepare(
        `SELECT * FROM workflow_sessions
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(limit) as SessionRow[];
    return rows.map(rowToSession);
  },

  getById(db: Database, id: number): WorkflowSession | null {
    const row = db
      .prepare('SELECT * FROM workflow_sessions WHERE id = ?')
      .get(id) as SessionRow | undefined;
    return row ? rowToSession(row) : null;
  },

  create(
    db: Database,
    input: { goal_input: string; started_by: string },
  ): WorkflowSession {
    const ts = now();
    const result = db
      .prepare(
        `INSERT INTO workflow_sessions
         (goal_input, status, started_by, created_at)
         VALUES (?, 'drafting', ?, ?)`,
      )
      .run(input.goal_input, input.started_by, ts);
    const s = this.getById(db, Number(result.lastInsertRowid));
    if (!s) throw new Error('session insert failed');
    return s;
  },

  update(
    db: Database,
    id: number,
    patch: Partial<{
      status: WorkflowSessionStatus;
      draft_yaml: string | null;
      rationale: string | null;
      workflow_id: string | null;
      fallback_reason: string | null;
      ended: boolean;
    }>,
  ): WorkflowSession | null {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (patch.status !== undefined) {
      fields.push('status = ?');
      values.push(patch.status);
    }
    if (patch.draft_yaml !== undefined) {
      fields.push('draft_yaml = ?');
      values.push(patch.draft_yaml);
    }
    if (patch.rationale !== undefined) {
      fields.push('rationale = ?');
      values.push(patch.rationale);
    }
    if (patch.workflow_id !== undefined) {
      fields.push('workflow_id = ?');
      values.push(patch.workflow_id);
    }
    if (patch.fallback_reason !== undefined) {
      fields.push('fallback_reason = ?');
      values.push(patch.fallback_reason);
    }
    if (patch.ended) {
      fields.push('ended_at = ?');
      values.push(now());
    }
    if (!fields.length) return this.getById(db, id);
    values.push(id);
    db.prepare(`UPDATE workflow_sessions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.getById(db, id);
  },
};
