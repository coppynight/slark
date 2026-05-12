---
description: Slark Issue 工作流 — list / triage / resolve / create 子动作（all-in-one）
---

# /issue — Slark 仓库 Issue 工作流

接受一个子动作参数：`list` / `triage` / `resolve` / `create`（不指定就 `list`）。
所有 GitHub 操作都用 `gh` CLI 走 `coppynight/slark` 仓库。

---

## 用法

```
/issue                          # 列出 open issue + 状态建议（等价于 /issue list）
/issue list                     # 同上
/issue triage <number>          # Triage 指定 issue：归类 / 起草回复 / 必要时建议加 label
/issue resolve <number>         # 像处理 #1 那样：理解需求 → 做改动 → 回复 + close
/issue create                   # 基于当前对话或代码上下文起草并创建一条 issue
```

如果消息里出现了 issue URL（`https://github.com/coppynight/slark/issues/4`），从 URL 解析编号。

---

## 公共上下文

- 仓库：`coppynight/slark`
- Labels：当前仓库 labels 较少，必要时建议（**不直接创建**）以下分类：
  - `type/bug` `type/feature` `type/docs` `type/question` `type/chore`
  - `area/runtime` `area/ui` `area/workflow` `area/agent-engine` `area/storage`
  - `good-first-issue` `help-wanted`
- 仓库的常见信息源（理解 issue 时优先翻这些）：
  - `docs/project-status.md` § 当前状态
  - `docs/technical-decisions.md` D-N
  - `docs/optimization-backlog.md` O-N
  - `docs/sprint{N}-milestone.md`
  - 已合并的 PR：`gh pr list --state merged --limit 10`
- 回复语气：跟仓库现有评论一致（README 用中文、issue 评论可用中文）；务实、不卖弄、不堆 emoji

---

## 子动作 1：`/issue list` (或 `/issue` 无参数)

1. 拉数据：

   ```bash
   gh issue list --state open --json number,title,author,createdAt,comments,labels --limit 30
   ```

2. 每条 issue 一句话标签：
   - `🐛 bug` / `💡 feature` / `📚 docs` / `❓ question` / `🧹 chore`
   - 标注 stale（>30 天无回复）/ unread（owner 还没回过）/ wip（有讨论但无结论）

3. 推荐 1-3 条优先处理的：可以马上 close 的 / 容易回的 / 真有价值的 feature
4. 问用户：要 `/issue triage <n>` 还是直接 `/issue resolve <n>`？

---

## 子动作 2：`/issue triage <number>`

**目标**：理解 + 归类 + 起草回复，**不直接发**也**不 close**。

步骤：

1. 拿数据：

   ```bash
   gh issue view <n> --json title,body,author,comments,labels,createdAt,state
   ```

2. 判断 issue 类型（bug / feature / docs / question / chore）+ 关联模块（runtime / ui / workflow / agent-engine / storage 之一）
3. 在仓库里**先找答案**再回（避免重复回答）：
   - `Grep` / `Glob` 找相关代码、文档、commit message
   - 看 `docs/project-status.md` 是不是已经记录在案（例如已知技术债 TD-N、远期路线 R-N）
   - 看 `docs/optimization-backlog.md` 看是否已被排期过
4. 选 1 种回复方向并起草：
   - **已实现/已修复** → 指 commit / PR / 文档章节，建议 close
   - **已记录但未排期** → 引用 `optimization-backlog.md` 或 `project-status.md` 远期路线，建议加 `help-wanted` label
   - **需要更多信息** → 列出复现步骤 / 期望行为 / 实际行为 / 环境（OS / Node / runtime）的问题清单
   - **不在范围内 / 反对** → 引 `docs/product-brief.md` 的非目标章节，说明为什么不做，但**先问用户**再发
   - **真 bug，要修** → 转 `/issue resolve <n>`
5. 输出格式（**不主动 `gh issue comment`**，等用户拍板）：

   ```markdown
   ## Triage：#<n> <title>

   **作者**：@xxx · **创建于**：YYYY-MM-DD · **评论数**：N

   **类型**：🐛 bug · area/storage（建议 label）

   **判断**：<一段话讲为什么这样归类、和现有代码/文档的关联>

   **建议下一步**：[发送下面回复 + close] / [发送回复 + 留开] / [要更多信息] / [拒绝（先问用户）] / [转 /issue resolve]

   ---

   **回复草稿**：

   <用 issue 作者的语言（中/英）写一段务实回复>
   ```

6. 等用户说 "发吧" / "改改" / "close" 再动作。如果用户说发，命令是：

   ```bash
   gh issue comment <n> --body "$(cat <<'EOF'
   ...
   EOF
   )"
   # 如同时 close：gh issue close <n> --comment "..."
   ```

---

## 子动作 3：`/issue resolve <number>` — 闭环处理

**目标**：复现刚处理 #1（"要是有截图就好了"）的完整流程：理解 → 做改动 → 回复 + close。

步骤（**所有改动都先做完再回复 + close**，避免评论里说"刚刚做了"但实际没 push）：

1. **理解**：`gh issue view <n> --comments` + 读 issue body 全文 + 找作者前面有没有评论补充
2. **确认范围**：在仓库里找证据 —— 这事是不是真在范围内？有没有现成相关代码？已有的同类做法是什么？
3. **列计划**：用 `TodoWrite` 写出 3-6 步执行清单（更新文档 / 加代码 / 加测试 / 验证），让用户能跟着看进度
4. **做改动**：按计划执行；如果是文档改动，记得同步：
   - `README.md` 引用关系
   - `docs/project-status.md`（如果状态变了）
   - `docs/technical-decisions.md` D-N（如果出新决策）
5. **本地验收**：`pnpm typecheck` 必须绿；改了前端跑 `pnpm dev` smoke；改了 schema bump `schema_version`
6. **commit + push**（**关键：先 commit + push 再回复 issue**，让评论里说"已更新"对得上远程状态）：

   ```bash
   git add <files>
   git commit -m "<conventional commit message, closes #<n>>"
   git push origin main   # 或：先 PR
   ```

   - 涉及小改动（docs / 配置 / 不影响生产）可以直接 main
   - 涉及代码 / schema / 行为 / UI 必走 PR：用 `/pr create` 流程
7. **回复 + close**：

   ```bash
   gh issue close <n> --comment "$(cat <<'EOF'
   感谢提出！...

   ## 已做的事
   - ...
   - ...

   ## 后续如果还想要...
   欢迎再开 issue 或直接 PR。
   EOF
   )"
   ```

   - 已经走 PR 的就先**别 close**，让 PR 的 `Closes #<n>` 自动 close

8. 给用户汇报：改了什么文件 / commit hash / PR URL / issue 已 close

---

## 子动作 4：`/issue create`

**目标**：基于当前对话 / 代码上下文起草一条新 issue 并创建。

步骤：

1. 跟用户确认 1-2 件事（如果上下文不够）：
   - 是 bug 还是 feature？
   - 复现环境（OS / Node / runtime）？
2. 按 issue 类型起草 body：

   **Bug 模板**：

   ```markdown
   ## 复现步骤
   1. ...
   2. ...
   3. ...

   ## 期望
   ...

   ## 实际
   ...

   ## 环境
   - OS: <macOS x.x / Linux / Windows>
   - Node: <node -v>
   - pnpm: <pnpm -v>
   - Runtime: <cursor-agent vX / codex vY / Cursor SDK>
   - Slark commit: <git rev-parse --short HEAD>

   ## 相关日志
   ```

   <粘贴日志，删隐私>

   ```
   ```

   **Feature / 想法模板**：

   ```markdown
   ## 场景
   <为什么需要这个，使用场景>

   ## 期望行为
   <希望产品做到什么>

   ## 相关上下文
   - 关联模块：<runtime / ui / workflow / ...>
   - 已读过的相关文档：<docs/...>
   ```

3. **先把草稿给用户看**，等 "OK 发吧" 再创建：

   ```bash
   gh issue create --title "<concise>" --body "$(cat <<'EOF'
   ...
   EOF
   )"
   ```

4. 返回 issue URL。

---

## 安全网（所有子动作通用）

- 永不在用户没拍板前发评论 / 改 label / close / 创建 issue
- 真要 close 时**永远附带说明**（用 `--comment "..."` 而不是裸 `gh issue close`），保留可追溯
- 涉及他人 PR / issue 时回复语气保持尊重，**不替项目作者拍板**（如反对某 feature），先问用户
- 不公开任何秘密路径 / 凭证（如 `CURSOR_API_KEY`、`.env` 内容）
