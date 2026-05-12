/**
 * REST API 客户端封装
 */

import type {
  Agent,
  AgentActivity,
  AgentFeedback,
  AgentSkill,
  ChatMessage,
  Channel,
  CursorBackendStatus,
  CursorBackendUpdateInput,
  Decision,
  Lesson,
  LessonKind,
  Project,
  ProjectOnboarding,
  ReviewStatus,
  RuntimeDetection,
  Task,
  TaskStatus,
  TeamSuggestion,
  ReasoningEffort,
  Runtime,
  Workflow,
  WorkflowRun,
  WorkflowSession,
} from '@slark/shared';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Fastify 5+ 默认拒绝 "Content-Type: application/json + empty body"（FST_ERR_CTP_EMPTY_JSON_BODY → 400）。
  // 因此仅在确实有 body 时才声明 JSON content-type。caller 显式覆盖时优先生效。
  const userHeaders = (init?.headers ?? {}) as Record<string, string>;
  const hasBody = init?.body !== undefined && init.body !== null;
  const headers: Record<string, string> = { ...userHeaders };
  if (hasBody && headers['Content-Type'] === undefined && headers['content-type'] === undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface Health {
  ok: boolean;
  version: string;
  slark_home: string;
  db: { channels: number; agents: number };
  ws?: { sockets: number; channels: Record<string, number> };
  queue?: { running: number; waiting: number };
}

// Health & runtimes
export const getHealth = () => request<Health>('/api/health');
export const getRuntimes = () => request<RuntimeDetection[]>('/api/runtimes');
export const getRuntimeModels = (id: Runtime) =>
  request<{ models: string[]; note?: string; error?: string }>(`/api/runtimes/${id}/models`);

// Cursor backend settings (Sprint 4-ext / S-1 收尾)
export const getCursorSettings = (validate = false) =>
  request<CursorBackendStatus>(
    `/api/settings/cursor${validate ? '?validate=true' : ''}`,
  );
export const updateCursorSettings = (
  data: CursorBackendUpdateInput & { validate?: boolean },
) =>
  request<CursorBackendStatus>('/api/settings/cursor', {
    method: 'POST',
    body: JSON.stringify(data),
  });

// Projects (v1.0 新增)
export const listProjects = () => request<Project[]>('/api/projects');
export const getProject = (id: string) => request<Project>(`/api/projects/${id}`);
export const getProjectByName = (name: string) =>
  request<Project>(`/api/projects/by-name/${encodeURIComponent(name)}`);
/**
 * D-21：POST /api/projects/open 替代旧 POST /api/projects。
 * 服务端检测 <workspace>/.slark/ 是否已存在 → reopen 或新建。
 * 保留 createProject 函数名供既有调用者用。
 */
export const createProject = (data: {
  id?: string;
  name: string;
  display_name?: string | null;
  workspace_path: string;
  goal: string;
  team_rules?: string | null;
  color?: string | null;
}) =>
  request<{ project: Project; is_new: boolean }>('/api/projects/open', {
    method: 'POST',
    body: JSON.stringify(data),
  }).then((res) => res.project);
export const updateProject = (id: string, patch: Partial<Project>) =>
  request<Project>(`/api/projects/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
/** D-21：close = 仅从 recent 移除（保留 .slark/）；delete-storage = rm -rf .slark/ */
export const closeProject = (id: string) =>
  request<void>(`/api/projects/${id}/close`, { method: 'POST' });
export const deleteProjectStorage = (id: string, confirmName: string) =>
  request<void>(`/api/projects/${id}/delete-storage`, {
    method: 'POST',
    body: JSON.stringify({ confirm_name: confirmName }),
  });
/** 兼容旧调用：等价于 closeProject（开发阶段 UX 改造前）*/
export const deleteProject = closeProject;

// Team Architect（Create Project Step 2 用）
export const suggestTeam = (data: {
  goal: string;
  workspace_path: string;
  workspace_hint?: { stack?: string; readme_excerpt?: string };
}) =>
  request<TeamSuggestion>('/api/projects/suggest-team', {
    method: 'POST',
    body: JSON.stringify(data),
  });

// Channels
export const listChannels = (projectId?: string) => {
  const qs = projectId ? `?project_id=${encodeURIComponent(projectId)}` : '';
  return request<Channel[]>(`/api/channels${qs}`);
};
export const getChannel = (id: string) => request<Channel>(`/api/channels/${id}`);
export const createChannel = (data: {
  name: string;
  description?: string;
  type?: 'channel' | 'dm';
  project_id?: string;
}) =>
  request<Channel>('/api/channels', {
    method: 'POST',
    body: JSON.stringify(data),
  });
export const getChannelMessages = (id: string, opts?: { parent_id?: string; limit?: number }) => {
  const qs = new URLSearchParams();
  if (opts?.parent_id) qs.set('parent_id', opts.parent_id);
  if (opts?.limit) qs.set('limit', String(opts.limit));
  const q = qs.toString();
  return request<ChatMessage[]>(`/api/channels/${id}/messages${q ? '?' + q : ''}`);
};
export const getChannelAgents = (id: string) =>
  request<Agent[]>(`/api/channels/${id}/agents`);
export const stopAllAgents = (id: string) =>
  request<{ stopped: number }>(`/api/channels/${id}/stop-all`, {
    method: 'POST',
  });

// Agents
export const listAgents = (projectId?: string) => {
  const qs = projectId ? `?project_id=${encodeURIComponent(projectId)}` : '';
  return request<Agent[]>(`/api/agents${qs}`);
};
export const getAgent = (id: string) => request<Agent>(`/api/agents/${id}`);
export const createAgent = (data: {
  name: string;
  role?: string | null;
  description?: string;
  runtime: Runtime;
  model?: string;
  reasoning?: ReasoningEffort;
  thinking?: boolean | null;
  context?: '300k' | '1m' | null;
  env_vars?: Record<string, string>;
  project_id?: string;
}) => request<Agent>('/api/agents', { method: 'POST', body: JSON.stringify(data) });
export const updateAgent = (id: string, patch: Partial<Agent>) =>
  request<Agent>(`/api/agents/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
export const deleteAgent = (id: string) =>
  request<void>(`/api/agents/${id}`, { method: 'DELETE' });
export const startAgent = (id: string) =>
  request<{ ok: boolean }>(`/api/agents/${id}/start`, { method: 'POST' });
export const stopAgent = (id: string) =>
  request<{ ok: boolean }>(`/api/agents/${id}/stop`, { method: 'POST' });
export const restartAgent = (id: string) =>
  request<{ ok: boolean }>(`/api/agents/${id}/restart`, { method: 'POST' });
export const getAgentActivity = (
  id: string,
  opts?: { channel_id?: string; limit?: number },
) => {
  const qs = new URLSearchParams();
  if (opts?.channel_id) qs.set('channel_id', opts.channel_id);
  if (opts?.limit) qs.set('limit', String(opts.limit));
  const q = qs.toString();
  return request<AgentActivity[]>(`/api/agents/${id}/activity${q ? `?${q}` : ''}`);
};
// CP8.5：getAgentWorkspace 已删除（D-8 v1.0 修订：agent 无独立 workspace）。
// 旧前端组件如 AgentProfilePanel 的 WORKSPACE Tab 已在 CP6 中删除。
export const joinChannel = (channelId: string, agentId: string) =>
  request<{ ok: boolean }>(`/api/channels/${channelId}/agents`, {
    method: 'POST',
    body: JSON.stringify({ agent_id: agentId }),
  });

// Tasks
export const listTasks = (opts?: { channel_id?: string; status?: TaskStatus }) => {
  const qs = new URLSearchParams();
  if (opts?.channel_id) qs.set('channel_id', opts.channel_id);
  if (opts?.status) qs.set('status', opts.status);
  const q = qs.toString();
  return request<Task[]>(`/api/tasks${q ? '?' + q : ''}`);
};
export const createTask = (data: {
  channel_id: string;
  title: string;
  assignee_agent_id?: string | null;
}) => request<Task>('/api/tasks', { method: 'POST', body: JSON.stringify(data) });
export const updateTask = (id: number, patch: Partial<Task>) =>
  request<Task>(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
export const deleteTask = (id: number) =>
  request<void>(`/api/tasks/${id}`, { method: 'DELETE' });

// 全局/辅助
export const searchMessages = (q: string, channelId?: string) => {
  const qs = new URLSearchParams({ q });
  if (channelId) qs.set('channel_id', channelId);
  return request<ChatMessage[]>(`/api/messages/search?${qs.toString()}`);
};

export const listGlobalThreads = () =>
  request<ChatMessage[]>('/api/threads');

export const saveMessage = (id: string) =>
  request<{ ok: boolean }>(`/api/messages/${id}/save`, { method: 'POST' });

export const unsaveMessage = (id: string) =>
  request<void>(`/api/messages/${id}/save`, { method: 'DELETE' });

export const isMessageSaved = (id: string) =>
  request<{ saved: boolean }>(`/api/messages/${id}/saved`);

export const listSaved = () => request<ChatMessage[]>('/api/saved');

// Workflows (Sprint 2 CP1)
export const listProjectWorkflows = (projectId: string) =>
  request<Workflow[]>(`/api/projects/${projectId}/workflows`);

export const getWorkflow = (id: string) =>
  request<Workflow>(`/api/workflows/${id}`);

export const createWorkflow = (
  projectId: string,
  data: {
    name: string;
    description?: string | null;
    trigger_command: string;
    definition_yaml: string;
  },
) =>
  request<Workflow>(`/api/projects/${projectId}/workflows`, {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const updateWorkflow = (
  id: string,
  patch: Partial<{
    name: string;
    description: string | null;
    trigger_command: string;
    definition_yaml: string;
  }>,
) =>
  request<Workflow>(`/api/workflows/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });

export const deleteWorkflow = (id: string) =>
  request<void>(`/api/workflows/${id}`, { method: 'DELETE' });

export const listWorkflowRuns = (workflowId: string) =>
  request<WorkflowRun[]>(`/api/workflows/${workflowId}/runs`);

export const getWorkflowRun = (id: number) =>
  request<WorkflowRun & { workflow: Workflow | null }>(`/api/workflow-runs/${id}`);

export const abortWorkflowRun = (id: number, reason?: string) =>
  request<WorkflowRun>(`/api/workflow-runs/${id}/abort`, {
    method: 'POST',
    body: JSON.stringify({ reason: reason ?? 'aborted by user' }),
  });

export const getActiveWorkflowRun = (channelId: string, threadId?: string) => {
  const qs = threadId ? `?thread_id=${encodeURIComponent(threadId)}` : '';
  return request<{ run: (WorkflowRun & { workflow: Workflow | null }) | null }>(
    `/api/channels/${channelId}/active-workflow-run${qs}`,
  );
};

export const listActiveWorkflowRuns = (status?: 'running' | 'awaiting_approval') => {
  const qs = status ? `?status=${status}` : '';
  return request<Array<WorkflowRun & { workflow: Workflow | null; channel: Channel | null }>>(
    `/api/workflow-runs${qs}`,
  );
};

// Workflow Import / Export (Sprint 3 CP4)
export async function exportWorkflowYaml(id: string): Promise<{
  filename: string;
  yaml: string;
}> {
  const res = await fetch(`/api/workflows/${id}/export`);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  const yaml = await res.text();
  // 解析文件名：Content-Disposition: attachment; filename="..."
  const cd = res.headers.get('content-disposition') ?? '';
  const m = /filename="([^"]+)"/.exec(cd);
  const filename = m?.[1] ?? `${id}.workflow.yaml`;
  return { filename, yaml };
}

export const importWorkflowYaml = (
  projectId: string,
  data: {
    definition_yaml: string;
    name?: string;
    description?: string | null;
    trigger_command?: string;
    overwrite?: boolean;
  },
) =>
  request<{
    imported: Workflow;
    mode: 'created' | 'updated';
  }>(`/api/projects/${projectId}/workflows/import`, {
    method: 'POST',
    body: JSON.stringify(data),
  });

// Intelligence — Decisions / Lessons (Sprint 4 CP4)

export const listProjectDecisions = (projectId: string, status?: ReviewStatus) => {
  const qs = status ? `?status=${status}` : '';
  return request<Decision[]>(`/api/projects/${projectId}/decisions${qs}`);
};

export const createDecision = (
  projectId: string,
  data: { title: string; body: string; audience?: string; source_message_id?: string | null },
) =>
  request<Decision>(`/api/projects/${projectId}/decisions`, {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const updateDecision = (
  id: number,
  patch: {
    review_status?: ReviewStatus;
    title?: string;
    body?: string;
    audience?: string;
  },
) =>
  request<Decision>(`/api/decisions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });

export const deleteDecision = (id: number) =>
  request<void>(`/api/decisions/${id}`, { method: 'DELETE' });

export const listProjectLessons = (
  projectId: string,
  opts?: { status?: ReviewStatus; audience?: string; kind?: LessonKind },
) => {
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.audience) qs.set('audience', opts.audience);
  if (opts?.kind) qs.set('kind', opts.kind);
  const q = qs.toString();
  return request<Lesson[]>(`/api/projects/${projectId}/lessons${q ? `?${q}` : ''}`);
};

export const createLesson = (
  projectId: string,
  data: {
    kind: LessonKind;
    title: string;
    body: string;
    audience?: string;
    tags?: string[];
    source_message_id?: string | null;
  },
) =>
  request<Lesson>(`/api/projects/${projectId}/lessons`, {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const updateLesson = (
  id: number,
  patch: {
    review_status?: ReviewStatus;
    title?: string;
    body?: string;
    audience?: string;
    kind?: LessonKind;
    tags?: string[];
  },
) =>
  request<Lesson>(`/api/lessons/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });

export const deleteLesson = (id: number) =>
  request<void>(`/api/lessons/${id}`, { method: 'DELETE' });

// Agent Feedback (Sprint 5 CP4 / CP5)

export const listAgentFeedback = (agentId: string) =>
  request<AgentFeedback[]>(`/api/agents/${agentId}/feedback`);

export const runCoachForAgent = (agentId: string) =>
  request<{ feedback: AgentFeedback | null }>(
    `/api/agents/${agentId}/feedback/run-coach`,
    { method: 'POST' },
  );

export const applyAgentFeedback = (id: number) =>
  request<AgentFeedback>(`/api/feedback/${id}/apply`, { method: 'POST' });

export const rejectAgentFeedback = (id: number) =>
  request<AgentFeedback>(`/api/feedback/${id}/reject`, { method: 'POST' });

export const rollbackAgentFeedback = (id: number) =>
  request<AgentFeedback>(`/api/feedback/${id}/rollback`, { method: 'POST' });

// Onboarding (Sprint 6 CP3)
export const getProjectOnboarding = (projectId: string) =>
  request<ProjectOnboarding | { project_id: string; ready: false }>(
    `/api/projects/${projectId}/onboarding`,
  );

export const runOnboarder = (projectId: string) =>
  request<ProjectOnboarding | null>(`/api/projects/${projectId}/onboarding/run`, {
    method: 'POST',
  });

// Skill Matrix (Sprint 6 CP4 / CP5)
export const listAgentSkills = (agentId: string) =>
  request<AgentSkill[]>(`/api/agents/${agentId}/skills`);

export const listProjectSkills = (projectId: string) =>
  request<AgentSkill[]>(`/api/projects/${projectId}/skills`);

export const suggestAgentsForKeyword = (projectId: string, keyword: string) =>
  request<Array<{ agent_id: string; total_count: number; matched_keys: string[] }>>(
    `/api/projects/${projectId}/skill-suggest?keyword=${encodeURIComponent(keyword)}`,
  );

// Workflow Sessions (Sprint 7)

export const listProjectWorkflowSessions = (projectId: string) =>
  request<WorkflowSession[]>(`/api/projects/${projectId}/workflow-sessions`);

export const createWorkflowSession = (projectId: string, goalInput: string) =>
  request<WorkflowSession>(`/api/projects/${projectId}/workflow-sessions`, {
    method: 'POST',
    body: JSON.stringify({ goal_input: goalInput }),
  });

export const getWorkflowSession = (id: number) =>
  request<WorkflowSession>(`/api/workflow-sessions/${id}`);

export const approveWorkflowSession = (
  id: number,
  patch?: { name?: string; trigger_command?: string },
) =>
  request<{ session: WorkflowSession; workflow: Workflow }>(
    `/api/workflow-sessions/${id}/approve`,
    {
      method: 'POST',
      body: JSON.stringify(patch ?? {}),
    },
  );

export const rejectWorkflowSession = (id: number) =>
  request<WorkflowSession>(`/api/workflow-sessions/${id}/reject`, { method: 'POST' });

export const archiveWorkflowSession = (id: number) =>
  request<WorkflowSession>(`/api/workflow-sessions/${id}/archive`, { method: 'POST' });
