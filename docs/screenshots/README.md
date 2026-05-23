# README 截图采集规范

> **核心原则：少而精，有关键信息即可。** 一张能传递"产品价值"的截图，胜过五张展示空白 UI 的截图。

本目录里所有 `.png` 都用于仓库根 `README.md` 的 "📸 界面预览" 区。**不在 README 中引用的截图请不要放进来。**

## 1. 一票否决：禁止"空状态"截图

历史上曾因贪图覆盖率而塞过 5 张截图，其中 3 张是空状态（空频道 / 空看板 / 空 Threads），除了展示 UI 框架外信息量为零，反而拉低质感。**已撤掉，不要再补回**。

判断标准：**截图能否让一个没用过 Slark 的人看出"它能做什么"？** 不能就别放。

| ❌ 别拍 | ✅ 拍这种 |
|---|---|
| `No messages yet. Try @Agent hello.` | 用户 `@Architect` → Architect `@Dev` → Dev 跑完 reply 的多 Agent 链式对话 |
| 空看板四列 `No tasks` | 看板四列各 2-3 张真实 task 卡片，能看到 assignee chips 与状态流转 |
| 空 Threads 列表 `No threads yet` | 一个展开的 Thread：父消息 + 3-5 条 reply，不同 Agent 头像可见 |
| 没填 Goal 的 Project Settings | Goal 已填 + Team Architect 推荐的三张 Agent 卡片 |
| Onboarder 还在 "分析中…" | Onboarder 跑完，overview + tech_stack chips + conventions 都齐了 |

## 2. 优先级清单（按价值排序）

补图时按这个顺序选场景，**3~5 张封顶**：

| # | 场景 | 文件名 | 必须包含的信息 |
|---|------|--------|--------------|
| 1 | **多 Agent 链式对话**（核心差异化） | `01-multi-agent-chain.png` | ≥ 2 个 Agent 互相 @mention；Thread 入口可见 |
| 2 | **Workflows 列表** | `02-workflows.png` | 3 个内置模板 + trigger command + `From Team Discussion` 按钮 |
| 3 | **Tasks 看板有内容** | `03-tasks-kanban.png` | 四列各 2-3 张卡，assignee chips 可见 |
| 4 | **Thread 隔离三栏视图** | `04-thread-panel.png` | 主线 + Thread panel 并存，演示链式触发 + 主线整洁 |
| 5 | **Open Project Folder** | `05-open-project.png` | 对话框 + 路径示例 + per-project 存储说明 |
| 6 | **Intelligence Tab**（可选） | `06-intelligence.png` | Scribe 沉淀的 decisions / lessons 列表，有 Pending / Approved 状态 |
| 7 | **Agent Profile FEEDBACK Tab**（可选） | `07-feedback-diff.png` | Coach 提议的 description before/after diff，Apply/Reject 按钮可见 |

> 这份清单是**菜单不是任务**——拍其中 3~5 张即可，覆盖"协作 / 流程 / 沉淀-进化"三类信号就够。

## 3. 采集规范

| 项 | 规范 |
|---|------|
| 分辨率 | 视窗 **1440 × 900**（macOS 默认 retina @1x 导出，避免 2x 截图 4MB+） |
| 浏览器 | Chrome / Safari 任一，**关闭** DevTools / 扩展侧栏 |
| 主题 | 默认 Neo-Brutalism 配色，不改 token |
| 文件名 | `NN-kebab-case.png`，两位数字前缀决定 README 渲染顺序 |
| 文件大小 | **< 300KB**。超了用 [TinyPNG](https://tinypng.com/) 或 `pngquant --quality=70-85` 压一下 |
| 隐私 | **不要包含真实用户名 / 路径 / token**。workspace 路径打码或用 `/Users/you/code/demo` 这类示例 |
| 内容 | 必须**有真实数据**（参考第 1 节"一票否决"） |

## 4. 提交流程

```bash
# 1. 拍图，按 §3 规范命名 + 压缩
mv ~/Desktop/screenshot.png docs/screenshots/04-workflow-running.png

# 2. 在仓库根 README.md 的 "📸 界面预览" <table> 中加一栏（或替换占位）
#    保持两栏并排布局；caption 写一句话讲"这张图能看到什么信息"

# 3. PR 标题前缀用 docs:
git commit -m "docs: add workflow-running screenshot"
```

PR 评审时会重点看：

- 截图是否真传递了信息（不是空状态）
- 文件大小是否 < 300KB
- caption 是否一句话讲清"看到什么"
- 是否替换/补充了清单里的项，而不是无序新增

## 5. 当前覆盖状态

| # | 场景 | 状态 |
|---|------|------|
| 1 | 多 Agent 链式对话 | ✅ `01-multi-agent-chain.png` |
| 2 | Workflows 列表 | ✅ `02-workflows.png` |
| 3 | Tasks 看板有内容 | ✅ `03-tasks-kanban.png` |
| 4 | Thread 隔离三栏视图 | ✅ `04-thread-panel.png` |
| 5 | Open Project Folder | ✅ `05-open-project.png` |
| 6 | Intelligence Tab | ⏭️ 可选 |
| 7 | Agent Profile FEEDBACK Tab | ⏭️ 可选 |

### 当前 5 张是如何采集的

1~4 号 demo 数据是用 `/tmp/slark-demo` workspace + sqlite3 直接 INSERT 假对话（OAuth + PKCE 工程场景）造的，没有真的 spawn cursor-agent。这样：
- 截图**完全可重复**：同一个 seed 脚本任何时候都能复现同样的 UI
- 不依赖真实 LLM 调用，省钱省时间
- 内容可控（精挑过的代码块 + 真实工程对话）

如果要复刻：参考 `git log --all --grep=screenshots` 找到当时的 seed 脚本（保存在 `/tmp/seed-demo.sh`，未入仓）。**不要把真实 project 截图直接放进来**——隐私 + 不可复现两个问题。
