# Project Status — 项目当前状态（单一状态源）

> **本文档是 Slark 项目的唯一状态来源**。
> 询问"当前进展到哪了 / 下一步做什么 / 还有什么阻塞"时，只看这一份。
> 其他文档（PLAN.md / product-brief.md / technical-decisions.md）不维护状态，只维护内容。

**最近更新**：2026-05-12（**方向收敛：前期聚焦核心闭环**——引入 [`focus-core-loop.md`](focus-core-loop.md)）

---

## 1. 当前位置

| 项 | 值 |
|---|---|
| 当前阶段 | **前期聚焦核心闭环打磨**（[`focus-core-loop.md`](focus-core-loop.md) v0.1 生效） |
| 最近 Sprint | Per-Project Storage 重构 Sprint A+B+C 已完成（D-21~D-25，merged 到 `main`） |
| 下一阶段 | **Sprint 8 候选**：反馈姿势（L5）+ 真实任务体验（L4）—— 见 [`focus-core-loop.md`](focus-core-loop.md) §6 |
| 前置工作 | **dogfood 第一轮**：用 Slark 自己跑一个真实任务，记录 7 步闭环卡点，灌入 Sprint 8 backlog |
| 当前分支 | `main` |
| 类型检查 | ✅ pnpm -r typecheck 全绿 |

### 2026-05-12 方向收敛摘要

基于 [`focus-core-loop.md`](focus-core-loop.md)：

- **聚焦**：把 L1→L7 七步使用闭环（打开项目 / 创建团队 / 初始 Workflow / 运行真实任务 / 过程反馈 / 结果反馈+迭代团队 / 项目高质量迭代）打磨到日常顺手
- **现状评估**：L1~L4 黄绿、**L5 红、L6 黄、L7 红**——卡点在"反馈与迭代"内回路（异步、单向、入口深）
- **重排**：Sprint 8/9/10 改为深度优先（反馈姿势→即时回路→团队级视图+Worktree）；R-18/19/21/22/23/24/25 等广度项推迟到 Sprint 11+
- **退出条件**：闭环可演示 + 反馈姿势日常化 + 团队级视图可读（详见 `focus-core-loop.md` §7）

### Per-Project Storage Sprint A+B+C 已交付摘要（2026-05-08）

基于 [`per-project-storage-design.md`](per-project-storage-design.md) v0.3，落地三个 Sprint：

**Sprint A — 存储层重写（commit `023fcec`）**
- ✅ 新增 `config/projects-store.ts` `config/project-meta.ts` `config/projects-service.ts`：~/.slark/projects.json + <ws>/.slark/project.json 双层文件存储
- ✅ 重写 `db/index.ts` 为 LRU handle pool（max=20，30min idle close）+ `findDbByResource` 资源反查 + warm-up 接口
- ✅ schema.sql 删 projects 表 + 全表去 project_id；`db/repos.ts` 全部 repo 改为 per-project 形态
- ✅ 重写 `routes/projects.ts`（POST /open、POST /close、POST /delete-storage 替代旧 CRUD）
- ✅ 所有其他 routes（channels/agents/tasks/extras/feedback/intelligence/skills/workflows/workflow-sessions/ws-handler）改为通过 `_helpers.ts` resolver 拿 per-project db
- ✅ 系统模块（agents/engine、system-agents/*、workflows/runner、messaging/router）适配 per-project handle
- ✅ 启动期 warm-up 所有 recent project；shutdown 关闭全部 db
- ✅ 前端 `lib/api.ts` createProject 改调 /api/projects/open；新增 closeProject / deleteProjectStorage

**Sprint B — UX 对齐 Close vs Delete（commit `21b146b`）**
- ✅ OpenProjectDialog：调 /api/projects/open，区分 is_new / reopen；reopen 拉已存在 channels；新建 seed #general
- ✅ ProjectSettingsPage Danger Zone 双按钮：Close（保留 .slark/）+ Delete .slark/（自定义模态需输入项目名 slug 校验）
- ✅ Sidebar Switcher ⋯ 菜单加 "✕ Close" 项

**Sprint C — Knowledge JSONL + 全局视图 + WS + 文档（本 commit）**
- ✅ Knowledge Store：`config/knowledge-store.ts` 在 approve / reject / update 后整体重写 `<ws>/.slark/knowledge/{decisions,lessons}.jsonl`（仅 review_status='approved'）
- ✅ 跨 project 全局视图聚合：`/api/inbox(workflow-runs)`、`/api/threads`、`/api/messages/search`、`/api/saved`、`/api/agents`、`/api/channels`、`/api/tasks`、`/api/skills` 全部走 `forEachProjectDb` 遍历 handle pool
- ✅ projectsService.ensureReadme：自动生成 `.slark/README.md`（含目录结构、git 入仓建议）
- ✅ WS 全局事件：`hub.broadcastGlobal()` + `ServerEvent` 新增 `project_list_changed` / `knowledge_updated`；前端 ws-bridge 收到后 refresh stores
- ✅ 文档同步：`docs/technical-decisions.md` 新增 D-21 ~ D-25 + 版本 v1.2

> 关键点：开发阶段**不向前兼容**（Q-12）。旧 `~/.slark/slark.db` 启动期检测仅 warn，不迁移；用户手动 `mv` 释放即可。
> 验收：服务启动 0 错误 → POST /api/projects/open 创建 `<path>/.slark/{project.json,slark.db,.gitignore,README.md}` → GET /api/projects 从 projects.json 列出。

### Sprint 4-ext 已交付摘要（2026-04-30）

基于 [`cursorsdkadapter.md`](cursorsdkadapter.md) §S-N 优先级，落地 🔴 短期 3 项：

- ✅ **S-1** `CursorSdkAdapter` 旁路：`packages/server/src/agents/cursor-sdk-adapter.ts` + `adapter-factory.ts`，环境变量 `SLARK_CURSOR_BACKEND=sdk\|cli` 切换；`CLIAdapter` 接口扩展 `runDirect?` 钩子；`runner.ts` 新增 `runWithAdapter()` 统一 dispatcher（spawn-派 / api-direct-派）
- ✅ **S-2** SDK 标准 tool_call schema：`SDKToolUseMessage` 直接给 `{ name, args, result, status, truncated }`，避免 cursor-agent 的 `xxxToolCall` 后缀脆弱解析
- ✅ **S-3** `summarizeToolArgs`：`packages/server/src/agents/summarize-tool-args.ts` + 接入 `activity-recorder.ts`，给 D-3 Activity Tab 输出 `Shell: ls -la /path` / `Read: src/auth/oauth.ts (offset=10, limit=50)` 风格摘要
- ✅ 全部 6 个 System Agent（Team Architect / Scribe / Coach / Evaluator / Onboarder / Facilitator）+ Engine 切到 `runWithAdapter`，让 backend 切换贯通整条调用链
- ✅ `CursorSdkAdapter` 用 lazy dynamic import：默认 `cli` 模式启动**不会触发 SDK / sqlite3 加载**，向后兼容
- ✅ Smoke verify 脚本：`packages/server/scripts/verify-sdk-adapter.ts`（无需 SQLite 即可跑）

> 关键点：默认行为 100% 不变（`cli` 模式 = 旧 `CursorAdapter` spawn `cursor-agent`）；启用 SDK 模式需要 `CURSOR_API_KEY` + `pnpm approve-builds` 编译 sqlite3。详见 [`cursorsdkadapter.md` §9 运维章节](cursorsdkadapter.md)。

### Sprint 7 已交付摘要

- ✅ **CP1** `workflow_sessions` 表（schema_version → 9）
- ✅ **CP2 + CP3** Facilitator System Agent + Session 状态机 + 后台 Facilitator 运行
- ✅ **CP4 + CP5** Workflow Design Session UI + Approve / Reject / Archive + Failure 降级提示
- ✅ **CP6** Sprint 7 milestone 文档 + 全项目收尾

---

## 2. 当前阻塞 / 待决议

无待决议项；MVP（Sprint 1~7）完成。

后续 Sprint 8+ 主题（远期路线）：

- Facilitator 多轮真对话（升级 Sprint 7 single-shot）
- R-18 多 runtime 适配（Codex / Claude / Kimi / Copilot / Gemini）
- R-19 跨 Project 全局视图（Kanban）
- B-1 Worktree 多 Agent 隔离
- Agent / Workflow Marketplace

### 已决议（历史，仅供检索）

| # | 议题 | 决议 | 决议日期 |
|---|------|------|---------|
| Q-1 ✅ | Team Architect 用哪个 runtime | Cursor Agent | 2026-04-23 |
| Q-2 ✅ | 未装 cursor-agent 时 Seed 行为 | Welcome 页友好降级 + 兜底三件套 | 2026-04-23 |
| Q-3 ✅ | `projects.goal` 长度上限 | 500 字符 | 2026-04-23 |
| Q-4 ✅ | Workflow YAML 版本控制 | YAML 存 `workflows.definition_yaml` 单字段；不引入 SQL 内 version | 2026-04-30 |
| Q-5 ✅ | System Agent token 配额 | 独立 timeout，不计入 per-Agent 配额 | 2026-04-30 |
| Q-6 ✅ | Coach Apply 后能否回滚 | 能；`agent_feedback.description_before` 创建时快照保存 | 2026-04-30 |
| Q-7 ✅ | Scribe lessons 跨 Project 共享 | 默认 Project-private | 2026-04-30 |
| Q-8 ✅ | Facilitator Session 触发方式 | 手动 (`✨ From Team Discussion` 按钮) | 2026-04-30 |
| Q-9 ✅ | Facilitator Session 时长 / 轮数 | 单次 spawn，`FACILITATOR_TIMEOUT_MS = 90s`；多轮版本留 Sprint 8+ | 2026-04-30 |

---

## 3. 已完成 Sprint 摘要

### Sprint 7 — Team-First-Collaborative Workflow Design (Facilitator)

详见 [`sprint7-milestone.md`](sprint7-milestone.md)。

- `workflow_sessions`（schema_version → 9）
- Facilitator System Agent（单次 spawn 模拟 round-table 产 YAML）
- WorkflowsPage `✨ From Team Discussion` 按钮 + Session 卡片状态机
- Approve 写入 `workflows` 表 + 自动 derive responsibilities
- Failure 降级到 Sprint 2 Template 路径

### Sprint 6 — Onboarding Loop + Skill Matrix

详见 [`sprint6-milestone.md`](sprint6-milestone.md)。

- `project_onboarding` / `agent_skills`（schema_version → 8）
- Onboarder System Agent（README + package.json + git log → 总结）
- Project 创建后异步触发 Onboarder + Onboarding 卡片
- Skill Matrix 从 tool_call 自动统计 + Create Task `Suggested by Skill Matrix`

### Sprint 5 — Evolution Loop（Agent 成长）

详见 [`sprint5-milestone.md`](sprint5-milestone.md)。

- `agent_observations` / `agent_feedback` 两张新表（schema_version → 7）
- Evaluator 24h cron 扫消息 → 写 observations
- Coach 聚合 negative tag → 产 description 修改建议
- Agent Profile FEEDBACK Tab：Apply / Reject / Rollback（Q-6 决议保留 diff 历史）

### Sprint 4 — Delivery Loop（Scribe 沉淀）

详见 [`sprint4-milestone.md`](sprint4-milestone.md)。

- `decisions` / `lessons` 两张新表（schema_version → 6）
- Scribe System Agent（严格 JSON + 60s timeout + 静默 fallback）
- Workflow 完成自动触发 Scribe；`/sediment` 手动指令
- Intelligence Tab（Pending / Knowledge Base / Decisions）
- ContextBuilder 注入 Project Goal + audience 过滤的 lessons + decisions

### Sprint 3 — Responsibility + User Intervention

详见 [`sprint3-milestone.md`](sprint3-milestone.md)。

- `responsibilities` 表（schema_version → 5）+ 自动从 YAML 推导
- ApprovalCard + Inbox 视图
- `/comment` `/override` 完整化；`/abort` 真正 kill `cursor-agent` 子进程
- Workflow YAML Import / Export + WorkflowsPage 管理页
- 触发 workflow 后前端自动跳 thread

### Sprint 2 — Workflow Framework

详见 [`sprint2-milestone.md`](sprint2-milestone.md)。

- `workflows` / `workflow_runs` 两张新表（schema_version → 4）
- 3 内置模板：`feature-development` / `bug-fix` / `research`
- WorkflowRunner 状态机 + `/command` 触发 + Thread 进度条

### Sprint 1 — Foundation + Goal → AI Team

详见 [`sprint1-milestone.md`](sprint1-milestone.md)。

- `projects` / `agent_runs` 两张新表
- Create Project 三步向导 + Team Architect 系统 Agent + 兜底三件套
- Sidebar Project 切换器；Welcome 页（不再预置 `#general`）
- Agent Profile 简化为 PROFILE / ACTIVITY 两 Tab

---

## 4. 已知技术债

Sprint 3 完成后剩余的延后项（详见 [`sprint3-milestone.md`](sprint3-milestone.md) §3）：

| # | 项 | 影响 | 计划清理时机 |
|---|---|------|------------|
| TD-8 | Workflow YAML `input` 注入仅 summary（前 1000 字符）| 长输出会被截断，下游 step 看不到完整内容 | Sprint 4+（评估是否值得加 token 预算策略） |
| TD-9 | `/reject` reason 仅注入 prompt，不沉淀 lessons | 反馈不可复用 | Sprint 4 Scribe 落地后顺手补 |
| TD-12 | `/override` 在 `running` 状态不支持，必须先 `/abort` | 用户体验略别扭 | Sprint 4+（涉及 step output 占位 + agent kill 同步语义） |
| TD-13 | Responsibilities UI 编辑器缺失（仅自动 derive）| 用户不能手动调整 role/authority | Sprint 7 配合 Facilitator |
| TD-14 | Workflow YAML 行内编辑器缺失 | 必须 export 改了再 import | Sprint 4+ |

**已清理**：TD-1 ~ TD-7（CP8 / Sprint 3 CP3）、TD-10（CP4）、TD-11（CP5）。

---

## 5. 下一步建议

MVP（Sprint 1~7）已交付。**2026-05-12 起方向收敛于"前期聚焦核心闭环"**（详见 [`focus-core-loop.md`](focus-core-loop.md)）。

### A. 立即（本周）：dogfood 第一轮

用 Slark 自己跑一个真实任务，验证 L1→L7 七步闭环的实际体验：

- 选一个**真实可交付**的项目内题目（不是 demo / 不是玩具）
- 全程使用 Slark 推进，记录每一步的"卡 / 别扭 / 想给反馈但没地方给"
- 产出 `docs/dogfood/2026-05-12-round-1.md` 报告 → 直接驱动 Sprint 8 backlog

### B. Sprint 8（候选）：反馈姿势 + 真实任务体验

按 [`focus-core-loop.md`](focus-core-loop.md) §6：

- **G1 反馈姿势**（L5 红 → 黄）：消息级 inline 👍/👎 + reason 入口；`agent_feedback.source='inline'`；落地 `learn-fast-loop.html` 视觉
- **G3 真实任务体验**（L4 黄 → 绿）：TD-8 长输出 token 预算策略 / TD-12 running 状态 override / 单消息 timeout 自适应 / Activity 降噪

### C. Sprint 9（候选）：即时回路

- **G2 即时回路**（L5→L6）：Coach 从 24h cron 改为阈值即时触发；右侧 rail panel "Coach suggested edit"；一键 Apply
- TD-9 `/reject` reason 沉淀进 lessons

### D. Sprint 10（候选）：团队级视图 + Worktree

- **G4 团队级视图**（L6→L7）：Team Health 仪表盘 / Project Intelligence 升级
- **B-1 Worktree 隔离**：让 L4 多 Agent 真正并发改代码

### E. Hold（前期推迟）

R-18 多 runtime / R-19 Kanban 升级 / R-21 Marketplace / R-22 team.yaml / R-23 Electron / R-24 Agent DM / R-25 拖拽 / 跨 Project 经验迁移 —— 等核心闭环退出条件全部满足后回归（[`focus-core-loop.md`](focus-core-loop.md) §7）。

详见 [`PLAN.md` §Sprint 8+ 重排（前期聚焦下）](../PLAN.md#sprint-8-重排前期聚焦下)。

---

## 6. 文档体系（简化后）

| 文档 | 唯一职责 |
|------|---------|
| **本文档**（`project-status.md`）| 项目当前状态 / 阻塞 / 技术债 / 下一步 |
| [`docs/focus-core-loop.md`](focus-core-loop.md) | **前期阶段性收敛锚点**（2026-05-12 生效）：核心闭环 7 步 / 现状评估 / Sprint 8+ 重排 / 退出条件 |
| [`PLAN.md`](../PLAN.md) | 当前 + 未来 Sprint 的范围与验收（不维护"已完成"细节） |
| [`docs/sprint1-milestone.md`](sprint1-milestone.md) | Sprint 1 历史交付记录（不再变更） |
| [`docs/product-brief.md`](product-brief.md) | 战略：定位 / 目标用户 / 核心决策 / 非目标 |
| [`docs/technical-decisions.md`](technical-decisions.md) | 稳定技术决策与默认值（D-N） |
| [`docs/optimization-backlog.md`](optimization-backlog.md) | 已决定但未排期的优化（O-N） |
| [`README.md`](../README.md) | 一句话简介 + 真实启动方式 |

调研 / 视觉 / 实验类（不在主线，仅参考）：

- [`docs/clawteam-comparison.md`](clawteam-comparison.md) — ClawTeam 借鉴条目（B-N）
- [`docs/research/routa-analysis.md`](research/routa-analysis.md) — Routa 借鉴条目
- [`docs/cursorsdkadapter.md`](cursorsdkadapter.md) — Cursor SDK / cookbook 引入条目（S-N）
- [`docs/cli-event-format.md`](cli-event-format.md) — CLI 事件格式
- [`docs/phase0-cli-spike.md`](phase0-cli-spike.md) — Phase 0 验证记录
- [`docs/ui-reference/`](ui-reference/README.md) — UI 视觉基准
- [`spike/README.md`](../spike/README.md) — Phase 0 spike 产物

---

## 7. 维护规则

- **状态变化时只改本文档**。其他文档不要再写"当前 Sprint""已完成 X""下一步 Y"。
- Sprint 切换时：把当前 Sprint 摘要挪到对应 milestone 文档（如 `sprint2-milestone.md`），更新本文档第 1 / 3 节。
- 新决策落地后：把对应 Q-N 从第 2 节移除，必要时迁移到 `technical-decisions.md`。
- 技术债清理后：从第 4 节移除。
