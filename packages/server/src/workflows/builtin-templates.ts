/**
 * 内置 Workflow 模板（Sprint 2 CP2，Sprint 8 / Lo-26 修复）
 *
 * 3 个模板，对应 PLAN.md Sprint 2 §2.2：
 *   - feature-development: design → await_approval → implement → review → done
 *   - bug-fix:             reproduce → fix → verify → done
 *   - research:            gather → summarize → done
 *
 * Sprint 8 / Lo-26 修复：模板的 `owner` 使用**角色占位符**（@architect / @implementer
 * / @reviewer / @qa），Runner 通过双路径解析（先 byName，找不到再 byRole）映射到
 * Team Architect 推荐的具体 agent。这样 Team Architect 自由命名（如 @BackendDev）
 * 仍然可被 workflow 引用，避免硬编码 @Dev 跟自由命名错位（dogfood r1 阻塞 bug）。
 *
 * 后向兼容：
 *   - 老 project 里手建 agent 名叫 "Dev" / "Reviewer" 等也能命中 byName 通道
 *   - Team Architect 兜底三件套（D-19，fallbackAgents）的 name + role 现在都对齐
 *
 * 模板首次创建时通过 importBuiltinsForProject() 自动 seed 到 Project；
 * 后续用户可通过 PATCH /api/workflows/:id 修改 YAML，不会被重新覆盖。
 */

export interface BuiltinTemplate {
  /** trigger_command（同 project 内唯一）*/
  command: string;
  name: string;
  description: string;
  yaml: string;
}

const FEATURE_DEVELOPMENT_YAML = `version: "1"
name: feature-development
description: Three-stage feature delivery — architect designs, you approve, implementer implements, reviewer reviews.

trigger:
  command: "/new-feature"

steps:
  - id: design
    owner: "@architect"
    description: "Produce a design proposal for the requested feature."
    on_complete: await_approval

  - id: await_approval
    owner: "local-user"
    action: approve_or_reject
    description: "Approve the design or reject with feedback to redo."
    on_approve: implement
    on_reject: design

  - id: implement
    owner: "@implementer"
    input: design
    description: "Implement the approved design."
    on_complete: review

  - id: review
    owner: "@reviewer"
    action: approve_or_reject
    input: implement
    description: "Review the implementation; reject sends it back to implement."
    on_approve: done
    on_reject: implement

  - id: done
    action: close_thread
    description: "Workflow complete."
`;

const BUG_FIX_YAML = `version: "1"
name: bug-fix
description: Three-stage bug fix — reproduce, fix, verify.

trigger:
  command: "/bug-fix"

steps:
  - id: reproduce
    owner: "@implementer"
    description: "Reproduce the bug and document the root cause."
    on_complete: fix

  - id: fix
    owner: "@implementer"
    input: reproduce
    description: "Apply a fix and document the change."
    on_complete: verify

  - id: verify
    owner: "@reviewer"
    action: approve_or_reject
    input: fix
    description: "Verify the fix; reject sends it back to fix."
    on_approve: done
    on_reject: fix

  - id: done
    action: close_thread
    description: "Workflow complete."
`;

const RESEARCH_YAML = `version: "1"
name: research
description: Lightweight research — gather information then summarize.

trigger:
  command: "/research"

steps:
  - id: gather
    owner: "@architect"
    description: "Gather relevant information about the topic."
    on_complete: summarize

  - id: summarize
    owner: "@architect"
    input: gather
    description: "Summarize findings into actionable notes."
    on_complete: done

  - id: done
    action: close_thread
    description: "Workflow complete."
`;

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    command: '/new-feature',
    name: 'feature-development',
    description:
      'Three-stage feature delivery — Architect designs, you approve, Dev implements, Reviewer reviews.',
    yaml: FEATURE_DEVELOPMENT_YAML,
  },
  {
    command: '/bug-fix',
    name: 'bug-fix',
    description: 'Three-stage bug fix — reproduce, fix, verify.',
    yaml: BUG_FIX_YAML,
  },
  {
    command: '/research',
    name: 'research',
    description: 'Lightweight research — gather information then summarize.',
    yaml: RESEARCH_YAML,
  },
];
