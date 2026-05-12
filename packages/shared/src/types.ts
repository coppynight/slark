/**
 * 前后端共享的实体类型。数据库行按 `packages/server/src/db/schema.sql`，这里是 TypeScript 镜像。
 *
 * 约定：
 *   - id 字段用 string（UUID / slug / nanoid）或 number（tasks / activity / agent_runs 自增）
 *   - 时间戳统一 number（unix ms）
 *   - JSON 字段在 DB 层是 TEXT，在这里反序列化为对应类型
 */

import type {
  ContextSize,
  ReasoningEffort,
  Runtime,
  SenderType,
  TaskStatus,
} from './constants.js';

// =============================================================================
// Project (v1.0 新增，对齐 docs/product-brief.md §D-2 / technical-decisions D-13)
// =============================================================================
export interface Project {
  id: string;
  /** URL slug, 小写 / 数字 / - _，唯一 */
  name: string;
  display_name: string | null;
  /** 代码仓库绝对路径，必填（D-8 废除沙盒后无兜底） */
  workspace_path: string;
  /**
   * 项目目标，最长 GOAL_MAX_LENGTH 字符（D-14）。
   *
   * 空字符串表示"未设置"（OpenProjectDialog 创建空 project 时的状态）；
   * 真正需要"已填写"约束的地方（Team Architect / Build Team）应当显式校验
   * `goal.trim().length > 0`，不能依赖类型层防御。
   * Sprint 8 / Lo-13: 不再写 `(Goal not set yet — ...)` 这种占位文本到存储层，
   * 避免污染 Team Architect 推荐输入。
   */
  goal: string;
  /** 可选团队协作规则，ContextBuilder 将注入到 prompt 顶部 */
  team_rules: string | null;
  color: string | null;
  created_at: number;
}

// =============================================================================
// Channel
// =============================================================================
export interface Channel {
  id: string;
  name: string;
  description: string | null;
  type: 'channel' | 'dm';
  /**
   * v1.0 新增：归属 Project（D-2）。
   * v1.0.1 过渡期：旧 db 行可能为 null，Sprint 1 Checkpoint 2 将强制 NOT NULL。
   */
  project_id?: string | null;
  created_at: number;
}

// =============================================================================
// Agent
// =============================================================================
export interface Agent {
  id: string;
  name: string;
  /**
   * Sprint 8 / Lo-26 修复：团队角色标签（implementer / reviewer / qa / architect / scribe / ...）。
   * Workflow YAML 占位符（@implementer 等）按 role 解析到具体 agent，避免 builtin template 硬编码 name 跟 Team Architect 自由命名错位。
   * `null` = legacy agent / 用户手建未指定；Runner 回退到 byName 匹配。
   */
  role: string | null;
  avatar: string | null;
  description: string | null;
  runtime: Runtime;
  model: string | null;
  reasoning: ReasoningEffort | null;
  /**
   * Sprint 4-ext / Phase A：Cursor SDK ModelSelection.params{id:"thinking"} 开关。
   * `null` = 跟 model 默认；`true/false` 显式覆盖。CLI 模式忽略 + 运行期 warn。
   */
  thinking: boolean | null;
  /**
   * Sprint 4-ext / Phase A：Cursor SDK ModelSelection.params{id:"context"} —— '300k' / '1m'。
   * `null` = 跟 model 默认。Cursor IDE Options 面板对齐项。
   */
  context: ContextSize | null;
  env_vars: Record<string, string>;
  /**
   * v1.0 新增：归属 Project（D-13）。
   * 注：CP8.3 起 `agents.status` 字段已从 schema 移除；状态从 agent_runs 表派生。
   * 前端通过 GET /api/agents/:id/status 或 WS agent_status 事件获取实时状态。
   */
  project_id?: string | null;
  created_at: number;
}

// =============================================================================
// Agent Run (v1.0 新增，对齐 D-1 / D-18)
// =============================================================================
export type AgentRunStatus = 'thinking' | 'working' | 'error' | 'stopped';

export interface AgentRun {
  id: number;
  agent_id: string;
  channel_id: string;
  status: AgentRunStatus;
  started_at: number;
  ended_at: number | null;
  error_msg: string | null;
}

// =============================================================================
// Message
// =============================================================================
export interface ChatMessage {
  id: string;
  channel_id: string;
  sender_type: SenderType;
  /** user: 'local-user' | agent: agent_id | system: null */
  sender_id: string | null;
  content: string;
  metadata: MessageMetadata | null;
  /** Thread 根消息 ID，NULL = 顶层消息 */
  parent_id: string | null;
  /** 仅根消息维护 */
  reply_count: number;
  created_at: number;
}

/**
 * 消息附加元数据（D-7 契约）
 */
export interface MessageMetadata {
  /** 解析自 content 的 @mention 列表 */
  mentions?: Array<{ name: string; agent_id: string | null }>;

  /** 关联的 task（当 Task 状态变更产生系统消息时） */
  task_ref?: {
    id: number;
    title: string;
    status: TaskStatus;
    assignee_agent_id: string | null;
  };

  /** 链式触发深度（0 = 用户首次发起） */
  chain_depth?: number;
  /** 链式触发的"上游"消息 id */
  triggered_by_message_id?: string;

  /** CLI 工具调用记录 */
  tool_calls?: Array<{
    tool: string;
    args: Record<string, unknown>;
    result?: string;
    success?: boolean;
    duration_ms?: number;
  }>;

  /** 消息是否正在流式输出 */
  streaming?: boolean;

  /** Agent 响应的元信息（sender_type=agent） */
  agent_meta?: {
    runtime: Runtime;
    model: string;
    total_duration_ms: number;
    input_tokens_estimate?: number;
    output_tokens_estimate?: number;
  };

  /** Sprint 2 CP3：标记此 system / agent 消息属于哪个 workflow run / step */
  workflow_ref?: {
    run_id: number;
    workflow_id: string;
    step_id: string;
    /** 'header' = 步骤起始 system 消息 / 'output' = agent 完成此 step 的回复 */
    kind?: 'header' | 'output' | 'await_approval' | 'finished';
  };

  /** System 消息事件类型（sender_type=system） */
  system_event?:
    | { type: 'task_created'; task_id: number; title: string }
    | { type: 'task_claimed'; task_id: number; agent: string }
    | {
        type: 'task_moved';
        task_id: number;
        from: TaskStatus;
        to: TaskStatus;
        by: string;
      }
    | { type: 'agent_error'; agent: string; message: string }
    | { type: 'chain_limit_reached'; detail: string }
    | { type: 'workflow_started'; run_id: number; workflow_name: string }
    | { type: 'workflow_step'; run_id: number; step_id: string; owner: string }
    | { type: 'workflow_awaiting_approval'; run_id: number; step_id: string }
    | {
        type: 'workflow_finished';
        run_id: number;
        status: 'completed' | 'aborted' | 'failed';
      };
}

// =============================================================================
// Task
// =============================================================================
export interface Task {
  id: number;
  channel_id: string;
  title: string;
  status: TaskStatus;
  assignee_agent_id: string | null;
  created_by: string;
  source_message_id: string | null;
  created_at: number;
  updated_at: number;
}

// =============================================================================
// Agent Activity
// =============================================================================
export type ActivityType = 'thinking' | 'working' | 'output' | 'error' | 'idle';

export interface AgentActivity {
  id: number;
  agent_id: string;
  /**
   * v1.0 新增：活动发生在哪个 channel（K-3 修正）。
   * v0 遗留 activity 行为 null。
   */
  channel_id: string | null;
  type: ActivityType;
  detail: string | null;
  created_at: number;
}

// =============================================================================
// Runtime Detection
// =============================================================================
export interface RuntimeDetection {
  id: Runtime;
  label: string;
  installed: boolean;
  version?: string;
  path?: string;
  note?: string;
  /** MVP 当前 Slark 端是否已实装该 runtime（未实装会 disable） */
  enabled_in_slark: boolean;
}

// =============================================================================
// Workflow（Sprint 2 / D-16 — 声明式 YAML 甬道）
// =============================================================================

export type WorkflowSource = 'builtin' | 'user';

/** 数据库行（不含 parsed YAML） */
export interface Workflow {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  /** 触发命令，如 "/new-feature"；同 project 内唯一 */
  trigger_command: string;
  /** 原始 YAML 文本 */
  definition_yaml: string;
  /** 'builtin'（随 Slark 发行）或 'user'（用户自建 / Facilitator 产出） */
  source: WorkflowSource;
  created_at: number;
  updated_at: number;
}

/** YAML 解析后的 step（供 Runner 消费） */
export interface WorkflowStep {
  id: string;
  /** "@AgentName" 或 "local-user" */
  owner: string;
  /** 'approve_or_reject' = 等用户批准；'close_thread' = 终止；undefined = 普通执行 */
  action?: 'approve_or_reject' | 'close_thread';
  /** 完成后跳转 step id */
  on_complete?: string;
  /** approve_or_reject 时：用户批准 → 跳转 step id */
  on_approve?: string;
  /** approve_or_reject 时：用户拒绝 → 跳转 step id */
  on_reject?: string;
  /** 引用前一 step 的输出作为输入（仅 documentational，runner 用 state_json 路由）*/
  input?: string;
  /** 输出标签，便于其他 step 引用 */
  output?: string;
  /** Optional 描述，便于 UI 展示 */
  description?: string;
}

/** YAML 解析后的完整定义 */
export interface WorkflowDefinition {
  /** 软声明，YAML 顶层 `version: "1"`；Runner 用于将来兼容 */
  version: string;
  name: string;
  description?: string;
  trigger: { command: string };
  steps: WorkflowStep[];
}

export type WorkflowRunStatus =
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'aborted'
  | 'failed';

export interface WorkflowRun {
  id: number;
  workflow_id: string;
  channel_id: string;
  /** Thread 根消息 ID（绑定到一条主线消息生成的 thread）*/
  thread_id: string | null;
  status: WorkflowRunStatus;
  /** 当前执行 step id（completed/aborted/failed 时为最后一步）*/
  current_step: string | null;
  /** 'local-user' 或 agent_id */
  started_by: string;
  started_at: number;
  ended_at: number | null;
  /** 各 step 的产出 / 用户输入快照（JSON） */
  state_json: string;
}

/** state_json 解构后（Runner 内部用） */
export interface WorkflowRunState {
  /** 触发时用户输入的指令尾巴（如 `/new-feature add OAuth` 后面的 'add OAuth'）*/
  initial_input?: string;
  /** 每一步的最终消息 id + 摘要（用于上下文链路）*/
  step_outputs: Record<
    string,
    {
      message_id: string;
      summary?: string;
      ended_at: number;
      status: 'completed' | 'approved' | 'rejected' | 'failed';
    }
  >;
  /** Reject 时的反馈，注入下一轮 spawn 的 prompt 上下文 */
  last_rejection_reason?: string;
  /** Abort 原因 */
  abort_reason?: string;
}

// =============================================================================
// Workflow Design Session (Sprint 7 / D-15 Facilitator)
// =============================================================================

export type WorkflowSessionStatus =
  | 'drafting'
  | 'awaiting_approval'
  | 'approved'
  | 'rejected'
  | 'failed'
  | 'archived';

export interface WorkflowSession {
  id: number;
  project_id: string;
  goal_input: string;
  draft_yaml: string | null;
  rationale: string | null;
  status: WorkflowSessionStatus;
  workflow_id: string | null;
  fallback_reason: string | null;
  started_by: string;
  created_at: number;
  ended_at: number | null;
}

// =============================================================================
// Onboarding Loop — project_onboarding + agent_skills (Sprint 6 / D-20)
// =============================================================================

export interface ProjectOnboarding {
  project_id: string;
  overview: string;
  tech_stack: string[];
  conventions: string | null;
  ready: boolean;
  generated_at: number;
}

export interface AgentSkill {
  id: number;
  agent_id: string;
  project_id: string;
  skill_key: string;
  touch_count: number;
  last_touched: number;
}

// =============================================================================
// Evolution Loop — observations + feedback (Sprint 5 / D-20)
// =============================================================================

export type ObservationPolarity = 'positive' | 'negative' | 'neutral';

export interface AgentObservation {
  id: number;
  agent_id: string;
  polarity: ObservationPolarity;
  /** 短标签，Coach 用于聚合 */
  tag: string;
  body: string;
  source_message_id: string | null;
  source_run_id: number | null;
  created_at: number;
}

export type AgentFeedbackStatus = 'pending' | 'applied' | 'rejected' | 'rolled_back';

export interface AgentFeedback {
  id: number;
  agent_id: string;
  period_start: number;
  period_end: number;
  summary: string;
  rationale: string;
  description_before: string;
  description_after: string;
  status: AgentFeedbackStatus;
  confidence: number | null;
  reviewed_by: string | null;
  applied_at: number | null;
  rejected_at: number | null;
  rolled_back_at: number | null;
  created_at: number;
}

// =============================================================================
// Knowledge — Decisions / Lessons (Sprint 4 / D-20 Delivery Loop)
// =============================================================================

export type ReviewStatus = 'pending' | 'approved' | 'rejected';
export type LessonKind = 'do' | 'dont' | 'pattern' | 'pitfall';

/** 项目级决策记录 */
export interface Decision {
  id: number;
  project_id: string;
  title: string;
  body: string;
  /** 'all' / 'team' / agent.id / agent.name */
  audience: string;
  source_run_id: number | null;
  source_message_id: string | null;
  confidence: number | null;
  review_status: ReviewStatus;
  /** 'scribe' / agent.id / 'local-user' */
  recorded_by: string;
  created_at: number;
  reviewed_at: number | null;
}

/** 项目级经验条目 */
export interface Lesson {
  id: number;
  project_id: string;
  kind: LessonKind;
  title: string;
  body: string;
  audience: string;
  tags: string[];
  source_run_id: number | null;
  source_message_id: string | null;
  confidence: number | null;
  review_status: ReviewStatus;
  recorded_by: string;
  use_count: number;
  created_at: number;
  reviewed_at: number | null;
}

// =============================================================================
// Responsibility (Sprint 3 / D-17)
// =============================================================================

export type ResponsibilityRole = 'executor' | 'approver' | 'reviewer' | 'informed';
export type ResponsibilityAuthority =
  | 'must_approve'
  | 'optional_approve'
  | 'no_authority';

/**
 * Workflow × Step × Agent 的责任连接（简化 RACI）。
 *
 * `agent_id` 字段语义：
 *   - 普通 agent：agents.id 字符串
 *   - 系统一等用户：固定字符串 `'local-user'`
 *   - YAML 引用了项目内不存在的 agent name：`'unresolved:<mention>'`
 */
export interface Responsibility {
  id: number;
  workflow_id: string;
  step_id: string;
  agent_id: string;
  role: ResponsibilityRole;
  authority: ResponsibilityAuthority | null;
  created_at: number;
}

// =============================================================================
// Team Architect System Agent（v1.0 / D-15 / D-19）
// =============================================================================

/**
 * 一个 Team Architect 推荐的 Agent 候选项。
 *
 * runtime 允许空串 '' 表示兜底场景（Q-2 决议，未装 cursor-agent 时）；
 * 此时用户必须在 Approve 后手动配置 runtime/model 才能 spawn。
 */
export interface TeamSuggestionAgent {
  name: string;
  role: string;
  description: string;
  runtime: Runtime | '';
  model: string;
  reasoning: ReasoningEffort;
  /**
   * Sprint 4-ext / Phase A：是否启用 Thinking 模式。`null` = 跟 model 默认。
   * Team Architect 通常给 Architect / Reviewer 推 true，Dev 推 false。
   */
  thinking?: boolean | null;
  /**
   * Sprint 4-ext / Phase A：Context window size。`null` = 跟 model 默认。
   * Team Architect 通常给读大量代码的角色（Architect / Reviewer）推 '1m'。
   */
  context?: ContextSize | null;
}

export interface TeamSuggestion {
  agents: TeamSuggestionAgent[];
  rationale: string;
  /** true = 走了固定三件套兜底（Review 5） */
  is_fallback: boolean;
  /** 兜底触发的具体原因（仅 is_fallback = true 时存在） */
  fallback_reason?: string;
}

// =============================================================================
// Cursor Backend Settings (Sprint 4-ext / S-1 收尾)
//
// 用户在 UI Settings 页配置的 Cursor backend 选项，持久化到 ~/.slark/settings.json。
// 与 .env / shell env 的合并优先级见 packages/server/src/config/cursor-settings.ts 顶注。
// =============================================================================
export type CursorBackend = 'cli' | 'sdk';

export interface CursorBackendStatus {
  /** 当前生效的 backend（按优先级合并后） */
  backend: CursorBackend;
  /** 是否已配置 API key（来自 env / .env / settings.json 任一源） */
  hasApiKey: boolean;
  /** API key 来源（仅展示，不回传具体值） */
  apiKeySource: 'env' | 'settings' | null;
  /** Cursor.me() 验证通过返回的用户身份；validate=false 时不携带 */
  identity?: {
    apiKeyName: string;
    userEmail?: string;
  };
  /** validate 时遇到的错误（如 401） */
  identityError?: string;
  /** SDK 模式额外检查 */
  ripgrep?: {
    configured: boolean;
    path?: string;
  };
}

export interface CursorBackendUpdateInput {
  backend?: CursorBackend;
  /** 留空 = 不改；显式空字符串 = 清除已保存的 key */
  apiKey?: string | null;
}
