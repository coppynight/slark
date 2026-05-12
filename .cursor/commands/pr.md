---
description: Slark PR 工作流 — review / babysit / create / merge 子动作（all-in-one）
---

# /pr — Slark 仓库 Pull Request 工作流

接受一个子动作参数：`review` / `babysit` / `create` / `merge`（不指定就先列出待办 PR 让用户选）。
所有 GitHub 操作都用 `gh` CLI 走 `coppynight/slark` 仓库。

---

## 用法

```
/pr                                # 列出 open PR + 当前状态，让我建议下一步
/pr review <number>                # Review 指定 PR
/pr babysit <number>               # 推一个 PR 到 merge-ready（CI / 评论 / 冲突）
/pr create                         # 基于当前 branch 创建 PR
/pr merge <number>                 # 合并 PR（squash，等用户确认）
```

如果消息里出现了 PR URL（如 `https://github.com/coppynight/slark/pull/4`），从 URL 解析出编号。

---

## 公共上下文（任何子动作开始前先看一眼）

- 仓库：`coppynight/slark`（也有 fork remote `novax` → `VibeNexus/slark`，**永远默认推 `origin`/`coppynight/slark` 除非用户明说**）
- 默认分支：`main`，通常直接 PR 到 `main`
- Commit 风格：[Conventional Commits](https://www.conventionalcommits.org/)，参考 `git log --oneline -10` 的现有例子（`feat(sprint7-cp4): …` / `fix: …` / `docs: …` / `refactor(per-project-storage): …`）
- 文档优先级（写 PR 描述 / review 时引用）：`docs/product-brief.md` > `PLAN.md` > `docs/project-status.md` > `docs/technical-decisions.md` > 其他
- 验收红线（任何 PR 都该过）：`pnpm typecheck` 全绿；本地 `pnpm dev` smoke 通过；涉及 schema 变更则 `schema_version` 已 bump

---

## 子动作 1：`/pr` (无参数) — 列表 + 建议

1. `gh pr list --state open --json number,title,author,isDraft,mergeable,reviewDecision,statusCheckRollup,updatedAt --limit 20`
2. 一句话给每个 PR 打标签：`✅ merge-ready` / `🟡 待 review` / `🔴 CI 红` / `⚪️ Draft` / `⚠️ 有冲突`
3. 推荐一个该优先处理的，并问用户要不要 `/pr babysit <n>` 或 `/pr review <n>`
4. **不主动改任何 PR 状态**

---

## 子动作 2：`/pr review <number>`

**目标**：给出一份对 reviewer 友好的 review 摘要 + 关键问题清单（不写 inline comments，除非用户单独要求）。

步骤：

1. 拿 PR 元数据 + diff：

   ```bash
   gh pr view <n> --json title,body,author,baseRefName,headRefName,files,additions,deletions,mergeable,reviewDecision
   gh pr diff <n>
   ```

2. 拉到本地拿到完整代码：

   ```bash
   gh pr checkout <n>          # 切到 PR 分支
   pnpm typecheck              # 看类型有没有红
   ```

   完事记得 `git checkout main` 切回去。
3. 按下面 6 维度评审，每个维度只输出 0-3 条要点：
   - **范围**：和 `docs/project-status.md` 的 Sprint / `PLAN.md` 的当前焦点是否一致？范围是否过大？
   - **架构契合度**：是否遵守 5 个核心模块边界（CLI Bridge / Agent Engine / Message Bus / Data Layer / UI）？有没有跨层调用？
   - **数据层**：动了 `schema.sql`?`schema_version` 有没有 bump？migration 路径如何？per-project storage 假设（`<workspace>/.slark/`）有没有破？
   - **运行时假设**：新增了 `CursorAdapter` / `CodexAdapter` / `CursorSdkAdapter` 之外的依赖？lazy import 处理了吗？
   - **质量**：typecheck / lint / smoke；命名是否对齐 `agents.description` / `agent_runs` / `project.workspace_path` 现有术语
   - **文档**：动了行为就该改 `docs/project-status.md` § 状态；新决策落到 `technical-decisions.md`（D-N）；新优化进 `optimization-backlog.md`（O-N）

4. 用 markdown 输出一份 review（顶部一句话总评 → 6 维度要点 → 「建议下一步」三选一：`Approve` / `Request changes` / `Comment only`）。
5. **不要**用 `gh pr review --approve` 直接 approve。如果用户明确说"批准它"，再用 `gh pr review <n> --approve --body "..."`。

---

## 子动作 3：`/pr babysit <number>` — 用 babysit skill

**目标**：把指定 PR 一路推到 merge-ready。

**首要动作**：读并遵循 babysit skill —— `/Users/kaikxiao/.cursor/skills-cursor/babysit/SKILL.md`。把那份 skill 里的循环（triage 未读评论 → 跑 CI → 解冲突 → 提交修复 → 继续）当成执行手册，**不要从记忆里走流程**。

Slark 特化要点（覆盖 skill 默认行为）：

- 推送时**默认 `origin`**（即 `coppynight/slark`），永不推 `novax`
- 修代码后必须：`pnpm typecheck` 绿；如果改了前端必须本地 `pnpm dev` smoke；如果改了 schema 必须 bump `schema_version`
- Commit 必须 Conventional Commits 风格；hook 自动改了文件需要 amend 时遵守"未 push 才能 amend"规则
- 遇到无法解决的歧义（如 schema 设计选择），**停下来问用户**而不是猜
- 永不 `--force-push` 到 `main`；fork PR 的 force-push 也要先问

完成后给出一句话状态：`✅ merge-ready` / `⏸ blocked: <原因>`。

---

## 子动作 4：`/pr create` — 基于当前 branch 建 PR

**前置自检**（任一不过就停下来问用户）：

1. `git status` — 没有未 commit 的改动（或确认要先 commit）
2. `git rev-parse --abbrev-ref HEAD` — 当前 **不在** `main` 上
3. `git log main..HEAD --oneline` — 至少有 1 个 commit
4. `pnpm typecheck` — 全绿

通过后：

1. 收集差异：

   ```bash
   git status
   git diff main...HEAD --stat
   git log main..HEAD --oneline
   ```

2. 根据 commits + diff 起草 PR title（一行，Conventional Commits 风格，**不要**带 emoji 除非现有 commit 已有）和 body（用下面模板，HEREDOC 传入）：

   ```markdown
   ## Summary
   <1-3 句解释做了什么、为什么>

   ## 改动范围
   - <按 5 个核心模块归类>

   ## 验收
   - [ ] `pnpm typecheck` 全绿
   - [ ] 手动 smoke：<具体场景>
   - [ ] （如涉及）schema_version 已 bump
   - [ ] （如涉及）docs/project-status.md / technical-decisions.md 已更新

   ## 关联
   - Closes #<issue>（如有）
   - 参考：docs/<相关文档>
   ```

3. push + create：

   ```bash
   git push -u origin HEAD
   gh pr create --title "..." --body "$(cat <<'EOF'
   ...
   EOF
   )"
   ```

4. 返回 PR URL。**不要**自己 approve / merge。

---

## 子动作 5：`/pr merge <number>` — 合并

只有用户明确说"merge 它"时才走这条。步骤：

1. 复查：`gh pr view <n> --json mergeable,reviewDecision,statusCheckRollup`
2. 任一红线**未达成**就停下来汇报：
   - `mergeable != "MERGEABLE"`
   - `statusCheckRollup` 有失败
   - 没有 approve 或 author 不是用户自己
3. 全部通过则用 **squash + delete branch**（仓库现有风格）：

   ```bash
   gh pr merge <n> --squash --delete-branch
   ```

4. 合并后 `git checkout main && git pull origin main`，确认本地同步。

**永不**对 `main` 用 `--force` / `--admin` 跳过保护。

---

## 安全网（所有子动作通用）

- 永不更新 git config
- 永不 `--no-verify` 跳过 hook
- 涉及秘密文件（`.env` / `.env.local` / `CURSOR_API_KEY`）一律拒绝 commit / push，发现就停下来警告
- 任何破坏性操作（`merge` / `close` / `delete-branch` / `force-push`）必须有用户明确指令
