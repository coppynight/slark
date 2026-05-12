# Slark - Programmable AI Team OS（战术执行计划）

> **战略层**：[`docs/product-brief.md`](docs/product-brief.md) v1.0.1
> **当前聚焦**：[`docs/focus-core-loop.md`](docs/focus-core-loop.md) ← **前期阶段性收敛锚点（2026-05-12 生效）**
> **当前状态**：[`docs/project-status.md`](docs/project-status.md) ← 关心"进展到哪了"看这里
> **本文件**：当前 Sprint + 未来 Sprint 的范围与验收（**不维护"已完成"详细清单**）
>
> 冲突时优先级：`product-brief.md` > `focus-core-loop.md` > `PLAN.md` > 其他

## 文档地图

| 文档 | 层级 | 用途 |
|------|------|------|
| [`docs/project-status.md`](docs/project-status.md) | **状态** | **唯一状态源**：当前 Sprint / 阻塞 / 技术债 / 下一步 |
| [`docs/product-brief.md`](docs/product-brief.md) | 战略 | 产品定位 / 6 层架构 / 关键决策 / 非目标 |
| [`docs/focus-core-loop.md`](docs/focus-core-loop.md) | **聚焦** | **前期阶段性收敛**：核心闭环 7 步 / 现状评估 / Sprint 8+ 重排建议 / 退出条件 |
| `PLAN.md`（本文件） | 战术 | 当前 + 未来 Sprint 的范围与验收 |
| [`docs/sprint1-milestone.md`](docs/sprint1-milestone.md) | 历史 | Sprint 1 交付记录与手动验收 runbook |
| [`docs/technical-decisions.md`](docs/technical-decisions.md) | 实现 | 默认决策（D-N）/ 常量 / 状态机 |
| [`docs/optimization-backlog.md`](docs/optimization-backlog.md) | 队列 | 已决定但未排期的优化（O-N） |
| [`docs/clawteam-comparison.md`](docs/clawteam-comparison.md) | 调研 | ClawTeam 借鉴条目（B-N） |
| [`docs/cli-event-format.md`](docs/cli-event-format.md) | 实现 | Cursor / Codex / Claude 事件格式对照 |
| [`docs/phase0-cli-spike.md`](docs/phase0-cli-spike.md) | 历史 | Phase 0 CLI 验证记录 |
| [`docs/ui-reference/`](docs/ui-reference/README.md) | 视觉 | UI 基准（17 张截图 + 4 份规范） |

---

## 项目总览

### 一句话定位

> **Slark = Programmable AI Team OS** —— 你设定 Goal，AI 自动配备团队，团队自己设计 Workflow，系统持续沉淀经验并让每个 Agent 随项目成长。

### 6 层架构

```
Layer 6:  Capability      能力强化（Evaluator + Coach）
Layer 5:  Knowledge       集体知识（Scribe + decisions/lessons）
Layer 4:  Responsibility  职责框架（RACI 简化：Step × Agent）
Layer 3:  Workflow        工作流"甬道"（声明式 YAML）
Layer 2:  Team            团队成员（Team Architect AI 自动配）
Layer 1:  Goal            项目目标（一等公民，必填）
```

### 三条主流程

```
流程 A：Goal → AI 团队组建（Sprint 1，已完成）
  用户填 Goal + Workspace → Team Architect spawn → 推荐 Team
  → 用户 Approve → 创建 Agents 加入 #general → 用户首次 @ 开始对话

流程 B：Workflow 驱动多 Agent 协作（Sprint 2~3）
  用户 /trigger → Workflow Runner 按 YAML step 路由
  → 每步 spawn 对应 owner Agent → 流式输出 → 完成 → 下一步
  → await_approval step 等用户 /approve → 整条 thread 完结

流程 C：自动沉淀 + 持续进化（Sprint 4~5）
  Workflow Run 结束 → Scribe 回扫 thread 提炼 lessons / decisions
  → 用户在 Intelligence Tab Approve → 进入项目知识池
  → 后续 Agent spawn 时 ContextBuilder 按 audience 注入相关知识
  Coach 周期性扫描 Agent 表现 → 提 description 修改建议
  → 用户 Apply → agents.description 演化
```

### 五个核心模块

- **M1: CLI Bridge** — `child_process.spawn` + NDJSON/JSONL 流式解析（Cursor 适配器）
- **M2: Agent Engine** — Agent CRUD / 状态机 / ContextBuilder / `agent_runs` per-channel 状态
- **M3: Message Bus** — WebSocket / Message Router / @mention 链式触发 / Thread / Workflow Runner
- **M4: Data Layer** — SQLite (projects / channels / agents / messages / tasks / workflows / decisions / lessons / agent_feedback / ...)
- **M5: Frontend UI** — Vite + React + Tailwind，Neo-Brutalism 暖黄风（1:1 对照 slock.ai）

### 技术栈

- **前端**: Vite + React 19 + TypeScript + Tailwind CSS v4 + Radix UI Primitives
- **后端**: Node.js + Fastify + ws + better-sqlite3
- **CLI 桥接**: `child_process.spawn` + NDJSON/JSONL 流式解析
- **包管理**: pnpm workspaces (monorepo)

### 关键决策摘要

详见 [`docs/technical-decisions.md`](docs/technical-decisions.md)：

- **Agent 状态机**：`idle / thinking / working / error / stopped`，per-channel 派生自 `agent_runs`
- **Token 预算**：`MAX_CONTEXT=8000 / DESCRIPTION=2000 / HISTORY=5500 / CURRENT=500`
- **并发控制**：同时最多 3 个 CLI 进程，FIFO 队列上限 20，单次 spawn 5 分钟超时
- **链式触发防护**：`max_chain_depth=10 / max_consecutive_triggers=3 / max_mentions_per_message=5`，per-thread 计数
- **数据目录**：`~/.slark/slark.db`；Agent cwd 取自 `project.workspace_path`，无 Agent 沙盒
- **Seed 数据**：首次启动不预置任何 Project / Channel / Agent，欢迎页引导 Create Project

---

## 实施路线总览

| 阶段 | 战略价值 | 状态 |
|------|---------|------|
| Phase 0 — CLI Bridge 技术验证 | 验证 spawn-per-message 模型 | ✅ 已完成 |
| Phase 0.5 — UI 基准采集 | 17 张截图 + 4 份规范 | ✅ 已完成 |
| v0 MVP — 基础聊天室能力 | M1~M5 骨架 + 链式触发 + Tasks 面板 | ✅ 已交付（Sprint 1 起点）|
| **Sprint 1** — Foundation + Goal → AI Team | Programmable AI Team OS 雏形 | ✅ **已交付**（见 [`docs/sprint1-milestone.md`](docs/sprint1-milestone.md)） |
| **Sprint 2** — Workflow Framework | Workflow YAML + 3 内置模板 + 执行引擎 | ✅ **已交付**（见 [`docs/sprint2-milestone.md`](docs/sprint2-milestone.md)） |
| **Sprint 3** — Responsibility + User Intervention | 批准流 + 用户介入 + Workflow Import/Export | ✅ **已交付**（见 [`docs/sprint3-milestone.md`](docs/sprint3-milestone.md)） |
| **Sprint 4** — Delivery Loop (Scribe) | 沉淀 + Intelligence Tab | ✅ **已交付**（见 [`docs/sprint4-milestone.md`](docs/sprint4-milestone.md)） |
| **Sprint 5** — Evolution Loop | Evaluator + Coach + Description 演化 | ✅ **已交付**（见 [`docs/sprint5-milestone.md`](docs/sprint5-milestone.md)） |
| **Sprint 6** — Onboarding Loop + Skill Matrix | 新 Project 自动分析 + 能力地图 | ✅ **已交付**（见 [`docs/sprint6-milestone.md`](docs/sprint6-milestone.md)） |
| **Sprint 7** — Team-First-Collaborative Workflow Design | Facilitator 主持的 Workflow Design Session | ✅ **已交付**（见 [`docs/sprint7-milestone.md`](docs/sprint7-milestone.md)） |
| Sprint 8+ — 远期路线 | 跨 Project 经验迁移 / 多 runtime / Worktree 隔离 / Marketplace | 远期 |

### Sprint 启动前必做 checklist

每个 Sprint 动工前，负责人必须走一遍：

1. 扫一遍 [`docs/product-brief.md`](docs/product-brief.md) §10 待决议表，把 `Deadline <= 本 Sprint` 的 `Q-N` 全部拍板或显式延期
2. 扫一遍 [`docs/clawteam-comparison.md`](docs/clawteam-comparison.md) §4.5 Sprint 映射汇总，确认本 Sprint 需要兑现的 B-N 借鉴条目
3. 扫一遍 [`docs/research/routa-analysis.md`](docs/research/routa-analysis.md)，检查有无待兑现的 B-N
4. 扫一遍 [`docs/optimization-backlog.md`](docs/optimization-backlog.md)，把 🔴 优先级 `[待排期]` 条目按需纳入当前 Sprint
5. 看 [`docs/project-status.md`](docs/project-status.md) §4 "已知技术债"，把会阻塞本 Sprint 的优先清理

任一条未完成 → Sprint 不动工。

---

## 已完成阶段（摘要）

### Phase 0：CLI Bridge 技术验证 ✅

详见 [`docs/phase0-cli-spike.md`](docs/phase0-cli-spike.md)。三个 CLI 都是 spawn-per-message 模型；统一 `CLIAdapter` 接口已落地（`packages/server/src/agents/types.ts`）；Cursor 首 token 约 4.5s，选定为 MVP runtime。

### Phase 0.5：UI 基准采集 ✅

详见 [`docs/ui-reference/`](docs/ui-reference/README.md)。17 张桌面版截图 + 5 份规范。

### v0 MVP ✅

按原 PLAN（v0.1 ~ v0.3）落地的"AI 编程协作室"基础版本，作为 Sprint 1 起点。能力包括：Monorepo 骨架、SQLite v0 schema、REST + WebSocket、Cursor Adapter、ContextBuilder、Message Router、前端 Shell。详细差距与 Sprint 1 处理见 [`docs/sprint1-milestone.md`](docs/sprint1-milestone.md)。

### Sprint 1：Foundation + Goal → AI Team ✅

**目标已达成**：3 分钟内从 Goal 得到一个可用的 AI Team。

CP1 ~ CP7 全部交付：`projects` / `agent_runs` schema、Projects API、Team Architect 系统 Agent + 兜底三件套、Create Project 三步向导、Sidebar Project 切换器、Agent Profile 简化为 2 Tab、Engine 按 `project.workspace_path` 路由 cwd。

详细交付清单 + 手动验收 runbook → [`docs/sprint1-milestone.md`](docs/sprint1-milestone.md)。

### Sprint 2：Workflow Framework ✅

**目标已达成**：声明式 Workflow（YAML）可执行成一个完整 thread —— 触发 → 分步 → 路由 → 完结。

CP8 + CP1 ~ CP5 全部交付：

- CP8 Sprint 1 收口（Project scope 路由 / per-channel agent status / 删 `agents.status` / Activity filter / D-8 沙盒清理）
- CP1 `workflows` / `workflow_runs` 两张新表（schema_version → 4）+ REST 端点
- CP2 3 个内置模板（feature-development / bug-fix / research）+ auto-import
- CP3 WorkflowRunner 状态机 + step 推进 + `/command` `/approve` `/reject` `/abort` 指令解析
- CP4 Thread 顶部 WorkflowProgress 进度条 + `/command` 提示下拉
- CP5 多 Project 隔离 + Sprint 2 milestone

详细交付清单 + 手动验收 runbook + 已知技术债 → [`docs/sprint2-milestone.md`](docs/sprint2-milestone.md)。

---

### Sprint 3：Responsibility + User Intervention ✅

**目标已达成**：Workflow 中用户可随时介入；Workflow 可导入导出。

CP1 ~ CP6 全部交付：

- CP1 `responsibilities` 表（schema_version → 5）+ 从 YAML 自动推导 executor / approver
- CP2 ApprovalCard 组件（替代 awaiting_approval 文字提示）+ Inbox 跨 Project 视图
- CP3 `/comment` `/override` 完整化；`/abort` 真正 kill cursor-agent 子进程
- CP4 Workflow YAML Import / Export + WorkflowsPage 管理页
- CP5 触发 workflow 后前端自动跳 thread
- CP6 Sprint 3 milestone

详细交付清单 + 手动验收 runbook + 已知技术债 → [`docs/sprint3-milestone.md`](docs/sprint3-milestone.md)。

---

### Sprint 4：Delivery Loop（Scribe 沉淀）✅

CP1 ~ CP6 已交付：`decisions` / `lessons` 表（schema_version → 6）+ Scribe System Agent + Workflow 完成自动触发 + `/sediment` + Intelligence Tab + ContextBuilder 注入。

详细 → [`docs/sprint4-milestone.md`](docs/sprint4-milestone.md)。

---

### Sprint 5：Evolution Loop（Agent 成长）✅

CP1 ~ CP6 已交付：`agent_observations` / `agent_feedback` 表（schema_version → 7）+ Evaluator 24h cron + Coach 阈值触发 + Agent Profile FEEDBACK Tab + Apply/Rollback。

详细 → [`docs/sprint5-milestone.md`](docs/sprint5-milestone.md)。

---

### Sprint 6：Onboarding Loop + Skill Matrix ✅

CP1 ~ CP6 已交付：`project_onboarding` / `agent_skills` 表（schema_version → 8）+ Onboarder System Agent + Project 创建异步触发 + 卡片 UI + tool_call 自动统计 + Create Task 智能推荐。

详细 → [`docs/sprint6-milestone.md`](docs/sprint6-milestone.md)。

---

### Sprint 7：Team-First-Collaborative Workflow Design（Facilitator）✅

CP1 ~ CP6 已交付：`workflow_sessions` 表（schema_version → 9）+ Facilitator System Agent + WorkflowsPage `✨ From Team Discussion` 按钮 + Approve / Reject / Archive。

详细 → [`docs/sprint7-milestone.md`](docs/sprint7-milestone.md)。

> **MVP 完成（Sprint 1~7）**。下一步进入 **Sprint 8+ 远期路线**。

---

### Sprint 4-ext：Cursor SDK Adapter 旁路 ✅（2026-04-30）

跨 Sprint 顺手项，源自 [`docs/cursorsdkadapter.md`](docs/cursorsdkadapter.md) 调研。落地 🔴 短期 3 项：

- **S-1** `CursorSdkAdapter`：`@cursor/sdk` 直连派 adapter，与 `CursorAdapter`（spawn cursor-agent）并存；环境变量 `SLARK_CURSOR_BACKEND=sdk|cli` 切换；`CLIAdapter.runDirect?` 钩子 + `runWithAdapter()` 统一 dispatcher
- **S-2** SDK 标准化 `SDKToolUseMessage` 直接给 `{ name, args, result, status, truncated }`，避免 cursor-agent 内部 `xxxToolCall` 后缀脆弱解析
- **S-3** `summarizeToolArgs` 工具模块 + 接入 `ActivityRecorder`，给 D-3 Activity Tab 输出 `Shell: ls -la /path` 风格摘要

实现要点：
- 全部 6 个 System Agent + AgentEngine 切到 `runWithAdapter`，让 backend 切换贯通整条调用链
- `@cursor/sdk` 通过 lazy dynamic import 引入，**默认 `cli` 模式启动不触发 SDK / sqlite3 加载**，向后兼容
- 启用 `sdk` 模式需要 `CURSOR_API_KEY` + `pnpm approve-builds` 编译 sqlite3 native binding（详见 [`cursorsdkadapter.md` §9](docs/cursorsdkadapter.md)）
- Smoke verify：`packages/server/scripts/verify-sdk-adapter.ts`（无需 SQLite，独立可跑）

**未落地 / 暂缓**：S-4 Subagents 重构（待 SDK GA + spike）、S-5/6 设计参考（纳入 R-19/R-25）、S-7/8/9 远期（cloud / Hooks）。详见 [`cursorsdkadapter.md`](docs/cursorsdkadapter.md) 顶部状态表。

---

## Sprint 8+: 远期路线

> **⚠ 前期聚焦中（2026-05-12 起生效）**：当前阶段按 [`docs/focus-core-loop.md`](docs/focus-core-loop.md) 收敛于"核心闭环打磨"，下表的"广度扩展"项已显式 `Hold` 到 §"Sprint 8+ 重排（前期聚焦下）" 之后。
>
> 退出条件、判断准则、Sprint 8/9/10 主题见 [`focus-core-loop.md`](docs/focus-core-loop.md) §4 / §7。

### Sprint 8+ 重排（前期聚焦下）

| 顺序 | Sprint 候选 | 主题 | 关键交付 | 对应闭环 |
|------|---------|------|---------|---------|
| **Sprint 8** | 反馈姿势 + 真实任务体验 | "把 L4/L5 跑顺" | 消息 inline 👍/👎 + reason / `agent_feedback.source='inline'` / TD-8 长输出策略 / TD-12 running 状态 override / Activity 降噪 | L4 + L5 |
| **Sprint 9** | 即时回路 + dogfood 第一轮 | "把 L5→L6 接成短回路" | Coach 阈值即时触发 / 右侧 rail panel "Coach suggested edit" / `learn-fast-loop.html` 原型落地 / TD-9 `/reject` 沉淀进 lessons | L5→L6 |
| **Sprint 10** | 团队级视图 + Worktree | "把 L6→L7 闭上" | Team Health 仪表盘 / Project Intelligence 升级为"学习速率"视图 / **B-1** Worktree 隔离让多 Agent 真正并发 | L6→L7 + L4 |
| Sprint 11+ | 回归广度扩展 | "打开外延" | 回到下表 R-N / B-N 原排序 | 跨闭环 |

### 后期广度路线（Sprint 11+，前期 Hold）

| 项目 | 描述 | 优先级（前期 Hold 后） |
|-----|------|--------|
| **R-18** Codex / Claude Code 多 runtime 适配 | 接入 Claude / Kimi / Copilot / Gemini Adapter（Codex / Cursor SDK 已落） | 🟡 中 |
| **R-19** 跨 Project 全局视图 Kanban 升级 | `/threads` / `/tasks` / `/saved` Kanban 视觉打磨 | 🟡 中 |
| **R-20** Team Memory（Project 级 ground rules）| 用 lessons 表已半实现 | 🟢 低 |
| **R-21** Agent / Workflow Template Marketplace | 用户可分享 Workflow YAML / Team Template | 🟢 低 |
| **R-22** `.slark/team.yaml` Project 级 Agent 定义 | git 可追踪 | 🟢 低 |
| **R-23** Electron / Tauri 打包 | 桌面应用 + 系统托盘 | 🟢 低 |
| **R-24** Agent 之间主动 DM | 非 @mention 触发 | 🟢 低 |
| **R-25** Project 拖拽排序、收藏、归档 | UX 打磨 | 🟢 低 |
| **B-3** 任务依赖图（`blocked_by`）| Task 之间显式依赖 + 自动 unblock | 🟡 中（前期可顺手做） |
| **B-6** Tiled Live View（多 Agent 并排实时输出）| Slark 相对 ClawTeam 的差异化机会 | 🟡 中 |
| Facilitator 多轮真对话 | 升级 Sprint 7 single-shot | 🟡 中（前期 G3 之后评估） |

> **B-1 Worktree 已上提到 Sprint 10**：它是 L4 "真实多 Agent 并发改代码" 的前置，属于核心闭环必需，不押到后期。

---

## 关键技术决策（保留 / 更新）

- **为什么不用 MCP**: 本地场景直接 spawn CLI 比 MCP 更简单直接
- **为什么用 SQLite**: 零配置单文件，适合本地应用
- **为什么用 WebSocket**: 需要双向通信（发消息 + 流式响应 + 状态更新）
- **为什么用适配器模式**: 不同 CLI 接口差异大，适配器解耦核心逻辑
- **为什么 spawn-per-message**: CLI 工具原生设计就是单次执行
- **为什么 Agent 无独立 workspace（v1.0 修订）**: 聚焦编程协作，记忆通过 ContextBuilder 注入 + Coach 演化 description 承载
- **为什么 Workflow 用声明式 YAML**: 类比 GitHub Actions，工程师友好；为 Sprint 7 Facilitator 输出留下标准接口
- **为什么 Project 是一等公民（v1.0 修订）**: Server = Project 是 slock.ai 原版的等价语义；多 Project 并发时上下文 / Tasks / Knowledge 都按 Project 隔离

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v0.1 ~ v0.3 | 2026-04-22 | 原 4 Phase / MVP-1~9 结构（v0 MVP 已交付） |
| v1.0 | 2026-04-23 | 按 `product-brief.md` v1.0 重写：Sprint 1~6 路线 + Sprint 1 详细任务 |
| v1.0.1 | 2026-04-23 | 同步 v1.0.1 Review 决议：Sprint 1 工期弹性、删库迁移、Sprint 4 拆分 Sprint 7 |
| **v1.1** | 2026-04-30 | **文档体系简化**：状态收敛到 `docs/project-status.md`；Sprint 1 详细任务清单移至 `docs/sprint1-milestone.md`；v0 MVP 已交付清单折叠为一句话；当前焦点改为 Sprint 2 |
| v1.2 | 2026-04-30 | Sprint 1~7 全部交付，MVP 完成；新增 Sprint 4-ext（Cursor SDK Adapter 旁路）落地记录 |
| **v1.3** | 2026-05-12 | **前期聚焦核心闭环**：引入 [`docs/focus-core-loop.md`](docs/focus-core-loop.md) 作为阶段性收敛锚点；Sprint 8+ 章节重排（"广度优先" → "深度优先"），Sprint 8/9/10 主题改为 L4/L5/L6/L7 闭环打磨；R-N 广度路线推迟到 Sprint 11+ |
