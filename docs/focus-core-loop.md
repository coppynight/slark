# Focus: Core Loop（前期聚焦——核心使用闭环）

> **本文档的角色**：Slark 当前阶段的**临时收敛锚点**，回答"**Sprint 8+ 接下来该排什么、不排什么**"。
>
> **不替代**[`product-brief.md`](product-brief.md)（战略北极星）和 [`PLAN.md`](../PLAN.md)（战术路线图），而是给两者**临时套一层"前期聚焦"的滤镜**。
>
> **退出条件**：当 §3 7 步闭环全部达到"绿"或主路径上没有明显卡点后，本文档归档，回到 PLAN.md Sprint 8+ 原排序（广度扩展）。

**生效日期**：2026-05-12
**最近更新**：2026-05-12（v0.2：基于 [dogfood 第一轮](dogfood/2026-05-12-round-1.md) 26 条观察更新——含 Lo-26 紧急阻塞 + Lo-25 战略 pivot）

---

## 1. 方向一句话

> **前期暂停 Sprint 8+ 的"广度扩展"（Marketplace / 多 runtime / Electron / 跨 Project 经验迁移…），先把 Slark 自身的"核心使用闭环"打磨到日常顺手——让用户能用 Slark 推进一个真实项目，并在使用过程中持续迭代团队、提升项目质量。**

**关键词**：

- **聚焦** 而非否定：Sprint 8+ 远期项不删除，只重排
- **闭环** 而非功能：以"使用者跑通一圈"为单位评估，不以"功能列表"为单位
- **深度** 而非广度：先把内核打透，再谈外延

---

## 2. 为什么现在做这次收敛？

| 信号 | 说明 |
|------|------|
| **MVP（Sprint 1~7）已交付** | 机制层（Goal→Team→Workflow→Scribe→Coach→Onboarder→Facilitator）已经齐备，6 个 System Agent 全到位 |
| **Per-Project Storage 重构刚收口** | 数据层稳定（D-21~D-25），是打磨闭环最稳的窗口期 |
| **Sprint 8+ 原排序是"广度优先"** | R-18 多 runtime / R-19 跨 Project / R-21 Marketplace / B-1 Worktree…—— 全是"再加一层"，但内核闭环还没人真的跑过 100 次 |
| **`learn-fast-loop` 原型已经画好** | 说明"过程反馈→即时 Coach→Apply"这条最薄弱回路在 UX 层已经有方案，缺的是工程落地 |
| **dogfood 缺位** | 项目自己还没有用 Slark 跑过一个完整 sprint —— 不 dogfood 的工具不会有真问题，只有想象问题 |

---

## 3. 核心闭环：7 步 + 现状评估

### 闭环定义（用户口语版）

> **打开项目 → 创建项目团队 → 确定团队初始工作流程 → 运行真实任务 → 基于任务过程和结果进行反馈 → 迭代团队 → 推进项目更高质量的迭代。**

### 7 步对照表

| # | 闭环步骤 | 当前实现 | 关键缺口 | 期望姿势 | 成熟度 |
|---|---|---|---|---|---|
| **L1** | 打开项目 | `OpenProjectDialog` → `<workspace>/.slark/` 自动 seed | 无明显缺口 | 保持 | ✅ 绿 |
| **L2** | 创建团队 | Team Architect 从 Goal 推 3~5 个 Agent + 兜底三件套 | Team Architect 推荐质量在长 Goal / 多技术栈下不稳；用户 Customize 时缺"加一个 / 删一个 / 换 runtime"的快速操作 | 推荐稳定 + 一键微调 | 🟡 黄 |
| **L3** | 初始 Workflow | 3 内置模板 + `Facilitator ✨ From Team Discussion`（single-shot） | Facilitator 是"模拟 round-table"非真多轮；模板覆盖窄（feature-development / bug-fix / research）；用户对"该选哪个"无指引 | Facilitator 真多轮 + 模板推荐 + "我没有 Workflow 就直接 @ 行不行" 的轻路径 | 🟡 黄 |
| **L4** | 运行真实任务 | `@mention` / Tasks Tab / Workflow Runner / 链式触发 / Thread 隔离 | TD-8 长输出截断、TD-12 `running` 状态无法 `/override`、Activity 噪音、单消息 5 分钟 timeout 在长任务里偏紧 | "能跑" → "好跑"，长任务不丢失、过程可中断不破坏状态 | 🟡 黄 |
| **L5** | **过程反馈** | Activity Tab（仅观察） | **没有"用户在过程中主动给反馈"的姿势**——只有事后异步的 Evaluator/Coach | 消息级 inline 👍/👎 + 一行原因 → 立即写入 `agent_feedback` | 🔴 红 |
| **L6** | **结果反馈 + 迭代团队** | Scribe 自动沉淀 decisions/lessons；Coach 24h cron 提 description diff；FEEDBACK Tab Apply/Rollback | **回路慢且单向**：24h 异步 + 入口在 Agent Profile 深处，"团队级"迭代视图缺失；`/reject` reason 不沉淀（TD-9） | 阈值即时 Coach（连续 N 次同方向反馈即触发）+ 团队级 dashboard + reject 也沉淀 | 🟡 黄 |
| **L7** | 项目高质量迭代 | （无统一观测面） | 缺一个"我的项目这周学到了什么 / Agent 变强了哪里 / 还卡在哪"的整合视图 | Project Intelligence 升级为"学习速率仪表盘" | 🔴 红 |

### 一句话总结

> **闭环前半段（L1~L4）基本到位但有打磨空间；卡点在 L5~L7——反馈与迭代的"内回路"不够短、不够顺、不够日常。** Sprint 4/5 给了机制，但都是异步/事后；缺一个"日常使用中即时回路"的入口（这正是 `learn-fast-loop.html` 原型在解决的事）。

### v0.2 update —— dogfood 第一轮（2026-05-12）实测对照

| 步骤 | v0.1 预测 | 实测 | 关键差异 |
|---|---|---|---|
| L1 | ✅ 绿 | 🟡 黄 | 跑通但 4 条 UX 卡点（Lo-2/3/6/9）；Lo-9 真 bug |
| L2 | 🟡 黄 | 🟡 黄 | 推荐质量爆表，但 Goal 输入路径割裂 + Lo-16 无进度反馈 |
| L3 | 🟡 黄 | 🟡 黄 | Workflows 页无 Run 入口（Lo-19）|
| L4 | 🟡 黄 | 🔴 红 | **Lo-26 紧急阻塞**：workflow YAML `@Dev` 与 Team Architect `@BackendDev` 错位 → 任何 fresh project 必失败 |
| L5 | 🔴 红 | 🟡+🤯 | **金块 Lo-25**：Architect 自带写 `.cursor/rules/*.mdc` 能力——比预期红反而被模型超额完成 |
| L6 | 🟡 黄 | 🔴 红 | Lo-26 阻塞导致 Scribe 没机会触发；但反向强化 Lo-25 战略判断 |
| L7 | 🔴 红 | 🔴 红 | 未到，反推 Project Health Dashboard 视图缺失 |

### 🔥 战略级新发现：Lo-25（Slark 知识层 vs Cursor `.cursor/rules/`）

dogfood L5 reject "Buy milk" 示例数据时，**Architect 主动写了 `.cursor/rules/sample-data-taste.mdc`**（1240 字节，反例 5 + 正例 6 + 适用范围 4 + 给 AI agent 指引），且 `alwaysApply: true` 立即对所有后续 cursor-agent 生效。

**职责对照**：

| 维度 | Slark 设计（lessons.jsonl） | Cursor 原生（`.cursor/rules/*.mdc`）|
|---|---|---|
| 沉淀路径 | reject → Scribe → jsonl | Architect 第一人称写 mdc |
| 数据格式 | JSONL 单行 | Markdown + frontmatter + 结构化条款 |
| 生效机制 | ContextBuilder 加载 | Cursor 原生 `alwaysApply` |
| 跨 agent | Slark 团队内 | 任何用 `<workspace>` 的 cursor 工具 |
| 用户编辑 | 必须经 Slark UI | IDE 直接编辑 mdc |

**结论**：模型自带能力 > Slark 设计能力。Slark 应**pivot 到"组织和管理 `.cursor/rules/*.mdc`"**，不重新发明知识层。

### 🚨 紧急阻塞 Lo-26（先于一切战略）

Workflow YAML 模板（feature-development）硬编码 `@Dev`，Team Architect 自由命名 `@BackendDev` → workflow step 2 implement 直接 fail。任何 fresh project 的 L4 都跑不通。

**修复方案 A**（推荐）：workflow YAML 用**角色占位符** `@implementer / @reviewer / @qa`，runtime 由 messageRouter 按 team 角色映射到具体 agent name。

---

## 4. 前期收敛范围（What's In / What's Out）

### v0.2 战略 pivot 摘要

基于 dogfood 第一轮 Lo-25 发现，G1~G4 的实施方向**全部需要 pivot**：

| 组别 | v0.1 思路 | v0.2 pivot 后 |
|---|---|---|
| **G0**（v0.2 新增）🚨 | — | **修 Lo-26 workflow 命名错位**（先决条件，否则其他都跑不动）|
| **G1 反馈姿势** | reject reason 入 lessons.jsonl 候选 | reject reason 入 **`.mdc` 草稿候选**（Pending Queue 渲染 mdc 预览）|
| **G2 即时回路** | Coach 提 lesson edit 建议 | Coach 提 **`.mdc` rule 草稿**（一键写入 `.cursor/rules/`）|
| **G3 真实任务体验** | 不变（仍然是 TD-8/TD-12/timeout/降噪）| 不变 |
| **G4 团队级视图** | Intelligence Tab = lessons review | **Intelligence Tab = Rules Dashboard**（mdc CRUD + 启用/禁用 + 来源追溯）|

### ✅ In —— 纳入"前期"的工作（v0.2 修订）

| 组别 | 对应闭环步骤 | 代表性工作（v0.2）|
|------|------|------|
| **G0 命名错位修复** 🚨 | L3/L4 | Workflow YAML 改角色占位符 `@implementer/@reviewer/@qa` + messageRouter 角色映射 + 单测覆盖（Lo-26）|
| **G1 反馈姿势** | L5 | 消息级 inline 👍/👎 + reason + `/feedback` 指令；reject reason → **`.mdc` 草稿候选**；落地 `learn-fast-loop.html` 原型 |
| **G2 即时回路** | L5→L6 | Coach 从 24h cron 改为阈值即时触发；右侧 rail panel **"Coach 给的 rule 草稿"**；一键写入 `.cursor/rules/` |
| **G3 真实任务体验** | L4 | TD-8 长输出 token 预算 / TD-12 running 状态 override / Activity 噪音降级 / **Lo-22 spawn 进度可视化**（Architect 60s cold start 必须有进度文案）|
| **G4 团队级视图** | L6→L7 | **Rules Dashboard**（替代原 lesson review）：浏览/编辑/启用/禁用 `.cursor/rules/*.mdc`；Team Health 面板；reject reason 沉淀（TD-9 重定义为 rule 候选）|

### ⏸ Hold —— 显式推迟到"后期"的 Sprint 8+ 远期项

| 项目 | 原优先级 | 推迟理由 |
|------|---------|---------|
| **R-18** 多 runtime（Claude / Kimi / Copilot / Gemini） | 🟡 中 | Codex 已落，Cursor SDK 旁路已落，闭环验证不依赖更多 runtime |
| **R-19** 跨 Project 全局视图 Kanban 升级 | 🟡 中 | Per-Project Storage 已有跨 Project 聚合，UX 打磨可押后 |
| **R-21** Agent / Workflow Template Marketplace | 🟢 低 | 自己都没 dogfood 几次，无内容可分享 |
| **R-22** `.slark/team.yaml` git 可追踪 Agent 定义 | 🟢 低 | 当前 SQLite per-project + knowledge jsonl 已部分覆盖 |
| **R-23** Electron / Tauri 打包 | 🟢 低 | Web 形态已够 dogfood |
| **R-24** Agent 之间主动 DM | 🟢 低 | 闭环价值不直接 |
| **R-25** Project 拖拽 / 收藏 / 归档 | 🟢 低 | 纯 UX 打磨 |
| **跨 Project Lessons / Description 迁移** | 中 | 单 Project 内回路没跑通前不做迁移 |

### 🟢 Keep —— 保留高优先级（属于闭环必需）

| 项目 | 理由 |
|------|------|
| **B-1** Worktree 多 Agent 隔离 | L4 真实多 Agent 并发改代码时必须，否则 Workflow Runner 多 step 并行就翻车 |
| **B-3** 任务依赖图（`blocked_by`） | L4 / L7 整体可视，让"为什么卡住"看得见 |
| **Facilitator 多轮对话**（Q-9 标过 Sprint 8+） | L3 闭环里的 sub-loop，但优先级让位于 G1/G2 反馈姿势 |

---

## 5. 判断准则：怎么决定"这个想法属于前期还是后期"

> 每次有新需求 / 新借鉴条目（B-N） / 新优化（O-N）冒出来时，按这套快速判断：

```
新需求落到哪一格？
┌─────────────────────────────────┬──────────────────────────────────┐
│ ① 直接打磨 L1~L7 任一步 +       │ ② 直接帮 dogfood 跑通真实任务 +   │
│   能在 1~2 周内交付              │   能让用户日常使用更顺            │
├─────────────────────────────────┼──────────────────────────────────┤
│         前期 In                  │         前期 In                   │
└─────────────────────────────────┴──────────────────────────────────┘
┌─────────────────────────────────┬──────────────────────────────────┐
│ ③ "再加一种 runtime / 再加一    │ ④ "未来某天用户群大了会需要"       │
│   层抽象 / 再适配一个平台"       │                                  │
├─────────────────────────────────┼──────────────────────────────────┤
│         后期 Hold                │         后期 Hold                 │
└─────────────────────────────────┴──────────────────────────────────┘
```

**额外快测**：

- 这个需求**让一个还没用过 Slark 的人下周更愿意打开吗**？→ 是 = 前期
- 这个需求**让我们 dogfood 时少卡一次吗**？→ 是 = 前期
- 这个需求**靠"再加一个 Adapter / 一个平台 / 一个 Marketplace"实现**？→ 是 = 后期

---

## 6. Sprint 8+ 重排建议（给 PLAN.md）

旧表（按广度优先，PLAN.md 现状）：

```
R-18 多 runtime → R-19 跨 Project Kanban → B-1 Worktree → Marketplace → …
```

v0.1 表（按 G1→G4 顺序）：

| 顺序 | Sprint 候选 | 主题 |
|------|---------|------|
| Sprint 8 | G1 反馈姿势 + G3 真实任务体验 | 把 L4/L5 跑顺 |
| Sprint 9 | G2 即时回路 + dogfood 第一轮 | 把 L5→L6 接成短回路 |
| Sprint 10 | G4 团队级视图 + B-1 Worktree | 把 L6→L7 闭上 |

### v0.2 表（**G0 先决 → 战略 pivot → 闭环深度**）

| 顺序 | Sprint 候选 | 主题 | 关键交付 | 状态 |
|------|---------|------|---------|------|
| **Sprint 8** | **G0（必须先做）+ G3 真实任务体验** | "**修通才能再跑**" | 修 Lo-26 workflow 命名错位（**S-2 紧急**）/ Architect spawn 进度可视化（Lo-22）/ TD-8 长输出 / TD-12 override / Activity 降噪 | 🚨 紧急 |
| **Sprint 9** | **G1 反馈姿势（pivot v0.2）+ dogfood 第二轮** | "reject reason 显式成 rule 草稿" | 消息 inline 👍/👎 / reject reason → mdc 草稿候选（**S-1c**）/ Pending Queue 改 mdc 预览 / dogfood 第二轮验证 G0 修复 | 🔥 战略 |
| **Sprint 10** | **G2 即时回路 + G4 团队级视图（Rules Dashboard）** | "把 L6→L7 闭上（mdc 路径）" | Coach 阈值即时触发 + 给 rule 草稿 / Rules Dashboard 替代 Pending Queue（**S-1a/b**）/ B-1 Worktree | 🔥 战略 |
| **Sprint 11** | **跨 runtime 适配 + 历史数据迁移** | "守住 runtime-agnostic" | cursor 直接写 .mdc / codex 转译 AGENTS.md / 历史 lessons.jsonl 归档（**S-1d**）| 🔥 战略 |
| Sprint 12+ | 回归 PLAN.md 原 Sprint 8+ 广度路线 | 打开外延 | R-18 / R-19 / R-21 / Facilitator 多轮 / Marketplace | 后续 |

> 上述 Sprint 编号只是占位。每个 Sprint 启动前按 PLAN.md §"Sprint 启动前必做 checklist" 走一遍。
>
> **特别**：Sprint 9 启动**前**必须先跑 dogfood 第二轮，验证 Sprint 8 G0+G3 修复有效（Lo-26 不再阻塞 + Architect 等待体验改善）。

---

## 7. 前期完成判据（何时归档本文档）

满足下列**四条**全部 `true` 时，本文档归档，回到 PLAN.md Sprint 8+ 原排序（v0.2 加第 4 条）：

- [ ] **闭环可演示**：单次 dogfood 完整跑通 L1→L7 七步，**无 workflow fail**（Lo-26 已修），全程无人为绕路，记录"我作为用户的不爽"≤ 3 条
- [ ] **反馈姿势日常化**：连续 1 周使用过程中，用户主动给反馈次数 ≥ 5 次（不是被催出来的），且至少一次产生了 Coach 建议被 Apply
- [ ] **团队级视图可读**：打开 Rules Dashboard（替代旧 Team Health）能在 30 秒内回答"这周我的项目新增了哪些规则 / 哪条 rule 被命中最多 / 哪个 Agent 最该被调整"
- [ ] **（v0.2 新增）知识边界清晰**：Slark Pending Queue / Rules Dashboard 与 Cursor `.cursor/rules/` 不出现"同一条经验在两个仓库"的冗余；用户/AI agent 都能一眼知道"项目级品味偏好"沉淀在哪个文件

> 四条都满足 → 本文档移至 `docs/archive/`，PLAN.md 删掉指向链接，继续广度扩展。
>
> 任一条 6 个月内未满足 → 评估是否方向有误（可能是 product-brief 假设错了），不要傻坚持。

---

## 8. 与现有文档的关系

```
战略层（不变）       product-brief.md（北极星）
                           │
                           ↓ 用"前期聚焦"过滤
                  ┌────────────────────┐
临时锚点（本文档）│ focus-core-loop.md │ ← 当前看这份决定排什么
                  └────────────────────┘
                           │
                           ↓ 体现为
战术层（更新）        PLAN.md（Sprint 8+ 章节按新表重排）
                           │
                           ↓ 状态同步
状态层（更新）   docs/project-status.md（§1 / §5 反映新方向）
```

**冲突时优先级**：`product-brief.md` > `focus-core-loop.md`（本文档）> `PLAN.md` > 其他。

**本文档**不引入新的 D-N / B-N / O-N 编号，只做"分组归位"——具体条目按需进 `optimization-backlog.md` 或 `PLAN.md`。

---

## 9. 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v0.1 | 2026-05-12 | 初版：基于"前期聚焦核心闭环"对齐 + 7 步现状评估 + Sprint 8+ 重排建议 |
| **v0.2** | **2026-05-12** | **基于 [dogfood 第一轮](dogfood/2026-05-12-round-1.md) 26 条观察更新**：<br>· §3.5 加 dogfood 实测对照表 + Lo-25 战略发现 + Lo-26 紧急阻塞<br>· §4 G0 新增 + G1/G2/G4 pivot 到"`.cursor/rules/*.mdc`"<br>· §6 Sprint 8+ 重排：Sprint 8 = G0 紧急 + G3，Sprint 9 = G1 pivot + dogfood r2，Sprint 10 = G2+G4，Sprint 11 = 跨 runtime 适配<br>· §7 加第 4 条退出条件（知识边界清晰） |
