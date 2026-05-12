# Focus: Core Loop（前期聚焦——核心使用闭环）

> **本文档的角色**：Slark 当前阶段的**临时收敛锚点**，回答"**Sprint 8+ 接下来该排什么、不排什么**"。
>
> **不替代**[`product-brief.md`](product-brief.md)（战略北极星）和 [`PLAN.md`](../PLAN.md)（战术路线图），而是给两者**临时套一层"前期聚焦"的滤镜**。
>
> **退出条件**：当 §3 7 步闭环全部达到"绿"或主路径上没有明显卡点后，本文档归档，回到 PLAN.md Sprint 8+ 原排序（广度扩展）。

**生效日期**：2026-05-12
**最近更新**：2026-05-12（**v0.3 矫正 v0.2 偏激 pivot**：基于"**V1 主变量 + 最小解阻**"决策，回归 product-brief v1.0 "Programmable AI Team OS" 主叙事；Sprint 8 收紧为最小解阻 Lo-26；pivot 幅度待 dogfood r2 数据判断）

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

**v0.2 结论（已被 v0.3 矫正）**：~~Slark 应 pivot 到"组织和管理 `.cursor/rules/*.mdc`"~~

**v0.3 结论**：单次 dogfood 揭示了 Slark 知识层与 Cursor 原生 rules **可能**职责重叠，但**不足以基于一次现象就改主叙事**。判断节点设在 Sprint 9 dogfood r2：

- **如果 r2 再次出现且 Slark Scribe 路径仍冗余** → 启动 mdc pivot（参见 §4 探索备选清单）
- **如果 r2 只是 r1 偶发** → 保持 v0.1 lessons.jsonl 主路径，把"扫描既有 `.cursor/rules/`"作为 L1 辅助能力
- **无论哪种结果**：Slark 主叙事不变（V1 = AI Team Orchestration），知识层只是支撑能力（参见 §9）

### 🚨 紧急阻塞 Lo-26（先于一切战略）

Workflow YAML 模板（feature-development）硬编码 `@Dev`，Team Architect 自由命名 `@BackendDev` → workflow step 2 implement 直接 fail。任何 fresh project 的 L4 都跑不通。

**修复方案 A**（推荐）：workflow YAML 用**角色占位符** `@implementer / @reviewer / @qa`，runtime 由 messageRouter 按 team 角色映射到具体 agent name。

---

## 4. 前期收敛范围（What's In / What's Out）

### v0.3 矫正：把 v0.2 的"全面 pivot"收回成"探索备选"

v0.2 基于 dogfood r1 一次观察就把 G1/G2/G4 全部 pivot 到 `.cursor/rules/*.mdc`，**越界了**：

- product-brief v1.0 主叙事是 **"Programmable AI Team OS"**（V1 = AI Team Orchestration）
- "知识层"只是支撑"团队编排"的能力之一，不是主语
- 一次 dogfood 不足以决定改主叙事；**先解阻让 dogfood r2 能跑完，拿到第二组数据再判断**

v0.3 调整：

| 组别 | v0.1 | v0.2（已被矫正） | **v0.3（当前）** |
|---|---|---|---|
| **G0** 🚨 | — | 修 Lo-26（必做）| **修 Lo-26 + Lo-22（必做，Sprint 8 全部聚焦）**|
| **G1 反馈姿势** | reject reason 入 lessons.jsonl | pivot 到 mdc 草稿 | **保持 v0.1 原方向**；mdc 路径作为 dogfood r2 后再判断的备选 |
| **G2 即时回路** | Coach 阈值即时触发 | Coach 给 mdc 草稿 | **保持 v0.1 原方向**；mdc 路径备选 |
| **G3 真实任务体验** | TD-8/TD-12/timeout/降噪 | 同 v0.1 | **同 v0.1**；Sprint 8 紧急修 Lo-22 是其子集 |
| **G4 团队级视图** | Team Health 仪表盘 | Rules Dashboard | **保持 v0.1 原方向**；Rules Dashboard 备选 |

### ✅ In —— 纳入"前期"的工作（v0.3）

| 组别 | 对应闭环步骤 | 代表性工作 |
|------|------|------|
| **G0 紧急解阻** 🚨 | L3/L4 | **Lo-26 修复**：Workflow YAML 改角色占位符 `@implementer/@reviewer/@qa` + messageRouter 角色映射 + 单测<br>**Lo-22 修复**：Architect cold start spinner / "Architect is thinking..." 进度文案 / token counter / step progress |
| **G1 反馈姿势** | L5 | 消息级 inline 👍/👎 + reason + `/feedback` 指令；`agent_feedback` 表 `source='inline'`；落地 `learn-fast-loop.html` 原型 |
| **G2 即时回路** | L5→L6 | Coach 从 24h cron 改为"阈值即时触发"；右侧 rail panel "Coach suggested edit"；一键 Apply / Reject |
| **G3 真实任务体验** | L4 | TD-8 长输出 token 预算 / TD-12 running 状态 override / Activity 噪音降级 |
| **G4 团队级视图** | L6→L7 | "Team Health" 面板（每个 Agent 的最近 7 天 feedback 趋势）；Project Intelligence 升级为"学习速率"仪表盘；reject reason 沉淀（TD-9）|

### 🔬 待 dogfood r2 验证后判断的"探索备选"

dogfood r1 暴露 Lo-25 的现实（Architect 自带写 `.cursor/rules/*.mdc` 能力）后，以下条目作为**未定的探索方向**记录在案，**Sprint 9 启动前**根据 dogfood r2 数据判断是否要 pivot：

| 备选项 | 触发判断 |
|---|---|
| 把 reject reason → mdc 草稿候选（替代 lesson 候选）| dogfood r2 如果再次出现 "Architect 自己写 mdc" 而 Slark Scribe 路径冗余 |
| Intelligence Tab → Rules Dashboard（mdc CRUD）| 多次 dogfood 显示用户经常想"查我这个项目有哪些 rule"且现在没入口 |
| Scribe 输出格式从 jsonl 改 mdc | Scribe 实际产出能稳定满足 mdc 格式要求 |
| 跨 runtime 适配（codex 转译 AGENTS.md）| 多 runtime 真的成为前期需求（目前 Hold）|

> **判断原则**：dogfood r2 之前**不动 product-brief**；备选项是 v0.3 留的判断口子，不是承诺。

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

### v0.3 表（**最小解阻 → dogfood r2 验证 → 按数据决定 pivot 幅度**）

| 顺序 | Sprint 候选 | 主题 | 关键交付 | 状态 |
|------|---------|------|---------|------|
| **Sprint 8** | **G0 紧急解阻** | "**让 dogfood r2 能跑完**" | (1) Lo-26 Workflow YAML 角色占位符 + messageRouter 映射（**必做，最高优先级**）<br>(2) Lo-22 Architect cold start 进度可视化<br>(3) 顺带捎几条小 bug（Lo-9 delete stale / Lo-13 goal 默认值 / Lo-14 PATCH 不广播） | 🚨 紧急 |
| **Sprint 9** | **dogfood r2 + 按结果决定 pivot 范围** | "**验证再走**" | 跑 dogfood r2 完整 L1→L7；如果 Lo-25 现象**重现且 Slark Scribe 路径仍冗余**，启动 G1/G2/G4 pivot；否则继续 v0.1 原方向（G1 反馈姿势 + `agent_feedback`）| 🔬 判断 |
| Sprint 10+ | 按 Sprint 9 判断结果继续 | — | （取决于 r2 结论：要么 mdc 路径，要么原 lesson 路径，要么混合）| — |

**与 v0.2 表的关键差异**：

- v0.2 把 4 个 Sprint（8/9/10/11）全部排到 mdc pivot —— **越界**
- v0.3 只承诺 1 个 Sprint（**Sprint 8 最小解阻**）—— 然后 dogfood r2 判断
- v0.3 Sprint 9 不是预设方向，是**判断节点**

> 上述 Sprint 编号只是占位。每个 Sprint 启动前按 PLAN.md §"Sprint 启动前必做 checklist" 走一遍。
>
> **特别**：Sprint 8 完成立即跑 dogfood r2，**不要为 r2 做更多准备工作**——保持"刚 fix 完 bug 立即验证"的姿势。

---

## 7. 前期完成判据（何时归档本文档）

满足下列**四条**全部 `true` 时，本文档归档，回到 PLAN.md Sprint 8+ 原排序（v0.3 微调第 3/4 条措辞）：

- [ ] **闭环可演示**：单次 dogfood 完整跑通 L1→L7 七步，**无 workflow fail**（Lo-26 已修），全程无人为绕路，记录"我作为用户的不爽"≤ 3 条
- [ ] **反馈姿势日常化**：连续 1 周使用过程中，用户主动给反馈次数 ≥ 5 次（不是被催出来的），且至少一次产生了 Coach 建议被 Apply
- [ ] **团队级视图可读**：打开 Team Health 面板（或 Sprint 9 判断后选定的 Rules Dashboard）能在 30 秒内回答"这周我的项目新增了哪些经验 / 哪个 Agent 最该被调整"
- [ ] **（v0.3 调整）知识边界判明**：dogfood r2 之后给出明确答案——Slark `agent_feedback` / `lessons.jsonl` 与 Cursor `.cursor/rules/*.mdc` 是 **(a) 替代** / **(b) 互补** / **(c) 分层** 哪种关系；用户和 AI agent 都能一眼知道"项目级品味偏好"该沉淀到哪里

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

## 9. 核心流程 v2 + 独特价值（基于 dogfood r1 + V1 决策定锚）

> **本节是 dogfood r1 后对 product-brief v1.0 主叙事的"实操化补充"**——不替代 product-brief，把"Programmable AI Team OS"翻译成可执行的 7 步流程 + 4 条护城河 + 模型自带能力的边界。

### 9.1 一句话定位（V1 锐句）

> **Slark 解决"一群 AI 一起为一个项目工作并不断学得更好"——不重新发明 AI 写代码（Cursor 已经很好），而是把"团队编排 + 项目记忆 + 反馈回路"做成产品。**

product-brief v1.0 §1 已经写了同样的事（"Programmable AI Team OS"），v0.3 重申是为了在 dogfood r1 揭示"模型自带能力越来越强"之后**主语不被反客为主**：

- 主语**永远**是"一群 AI 为一个项目工作"
- Rules / Feedback / Observability 都是**支撑这个主语的能力**，不是主语
- 即便 Sprint 8+ 可能 pivot 到 `.cursor/rules/*.mdc`，那也只是"团队记忆载体的实现细节"——主叙事不变

### 9.2 模型自带 vs Slark 独特能力（dogfood r1 后的边界）

| 模型自带的（cursor-agent / claude / GPT 已经能做）| Slark 独特能力（模型做不到，Slark 才能补上）|
|---|---|
| 单 agent 跑代码 / 写文件 / 自检 | **多 agent 编排**：Architect / Dev / Reviewer / QA / Scribe / Coach 同时干活、互相 @ 触发 |
| 单次 task 的设计 / 实现 / 反思 | **跨 task 跨 thread 的反馈聚合**：用户连续 5 次嫌 Reviewer 不够细 → 系统看到模式 → 改 Reviewer description |
| 自己写一条 mdc rule 沉淀品味 | **rule / lesson 的组织、追溯、命中统计、人工 review**：agent 自己写的不一定是用户想要的，需要 inspect / approve / 演化 |
| 当前 workspace 内的上下文 | **跨 session / 跨 project 的 team OS 视角**：一组 team 配置可 fork / 复用 / 演化 |
| 单进程跑一个 task | **多 agent 并发不冲突**（B-1 Worktree 隔离）|
| 锁死在 cursor 平台 | **跨 runtime 抽象**：同一份 team.yaml + workflows + rules 跑 cursor / codex / cursor-sdk |

**结论**：Slark 的护城河 = **模型自带能力之上**的能力。Lo-25 揭示 Slark 不应在"重叠区"（rule writer）跟模型卷，而要在"模型做不到区"加深。

### 9.3 修订后的核心流程 v2（dogfood r1 后）

| 步 | v0.1（原 product-brief 假设）| **v2 修订（dogfood r1 后）** | 修订理由 |
|---|---|---|---|
| **L1** 打开项目 | seed `.slark/` | seed `.slark/` + **扫描既有 `.cursor/rules/` 展示** | dogfood r1: 用户工程里可能已经有 cursor rules，应被识别 |
| **L2** 创建团队 | Team Architect 自由命名 agent | Team Architect + **标准化命名约束**（Architect / Dev / Reviewer / QA）| dogfood r1 Lo-26: 自由命名跟 builtin workflow 硬编码冲突 |
| **L3** 初始 Workflow | YAML 硬编码 agent name | YAML 用 **角色占位符** `@implementer/@reviewer/@qa` + 运行时映射 | dogfood r1 Lo-26 修复方向 |
| **L4** 运行真实任务 | spawn 跑就完了 | spawn + **过程可视**（"Architect is thinking... 0:42"）+ token / step progress | dogfood r1 Lo-22: 60s cold start 静默用户以为卡死 |
| **L5** 过程反馈 | reject reason 隐式入 Scribe | inline 👍/👎 + reject reason **立即累积**（先入 `agent_feedback`，不预判去 lesson 还是 rule）| v0.1 + dogfood r1: 不预判去向，让 Sprint 9 决定 |
| **L6** 结果反馈+迭代 | Scribe 写 lessons.jsonl + Coach 给 description diff | **保持 v0.1 路径** + 观察 dogfood r2 中 Architect 是否会再次自己写 `.cursor/rules/` | v0.3: 不基于一次现象就改路径 |
| **L7** 持续提质 | Intelligence Tab 看 lessons | **保持 v0.1 路径** + 加 Project Health 趋势（命中 / 反馈率 / workflow 成功率）| v0.1 已经够，加趋势让 L7 红色降级 |

### 9.4 Slark 独特价值的"主-辅"结构

> 不是平行列 4 个价值，而是**有主语**的结构：V1 主，其他辅。

```
              ┌─────────────────────────────────────┐
              │   V1 (主)  AI Team Orchestration    │
              │   "一群 AI 为一个项目工作"          │
              └─────────────────────────────────────┘
                              │
        ┌───────────────────┼───────────────────┐
        ↓                     ↓                     ↓
  ┌─────────────┐      ┌─────────────┐      ┌─────────────┐
  │ V2 项目记忆 │      │ V3 反馈回路 │      │ V5 观测     │
  │ (lesson /   │      │ (inline /   │      │ (Health /   │
  │  rule       │      │  reject /   │      │  趋势 /     │
  │  组织管理)  │      │  Coach)     │      │  追溯)      │
  └─────────────┘      └─────────────┘      └─────────────┘
                              ↓
                        ┌─────────────┐
                        │ V4 跨 runtime│  (Hold 到 Sprint 11+)
                        │  Portability │
                        └─────────────┘
```

**释义**：

- **V1 主**（团队编排）：Goal → Team → Workflow → Responsibility 全自动 + 多 agent 协作。**这是 Slark 存在的根本理由**——Cursor 单 agent 解决不了"项目级团队协作"
- **V2 辅**（项目记忆）：lessons / rules / decisions 是支撑团队的"集体记忆"。dogfood r1 后留口子可能 pivot 到 `.cursor/rules/`，但**记忆服务于团队**，不反客为主
- **V3 辅**（反馈回路）：inline / reject / Coach 让团队随用越好用。"日常使用"是反馈的源头
- **V5 辅**（观测）：Health 趋势 / 命中统计让 L7 可读
- **V4 暂缓**（跨 runtime）：team.yaml 是可移植的，但前期 Hold 到 Sprint 11+

**`product-brief.md` v1.0 §4 差异化的"四个护城河"** 跟这里的 V1/V2/V3 高度对应：

| product-brief §4 护城河 | 本节 V# | 备注 |
|---|---|---|
| 1. Goal → Team AI 配备 | V1 子项 | 团队编排起点 |
| 2. Team 协同设计 Workflow | V1 子项 | 团队编排核心 |
| 3. 运营闭环机制（Scribe/Coach/Evaluator）| V2 + V3 | 项目记忆 + 反馈回路 |
| 4. 本地优先 + 完全可审计 | 横向通用 | 不是单独护城河 |

→ v0.3 不需要改 product-brief；本节是 dogfood 后的**实操对照**。

---

## 10. 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v0.1 | 2026-05-12 | 初版：基于"前期聚焦核心闭环"对齐 + 7 步现状评估 + Sprint 8+ 重排建议 |
| v0.2 | 2026-05-12 | 基于 [dogfood 第一轮](dogfood/2026-05-12-round-1.md) 26 条观察更新：§3.5 加 dogfood 实测对照 + Lo-25 + Lo-26；§4 G1/G2/G4 pivot 到 `.cursor/rules/*.mdc`；§6 4 个 Sprint 全压 mdc pivot；§7 加第 4 条退出条件。**矫正点**：基于一次 dogfood 做了 4 个 Sprint 的方向承诺，**越界** |
| **v0.3** | **2026-05-12** | **基于"V1 + 最小解阻"决策矫正 v0.2 偏激 pivot**：<br>· §3.5 把 Lo-25 "应 pivot" 结论降级为"判断节点设在 Sprint 9 r2"<br>· §4 把 G1/G2/G4 pivot 收回成"v0.1 原方向 + 探索备选清单"<br>· §6 Sprint 8 收紧为最小解阻（Lo-26 + Lo-22），Sprint 9 = dogfood r2 + 按结果判断 pivot 幅度<br>· §7 退出判据第 3/4 条措辞从"Rules Dashboard / 知识边界清晰"调成"Team Health 或 Rules Dashboard / 知识边界判明 a/b/c 关系"<br>· 加 §9 核心流程 v2 + V1 独特价值结构（主-辅）+ 模型自带 vs Slark 边界<br>· 强调"product-brief v1.0 主叙事不变" |
