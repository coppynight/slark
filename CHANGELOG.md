# Changelog

本文件记录 Slark 对使用者可见的变化。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循语义化版本。

## [0.1.0] - 2026-10-27

首个准备对外标记的版本：本地可编程 AI 团队操作系统。数据留在本机，Agent 由本机已登录的 coding CLI 驱动。Git tag `v0.1.0` 在引入本记录的变更合并后由维护者打，不在本变更里创建。

### 亮点

- **本地优先**：每个项目的数据在 `<workspace>/.slark/`（`project.json`、`slark.db`、`knowledge/*.jsonl`）。全局最近项目列表在 `~/.slark/projects.json`。
- **Cursor 与 Codex**：Cursor CLI（`cursor-agent`）/ Cursor SDK，以及 Codex CLI。系统 Agent 在 Codex 上有兜底。Codex 模型目录从 CLI 读取当前账号可见的模型，不再使用写死列表。
- **Windows**：可以在 Windows 上解析并启动本地 coding CLI，Open Project 接受盘符路径与 UNC 路径。
- **MVP（Sprint 1–7）**：Goal → AI Team、声明式 Workflow、审批与干预、Scribe 沉淀 decisions / lessons、Evaluator / Coach 演化、Onboarding 与 Skill Matrix、Facilitator 主持 Workflow 设计。

### 修复

- 恢复 `better-sqlite3` 在当前 Node 运行时上的原生绑定加载（[#8](https://github.com/coppynight/slark/pull/8)）。

### 已知前提

- Node.js 20 或更高，pnpm 10 或更高。
- 至少安装并登录其中一个：`cursor-agent` 和/或 Codex CLI。
