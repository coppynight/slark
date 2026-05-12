# Multica 项目调研：Slark 可借鉴点分析

> **调研对象**: [multica-ai/multica](https://github.com/multica-ai/multica)（~20k stars / ~2.5k forks / ~70 contributors，活跃，开源）
> **调研日期**: 2026-05-08
> **调研目的**: 分析 multica 的产品定位与设计思想，提取可供 Slark 借鉴的设计点，并明确不建议照搬的边界
> **参考版本**: main 分支，最新 release `v0.2.16`（2026-04-24）
> **调研方法**: Multica README + 官网 [multica.ai](https://multica.ai) + 公开特性页

---

## 一、执行摘要（TL;DR）

### 整体判断

Multica 与 Slark 都属于 **多 Agent 编程协作** 赛道，但**协作隐喻、用户模型、商业形态完全不同**：

| 维度 | Slark | Multica |
|------|-------|---------|
| 核心定位 | **本地** Programmable AI Team OS | **云优先**的 Managed Agents Platform |
| 协作隐喻 | **Slack 聊天室**（Channel + Thread + @mention 链） | **Linear 看板**（Issue + Comment + Activity Timeline） |
| 用户模型 | 单用户单机 | **多用户团队** + 可 Self-host |
| 顶层作用域 | Project（绑代码仓库） | Workspace（多团队隔离） |
| Agent 创建路径 | **Goal → Team Architect AI 自动推导** | 用户在 Settings → Agents 手动创建 |
| Workflow | 声明式 YAML（Template + Facilitator 协同设计） | Issue 状态流（看板 lifecycle） |
| Agent 能力封装 | description（自由文本，Coach 演化）+ agent_skills 自动统计 | **Skills 系统：可复用包**（SKILL.md + config + schema + templates） |
| 知识沉淀 | Scribe 自动沉淀 decisions / lessons | 弱（README 无明显沉淀机制） |
| 多 CLI 集成 | 1 runtime（Cursor），R-18 远期补 | **Daemon 自动检测 11 种 CLI**（11 Runtime 自动注册） |
| 后端 | Node.js + Fastify + better-sqlite3 | **Go + Chi + sqlc + Postgres 17 + pgvector** |
| 前端 | Vite + React 19 + Tailwind v4 | Next.js 16（App Router） |
| 安装 | dev mode（`pnpm install / pnpm dev`） | **brew / install.sh / pwsh + `multica setup`** 一键 |
| 协议栈 | 自定义 WebSocket + NDJSON | WebSocket + REST |
| 进程模型 | spawn-per-message（每条消息一个 CLI 子进程） | Daemon-managed（Runtime 长驻） |

### 核心结论

1. **Multica 是云端管理型平台，Slark 是本地可编程 OS**——两者面向的用户、形态、收费模式都完全不同，**不适合做产品全面对标**
2. **真正值得借鉴的是 Multica 在以下几个具体设计点**（详见 §5）：
   - **Multi-Runtime 自动发现**：Daemon 启动时扫 PATH 自动注册 11 种 CLI 为 Runtime ← 对 Slark 远期 R-18 多 runtime 落地最有参考价值
   - **统一 Activity Timeline**：Issue 详情页里 assigned / status changes / comments / agent action 全部混排 ← 对 Workflow Run 详情页的"叙事一致性"有帮助
   - **一键安装与 Setup 体验**：`brew install` + `multica setup` 一句话搞定 ← Slark Tauri 打包之前可先有 install 脚本
   - **Skills 作为版本化能力包**：`SKILL.md` + `version` + `templates` 文件结构 ← 与 routa B-2 / clawteam B-4 的 Agent Template 思路同源，但 Multica 落到具体文件结构
3. **明确不建议照搬**：Postgres + pgvector / Go 后端 / 多用户云端 / Issue-first 看板隐喻 / Skill Marketplace 等（详见 §6）。这些都与 Slark `product-brief.md §1 / §8` 定位冲突
4. **P0 可立即落地的借鉴点有 3 个**（B-1 / B-2 / B-3，见 §5.1），与 Slark 现有路线无冲突

### 结论一句话

> Multica 验证了"AI Agent 作为团队成员"这条赛道的市场需求（~20k stars 是强信号），但它选择的是**"云端 + 多用户 + 看板"路径**；Slark 走的是**"本地 + 单用户 + 聊天室 + 自演化"路径**。**Slark 的差异化恰恰是 Multica 的对立面**——学其 Multi-Runtime 自动发现、安装体验、Skills 文件结构这三个工程层面的细节即可。

---

## 二、Multica 项目概览

### 2.1 项目基础数据

- **GitHub**: [multica-ai/multica](https://github.com/multica-ai/multica)
- **Stars**: ~20k（截至 2026-05-08，活跃增长）
- **Forks**: ~2.5k
- **Contributors**: ~70
- **最新 Release**: `v0.2.16` @ 2026-04-24
- **许可证**: 开源（GitHub 显示，未在 README 中明确具体协议，需查 LICENSE 文件）
- **语言比例**: TypeScript 49.9% / Go 41.7%（前端 + 后端）
- **作者**: multica-ai（团队，配套 [multica.ai](https://multica.ai) 商业云服务）

### 2.2 产品定位（官方原文）

> **Multica turns coding agents into real teammates. Assign issues to an agent like you'd assign to a colleague — they'll pick up the work, write code, report blockers, and update statuses autonomously.**
>
> **Your next 10 hires won't be human.**

**关键词**：

- **Managed Agents Platform**：管理型平台（不是编排框架，不是 IDE 插件）
- **Coding Agents as Teammates**：把编程 Agent 当真同事用（assignee picker 里和真人并列）
- **Issue-first**：核心交互单元是 Issue（而非聊天室或卡片）
- **Multi-runtime**：一个 Dashboard 同时管 11 种 CLI
- **Open-source + Cloud + Self-host**：商业云优先 + 开源可自托管

### 2.3 运行形态

| 入口 | 适用场景 | 技术栈 |
|------|---------|--------|
| Web App | 主要 UI 入口，浏览器访问 | Next.js 16（App Router） |
| Cloud（multica.ai） | 默认 SaaS 形态 | 托管的 Multica server + 用户的本地 daemon |
| Self-host | 用户自托管完整 server | Docker Compose / 单 binary / Kubernetes |
| Daemon | 在用户机器上跑，连接 Multica 后端 | Go binary + 子进程管理（每个 CLI 一个 Runtime） |
| CLI | 终端工作流 + 脚本化 | `multica` Go binary（brew / install.sh / pwsh 安装） |

> **关键架构观察**：Multica 是 **Server-Daemon 分离**架构——server（云或自托管）持有数据 + 状态，daemon 在用户机器上执行 Agent。这和 Slark 的"单进程后端 + WebSocket 服务"完全不同。

### 2.4 技术栈

| 层 | Multica | Slark（对照） |
|----|---------|--------------|
| Frontend | Next.js 16（App Router） | Vite + React 19 + Tailwind v4 |
| Backend | **Go**（Chi router + sqlc + gorilla/websocket） | Node.js + Fastify + ws |
| 数据库 | **PostgreSQL 17 + pgvector**（暗示语义搜索 / 向量索引） | better-sqlite3（SQLite，单文件） |
| Agent Runtime | 本地 daemon（用户机器） + 云 runtime | spawn-per-message（每条消息一个子进程） |
| Agent CLI 支持 | **11 种**：Claude Code / Codex / GitHub Copilot CLI / OpenClaw / OpenCode / Hermes / Gemini / Pi / Cursor Agent / Kimi / Kiro CLI | 1 种（Cursor Agent，远期 R-18 补） |
| 包发布 | brew / install.sh / pwsh / Docker（GHCR 镜像） | dev mode（`pnpm install`） |
| 通信协议 | WebSocket + REST（自定义） | WebSocket + REST + NDJSON 流（自定义） |

### 2.5 核心交付能力（README 摘录）

> Multica manages the full agent lifecycle: from task assignment to execution monitoring to skill reuse.

1. **Agents as Teammates** — Agent 在 Assignee Picker / Activity Feed / Comment 里与真人并列；Agent 主动 create issues / post comments / report blockers
2. **Autonomous Execution** — 完整 task lifecycle（enqueue → claim → start → complete/fail）；real-time progress streaming via WebSocket；proactive blocker reporting
3. **Reusable Skills** — Skill 是结构化的能力包：`SKILL.md` + `config` + `schema.sql` + `templates/`；`version` + `author` + `steps` 字段；team-wide sharing
4. **Unified Runtimes** — Dashboard 显示所有 runtime 状态（local daemon / cloud）；real-time monitoring（online/offline）；usage charts；activity heatmap；自动检测 11 种 CLI
5. **Multi-Workspace** — Workspace 级隔离，每个 workspace 有独立的 agents / issues / settings

---

## 三、Multica 核心设计思想（深入分析）

### 3.1 Daemon + Auto-Detect Runtime 模型

**决策**：用户机器上跑一个长驻 daemon，启动时扫 `PATH` 自动检测可用的 CLI（claude / codex / copilot / openclaw / opencode / hermes / gemini / pi / cursor-agent / kimi / kiro-cli），每个检测到的 CLI 注册为一个 **Runtime**。

```text
multica setup
  ↓
1. 配置（OAuth）
2. 启动 daemon（后台进程）
3. daemon 扫 PATH → 发现 6 个 CLI 已安装
4. 注册 6 个 Runtime → 上报 Multica server
5. server 在 Settings → Runtimes 显示 6 个 active Runtime
```

**Runtime 抽象**：

> "A Runtime is a compute environment that can execute agent tasks. It can be your local machine (via the daemon) or a cloud instance. Each runtime reports which agent CLIs are available, so Multica knows where to route work."

**关键洞察**：

- **CLI ≠ Runtime**：一台机器装了 6 个 CLI = 6 个 Runtime（同一台机器上多个）
- **Runtime 是路由单位**：Multica 决定"这个 task 派给哪个 CLI 跑"时，是按 Runtime 路由
- **Auto-detection 是核心 UX**：用户不需要逐个配 CLI——装好 CLI 就被自动发现

**对 Slark 的参考价值**：**高**（远期 R-18 多 runtime 落地的现成参考）。Slark 当前 `RUNTIME_REGISTRY` 是写死的（仅 cursor 实现），未来要支持 Codex / Claude Code / Gemini 时可以借鉴这个"扫 PATH + 自动注册"模式。详见 §5.1 B-1。

### 3.2 Agent 作为 Assignee Picker 的一等公民

**决策**：Agent 出现在和真人**完全相同**的 assignee dropdown 里。从 UI 到协议层都不区分"分配给人 vs 分配给 Agent"。

```text
Assign to...
├── Members
│   ├── AR Alex Rivera
│   └── SK Sarah Kim
└── Agents
    ├── Claude
    └── Tina-dev
```

> "Humans and agents appear in the same dropdown. Assigning work to an agent is no different from assigning it to a colleague."

**核心 UX 洞察**：

- 用户的"分配工作"心智不变（Linear / Asana 用户已经会）
- Agent 行为模式被设计成"被动接活 + 主动汇报"——和真人新员工很像
- Activity Timeline 里 "Alex Rivera assigned to Claude 3:02 PM" 和 "Claude changed status from Todo to In Progress 3:02 PM" 同等渲染

**对 Slark 的参考价值**：**低**。Slark 是单用户工具，没有"真人 vs Agent 同列"的对比语义。Slark 的等价物是"Agent 在 Channel 内是一等公民"——已经实现。**思想可借鉴一点**：Slark 的 Tasks Tab 在 assignee 选择上可以**强化"Agent = 团队成员"的视觉一致性**（当前可能已经做到，需要 UI 复盘）。

### 3.3 统一 Activity Timeline

**决策**：Issue 详情页里所有事件——assignment / status change / comment / agent tool call / blocker report——**统一时间线渲染，不分版块**。

```text
MUL-18 — Refactor API error handling middleware
─────────────────────────────────────────────
AR Alex Rivera assigned to Claude                                    3:02 PM
Claude changed status from Todo to In Progress                       3:02 PM
AR Alex Rivera                                                       10 min
   The current error responses are inconsistent across handlers...
Claude                                                                6 min
   I've standardized error responses across 14 handlers. PR #43 ready.
AR Alex Rivera                                                        3 min
   Looking good. Make sure to preserve the existing HTTP status...
─────────────────────────────────────────────
```

**关键设计**：

- 用户 / Agent / 系统事件用同一种渲染方式（头像 + 名字 + 时间 + 内容）
- Agent 在 timeline 里既是行为者（"Claude changed status"）又是发言者（"Claude: I've standardized..."）
- 用户能"一眼看出"事情的全貌——不需要在多个 Tab 之间跳

**对 Slark 的参考价值**：**中-高**。Slark 当前 Workflow Run 的展示方式是"Thread 内消息流 + WorkflowProgress 顶部条 + Tasks Tab 状态"——**叙事是分裂的**。可以借鉴"统一 Activity"思想，让 Workflow Run / Task 详情页有一个"叙事统一视图"。详见 §5.1 B-2。

### 3.4 Skills 系统（可复用能力包）

**决策**：Agent 的"能力"被显式建模为 **Skill 文件包**——每个 Skill 是一个目录，包含 `SKILL.md`（说明 + steps）、`config`（配置）、`schema.sql`（数据库结构）、`templates/`（模板文件）等。

```text
Skills
├── deploy-to-staging       Run staging deploy pipeline
├── write-migration         Generate and validate SQL migration
├── review-pr              Code review with style guide checks
└── write-tests            Generate unit and integration tests

write-migration/
├── SKILL.md
│   ├── name: write-migration
│   ├── version: 1.2.0
│   ├── author: Alex Rivera
│   ├── description
│   └── steps:
│     1. Analyze the current schema from migrations/
│     2. Generate migration SQL with proper ordering
│     3. Validate with sqlc compile
│     4. Run tests against a fresh database
├── config
├── schema.sql
└── templates/
```

**核心设计**：

- **版本化**（`version: 1.2.0`）：Skill 像软件包一样可以演进
- **作者归属**（`author`）：可追溯
- **可复用**：一个人写一次，团队所有 Agent 都能用
- **结构化产物**：不只是 prompt，还包括代码 / config / schema / templates

> "Day 1: you teach an agent to deploy. Day 30: every agent deploys, writes tests, and does code review. Your team's capabilities grow exponentially."

**对 Slark 的参考价值**：**中（与现有 B-N 部分重叠）**。

- Slark 当前 `agent_skills` 表是**事后自动统计**的能力地图（`skill_key = 顶级路径段` / `touch_count`），与 Multica 的 **主动定义可复用包** 完全不是同一个东西
- Slark 当前 Agent 能力描述靠 `agents.description`（自由文本）+ Coach 演化
- Multica 的 Skill 文件包思路在 **routa-analysis.md B-2（Agent Template 机制）** 和 **clawteam-comparison.md B-4（团队模板）** 里已经讨论过类似方向
- Multica 的额外贡献：**Skill 文件可以包含 templates / schema / config**，不只是 prompt——这一点对 Slark 的 Workflow YAML / decisions / lessons 有启发

详见 §5.2 B-4。

### 3.5 Issue Lifecycle State Machine

**决策**：每个 Issue / Task 流转 `enqueue → claim → start → complete / fail` 状态机，**所有状态转换都被 broadcast**（WebSocket 实时推送）。

> "Every task flows through enqueue → claim → start → complete/fail. No silent failures — every transition is tracked and broadcast."

**关键设计**：

- 状态机的"语义"清晰——每条边都有明确含义（enqueue 后还没人接、claim 后还没开始跑、start 后正在跑、complete 表示完成）
- WebSocket 广播让所有客户端实时看到状态变化
- "No silent failures" 是核心原则——即使任务失败也要显式上报，让 PM 可见

**Proactive blocker reporting**：

> "When an agent gets stuck, it raises a flag immediately. No more checking back hours later to find nothing happened."

**对 Slark 的参考价值**：**低-中**。Slark 已有 `agent_runs` per-channel 状态机（`idle / thinking / working / error / stopped`，见 D-1）+ WebSocket 广播。Multica 的状态机粒度更细（按 Issue 而非按 Agent），但 Slark 的"Workflow Run 状态机"已经有这层语义（`running / completed / aborted / failed`）。**思想已对齐**，无需额外借鉴。

唯一可能借鉴的是 **"Proactive blocker reporting"** —— Slark 当前 Agent 卡住时只是抛错误消息，没有显式"Blocker 状态"。这条与 routa-analysis.md B-8（Blocked 消息类型）有重叠。

### 3.6 Workspace-level Isolation

**决策**：Workspace 是顶层作用域，每个 Workspace 有独立的 agents / issues / settings。

> "Multi-Workspace — organize work across teams with workspace-level isolation. Each workspace has its own agents, issues, and settings."

**对 Slark 的参考价值**：**已对齐**。Slark 的 Project 即对应 Multica 的 Workspace，是顶层作用域（v1.0 已修订，见 product-brief D-2）。语义完全一致。无需额外借鉴。

### 3.7 一键安装与 Setup

**决策**：用户从"听说 Multica" 到"开始用" 走 `brew install` + `multica setup` 两步。

```bash
# Step 1: install
brew install multica-ai/tap/multica

# Step 2: setup (one command does everything)
multica setup
# ↑ 内部干了：
#   - 配置 server URL
#   - OAuth 认证（开浏览器）
#   - 启动 daemon（后台进程）
#   - 扫 PATH 检测 11 个 CLI
#   - 注册 Runtime 到 server
```

**还有 self-host 一键脚本**：

```bash
curl -fsSL https://raw.githubusercontent.com/multica-ai/multica/main/scripts/install.sh | bash -s -- --with-server
multica setup self-host
```

**核心 UX 价值**：从"看到 README" 到"跑通第一个 task"≤ 5 分钟。

**对 Slark 的参考价值**：**中**。Slark 当前用户跑 dev mode（`pnpm install / pnpm dev`），目标用户群虽然是开发者但 onboarding 心智成本仍然较高。Sprint 8+ R-23 Tauri 打包之前，可以先做一个 install 脚本降低门槛。详见 §5.1 B-3。

---

## 四、Multica vs Slark：定位差异

### 4.1 核心隐喻对比

| 维度 | Slark | Multica |
|------|-------|---------|
| 用户打开第一眼看到 | 频道列表 + 消息流 | Workspace Dashboard + Issue Board |
| 用户发起工作方式 | 在频道里 `@Agent 帮我...` 或 `/new-feature` | 创建 Issue + 拉 Agent 到 assignee |
| Agent 被谁触发 | 用户 @mention / 链式 @mention / Workflow step | 用户分配 Issue / Issue 状态变更 |
| 交付确认方式 | Workflow Approve（用户/Agent）+ Scribe 自动沉淀 | Issue 状态流转到 Done |
| 协作痕迹载体 | 消息线 + Thread + decisions/lessons 知识池 | Issue 的 Activity Timeline + comments |

### 4.2 Agent 概念差异

| 维度 | Slark Agent | Multica Agent |
|------|-------------|---------------|
| 创建路径 | **AI 自动推荐**（Team Architect 从 Goal 推导）| 手动创建（Settings → Agents → New Agent） |
| 配置粒度 | name / description / runtime / model / env_vars | name / runtime / provider / instructions / skills |
| 角色分化 | 弱（每个 Agent 都是"通用助理"，靠 description 暗示） | 中（通过附加 Skill 包决定能力） |
| 行为约束 | 靠用户写 description + Coach 演化 | 靠用户写 instructions + 附加 Skill |
| 能力沉淀 | description 由 Coach 演化（基于 agent_observations）| 用户主动写 Skill 文件包 |
| 跨用户共享 | ❌ 不支持（本地单用户） | ✅ 支持（Workspace 内所有用户共享 Agent / Skill） |
| Agent 主动性 | 弱（必须被 @ 才动）| 中（可主动 create issues / report blockers） |

### 4.3 数据模型差异

```
Slark:
  Project (= Workspace 等价)
    └── Channels
        ├── Messages（主线 + Thread）
        └── Tasks（轻量状态机：todo/in_progress/in_review/done）
    └── Agents（Project-scoped，description 可演化）
    └── Workflows + WorkflowRuns（声明式 YAML 甬道）
    └── Responsibilities（Step × Agent 的 RACI）
    └── Knowledge: Decisions / Lessons（Scribe 沉淀）
    └── agent_observations / agent_feedback（Coach 演化）
    └── agent_skills（自动统计的 Skill Matrix）
    └── workflow_sessions（Facilitator 协同设计）

Multica:
  Workspace
    └── Issues（核心交互单元）
        └── Activity Timeline（assignment / status / comments / agent action 混排）
    └── Agents（Workspace-scoped）
    └── Skills（结构化能力包：SKILL.md + config + schema + templates）
    └── Runtimes（local daemon / cloud，自动检测 11 种 CLI）
    └── Members + Permissions（多用户）
```

**结构差异**：

- **Slark 实体更多更深**：6 层架构 + 4 Loop 让 Slark 数据模型涵盖了 "Goal / Workflow / 知识沉淀 / Agent 演化" 等"运营机制"
- **Multica 实体更扁更广**：Issue 是绝对核心，其他实体（Skills / Runtimes / Members）围绕 Issue 服务
- **核心关系不同**：Slark 是 `Project → Channel → Message`（一对多对多）；Multica 是 `Workspace → Issue`（一对多）

### 4.4 协作驱动力差异

| 驱动机制 | Slark | Multica |
|---------|-------|---------|
| 协作起点 | Goal（项目目标，必填）→ AI 配 Team | Issue（任务）→ 用户分配 Agent |
| 协作过程 | Workflow YAML 甬道 + @mention 链 + Approval | Issue 状态机 + Comment + Activity |
| 协作结束 | Workflow Run 完成 → Scribe 沉淀知识 → Coach 演化 Agent | Issue 状态变 Done → Skill 可被其他人复用 |
| 闭环 | 4 Loop（Onboarding / Delivery / Evolution / Reuse）| 2 Loop（Issue lifecycle / Skill reuse）|

**关键差异**：

- Slark 的协作是**自顶向下**的（Goal 驱动 Team，Team 设计 Workflow，Workflow 执行 + 沉淀）
- Multica 的协作是**水平铺开**的（创 Issue → 分配 → 跑 → 完成 → Skill 可复用）
- Slark 有更强的"团队随时间成长"机制（Coach + Evaluator + agent_feedback）
- Multica 有更强的"能力包水平复用"机制（Skill 文件 + 跨 workspace 共享）

### 4.5 用户基数差异

| 维度 | Slark | Multica |
|------|-------|---------|
| 单实例用户数 | 1（设计上） | N（团队） |
| 跨实例同步 | ❌（本地单机，product-brief N-2） | ✅（Cloud 默认 + Self-host 多人） |
| 商业模型 | 免费开源（无云服务） | 开源 + 云 SaaS（multica.ai） |
| 安装目标 | 个人开发者 | 工程团队 |

---

## 五、可借鉴的设计点（按优先级）

> 下文用 "B-N"（Borrow-N）表示具体借鉴项。每项注明：**价值 × 成本 × 建议时机**。
>
> 本文档的 B-N 编号空间**独立于** [`routa-analysis.md`](./routa-analysis.md) 和 [`clawteam-comparison.md`](../clawteam-comparison.md)。冲突时按上下文区分。

### 5.1 P0（立刻可做 / 高价值低成本）

---

#### B-1：Multi-Runtime 自动发现（远期 R-18 落地参考）

- **价值**: ⭐⭐⭐⭐⭐（极高 / 远期 R-18 落地的关键设计）
- **成本**: ⭐⭐（中低）
- **建议时机**: Sprint 8+ 启动 R-18 时直接套用

**Slark 现状**: `RUNTIME_REGISTRY` 写死（仅 cursor 实现，5 个 placeholder）；用户必须在 Create Agent 时手选 runtime；多 runtime 是 R-18 远期路线（未排期）。

**Multica 启发**: daemon 启动时扫 `PATH` 自动检测 11 种 CLI 是否安装，发现一个注册一个 Runtime。**用户什么都不用配**。

**建议落地（R-18 启动时）**:

**Step 1: 抽象 Runtime 检测器**

新增 `packages/server/src/agents/runtime-discovery.ts`：

```typescript
export interface RuntimeProbe {
  id: string;                          // 'cursor' | 'claude-code' | 'codex' | ...
  binaryName: string;                  // 'cursor-agent' | 'claude' | 'codex' | ...
  versionCommand: string[];            // 'cursor-agent --version'
  detected: boolean;
  version?: string;
  path?: string;
}

export async function probeRuntimes(): Promise<RuntimeProbe[]> {
  const candidates = [
    { id: 'cursor',      binaryName: 'cursor-agent', versionCommand: ['--version'] },
    { id: 'claude-code', binaryName: 'claude',       versionCommand: ['--version'] },
    { id: 'codex',       binaryName: 'codex',        versionCommand: ['--version'] },
    { id: 'gemini',      binaryName: 'gemini',       versionCommand: ['--version'] },
    // ... 用户实际想支持的列表
  ];

  return Promise.all(candidates.map(probe));
}
```

**Step 2: 启动时扫一次，结果写入 `runtimes` 内存表**

`packages/server/src/index.ts` 在 server start 之后：

```typescript
const probed = await probeRuntimes();
runtimeRegistry.refresh(probed);  // 缓存到 RUNTIME_REGISTRY
log.info('[runtime-discovery] detected runtimes:', probed.filter(p => p.detected).map(p => p.id));
```

**Step 3: Create Agent UI 改造**

- runtime dropdown 只列出 detected = true 的 runtime
- 显示 "Cursor Agent (v0.5.4)" 这种带版本的标签
- 没装的 runtime 可以**置灰显示**："Codex CLI (not installed) — `npm install -g @openai/codex`"
- 提供 "Re-detect" 按钮（重新扫 PATH）

**与 Multica 的差异（不要照搬）**:

- ❌ **不引入 daemon 进程**：Slark 是单进程后端，没必要额外起 daemon。直接在主进程内扫即可
- ❌ **不做"多机器 runtime"**：Slark 是单机工具（N-7 多机器分布式部署），runtime 必然在本机
- ✅ **保留"自动检测 + 自动注册"思想**：用户什么都不用配

**收益**:

- R-18 落地时用户体验"装好 CLI 立即可用"，不需要手填 runtime 字段
- 配合 Welcome Page 提示，可以把"Slark 支持 N 种 CLI" 转化为可见的安装引导
- 为 Sprint 8+ R-21（Workflow / Team Template Marketplace）打基础——模板可以声明 "需要 codex 或 claude"，自动检测后给提示

**涉及的 Slark 文档改动（实施时）**:

- `docs/technical-decisions.md` 新增 D-N：Runtime Discovery 机制
- `PLAN.md` Sprint 8+ R-18 任务清单加 "实现 runtime-discovery"
- `docs/optimization-backlog.md` 暂可记一条占位

---

#### B-2：Workflow Run / Task 详情页统一 Activity Timeline

- **价值**: ⭐⭐⭐⭐（高）
- **成本**: ⭐⭐（中低，主要是前端工作）
- **建议时机**: Sprint 8+ 任意时候，UI 重构时顺手做

**Slark 现状**: Workflow Run 的展示方式分散在三个地方：
- Thread 内消息流（消息文本）
- Thread 顶部 WorkflowProgress 进度条（step 状态）
- 频道 Tasks Tab（task 状态变更）

用户要全面理解一次 Workflow Run 发生了什么，需要在多个视图之间跳。

**Multica 启发**: Issue 详情页里所有事件——assignment / status change / comment / agent tool call / blocker report——**统一时间线渲染**。"一眼看出全貌"。

**建议落地**:

**新增 Workflow Run 详情页**（或在现有 Thread 页加 "Activity" 视图）：

```text
Workflow Run #42 — feature-development
Trigger: /new-feature add Google OAuth                    Started 3:00 PM
─────────────────────────────────────────────────────────
3:01 PM   ▶ Step 1: design — @Architect started
3:03 PM   💬 Architect: Here is my proposed OAuth design...
3:05 PM   🟡 Step 1: design — awaiting_approval (user)
3:08 PM   ✅ User approved step 1
3:08 PM   ▶ Step 2: implement — @Dev-Backend started
3:09 PM   🔧 Dev-Backend: Read packages/server/src/auth/oauth.ts
3:10 PM   🔧 Dev-Backend: Edit packages/server/src/auth/oauth.ts (+45 -3)
3:14 PM   💬 Dev-Backend: Implementation done, ready for review
3:15 PM   ▶ Step 3: review — @Reviewer started
3:17 PM   ⚠️ Reviewer: Concern about CSRF token storage
3:17 PM   🔄 Step 3: review → rejected, back to step 2
...
─────────────────────────────────────────────────────────
```

**实现要点**:

1. **数据来源已经齐全**：
   - `messages`（thread 内的消息）
   - `agent_runs`（per-channel agent 状态变更）
   - `workflow_runs.state_json`（每个 step 的产出 / 状态）
   - `tool_calls`（Agent 工具调用，配合 SDK adapter S-3 已落地的 `summarizeToolArgs`）
2. **后端**: 新增 `GET /api/workflow_runs/:id/timeline` 端点，按时间合并以上四个数据源，返回扁平的 timeline events
3. **前端**: 复用 ChannelPage 的消息渲染组件，但用统一的 "TimelineEntry" 卡片样式

**事件类型**:

| 类型 | 渲染 |
|------|------|
| `step.started` | `▶ Step X: id — @Owner started` |
| `step.completed` | `✅ Step X: id — completed` |
| `step.awaiting_approval` | `🟡 Step X — awaiting_approval` |
| `step.approved` | `✅ User approved step X` |
| `step.rejected` | `🔄 Step X → rejected, back to step Y` |
| `message.user` | `💬 User: ...` |
| `message.agent` | `💬 Agent: ...` |
| `tool_call.completed` | `🔧 Agent: Read|Edit|Bash|...` |
| `agent_run.error` | `❌ Agent error: ...` |

**与 Multica 的差异**:

- ❌ **不替换现有 Thread 视图**：Slark 的 Thread 是核心交互，不要替换
- ✅ **作为附加视图**：Workflow Run 详情页（或 Thread 顶部"Activity" 切换 Tab）
- ✅ **和 Slark 的 Neo-Brutalism 视觉一致**：硬阴影 + 2px 黑边 + 暖黄

**收益**:

- 用户向同事 / 老板"汇报这次 Workflow 干了什么"时，有一个可截图的统一视图
- 配合 Sprint 4 Scribe 沉淀，可以让"复盘一次 Workflow Run" 变得直观
- 为 Sprint 8+ R-19（跨 Project 全局视图）打基础——所有 Workflow Run 共享同一种 timeline 渲染

**涉及的 Slark 文档改动**:

- `docs/ui-reference/components.md` 新增 "Workflow Run Timeline" 组件规格
- `docs/optimization-backlog.md` 新增 O-N：Workflow Run Activity 视图（建议 P1）

---

#### B-3：一键安装脚本 + Setup 命令（Tauri 之前的过渡）

- **价值**: ⭐⭐⭐（中-高）
- **成本**: ⭐⭐（中低）
- **建议时机**: Sprint 8+ R-23 Tauri 打包**之前**做一版

**Slark 现状**: 用户跑 dev mode（`git clone / pnpm install / pnpm dev`）。目标用户是开发者，门槛尚可，但仍是"我要试试"和"我开始用"之间的最大障碍。R-23（Electron / Tauri 打包）是远期。

**Multica 启发**:

```bash
brew install multica-ai/tap/multica
multica setup
# 完事
```

**建议落地**（不依赖 Tauri / Electron）:

**方案 A: install.sh + 启动脚本**（最低成本）

提供 `scripts/install.sh`：

```bash
#!/usr/bin/env bash
# 1. 检测 node ≥ 20 / pnpm ≥ 10
# 2. 选个安装目录（默认 ~/.slark/app）
# 3. git clone slark 到该目录
# 4. pnpm install
# 5. 在 ~/.slark/launcher 写一个启动脚本
# 6. 在 PATH 里加 'slark' 命令（symlink）
# 7. 提示用户："运行 slark start 即可启动"
```

提供 `slark` CLI：

```bash
slark start          # 启动 server (4178) + web (5173)
slark status         # 检查健康
slark update         # git pull + pnpm install
slark logs           # 看日志
```

**方案 B: 直接 npm package**（中成本）

把 `@slark/cli` 发布到 npm：

```bash
npm install -g @slark/cli
slark setup
# 内部：拉取 slark monorepo 到 ~/.slark/app + pnpm install + 启动
```

**方案 C: Docker Compose**（不推荐，与本地工具定位冲突）

Slark 数据要本地落盘（`~/.slark/`），Docker 化反而更复杂。

**推荐：方案 A**（install.sh）。Sprint 8+ R-23 Tauri 真正打包后此方案可以淘汰，但短期内能极大降低试用门槛。

**与 Multica 的差异**:

- ❌ **不做 brew tap**：Slark 是 Node.js 项目，brew 心智不匹配。直接 `curl | bash` 即可
- ❌ **不做 OAuth 认证**：Slark 是本地单用户，不需要 OAuth
- ✅ **保留"一句话搞定"思想**：用户从 README 复制一行命令即可启动

**收益**:

- 大幅降低"试用门槛"：从 5+ 步降到 1 步
- 让 Slark 的可分享性更强（"试试看？这条命令"）
- 不会和 R-23 Tauri 打包冲突（这是过渡方案）

**涉及的 Slark 文档改动**:

- `README.md` 顶部新增"快速开始"块（一行 curl 命令）
- `docs/optimization-backlog.md` 新增 O-N：install 脚本（建议 P1）

---

### 5.2 P1（中等价值 / 需评估）

---

#### B-4：Skill 文件外化（与已有 B-N 重叠的具体落地形式）

- **价值**: ⭐⭐⭐⭐（思想价值高，但**与已有 B-N 重叠**）
- **成本**: ⭐⭐⭐（中）
- **建议时机**: 等 routa B-2（Agent Template）或 clawteam B-4（团队模板）落地时合并讨论

**重叠情况**:

| 来源 | 借鉴点 | 已经讨论 |
|------|-------|---------|
| routa-analysis.md B-2 | Specialist 外化为 Markdown + YAML（DB > 文件 > bundled） | ✅ |
| clawteam-comparison.md B-4 | TOML 格式团队模板（Hedge Fund 7-agent 一条命令拉起） | ✅ |
| **multica B-4（本条）** | Skill 包：`SKILL.md` + `config` + `schema` + `templates/` | 🆕 提供"包含模板/schema 而不只是 prompt"的具体文件结构 |

**Multica 的额外贡献**:

1. **Skill 文件包**不只是 prompt，还包括：
   - `config`（运行时配置）
   - `schema.sql`（数据库结构定义）
   - `templates/`（代码模板文件，比如 PR 模板 / commit message 模板）
2. **版本化**（`version: 1.2.0`）
3. **作者归属**（`author: Alex Rivera`）
4. **明确的 steps**（不是自由文本，是 ordered list）

**对 Slark 的具体影响**:

- 如果 Slark 落地 routa B-2（Agent Template 机制），文件结构可以**借鉴 Multica 的"包含 templates/"思路**——Agent Template 不只是 system_prompt，还可以包含：
  - `templates/commit-msg.txt`（agent 提交时用的模板）
  - `templates/pr-description.md`
  - `config.yaml`（agent 默认 env_vars）
- 这一步**不要在 Slark MVP 内做**——MVP 优先做 routa B-2 的最小版（仅 system_prompt + role_reminder），Multica 的"完整 Skill 包"思路放 P1+ 评估

**与 Multica 的差异（如果未来落地）**:

- ❌ **不做 Skill Marketplace**（云端分享）：Slark 单用户，没有"团队共享" 场景。Sprint 8+ R-21 才会讨论
- ❌ **不做 schema.sql 嵌入 Skill**：Slark 的 `decisions` / `lessons` 已经在数据库里，Skill 不需要带 schema
- ✅ **保留"templates/" 思想**：Agent Template 可以带提交 / PR 模板等附属文件

**收益**:

- 让 routa B-2 的落地形式更丰满（不只是 prompt 字段）
- 为 Sprint 8+ R-21（Workflow / Team Template Marketplace）准备结构

**结论**: **本条不单独立项**，作为 routa B-2 实施时的"附加考虑项"。在 routa-analysis.md B-2 落地时回看本条。

---

#### B-5：Tool Call 实时折叠展开 UI（已部分实现 / 视觉精细化）

- **价值**: ⭐⭐⭐（中）
- **成本**: ⭐（低，主要是前端样式）
- **建议时机**: 任意时候 UI 打磨阶段

**Slark 现状**: Sprint 4-ext（Cursor SDK Adapter 旁路）的 S-3 已经实现 `summarizeToolArgs`，给 Activity Tab 输出 `Shell: ls -la /path` 风格摘要。功能已落地。

**Multica 启发**: 实时进度卡片中 tool calls 折叠展开的视觉密度——用户能"扫一眼"知道 agent 干了什么，"点开看"了解细节。

```text
Agent is working                                  7m 17s · 10 tool calls

Analyzing the error handling patterns across all 14 handler files…
Read    server/internal/handler/issue.go         result: func (h *IssueHandler) Create(...)
Edit    server/internal/handler/issue.go — replace writeJSON error calls
                                                  result: Updated 3 error responses
Now checking handler/comment.go for the same inconsistent patterns…
Read    server/internal/handler/comment.go       result: func (h *CommentHandler) Create(...)
Bash    go test ./internal/handler/ -run TestErrorResponses
                                                  result: ok ... 0.847s

Task execution history
  Set up error response types          2m 14s
  Migrate issue handler                3m 41s
  Migrate comment handler              1m 22s
```

**Slark 可以借鉴的精细化点**:

1. **顶部摘要**: `7m 17s · 10 tool calls`（让用户立即知道总耗时和工具调用数）
2. **每个 tool call 双行显示**: 第一行是 tool name + 简化 args，第二行是 result 摘要
3. **底部 "Task execution history"**: 把整个 task 拆成几个阶段，显示每阶段耗时

**对照 Slark 当前 Activity Tab**:

- ✅ 摘要已有（`Shell: ls -la /path` 风格）
- ❌ result 摘要没显式渲染（需要展开看 raw output）
- ❌ 阶段拆分没有（Slark 的 message 是一个整块）

**建议落地**: 主要是 UI 改进，不需要 schema 改动。

**收益**: 视觉密度更高，用户对 Agent 当前进度的感知更强。

**结论**: 列入 `docs/optimization-backlog.md` O-N（建议 🟢 低优先级）。

---

### 5.3 P2（不做 / 长期争议）

---

#### B-6：GitHub Issue 双向同步（不做）

- **价值**: ⭐⭐（低）
- **成本**: ⭐⭐⭐⭐（高）
- **建议时机**: 不做

**Multica 启发**: Multica issues + GitHub 整合（隐含在"和真人 + Agent 一起协作"语义里）。

**为什么 Slark 不做**:

- Slark 单用户工具，不需要团队 issue tracker
- product-brief N-6 明确不做企业审计 / 合规日志
- 引入 GitHub OAuth + webhook 同步会引入大量 surface area

**Slark 的替代**: 用 Slark 自己的 Tasks 面板（吃自己的狗粮）。

---

#### B-7：看板视图（明确不做）

- **价值**: ⭐（低 / 与定位冲突）
- **成本**: ⭐⭐⭐（中-高）
- **建议时机**: 永远不做

**Multica 启发**: Issue 看板是核心 UI 入口。

**为什么 Slark 不做**:

- Slark 刻意选择"Slack 式聊天室"隐喻（product-brief §1）
- 已在 routa-analysis.md §6.4 明确 "Kanban 作为核心 UI" 不做
- product-brief R-19（跨 Project 全局看板）是 P2 远期 / 可能永远不做

**Slark 的边界**: Tasks 是**对话的附属产物**，不是驱动器。

---

#### B-8：Cloud + Multi-tenant 模型（不做）

- **价值**: ⭐（与定位根本冲突）
- **成本**: ⭐⭐⭐⭐⭐（极高）
- **建议时机**: 永远不做

**Multica 启发**: Cloud-first（multica.ai SaaS）+ Self-host 双形态。

**为什么 Slark 不做**:

- product-brief N-1（多用户）+ N-2（云端托管）+ N-7（多机分布式）三条明确不做
- Slark 的核心卖点是"数据本地、完全可审计、无 vendor lock-in"
- 引入 Cloud 会带来认证 / 计费 / 多租户隔离等数百小时工作

**Slark 的边界**: 永远是本地优先 + 单用户 + 单实例。

---

## 六、不建议照搬的点（明确边界）

### 6.1 ❌ Postgres + pgvector 数据库

**Multica 做法**: PostgreSQL 17 + pgvector（暗示 RAG / 语义搜索）。

**为什么不建议 Slark 做**:

- product-brief D-8 / N-12 明确 "本地化 SQLite + 不做向量索引 / 语义搜索"
- pgvector 适合云端 / 服务器，本地工具引入 Postgres 是巨大的运维负担
- Slark 的 ContextBuilder 用 audience 标签 + 关键词过滤已经够用（lessons / decisions 注入按 audience 分组）
- 切换数据库的迁移成本巨大（已有 schema_version → 9）

**Slark 的替代**:

- 保留 SQLite（D-8）
- 如果未来真需要语义搜索（产品已成熟、用户量大），可以走 SQLite 的 [`sqlite-vss`](https://github.com/asg017/sqlite-vss) 或 [`sqlite-vec`](https://github.com/asg017/sqlite-vec) 扩展，**不用切 Postgres**

### 6.2 ❌ Go 后端

**Multica 做法**: Go（Chi router + sqlc + gorilla/websocket）。

**为什么不建议**:

- Slark 已选 Node.js（Fastify + ws + better-sqlite3），生态完整
- Go 的优势在于性能 + 静态编译分发，但 Slark 单用户工具不需要那种性能
- 重写后端是几百小时工作，没有 ROI

**Slark 的替代**: 保留 Node.js 单后端（D-10）。

### 6.3 ❌ Daemon 长驻 + 多机器 Runtime

**Multica 做法**: Daemon 是独立进程，与 server 通过 OAuth + WebSocket 通信；每台机器一个 daemon = 一组 Runtime。

**为什么不建议**:

- product-brief N-7 明确不做多机器分布式部署
- Slark 是单进程后端 + spawn-per-message，不需要 daemon
- "本机就是 runtime" 比 "daemon 上报 runtime" 简单

**Slark 的替代**:

- 保留 server 直接 spawn 子进程
- B-1 借鉴的是"自动检测 CLI"思想，**不引入 daemon 进程**

### 6.4 ❌ Issue-first / Kanban 隐喻

详见 §5.3 B-7。

### 6.5 ❌ Skill Marketplace / 公开分享

**Multica 暗示**: Skill 可以跨 workspace / 跨用户分享（`author` 字段 + `version` 字段）。

**为什么不建议短期做**:

- Slark 单用户，没有"分享"场景
- Sprint 8+ R-21（Marketplace）是远期 P2，且只是设想
- 引入分享会带来"信任 / 审核 / 版本管理"等大量复杂度

**Slark 的替代**:

- Sprint 8+ R-22（`.slark/team.yaml` Project 级 Agent 定义，git 可追踪）已经是低成本的"分享"机制
- 真要做 Marketplace 时再回看本条

### 6.6 ❌ 多用户 / 权限 / Workspace 多团队

**Multica 做法**: Members + Roles + Workspace 多团队隔离。

**为什么不建议**:

- product-brief N-1 / N-2 / N-6 三条明确禁止
- Slark 的 "Project" ≠ Multica 的 "Workspace"——Slark 的 Project 是"项目空间"（绑代码仓库），Multica 的 Workspace 是"多团队工作空间"
- 同名不同义，**警惕命名混淆**

**Slark 的替代**: Project 级隔离（D-2）已经足够。永远不引入 Members / Roles。

### 6.7 ❌ Cloud OAuth 认证

**Multica 做法**: `multica setup` 调用 OAuth（开浏览器登录 multica.ai）。

**为什么不建议**:

- Slark 本地工具，不需要后端服务
- 引入 OAuth = 需要服务器端 + 数据库 + 用户管理，违背"本地优先"

**Slark 的替代**: 无认证（本地单用户），CLI 工具自己处理认证（如 `cursor login`，N-3 已规范）。

---

## 七、行动建议

### 7.1 立刻可做（本周）

无。Multica 的借鉴点都在 Sprint 8+ 远期，**当前 Sprint 不需要任何动作**。

### 7.2 短期规划（Sprint 8+ 启动前）

**新增到 `PLAN.md` Sprint 8+ 路线（按优先级）**:

| 编号 | 借鉴点 | 战略价值 | 涉及现有路线 |
|------|--------|---------|-------------|
| **B-1**（multica）| Multi-Runtime 自动发现 | R-18 落地的关键设计 | **R-18 必读** |
| **B-2**（multica）| Workflow Run Activity 统一视图 | UI 叙事一致性 | R-19 / 优化项 |
| **B-3**（multica）| 一键安装脚本 + slark CLI | 试用门槛降低 | R-23 之前的过渡 |

**待加入 `docs/optimization-backlog.md`（建议 🟡 中优先级）**:

- O-N：Workflow Run Timeline 视图（B-2）
- O-N：install.sh + slark CLI（B-3）
- O-N：Tool Call 实时折叠展开 UI 精细化（B-5）

**待加入 `PLAN.md` 启动前 checklist**:

- 在 §"Sprint 启动前必做 checklist" 加一条："扫一遍 [`docs/research/multica-analysis.md`](docs/research/multica-analysis.md)，检查有无待兑现的 B-N"
- 这一条已在 routa-analysis.md / clawteam-comparison.md 都有要求，新增 multica 后保持一致

### 7.3 长期规划（Sprint 8+ 内 / 远期）

**R-18（Codex / Claude Code 多 runtime 适配）启动时**:

1. 直接套用 B-1 的 `runtime-discovery.ts` 设计
2. Create Agent UI 改造按 B-1 §"Step 3" 设计
3. 在 `technical-decisions.md` 新增 D-N: Runtime Discovery

**R-23（Electron / Tauri 打包）之前**:

1. 先做 B-3 的 install.sh + slark CLI 过渡方案
2. 等 R-23 真正打包后此方案可以淘汰

**routa B-2（Agent Template）落地时**:

1. 回看本文 B-4，把 Multica 的"templates/" 思路整合进 Agent Template 的文件结构
2. **不做 Marketplace**

### 7.4 需要警惕的陷阱

在任何时候引入 multica 借鉴点之前，问一遍：

- [ ] **这个功能会让 Slark 偏离"本地单用户"定位吗？** 如果会，拒绝（§6.5 / §6.6 / §6.7 都是这类）
- [ ] **这个功能要求引入云端服务 / OAuth / 多用户？** 如果是，拒绝
- [ ] **这个功能会让"聊天室" 隐喻变弱、"看板" 变强吗？** 如果是，拒绝（§6.4）
- [ ] **这个功能要求切换数据库 / 后端语言？** 如果是，拒绝（§6.1 / §6.2）
- [ ] **这个功能能不能用 Slark 已有的设计承载？** 如果能，**不引入新概念**（B-4 是个例子——已被 routa B-2 + clawteam B-4 覆盖）

---

## 八、附录

### 8.1 Multica 文档关键链接

| 文档 | 链接 |
|------|------|
| Repo | <https://github.com/multica-ai/multica> |
| README.md | <https://github.com/multica-ai/multica/blob/main/README.md> |
| README.zh-CN.md | <https://github.com/multica-ai/multica/blob/main/README.zh-CN.md> |
| 官网 | <https://multica.ai/> |
| Self-Hosting Guide | <https://github.com/multica-ai/multica/blob/main/SELF_HOSTING.md> |
| Contributing Guide | <https://github.com/multica-ai/multica/blob/main/CONTRIBUTING.md> |
| CLI and Daemon Guide | <https://github.com/multica-ai/multica/blob/main/CLI_AND_DAEMON.md> |
| Releases | <https://github.com/multica-ai/multica/releases> |

### 8.2 借鉴点速查表

| 编号 | 借鉴点 | 价值 | 成本 | 优先级 | 建议时机 |
|------|--------|------|------|--------|---------|
| **B-1** | Multi-Runtime 自动发现 | ⭐⭐⭐⭐⭐ | ⭐⭐ | **P0** | Sprint 8+ R-18 启动时 |
| **B-2** | Workflow Run Activity 统一视图 | ⭐⭐⭐⭐ | ⭐⭐ | **P0** | Sprint 8+ UI 重构时 |
| **B-3** | 一键安装脚本 + slark CLI | ⭐⭐⭐ | ⭐⭐ | **P0** | Sprint 8+ R-23 之前 |
| **B-4** | Skill 文件外化（templates/ 思路） | ⭐⭐⭐⭐ | ⭐⭐⭐ | P1 | routa B-2 落地时合并讨论 |
| **B-5** | Tool Call 折叠展开 UI 精细化 | ⭐⭐⭐ | ⭐ | P1 | UI 打磨阶段 |
| **B-6** | GitHub Issue 双向同步 | ⭐⭐ | ⭐⭐⭐⭐ | P2 / 不做 | - |
| **B-7** | 看板视图 | ⭐ | ⭐⭐⭐ | ⛔ 不做 | - |
| **B-8** | Cloud + Multi-tenant | ⭐ | ⭐⭐⭐⭐⭐ | ⛔ 永远不做 | - |

### 8.3 Slark vs Multica 快速对比总结

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│    Slark 的定位（永远不变）           Multica 的定位          │
│                                                              │
│    ───────────────────────           ────────────────────    │
│                                                              │
│    本地单用户 OS                       云端多用户管理平台      │
│    Slack 式聊天室隐喻                  Linear 式看板隐喻       │
│    Goal → AI 推 Team → Workflow        Issue → Assign → Done  │
│    Cursor CLI（远期多 runtime）        11 种 CLI 自动检测      │
│    SQLite 单文件                       Postgres + pgvector     │
│    Node.js + Fastify                   Go + Chi               │
│    无 daemon（spawn-per-message）      Daemon-managed Runtime │
│    Coach 演化 description              手写 Skill 包          │
│    Scribe 自动沉淀知识                  弱（无明显沉淀机制）   │
│    暖黄 Neo-Brutalism                  （未强调视觉风格）      │
│    免费开源（无云）                     开源 + Cloud SaaS      │
│                                                              │
│    === 共同点 ===                                             │
│    多 Agent 编程协作 / Workspace-level 隔离 / WebSocket 进度   │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 8.4 Slark 相对 Multica 的核心差异化（要保住）

按重要性排序：

1. **Goal → Team AI 自动推导**（Multica 是手动创建 Agent）
2. **Workflow YAML + Facilitator 协同设计**（Multica 是固定的 Issue 状态流）
3. **Scribe 自动沉淀 decisions / lessons + Coach 演化 Agent description**（Multica 没有这层"团队成长"机制）
4. **6 Layer 系统化运营机制 + 4 Loop 闭环**（Multica 是平铺的 Issue + Skill）
5. **本地优先 + 完全可审计 + 数据本地化**（Multica 是 Cloud-first）
6. **Slack 聊天室隐喻 + Neo-Brutalism 暖黄风**（Multica 是 Linear 式看板，无强视觉锚点）

### 8.5 Slark 相对 Multica 的劣势（值得改进的点）

按可改进性排序：

1. **多 CLI 支持窄**：Multica 11 个 CLI 自动检测，Slark 只 1 个 → **B-1 已规划**
2. **安装体验差**：Multica `brew install` 一句话，Slark 需要 dev mode → **B-3 已规划**
3. **Workflow 叙事分散**：Multica 一个 Activity Timeline 看全貌，Slark 三个视图分散 → **B-2 已规划**
4. **市场认知度**：Multica ~20k stars，Slark 是新项目 → 不在本调研范围

### 8.6 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v0.1 | 2026-05-08 | 初版：基于 multica main 分支截至 2026-05-08（v0.2.16 release）+ 7 条借鉴条目（B-1~B-8）+ 7 条不建议照搬条目 |

---

**本文档的使用说明**：
- 阅读顺序建议：先读 §一（TL;DR）和 §四（定位差异），再读 §五（借鉴点），最后读 §六（不建议借鉴）
- 修订原则：Multica 发布重大变更时同步更新；Slark 落地某个借鉴点后在 §七行动建议中标记状态
- 关联文档：[`docs/research/routa-analysis.md`](./routa-analysis.md) / [`docs/clawteam-comparison.md`](../clawteam-comparison.md)（同类调研，B-N 编号空间独立）
