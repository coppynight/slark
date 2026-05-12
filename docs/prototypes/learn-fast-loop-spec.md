# Learn-Fast Loop · 实施规范

> **配套原型**：[`learn-fast-loop.html`](./learn-fast-loop.html)
>
> **目的**：把原型每一个 UI 元素 / 交互**钉死**到既有/新增的 schema、API、WS event、代码文件，避免实现阶段漂移。
>
> **作用域**：Sprint 8 — Learn-Fast Loop（**Time-to-First-Run** + **Inline Feedback**）。
>
> **状态**：v0.1 草案 · 待 Sprint 8 启动前 review。

---

## 0. 与现有 slark 实现的差异速览

| 主题 | 当前实现 | Sprint 8 改动 |
|---|---|---|
| Create Project 字段 | `name(slug) / display_name / workspace_path / goal / team_rules` 5 字段 + 3 步向导 | **保留全部 5 字段**，但默认折叠 `name(slug)` 与 `team_rules` 到 "Advanced"；走 1 屏 + 1 屏（共 2 步） |
| 默认 channels | 仅 `#general`（CreateProjectDialog `goStep3` 创建一个） | **不变** |
| 首次进入 channel | 用户必须主动 `@Architect` 或 `/new-feature` 触发 | **新增 auto-queue first run**：从 Goal 推断一个 builtin workflow + initial input → 用户在 channel 看到的第一条就是 workflow run 已经开跑 |
| Agent 状态 | 5 个：`idle / thinking / working / error / stopped` | **不变**，但原型必须展示 5 个 |
| Inline Feedback | ❌ 不存在；Message 组件只有 Save 按钮 | **新增 `agent_reactions` 表 + react bar UI + WS event** |
| Coach 触发 | 24h cron + 阈值 `COACH_NEGATIVE_THRESHOLD = 3` 同 tag negative | **新增 inline 触发**：reaction 命中"高信号 tag" 立即触发 Coach（仍只 propose，需用户 Apply） |
| Coach 提案 surface | 仅 Agent Profile FEEDBACK Tab | **新增 inline coach card**（thread 内 hint chip + 右栏 panel），不替代 FEEDBACK Tab |
| 反馈累积可见 | Agent Profile FEEDBACK Tab 列出历次 | **新增 Evolution Journal 时间线**（合入 Profile，不新建页面） |

**核心约束**：
- ⛔ 不动现有 schema 的列 / 不删表
- ✅ 仅 ADD：新表 `agent_reactions`、新 WS events、新 API endpoints
- ✅ 现有 9 张表（含 `agent_observations` / `agent_feedback`）保持兼容

---

## 1. 元素 → 数据来源对照表

按原型从上到下、从左到右枚举。

### 1.1 Sidebar 顶部

| UI 元素 | 数据/行为 | 现有/新增 |
|---|---|---|
| `slark.` brand mark | 静态 | — |
| `v0.7` tag | `package.json` `version` | 现有 |
| Project switcher（按钮） | `GET /api/projects` 返回 `Project[]` 取 `current` | 现有 (`useProjectsStore`) |
| Switcher 点击 → 弹下拉 | `~/.slark/projects.json` recent + Open Project + Settings | 现有 (`Sidebar.tsx`) |
| Empty state（无 project） | 默认显示，CTA `+ New project` 跳向 CreateProjectDialog | 现有 (`WelcomePage.tsx`) |

> **原型修正**：empty state 文案应与 `WelcomePage.tsx` 一致。

### 1.2 Sidebar 主体（项目已创建后）

| 区域 | 数据来源 | 备注 |
|---|---|---|
| **Channels** | `GET /api/channels`（per-project db），仅显示 `type='channel'` | **默认只有 `#general`**。`#design` / `#review` 是用户手动创建的。原型当前画了 3 个 → **修正只画 1 个** |
| **Direct → Threads** | `GET /api/threads` 跨 project 聚合 | 现有 |
| **Direct → Inbox** | `GET /api/workflow-runs?status=awaiting_approval` 跨 project | 现有 (`InboxPage.tsx`)；**badge = 跨 project pending 总数** |
| **Direct → Tasks** | `GET /api/tasks` 跨 project | 现有 (`GlobalTasksPage.tsx`) |
| **Agents** 列表 | `GET /api/agents`（per-project），加上每个 agent 的 status dot | 现有 |
| Agent status dot 颜色 | 派生自 `agent_runs` per-channel WS event `agent_status` | 见 §2.1 |
| Agent name + status text | `agent.name` + `mapStatus(currentStatus)` | 现有 (`StatusDot.tsx`) |

**Agent 状态 5 值的视觉规范**（对应 `AGENT_STATES` from `constants.ts`）：

| 状态 | 颜色 | 是否 pulse | 文字（小写 mono） |
|---|---|---|---|
| `idle` | `--success` 橄榄绿 | ❌ | `idle` |
| `thinking` | `--thinking` 沙金 | ✅ | `thinking…` |
| `working` | `--accent` 锈红 | ✅ | `working…` |
| `error` | `--accent` + `border-2` 黑边 | ❌ | `error` |
| `stopped` | `--ink-faded` 灰 | ❌ | `stopped` |

**原型修正**：当前只演示了 `idle / thinking / working`，缺 `error` / `stopped` 视觉示例。

### 1.3 Channel Header

| UI 元素 | 数据 | 备注 |
|---|---|---|
| `# general` | `channels.name` | 现有 (`ChannelHeader.tsx`) |
| `3 agents · 1 active run` | `channel_agents` count + `workflow_runs WHERE status IN ('running','awaiting_approval')` | 计数：现有；active run 数：**新增 query** |
| Presence 头像堆叠 | `channel_agents` 按 join_order | 现有 |
| 搜索按钮 | 打开 `SearchDialog` | 现有 |
| 设置按钮 | 打开 `ChannelSettingsDialog` | 现有 |

### 1.4 Workflow Run Bar（顶部进度条）

**渲染条件**：当前 channel 内**任一**`workflow_run.status IN ('running','awaiting_approval')`。

| UI 元素 | 数据 | WS 事件 |
|---|---|---|
| Workflow 名称 | `workflows.name` via `workflow_runs.workflow_id` | `workflow_run_update` |
| `Run #N` | `workflow_runs.id` | 同上 |
| 触发尾巴 (`add google oauth`) | `workflow_runs.state_json.initial_input` | 同上 |
| Elapsed timer | `Date.now() - workflow_runs.started_at` | 客户端定时器，不依赖 WS |
| 进度条 5 段 | 解析 `definition_yaml.steps[]` + `current_step` | `workflow_run_update` 推 |
| 段状态：done/active/pending | step.id 与 `current_step` 对比 + `state_json.step_outputs` | 现有 (`WorkflowProgress.tsx`) |
| `pause` / `abort` 按钮 | `POST /api/workflow_runs/:id/abort`；pause 当前**未实现** | abort 现有；**pause 新增（Sprint 8 P3 可选）** |

> **原型修正**：原型有 `pause` 按钮，但当前 backend 不支持。
> - 选项 A：去掉 pause（保持与现有一致）
> - 选项 B：保留并标 "coming soon"（推荐，体现 product roadmap）

### 1.5 Thread / Message 渲染

#### 1.5.1 消息共通字段

每条 `<article class="msg">` 对应一行 `messages` 表，按 `sender_type` 分支：

| sender_type | 渲染 | 文件 |
|---|---|---|
| `agent` | 头像 + 名 + 时间 + step 标签 + body + tool calls + react bar | `Message.tsx` |
| `user` | 头像（YOU）+ "You" + 时间 + body | `Message.tsx` |
| `system` | 行内灰色 mono 一句话 | `SystemMessage` 内嵌 |

#### 1.5.2 Step 标签 `step iv. review`

数据来源：`messages.metadata_json.workflow_ref.{ run_id, step_id, kind }`。

| `kind` | 标签文案 | 颜色 |
|---|---|---|
| `header` | `step iv. review · started` | dim |
| `output` | `step iv. review` | accent |
| `await_approval` | `step iv. review · awaiting approval` | accent + bold |
| `finished` | `step iv. review · done` | success |

**原型修正**：所有消息都标了 `step iv.`，应该按 `workflow_ref.step_id` 派生。

#### 1.5.3 Tool calls 区块

数据来源：`messages.metadata_json.tool_calls[]` —— 由 Sprint 4-ext 的 `summarizeToolArgs` 已经提供 `{ name, args, result, status, truncated }`。

| 显示规则 | 来源 |
|---|---|
| `Read` / `Edit` / `Bash` 这一列叫 verb | `tool_calls[i].tool` mapped via `summarizeToolArgs.ts` |
| 摘要文字（`packages/server/src/auth/oauth.ts · +112 −3`）| `summarizeToolArgs(name, args, result)` 返回的 string | 

> 原型当前的三行（`Read 248 lines / Edit +112 −3 / Bash ✓ 8 passed`）是手写示例，应当作"视觉契约"，实际由 `summarizeToolArgs` 输出。

#### 1.5.4 Inline React Bar（**新增**）

| UI | 行为 | 数据 |
|---|---|---|
| Hover 消息 → bar 浮出 | CSS only | — |
| 👍 Helpful | 写一行 `agent_reactions(message_id, polarity='positive', tag='helpful')` | 新表，见 §3.1 |
| 👎 Off | 弹出 reason popover（见 §1.5.5）；reason 选完后写 `agent_reactions` | 新表 |
| Coach（小字 CTA） | 打开右栏 Coach 面板 + manual `POST /api/agents/:id/coach/run` | 复用现有 `runCoachForAgent` |

**原型修正**：当前原型对所有 agent 消息都显示 react bar。**Sprint 8 仅对 `sender_type='agent'` 显示**，user / system 消息不显示。

#### 1.5.5 Reason Popover（**新增**）

锚定在被 down-vote 的消息右上角。

| 选项（reason tag） | 写入 `agent_reactions.tag` | Coach 触发权重 |
|---|---|---|
| Too vague | `vague` | high |
| Missed the risk | `missed-risk` | high |
| Wrong tone | `wrong-tone` | low |
| Should be more specific | `not-specific` | high |
| Wrong scope | `wrong-scope` | medium |
| Other… | `other` | none |

**触发权重**用于决定是否**inline 立即触发 Coach**。详见 §3.3。

> 原型修正：popover 关闭时 `Esc` 已绑定，但要确认 backdrop click 不会误关 message hover state。

### 1.6 Composer

| UI 元素 | 数据/行为 | 备注 |
|---|---|---|
| 输入框 | `<textarea>` + `MessageInput.tsx` | 现有 |
| `@` 按钮 | 提示输入 @mention | 现有（命令模式 placeholder） |
| `/` 按钮 | 弹 commands 提示下拉（`workflows[].trigger_command`）| 现有 (`MessageInput.tsx` `commands`) |
| `⊕ attach` | "coming soon" disabled | 现有 |
| `Send` | `wsClient.send({ type: 'send_message' })` | 现有 |
| `As Task` checkbox（原型未画） | 现有 | **原型应补：Composer 底部增 As Task** |

**原型修正**：当前 composer 缺 `As Task` checkbox（slark 现有的功能）。建议加上。

### 1.7 Right Rail · Coach 面板

| UI 元素 | 数据 | 备注 |
|---|---|---|
| Eyebrow `Coach · suggested edit` | 静态 | — |
| 标题 `Reviewer` | `agent_feedback.agent_id` → `agents.name` | — |
| `Drafted in 5s from your last reaction` | `Date.now() - agent_feedback.created_at` | 计算 |
| Body 段（why） | `agent_feedback.rationale` | 现有 |
| Diff before/after | `agent_feedback.{ description_before, description_after }` | 现有 |
| Trigger 行（`4× "should be more specific" in 6h`） | 来自 Coach prompt 的 reason 描述（**新增字段** `agent_feedback.trigger_summary` 或写在 `rationale` 里） | **新增可选字段** |
| Reversible 24h | 静态文案 + `agent_feedback.applied_at` 时间窗 | — |
| Dismiss 按钮 | `POST /api/agent-feedback/:id/reject` | 现有 (`rejectAgentFeedback`) |
| Edit first 按钮 | 打开内联编辑器，edit `description_after` | **新增**（Sprint 8 P2，可后置） |
| Apply 按钮 | `POST /api/agent-feedback/:id/apply` | 现有 (`applyAgentFeedback`) |

### 1.8 Right Rail · Agent Profile 面板

| UI 元素 | 数据 | 备注 |
|---|---|---|
| 头像 + 名 | `agents.{name, avatar}` | 现有 |
| Role / age | description 第一句 + `Date.now() - agents.created_at` | 现有 |
| Description (live) | `agents.description` | 现有；最新 Coach edit 用绿色高亮（**新增 visual diff renderer**） |
| 4 个 stat 数字 | 见 §3.4 stat schema | **新增 query** |
| **Evolution Journal 时间线** | `agent_feedback` + `agent_reactions` 按 created_at desc | **新增视图**（合并两表） |
| Just-now 脉冲圆点 | 最近 60s 内的事件 | CSS only |

**Sprint 8 决定**：原型这部分即新设计，对应实现是 `AgentProfilePanel.tsx` 的 FEEDBACK Tab 升级 + 新增 Journal Tab，**不替换现有 PROFILE / ACTIVITY / FEEDBACK 三 Tab**。

### 1.9 Create Project Modal

**与现有 `CreateProjectDialog.tsx` 的对应关系**：

| 现有字段 | 原型 Stage 1 是否显示 | 落地位置 |
|---|---|---|
| `name` (slug, required) | **默认隐藏 → "Advanced" 折叠**（auto-derive from goal first 3 words）| **新增 auto-derive 逻辑** |
| `display_name` (optional) | 默认隐藏 | 折叠到 Advanced |
| `workspace_path` (required) | ✅ ws-row | 现有 |
| `goal` (required, ≤ 500) | ✅ goal-input | 现有 |
| `team_rules` (optional) | 默认隐藏 | 折叠到 Advanced |

**Stage 2** = 现有 `Step2`（Team Suggestion + Approve）。

**原型修正**：当前原型的 Stage 1 只有 Goal + Workspace。**正确做法**：
1. Goal + Workspace 是 P0 必填字段（保持原型现有 UI）
2. 加一个 `▾ Advanced` 折叠区，里面有 `name (slug)` + `display_name` + `team_rules`
3. 默认折叠；若用户不展开，`name` 自动从 goal 派生（如 `oauth-sso-service`）

```javascript
// 默认 slug 派生
function deriveSlug(goal) {
  return goal.toLowerCase()
    .split(/\s+/)
    .slice(0, 3)
    .join('-')
    .replace(/[^a-z0-9_-]/g, '');
}
```

### 1.10 Cursor Backend Setup（**原型缺失，需补**）

当前用户跑 `pnpm dev` 时，若没有 `CURSOR_API_KEY` 也能用 `cli` 模式（spawn cursor-agent）。但 Welcome 页应该提示。

**新增**：Welcome 页底部增加一个状态条：

| 状态 | 文案 | CTA |
|---|---|---|
| `cursor-agent` 已检测 + cli mode | `✓ Cursor CLI detected (cli mode)` | `Switch to SDK?` → settings |
| `cursor-agent` 未检测 | `⚠ cursor-agent not in PATH. Install →` | 文档链接 |
| sdk mode 已配置 | `✓ Cursor SDK ready (sdk mode)` | `Switch to CLI?` → settings |
| sdk mode 配错 | `⚠ Cursor SDK API key invalid` | `Open Settings` |

数据来源：`GET /api/settings/cursor-backend/status` → `CursorBackendStatus` 现有接口。

---

## 2. WebSocket 事件流程（顺序图）

### 2.1 用户创建 project + 进入 channel

```
User                  Web                       Server                 DB
 │  click "Assemble"  │                          │                      │
 │  ───────────────►  │                          │                      │
 │                    │  POST /api/projects/open │                      │
 │                    │  ───────────────────────►│                      │
 │                    │                          │  mkdir .slark/       │
 │                    │                          │  init slark.db       │
 │                    │                          │  write project.json  │
 │                    │  ◄─────────── 200 Project│                      │
 │                    │                          │                      │
 │                    │  POST /api/projects/suggest-team                 │
 │                    │  ───────────────────────►│                      │
 │                    │                          │  spawn TeamArchitect │
 │                    │                          │  (30s timeout)       │
 │                    │  ◄─────── TeamSuggestion │                      │
 │  click "Approve"   │                          │                      │
 │  ───────────────►  │                          │                      │
 │                    │  POST /api/channels (#general)                   │
 │                    │  POST /api/agents × 3                            │
 │                    │  POST /api/channels/:id/agents × 3 (join)        │
 │                    │                          │                      │
 │                    │  ┌──── NEW (Sprint 8) ────┐                     │
 │                    │  │ POST /api/workflow_runs/auto-queue           │
 │                    │  │   { channel_id, goal_input }                 │
 │                    │  │ ──────────────────────►│                     │
 │                    │  │                        │ pick best builtin   │
 │                    │  │                        │ workflow → start run│
 │                    │  └────────────────────────┘                     │
 │                    │                          │                      │
 │  navigate → channel page                       │                      │
 │  ◄─────────────────┤                          │                      │
 │                    │  WS subscribe_channel    │                      │
 │                    │  ───────────────────────►│                      │
 │                    │  ◄────── system_event { type: 'workflow_started' }
 │                    │  ◄────── workflow_run_update                    │
 │                    │  ◄────── agent_status { Architect, working }    │
 │                    │  ◄────── message_stream (Architect 输出 deltas) │
 │                    │  ◄────── message_done                           │
 │                    │  ◄────── system_event workflow_step (→ implement)
 │                    │  …
```

**关键新增**：Sprint 8 的 `POST /api/workflow_runs/auto-queue` 让 channel 一打开就有内容跑。

### 2.2 用户 down-vote 一条 agent 消息

```
User                  Web                       Server                 DB
 │  hover msg         │                          │                      │
 │  click 👎          │                          │                      │
 │  ───────────────►  │                          │                      │
 │  open reason popover                          │                      │
 │                    │                          │                      │
 │  click tag         │                          │                      │
 │  ───────────────►  │                          │                      │
 │  click "Send & coach"                         │                      │
 │  ───────────────►  │                          │                      │
 │                    │  POST /api/agent-reactions                      │
 │                    │   { message_id, agent_id, polarity:'negative',  │
 │                    │     tag:'not-specific', body? }                 │
 │                    │  ───────────────────────►│                      │
 │                    │                          │  INSERT into         │
 │                    │                          │  agent_reactions     │
 │                    │                          │  (also INSERT into   │
 │                    │                          │   agent_observations)│
 │                    │  ◄────── 201 Reaction    │                      │
 │                    │                          │                      │
 │                    │  ┌── if tag.weight >= high & no recent pending ─┐
 │                    │  │   trigger Coach inline (async)               │
 │                    │  │   spawn coach agent (60s timeout)            │
 │                    │  │   write agent_feedback (status='pending')    │
 │                    │  │   WS broadcast: coach_proposal_ready         │
 │                    │  └────────────────────────────────────────────  ┘
 │                    │  ◄──── coach_proposal_ready { agent_id, feedback_id }
 │                    │                                                 │
 │  show toast "drafting…" → show stream-hint chip → open right rail    │
 │  ◄─────────────────┤                                                 │
 │                    │  GET /api/agent-feedback/:id                    │
 │                    │  ───────────────────────►│                      │
 │                    │  ◄────── AgentFeedback   │                      │
 │  render Coach card with diff                                         │
 │  ◄─────────────────┤                                                 │
```

### 2.3 用户 Apply Coach 提案

```
User                  Web                       Server                 DB
 │  click "Apply"     │                          │                      │
 │  ───────────────►  │                          │                      │
 │                    │  POST /api/agent-feedback/:id/apply             │
 │                    │  ───────────────────────►│                      │
 │                    │                          │  UPDATE agents       │
 │                    │                          │    SET description = │
 │                    │                          │      f.description_after
 │                    │                          │  UPDATE agent_feedback
 │                    │                          │    SET status='applied'
 │                    │  ◄────── 200            │                      │
 │                    │                          │                      │
 │                    │  WS broadcast (existing): agent_updated → upsert
 │                    │  ◄────── agent_updated   │                      │
 │  show toast "Applied · journal updated"                              │
 │  switch right rail to Agent Profile (new state)                      │
 │  ◄─────────────────┤                                                 │
```

---

## 3. 新增数据契约

### 3.1 新表 `agent_reactions`

> 每个 per-project SQLite 内一张表（与 `agent_observations` 并列）。
> Schema version → 11（per-project schema 内部版本）。

```sql
-- =============================================================================
-- 20. agent_reactions （Sprint 8 / Learn-Fast Loop · Inline Feedback）
--
-- 用户对单条 agent 消息的轻量反馈。与 agent_observations 区别：
--   - reactions = 用户主动的、明确的、即时的；polarity / tag 由用户选
--   - observations = Evaluator 等系统组件自动产生的；polarity / tag 由系统判断
--
-- Coach 同时消费两张表：reactions 是高信号（用户主动），observations 是低信号
-- （需要聚合）。Coach prompt 里 reactions 列表前置、observations 列表后置。
-- =============================================================================
CREATE TABLE IF NOT EXISTS agent_reactions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id        TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  message_id      TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  polarity        TEXT NOT NULL CHECK(polarity IN ('positive','negative','neutral')),
  tag             TEXT NOT NULL,        -- 'helpful' / 'vague' / 'missed-risk' / ...
  body            TEXT,                 -- 用户可选的自由文本备注
  /** 'local-user'；为未来多用户预留 */
  reacted_by      TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  UNIQUE(message_id, reacted_by)        -- 同一用户对同一消息只能有一条 reaction
);
CREATE INDEX IF NOT EXISTS idx_reactions_agent
  ON agent_reactions(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reactions_tag
  ON agent_reactions(agent_id, tag, polarity);
```

**TypeScript 镜像**（追加到 `packages/shared/src/types.ts`）：

```typescript
export type ReactionPolarity = 'positive' | 'negative' | 'neutral';

/** 高信号 negative tag — 命中即触发 inline Coach */
export const HIGH_SIGNAL_NEGATIVE_TAGS = [
  'vague',
  'missed-risk',
  'not-specific',
] as const;

export interface AgentReaction {
  id: number;
  agent_id: string;
  message_id: string;
  polarity: ReactionPolarity;
  tag: string;
  body: string | null;
  reacted_by: string;
  created_at: number;
}
```

### 3.2 新增 API endpoints

| 方法 | 路径 | Body | Response | 文件 |
|---|---|---|---|---|
| `POST` | `/api/agent-reactions` | `{ message_id, polarity, tag, body? }` | `AgentReaction` | **新建** `packages/server/src/routes/reactions.ts` |
| `DELETE` | `/api/agent-reactions/:id` | — | 204 | 同上 |
| `GET` | `/api/agent-reactions?agent_id=&since=` | — | `AgentReaction[]` | 同上 |
| `POST` | `/api/workflow_runs/auto-queue` | `{ channel_id, goal_input?, workflow_name? }` | `WorkflowRun` | **新建** route 或加到 `workflows.ts` |

**`auto-queue` 的逻辑**（要点）：
1. 选 workflow：若提供 `workflow_name` 用之，否则按 goal 关键词匹配 builtin（feature-development / bug-fix / research）
2. 启动 run 时把 `goal_input`（或 project goal 第一句）作为 `state_json.initial_input`
3. 不向 channel 发 user message，直接 `POST` workflow run + WS broadcast `workflow_started`

### 3.3 新增 / 修改 Coach 触发

**位置**：`packages/server/src/system-agents/coach.ts`。

**现有触发**：24h cron，扫 `agent_observations` 同 tag negative ≥ `COACH_NEGATIVE_THRESHOLD = 3`。

**新增 inline 触发**：

```typescript
// packages/shared/src/constants.ts （新增）
export const HIGH_SIGNAL_NEGATIVE_TAGS = ['vague', 'missed-risk', 'not-specific'] as const;
export const COACH_INLINE_DEBOUNCE_MS = 60_000;  // 同 agent 60s 内最多触发一次
export const COACH_PENDING_BLOCK = true;          // 已有 pending 则不再触发

// packages/server/src/system-agents/coach.ts （新增 hook）
export async function onReactionRecorded(reaction: AgentReaction) {
  if (reaction.polarity !== 'negative') return;
  if (!HIGH_SIGNAL_NEGATIVE_TAGS.includes(reaction.tag as any)) return;

  // dedupe
  const recent = await coachLastTriggerAt(reaction.agent_id);
  if (Date.now() - recent < COACH_INLINE_DEBOUNCE_MS) return;
  if (await hasPendingFeedback(reaction.agent_id)) return;

  // 异步 spawn coach；不 block reaction 写入
  void runCoachForAgent(reaction.agent_id, { trigger: 'inline-reaction', source_reaction_id: reaction.id });
}
```

**Coach 写入 `agent_feedback` 时**：
- `summary` 例如："Reviewer should name exact assertion when blocking"
- `rationale` 用模板：`You marked Reviewer's last N catches as "<tag>". Pattern is consistent.`
- `description_before` = 当前 `agents.description`
- `description_after` = LLM 产出的 edit
- `confidence` = 0.0 ~ 1.0

### 3.4 Agent Profile stat 字段（已有数据派生，无新表）

| Stat | 来源 query |
|---|---|
| edits applied | `SELECT COUNT(*) FROM agent_feedback WHERE agent_id=? AND status='applied'` |
| rolled back | `SELECT COUNT(*) FROM agent_feedback WHERE agent_id=? AND status='rolled_back'` |
| reviews this week | `SELECT COUNT(*) FROM messages WHERE sender_id=? AND created_at > now-7d` |
| first-pass approve % | 复杂派生，**Sprint 8 P2**（暂可硬编码 demo 数据，加 TODO） |

### 3.5 新增 WS events

追加到 `packages/shared/src/events.ts` 的 `ServerEvent` union：

```typescript
| {
    /** Sprint 8 / Learn-Fast Loop：Coach 因 inline reaction 异步产出新提案 */
    type: 'coach_proposal_ready';
    agent_id: string;
    feedback_id: number;
    /** 触发来源，便于前端在被对应 message 旁标"已生成建议" */
    trigger: 'inline-reaction' | 'cron-aggregate' | 'manual';
    source_reaction_id?: number;
  }
| {
    /** Sprint 8：reaction 写入广播（用于消息下方 chip + journal 实时更新） */
    type: 'agent_reaction_recorded';
    reaction: AgentReaction;
  }
```

---

## 4. 现有代码改动点

按文件列出。每条标注 P0/P1/P2 优先级。

| 文件 | 改动 | 优先级 |
|---|---|---|
| `packages/server/src/db/schema.sql` | 新增 `agent_reactions` 表 + 2 个索引 | **P0** |
| `packages/shared/src/types.ts` | 新增 `AgentReaction` 接口 | **P0** |
| `packages/shared/src/constants.ts` | 新增 `HIGH_SIGNAL_NEGATIVE_TAGS` / `COACH_INLINE_DEBOUNCE_MS` | **P0** |
| `packages/shared/src/events.ts` | `ServerEvent` 加 `coach_proposal_ready` / `agent_reaction_recorded` | **P0** |
| `packages/server/src/db/repos.ts` | 新增 `reactionsRepo` | **P0** |
| `packages/server/src/routes/reactions.ts` | 新文件，3 个 endpoint | **P0** |
| `packages/server/src/routes/workflows.ts` | 新增 `POST /workflow_runs/auto-queue` | **P0** |
| `packages/server/src/system-agents/coach.ts` | 新增 `onReactionRecorded` hook + dedupe 逻辑 | **P0** |
| `packages/server/src/index.ts` (or wherever routes register) | 挂 `reactions` route | **P0** |
| `packages/web/src/components/Message.tsx` | hover 时显示 react bar；只对 `sender_type='agent'` | **P0** |
| `packages/web/src/components/Message.tsx` | reason popover 子组件 | **P0** |
| `packages/web/src/components/CreateProjectDialog.tsx` | Step 1 折叠 advanced 字段 + auto-derive slug | **P1** |
| `packages/web/src/pages/ChannelPage.tsx` | 处理 `coach_proposal_ready` WS → 打开右栏 Coach 面板 | **P0** |
| `packages/web/src/pages/ChannelPage.tsx` | 进 channel 时若无 active run 且首次 → 调 `auto-queue` | **P0** |
| `packages/web/src/components/AgentProfilePanel.tsx` | FEEDBACK Tab 加 trigger meta + reaction journal 入口 | **P1** |
| `packages/web/src/pages/WelcomePage.tsx` | 加 Cursor backend 状态条 | **P2** |
| `packages/web/src/lib/api.ts` | `recordReaction` / `deleteReaction` / `autoQueueWorkflow` | **P0** |
| `packages/web/src/lib/ws-bridge.ts` | 处理新 2 个 event | **P0** |
| `packages/web/src/stores/agents.ts` | 收到 `agent_updated` 后局部更新 description + 高亮 diff（5s）| **P1** |

**预估工时**（按上述 P0 + P1）：1 后端工程师 ~4 天 + 1 前端工程师 ~5 天 = 9 person-days ≈ **2 周 1 sprint**。

---

## 5. CP 拆解（Sprint 8）

| CP | 内容 | 验收 |
|---|---|---|
| **CP1** | Schema + Type + WS event 定义 + 后端 reactions route | `curl POST /api/agent-reactions` 返回 201；DB 出现一行 |
| **CP2** | 前端 Message.tsx 加 react bar + reason popover；调 API；接 ws_event | 浏览器 hover 消息看到 bar；点 👎 选 tag 后 popover 关闭；DB 写入；WS 广播 |
| **CP3** | Coach inline trigger hook（dedupe + pending block） | 5 次 down-vote 同 tag 只触发 1 次 Coach；`agent_feedback` pending 行存在 |
| **CP4** | 前端右栏 Coach 面板从 `coach_proposal_ready` 自动弹出 + Apply 后切到 Agent Profile | 用户 down-vote → 5s 内右栏出 Coach 卡片 → Apply → Profile description 高亮 diff |
| **CP5** | `auto-queue` workflow + Goal → builtin workflow 选择逻辑 + ChannelPage 首次进入触发 | 创建 project → Approve team → 进入 #general → 顶部 workflow bar 自动出现 |
| **CP6** | CreateProjectDialog 简化（Advanced 折叠 + auto-derive slug）+ Welcome 加 Cursor backend status + milestone 文档 | Goal 一句话 + workspace 即可创建；Welcome 显示 backend status |

---

## 6. 与未来 Sprint 的边界

**Sprint 8 范围内**：
- 用户对**已有 agent 消息**的 inline 反馈 → Coach 立即提案 → 用户 Apply
- TTFR：模糊 onboarding（Goal → Team → 自动跑第一个 workflow）

**Sprint 8 之外（不要在这里做）**：
- Workflow YAML hot-edit（属于 Phase 3）
- Autonomy gradient / DRI agent（属于 Phase 4）
- Project World Model / Auto-Trigger 规则（属于 Phase 5+）
- Multi-runtime 自动检测（R-18）

**保留为 Phase 9+ 待评估**：
- Reaction 是否广播到其他 user 端（多人版本才需要）
- Coach edit 的 inline editor（CP4 标 P2，可后置）
- `pause` workflow run

---

## 7. 验收 Demo 路径（Sprint 8 完成时）

走完整 5 分钟：

1. `pnpm dev` → 浏览器打开 → Welcome 显示 Cursor backend status 为绿
2. 点 `+ New project` → 输入 Goal `Build OAuth SSO service` + workspace `~/code/test-sso` → Assemble team
3. Team Architect 实时叙述 → 推荐 3 agents → Approve & start first run
4. 进入 `#general` → 顶部 workflow bar 自动出现 + 进度条开始动 + Architect 流式输出
5. Workflow 推进到 review step → Reviewer 输出
6. **hover Reviewer 消息** → 点 👎 → 选 "Should be more specific" → Send & coach
7. 5 秒内右栏自动滑入 Coach 卡片 + diff
8. 点 **Apply** → toast "Applied · journal updated" → 0.8 秒后右栏切到 Agent Profile → description 顶部绿色高亮新增内容 + Journal 时间线顶部出现 "just now"
9. 关闭右栏 → 回到 #general → 流程结束

**通过条件**：上述每一步无报错，且每个 ✓ 数据点（DB 行 / WS event / API response）都能在 server log 看到。

---

## 8. 版本历史

| 版本 | 日期 | 变更 |
|---|---|---|
| v0.1 | 2026-05-11 | 初稿：原型对照 + agent_reactions schema + Coach inline trigger + WS event + CP 拆解 |
