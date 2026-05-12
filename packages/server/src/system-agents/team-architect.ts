/**
 * Team Architect — 首个 System Agent（Sprint 1 CP4 / D-15 / D-19）
 *
 * 职责：根据用户填写的 Project Goal，推导推荐的 AI 团队（3~5 个 Agent）。
 *
 * 实现：复用可用的本地 coding adapter（Cursor 或 Codex）spawn 一次，内置 description 模板，严格 JSON 输出。
 *
 * 兜底（Q-2 + Review 5）：任一情况走固定三件套 Architect + Dev + Reviewer：
 *   - 本地 coding runtime 未安装
 *   - spawn 超时（独立 TEAM_ARCHITECT_TIMEOUT_MS = 30s）
 *   - 返回内容非 JSON / 解析失败 / 字段缺失
 */

import { TEAM_ARCHITECT_TIMEOUT_MS } from '@slark/shared';
import type { ReasoningEffort, Runtime, TeamSuggestion, TeamSuggestionAgent } from '@slark/shared';
import { createSystemAdapter, runtimeForAdapter } from '../agents/adapter-factory.js';
import { runWithAdapter } from '../agents/runner.js';

// =============================================================================
// 公共接口
// =============================================================================

export interface SuggestTeamInput {
  goal: string;
  workspace_path: string;
  /** 可选的 workspace 技术栈提示（package.json / Cargo.toml / pyproject.toml 等推导） */
  workspace_hint?: {
    stack?: string;
    readme_excerpt?: string;
  };
}

export async function suggestTeam(input: SuggestTeamInput): Promise<TeamSuggestion> {
  const { adapter, install, noRuntimeAvailable } = await createSystemAdapter();
  const defaultRuntime = runtimeForAdapter(adapter);

  // 1. 预检查：本地 coding backend 是否可用
  if (noRuntimeAvailable) {
    // eslint-disable-next-line no-console
    console.warn(
      '[team-architect] no coding runtime available (cursor/codex both missing); using fallback team',
    );
    return fallbackTeam(
      defaultRuntime,
      'no coding runtime available (install cursor-agent or codex CLI, or set SLARK_SYSTEM_RUNTIME)',
    );
  }
  if (!install.installed) {
    return fallbackTeam(
      defaultRuntime,
      `${adapter.name} not available${install.error ? `: ${install.error}` : ''}`,
    );
  }

  // 2. spawn
  //
  // 注意：Team Architect **不传 workingDirectory** 到 CLI runtime。
  // 原因：Create Project Step 1 时用户填的 workspace_path 可能还不存在
  // （例如准备新建一个目录作为 Project 的代码仓库）；把它作为 cwd 会让
  // spawn 立刻失败。Team Architect 只需要根据 goal + workspace_path 字符串
  // 给出推荐，不需要实际读取项目文件 —— prompt 内部已包含 workspace_path
  // 作为上下文信息，spawn cwd 留给 Node.js 默认值（process.cwd()）即可。
  const prompt = buildTeamArchitectPrompt(input, defaultRuntime);

  try {
    const result = await runWithAdapter(
      adapter,
      { prompt, permissive: false },
      { timeoutMs: TEAM_ARCHITECT_TIMEOUT_MS },
    );

    if (result.timedOut) {
      return fallbackTeam(defaultRuntime, 'Team Architect spawn timed out');
    }
    if (result.aborted) {
      return fallbackTeam(defaultRuntime, 'Team Architect spawn aborted');
    }
    if (result.events.some((e) => e.type === 'error')) {
      const err = result.events.find((e) => e.type === 'error');
      const errMsg =
        err && err.type === 'error' ? err.message : 'Team Architect CLI error';
      return fallbackTeam(defaultRuntime, errMsg);
    }

    const parsed = parseTeamSuggestion(result.fullText, defaultRuntime);
    if (!parsed) {
      // S-1 调试：打印 SDK / CLI 实际返回的前 800 字符 + 长度，定位 prompt-output mismatch
      // eslint-disable-next-line no-console
      console.warn(
        `[team-architect] unparseable output; fullText.length=${result.fullText.length}, head=${JSON.stringify(result.fullText.slice(0, 800))}`,
      );
      return fallbackTeam(defaultRuntime, 'Team Architect returned unparseable output');
    }
    return { ...parsed, is_fallback: false };
  } catch (e) {
    return fallbackTeam(defaultRuntime, `Team Architect spawn failed: ${(e as Error).message}`);
  }
}

// =============================================================================
// Prompt 构造
// =============================================================================

function buildTeamArchitectPrompt(input: SuggestTeamInput, defaultRuntime: Runtime): string {
  const hintBlock = input.workspace_hint
    ? `\n\nWorkspace hint:\n${input.workspace_hint.stack ? `- Stack: ${input.workspace_hint.stack}` : ''}${
        input.workspace_hint.readme_excerpt
          ? `\n- README excerpt: ${input.workspace_hint.readme_excerpt.slice(0, 300)}`
          : ''
      }`
    : '';

  const modelCatalog =
    defaultRuntime === 'codex'
      ? [
          '## Model catalog (Codex CLI model IDs)',
          '',
          'Use runtime="codex" for every agent.',
          '',
          '- "gpt-5.5" — strongest general reasoning; preferred for Architect / Reviewer.',
          '- "gpt-5.4" — strong everyday coding and balanced implementation.',
          '- "gpt-5.4-mini" — fast lightweight work.',
          '- "gpt-5.3-codex" — coding-optimized model for implementation and refactors.',
          '- "gpt-5.3-codex-spark" — fast coding model for small changes.',
          '- "gpt-5.2" — professional work fallback.',
          '',
          'Selection guidelines:',
          '- Architect / Lead Reviewer → gpt-5.5; reasoning="high" or "extra-high"',
          '- Developer / Refactorer → gpt-5.3-codex or gpt-5.4; reasoning="medium"',
          '- Lightweight assistant → gpt-5.4-mini or gpt-5.3-codex-spark; reasoning="low"',
          '- Codex CLI ignores thinking/context fields; set them to null.',
        ]
      : [
          '## Model catalog (Cursor SDK approved IDs only)',
          '',
          'Use runtime="cursor" for every agent.',
          '',
          'Pick the right model for each role from this list — diversity is good (use vendors\' strengths together):',
          '',
          '### Top-tier reasoning (Architect / Senior Reviewer / Critical decisions)',
          '- "claude-opus-4-7" — Anthropic flagship; deep reasoning, long-context, top code quality. PREFERRED for Architect / Reviewer.',
          '- "gpt-5.5"        — OpenAI flagship; broad knowledge, strong system design, generalist. Great alternative for Architect.',
          '- "claude-opus-4-6" — previous gen Opus; cheaper, still strong.',
          '',
          '### Balanced workhorse (main implementers; Backend / Generalist Dev)',
          '- "composer-2"        — Cursor in-house balanced default; safe fallback.',
          '- "claude-sonnet-4-6" — Anthropic mid-tier; much faster than Opus, good quality.',
          '- "gpt-5.4"           — OpenAI mid-tier.',
          '',
          '### Code-specialised (pure refactor / codegen / Dev focused on code)',
          '- "gpt-5.3-codex"     — OpenAI codex; excels at code edits.',
          '- "gpt-5.1-codex-max" — long-context codex variant.',
          '',
          '### Multimodal / tool use / integration (Frontend with screenshots, QA, Integration)',
          '- "gemini-3.1-pro"    — Google flagship; multimodal + grounding + tool use. PREFERRED for QA / Frontend / Integration.',
          '- "gemini-3-flash"    — Google mid-tier, faster.',
          '',
          '### Lightweight (high-frequency simple tasks; cheap)',
          '- "gpt-5-mini"        — OpenAI light',
          '- "claude-haiku-4-5"  — Anthropic light',
          '- "gemini-2.5-flash"  — Google ultra-fast',
          '',
          '## Selection guidelines',
          '',
          'Empirical observation as of 2026: Claude family generally outperforms others on raw coding & refactoring;',
          "GPT family is broader generalist; Gemini family is best at multimodal & tool-use. Pick accordingly.",
          '',
          '- Architect / Designer / Lead Reviewer → claude-opus-4-7 (preferred) or gpt-5.5; thinking=true, context="1m", reasoning="high"~"extra-high"',
          '- Code Reviewer / Security Reviewer  → claude-opus-4-7; thinking=true, context="1m", reasoning="high"',
          '- Backend / Business Implementation  → claude-sonnet-4-6 (preferred for code quality) or composer-2; thinking=false, reasoning="medium"',
          '- Pure code Dev (refactor / codegen) → claude-sonnet-4-6 (preferred) or gpt-5.3-codex; reasoning="medium"',
          '- Frontend (UI / UX, possibly visual) → gemini-3.1-pro (multimodal) or claude-sonnet-4-6; thinking=false, reasoning="medium"',
          '- QA / Integration / Tester          → gemini-3.1-pro (strong tool use & grounding); reasoning="medium"',
          '- Generalist / PM-style coordinator  → gpt-5.5 (broad knowledge); reasoning="medium"',
          '- Lightweight assistant role         → gpt-5-mini or claude-haiku-4-5; reasoning="low"',
          '',
          'Pair vendors deliberately. Typical strong shape: opus Architect + sonnet Backend Dev + gemini QA + opus Reviewer.',
          "Don't overspend: only Architect / Reviewer should be on Opus-tier; implementers should be Sonnet/composer-2/codex.",
        ];

  return [
    'You are the Team Architect for a new AI engineering team in Slark (a local AI Team OS).',
    '',
    'Given a project goal and workspace path, recommend a small focused team of 3 to 5 AI agents with clear roles.',
    'Typical shapes: Architect + Implementer + Reviewer, or a richer mix for specific domains.',
    '',
    `Project goal: ${input.goal}`,
    `Workspace path: ${input.workspace_path}`,
    hintBlock,
    '',
    ...modelCatalog,
    '',
    '## Standard role labels (used by workflow YAML for routing)',
    '',
    'Each agent MUST have a `role` chosen from the standard set below. The role is a',
    'short lowercase keyword used by built-in workflows (e.g. /new-feature) to route',
    'steps to the right team member. Use the agent `name` for specialization (e.g.',
    '"BackendDev") and the `role` for routing (e.g. "implementer").',
    '',
    'Standard roles (use these exact lowercase strings):',
    '  - "architect"   — produces design, API specs, decisions; usually drives /new-feature step 1',
    '  - "implementer" — writes the actual code; required by /new-feature and /bug-fix',
    '  - "reviewer"    — reviews code/spec for correctness, security, maintainability',
    '  - "qa"          — integration tests, acceptance criteria, end-to-end verification',
    '  - "scribe"      — records decisions / lessons (optional, system agent covers this)',
    '',
    'HARD REQUIREMENT: the team MUST collectively cover BOTH "implementer" AND "reviewer".',
    'These two roles are referenced by all built-in workflows; missing either will block',
    'feature/bug workflows from running. For /new-feature an "architect" is also strongly',
    'recommended.',
    '',
    'You MAY assign the same role to multiple agents (e.g. two implementers with different',
    'specializations like "BackendDev" + "FrontendDev"); the first matching agent will be',
    'picked by default. A specialized name is good — it still routes via the standard role.',
    '',
    'Reply with STRICT JSON ONLY. No markdown fences, no commentary, no prose.',
    'Schema:',
    '{',
    '  "agents": [',
    '    {',
    '      "name": "Architect",                   // short, PascalCase or kebab-case; specialized name OK',
    '      "role": "architect",                    // REQUIRED: one of "architect"/"implementer"/"reviewer"/"qa"/"scribe"',
    '      "description": "...",                   // 1-3 sentences, written as the agent\'s system prompt in second person',
    `      "runtime": "${defaultRuntime}",                    // use "${defaultRuntime}" for this local setup`,
    `      "model": "${defaultRuntime === 'codex' ? 'gpt-5.5' : 'claude-opus-4-7'}",             // pick from the catalog above`,
    '      "reasoning": "high",                    // low / medium / high / extra-high / max',
    '      "thinking": true,                       // true / false / null (null = model default)',
    '      "context": "1m"                         // "300k" / "1m" / null (null = model default)',
    '    }',
    '  ],',
    '  "rationale": "one paragraph explaining why this team and these model choices fit the goal"',
    '}',
    '',
    'Return JSON ONLY.',
  ].join('\n');
}

// =============================================================================
// JSON 解析 + 兜底
// =============================================================================

function parseTeamSuggestion(raw: string, defaultRuntime: Runtime): Omit<TeamSuggestion, 'is_fallback'> | null {
  const cleaned = stripJSONFences(raw).trim();
  if (!cleaned) return null;

  // 尝试找到第一个 { ... } 对象
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first < 0 || last <= first) return null;
  const candidate = cleaned.slice(first, last + 1);

  let obj: unknown;
  try {
    obj = JSON.parse(candidate);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;

  const agentsRaw = o.agents;
  if (!Array.isArray(agentsRaw) || agentsRaw.length === 0) return null;

  const agents: TeamSuggestionAgent[] = [];
  for (const ag of agentsRaw) {
    if (!ag || typeof ag !== 'object') continue;
    const a = ag as Record<string, unknown>;
    const name = typeof a.name === 'string' ? a.name.trim() : '';
    const role = typeof a.role === 'string' ? a.role.trim() : '';
    const description = typeof a.description === 'string' ? a.description.trim() : '';
    if (!name || !description) continue;

    const llmRuntime = typeof a.runtime === 'string' ? a.runtime.trim() : '';
    const llmModel = typeof a.model === 'string' ? a.model.trim() : '';
    // Phase B：reasoning 5 值；老 LLM 输出可能仍写 'xhigh'，在此 normalize 到 'extra-high'。
    const reasoningRaw = typeof a.reasoning === 'string' ? a.reasoning.trim() : 'medium';
    const reasoning: ReasoningEffort =
      reasoningRaw === 'low' ||
      reasoningRaw === 'medium' ||
      reasoningRaw === 'high' ||
      reasoningRaw === 'extra-high' ||
      reasoningRaw === 'max'
        ? reasoningRaw
        : reasoningRaw === 'xhigh'
          ? 'extra-high'
          : 'medium';

    // Review B-2：强制对齐当前可用 runtime。LLM 即便看到 prompt 里的 "Use runtime=codex"
    // 也可能继续吐 "cursor"，落库后用户首次 @ 它就会遇到 "cursor backend not configured"。
    // 这里直接覆盖为本地真实可用的 runtime，让 Team Architect 的输出永远可用。
    const runtimeNormalized: Runtime = defaultRuntime;

    // 当 LLM 输出的 runtime 与本地不一致时，它选的 model 大概率也来自另一份 catalog
    // （例如 'claude-opus-4-7' 落到 codex runtime 上无法识别）→ 同步 fallback 到当前
    // runtime 的默认 model；当 runtime 一致或 LLM 没给时按现状处理。
    const runtimeMatches = llmRuntime === defaultRuntime;
    const model = runtimeMatches && llmModel ? llmModel : defaultModel(defaultRuntime, 'dev');

    // Sprint 4-ext / Phase A：thinking / context 接受多种 LLM 输出变体
    // Codex CLI 不支持 thinking / context 字段，强制为 null 与 fallback 三件套保持一致。
    const thinking = runtimeNormalized === 'codex' ? null : parseThinking(a.thinking);
    const context = runtimeNormalized === 'codex' ? null : parseContext(a.context);

    agents.push({
      name,
      // Sprint 8 / Lo-26: role 用于 workflow YAML 占位符（@implementer 等）路由，必须 lowercase。
      // LLM 输出可能写 "Implementer" / "Reviewer" / "ImpLementer"，统一 normalize。
      role: normalizeRole(role || name),
      description,
      runtime: runtimeNormalized,
      model,
      reasoning,
      thinking,
      context,
    });
  }

  if (agents.length === 0) return null;

  // Sprint 8 / Lo-26: 硬校验团队必须同时覆盖 implementer + reviewer，否则 builtin workflow
  // 会在 step 2/3 fail。不满足时返回 null，让 suggestTeam 走 fallback 三件套。
  const missing = checkRequiredRoles(agents);
  if (missing.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[team-architect] team missing required roles: ${missing.join(', ')}; agents: ${agents
        .map((a) => `${a.name}(${a.role})`)
        .join(', ')}`,
    );
    return null;
  }

  const rationale = typeof o.rationale === 'string' ? o.rationale.trim() : '';

  return { agents, rationale };
}

const STANDARD_ROLES = new Set([
  'architect',
  'implementer',
  'reviewer',
  'qa',
  'scribe',
]);

function normalizeRole(raw: string): string {
  const lower = raw.trim().toLowerCase();
  if (STANDARD_ROLES.has(lower)) return lower;
  // 常见同义词映射 — 让 LLM 飘的输出也能落到 builtin workflow 可用的角色
  const synonyms: Record<string, string> = {
    dev: 'implementer',
    developer: 'implementer',
    engineer: 'implementer',
    coder: 'implementer',
    backend: 'implementer',
    frontend: 'implementer',
    'backend-dev': 'implementer',
    'frontend-dev': 'implementer',
    backenddev: 'implementer',
    frontenddev: 'implementer',
    fullstack: 'implementer',
    code: 'implementer',
    coding: 'implementer',
    impl: 'implementer',
    review: 'reviewer',
    'code-reviewer': 'reviewer',
    codereviewer: 'reviewer',
    security: 'reviewer',
    auditor: 'reviewer',
    test: 'qa',
    tester: 'qa',
    quality: 'qa',
    integration: 'qa',
    qaintegration: 'qa',
    'qa-integration': 'qa',
    designer: 'architect',
    design: 'architect',
    pm: 'architect',
    lead: 'architect',
    archivist: 'scribe',
    recorder: 'scribe',
  };
  if (synonyms[lower]) return synonyms[lower];
  // free-form 角色保留（agent.role 仍是 lowercase），但 workflow 占位符不会命中它
  return lower;
}

function checkRequiredRoles(agents: TeamSuggestionAgent[]): string[] {
  const roleSet = new Set(agents.map((a) => a.role));
  const required = ['implementer', 'reviewer'];
  return required.filter((r) => !roleSet.has(r));
}

/** 去掉 assistant 有时会加的 ```json ... ``` 包裹 */
function stripJSONFences(text: string): string {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return match ? match[1] ?? '' : text;
}

/**
 * 宽容地解析 LLM 输出的 thinking 字段：
 *   - boolean → 直接用
 *   - 'on' / 'true' / 'yes' / '1' / 'enabled' → true
 *   - 'off' / 'false' / 'no' / '0' / 'disabled' → false
 *   - 'auto' / null / undefined → null（跟 model 默认）
 */
function parseThinking(raw: unknown): boolean | null {
  if (typeof raw === 'boolean') return raw;
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string') {
    const v = raw.trim().toLowerCase();
    if (['on', 'true', 'yes', '1', 'enabled'].includes(v)) return true;
    if (['off', 'false', 'no', '0', 'disabled'].includes(v)) return false;
    if (['auto', 'default', ''].includes(v)) return null;
  }
  return null;
}

/**
 * 宽容地解析 LLM 输出的 context 字段：
 *   - '300k' / '1m'（含大小写、含 K/M 后缀变体）→ 标准化
 *   - 'default' / null / undefined → null
 */
function parseContext(raw: unknown): import('@slark/shared').ContextSize | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase().replace(/[\s_]/g, '');
  if (['default', ''].includes(v)) return null;
  if (['300k', '300', '300000'].includes(v)) return '300k';
  if (['1m', '1000k', '1000000'].includes(v)) return '1m';
  return null;
}

// =============================================================================
// 兜底三件套（Q-2 / Review 5）
// =============================================================================

function fallbackTeam(defaultRuntime: Runtime, reason: string): TeamSuggestion {
  return {
    agents: fallbackAgents(defaultRuntime),
    rationale:
      'Default team (Team Architect unavailable). Please configure runtime/model for each agent before use.',
    is_fallback: true,
    fallback_reason: reason,
  };
}

function fallbackAgents(runtime: Runtime): TeamSuggestionAgent[] {
  return [
    {
      name: 'Architect',
      role: 'architect',
      description:
        'You design APIs, data models, and module boundaries. Before proposing a solution, skim the codebase to understand existing conventions. Focus on clarity and maintainability over cleverness.',
      runtime,
      model: defaultModel(runtime, 'architect'),
      reasoning: 'high',
      thinking: runtime === 'cursor' ? true : null,
      context: runtime === 'cursor' ? '1m' : null,
    },
    {
      name: 'Dev',
      role: 'implementer',
      description:
        "You implement features based on the Architect's design. Write clean, typed code with tests. Always wrap async calls in try/catch and surface errors with structured context.",
      runtime,
      model: defaultModel(runtime, 'dev'),
      reasoning: 'medium',
      thinking: runtime === 'cursor' ? false : null,
      context: null,
    },
    {
      name: 'Reviewer',
      role: 'reviewer',
      description:
        'You review code for correctness, security, and maintainability. Call out issues directly and suggest concrete fixes. Do not rubber-stamp; push back when something feels off.',
      runtime,
      model: defaultModel(runtime, 'reviewer'),
      reasoning: 'high',
      thinking: runtime === 'cursor' ? true : null,
      context: runtime === 'cursor' ? '1m' : null,
    },
  ];
}

function defaultModel(runtime: Runtime, role: 'architect' | 'dev' | 'reviewer'): string {
  if (runtime === 'codex') {
    return role === 'dev' ? 'gpt-5.3-codex' : 'gpt-5.5';
  }
  return role === 'dev' ? 'claude-sonnet-4-6' : 'claude-opus-4-7';
}
