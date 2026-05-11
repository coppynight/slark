# Slark

> **Programmable AI Team OS** — 本地可编程 AI 团队操作系统。
> 你设定 Goal，AI 自动配备 Team，团队自己设计 Workflow，系统持续沉淀经验。
> Agent 能力由 **Cursor CLI / Codex CLI** 驱动，无需 MCP、数据 100% 本地存储。

## ✨ 特性

- 🎯 **Goal → AI Team** — 填写 Goal + Workspace，Team Architect 3 分钟内推荐一个可用的 AI 工程团队
- 🟡 **1:1 还原 slock.ai UI** — Neo-Brutalism 风格（暖黄侧边栏 / 奶油主区 / 2px 黑边 / 粉色 CTA）
- 🤖 **多 Agent 协作** — 通过 `@mention` 在频道/Thread 内触发任意 Agent
- 🔗 **链式触发 + Thread 隔离** — Agent 之间互相 `@mention` 自动形成 Thread 对话，主线保持整洁
- 📦 **Project 一等公民** — 每个 Project 绑定独立 workspace，Channels / Agents / Tasks 完全隔离
- 📝 **Tasks 管理** — 频道内 Tasks Tab + 全局 Kanban 看板 + 状态变更系统消息
- 🔍 **全文搜索 / 收藏 / 全局 Threads 聚合**
- 💾 **100% 本地** — SQLite 存储在 `~/.slark/slark.db`，不经任何云端服务器
- 🛠️ **适配器架构** — 支持 Cursor CLI / Cursor SDK / Codex CLI，后续可扩展 Claude Code / 其他 runtime

## 🚀 快速开始

### 前置

- **Node.js ≥ 20**, **pnpm ≥ 10**
- 至少一个本地 coding runtime 已安装并登录：
  - **Codex CLI** (`codex`)
  - **[Cursor CLI](https://cursor.sh)** (`cursor-agent`) 或 Settings 中配置 Cursor SDK API key
  - 其他 runtime（Claude / Kimi / Copilot / Gemini）在 UI 中标为 "coming soon"

### 启动

```bash
pnpm install
pnpm dev                # 并发启动前后端

# 然后访问
# → http://localhost:4178   前端 UI
# → http://127.0.0.1:4179   后端 API + WebSocket
```

首次启动会：
- 在 `~/.slark/slark.db` 创建 SQLite 数据库（不预置任何 Project / Channel / Agent）
- 浏览器打开 → **Welcome 页**引导 `+ Create your first Project`
- Create Project 三步向导：填 Goal + Workspace → Team Architect 推荐团队 → Approve 即用

### 常用命令

```bash
pnpm dev             # 并发启动前后端
pnpm dev:web         # 仅前端（Vite @ 4178）
pnpm dev:server      # 仅后端（Fastify + tsx watch @ 4179）

pnpm build           # 递归构建所有 packages
pnpm typecheck       # 递归类型检查
pnpm lint            # ESLint
pnpm format          # Prettier
```

### 快捷键

- `⌘/Ctrl + K` — 全局搜索
- `Enter` — 发送消息
- `⌘/Ctrl + Enter` — 多行字段保存（Agent Profile 内联编辑等）
- `Esc` — 关闭对话框

## 🏗️ 架构

```
┌──────────────┬─────────────────────┬────────────────────┐
│  Web (React) │  WebSocket + REST   │  Server (Fastify)  │
│  4178        │  ← → + /api/*       │  4179              │
└──────────────┴─────────────────────┴────────────────────┘
                                               │
                                               ↓
                              ┌────────────┬────────────────┐
                              │  SQLite    │  CLI Bridge    │
                              │ ~/.slark   │  codex/cursor  │
                              │ /slark.db  │  spawn + NDJSON│
                              └────────────┴────────────────┘
```

### 五个核心模块

- **M1 — CLI Bridge** (`packages/server/src/agents/`) 替代 MCP，通过 `spawn + NDJSON` 与 CLI 工具通信
- **M2 — Agent Engine** 上下文构建（description + 团队列表 + 对话历史 + token 预算裁剪）+ 状态机
- **M3 — Message Bus** (`packages/server/src/messaging/`) WebSocket + @mention 解析 + 链式触发 + Thread 管理
- **M4 — Data Layer** (`packages/server/src/db/`) SQLite（projects / channels / agents / channel_agents / messages / tasks / agent_runs / agent_activity / saved_messages / meta） + Repository 封装
- **M5 — Frontend UI** (`packages/web/src/`) React 19 + Tailwind v4 + Zustand + Radix

## 📂 目录结构

```
slark/
├── packages/
│   ├── web/              # React 19 + Vite + Tailwind v4 前端
│   ├── server/           # Fastify + ws + better-sqlite3 后端
│   └── shared/           # 前后端共享类型、常量、事件协议
├── spike/                # Phase 0 CLI Bridge 技术验证产物
├── docs/
│   ├── project-status.md         # ★ 当前状态唯一来源
│   ├── product-brief.md          # 战略层文档
│   ├── sprint1-milestone.md      # Sprint 1 交付记录
│   ├── technical-decisions.md    # 默认决策（D-1~D-20）
│   ├── optimization-backlog.md   # 未排期优化（O-N）
│   ├── clawteam-comparison.md    # ClawTeam 借鉴（B-N）
│   ├── research/routa-analysis.md
│   ├── phase0-cli-spike.md       # Phase 0 验证计划
│   ├── cli-event-format.md       # CLI 事件格式对照
│   └── ui-reference/             # UI 基准（17 张截图 + 4 份规范）
├── PLAN.md               # 战术执行计划（当前 + 未来 Sprint）
├── pnpm-workspace.yaml
└── package.json
```

## 📖 核心文档

| 文档 | 用途 |
|------|------|
| **[docs/project-status.md](docs/project-status.md)** | **当前状态唯一来源** — 当前 Sprint / 阻塞 / 技术债 / 下一步 |
| [PLAN.md](PLAN.md) | 战术执行计划 — 当前 + 未来 Sprint 的范围与验收 |
| [docs/product-brief.md](docs/product-brief.md) | 战略层：产品定位 / 目标用户 / 核心决策 / 非目标 |
| [docs/sprint1-milestone.md](docs/sprint1-milestone.md) | Sprint 1 历史交付记录 + 手动验收 runbook |
| [docs/technical-decisions.md](docs/technical-decisions.md) | 状态机、Token 预算、并发、错误 UI 等默认决策（D-N） |
| [docs/optimization-backlog.md](docs/optimization-backlog.md) | 已决定但尚未排期的优化清单（O-N） |
| [docs/clawteam-comparison.md](docs/clawteam-comparison.md) | 调研：[HKUDS/ClawTeam](https://github.com/HKUDS/ClawTeam) 借鉴条目 |
| [docs/research/routa-analysis.md](docs/research/routa-analysis.md) | 调研：[phodal/routa](https://github.com/phodal/routa) 借鉴条目 |
| [docs/cli-event-format.md](docs/cli-event-format.md) | 三个 CLI 的事件格式对照 |
| [docs/ui-reference/README.md](docs/ui-reference/README.md) | UI 视觉基准（17 张真实截图 + 4 份规范） |
| [spike/README.md](spike/README.md) | Phase 0 CLI 验证结果总结 |

## 🧪 已完成路线

- ✅ **Phase 0 / 0.5** — CLI Spike + UI 基准采集
- ✅ **v0 MVP** — Monorepo 骨架 / SQLite / Cursor 适配器 / 链式触发 / Thread / Tasks / 全局视图
- ✅ **Sprint 1** — Foundation + Goal → AI Team（`projects` 一等公民 / Team Architect / Create Project 向导）

当前焦点：**Sprint 2 — Workflow Framework**（详见 [docs/project-status.md](docs/project-status.md)）。

## 📜 许可

MIT — 详见 [LICENSE](LICENSE)
