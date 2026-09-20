export type AgentToolName =
  | 'get_canvas_state'
  | 'get_node_capabilities'
  | 'get_node_detail'
  | 'configure_node'
  | 'move_resize_node'
  | 'execute_node_action'
  | 'get_node_task_status'
  | 'list_node_outputs'
  | 'select_node_output'
  | 'verify_node_output'
  | 'add_node'
  | 'remove_node'
  | 'update_node'
  | 'connect_nodes'
  | 'disconnect_nodes'
  | 'run_generation'
  | 'clear_canvas'
  | 'undo'
  | 'redo'
  | 'arrange_nodes'
  | 'list_workflows'
  | 'setup_workflow'
  | 'read_file'
  | 'write_file'
  | 'edit_file'
  | 'glob_search'
  | 'grep_search'
  | 'web_search'
  | 'web_fetch'
  | 'get_api_config'
  | 'set_api_config'
  | 'test_api_connection'
  | 'get_project_info'
  | 'list_projects'
  | 'open_project'
  | 'create_project'
  | 'bash'
  | 'task_create'
  | 'task_update'
  | 'sub_agent'
  | 'get_config'
  | 'plan_mode'
  | 'session_info'
  | 'update_user_profile'
  | 'music_search'
  | 'music_play'
  | 'music_pause'
  | 'music_resume'
  | 'music_next'
  | 'music_prev'
  | 'music_set_volume'
  | 'music_get_state'
  | 'music_load_playlists'
  | 'music_play_playlist'
  | 'music_get_recommend'
  | 'dreamina_check_login'
  | 'dreamina_install'
  | 'dreamina_configure'
  | 'dreamina_test'
  | 'dreamina_text2image'
  | 'dreamina_text2video'
  | 'dreamina_image2image'
  | 'dreamina_image2video'
  | 'dreamina_multimodal2video'
  | 'dreamina_list_task'
  | 'dreamina_query_result'
  | 'list_providers'
  | 'switch_provider'
  | 'add_custom_provider'
  | 'remember'
  | 'recall_memories'
  | 'forget_memory'
  | 'recall_work_style'
  | 'replay_work_routine';

export type ToolCategory =
  | 'canvas'
  | 'file'
  | 'web'
  | 'api-config'
  | 'project'
  | 'shell'
  | 'task'
  | 'meta'
  | 'music'
  | 'memory';

export interface AgentToolCall {
  name: AgentToolName;
  params: Record<string, unknown>;
}

export interface AgentToolResult {
  success: boolean;
  message: string;
  data?: unknown;
  error?: AgentToolError;
  artifacts?: AgentArtifact[];
  verification?: AgentVerificationResult;
}

export type AgentErrorCategory =
  | 'validation'
  | 'auth'
  | 'quota'
  | 'network'
  | 'timeout'
  | 'provider'
  | 'cancelled'
  | 'unknown';

export interface AgentToolError {
  code: string;
  category: AgentErrorCategory;
  message: string;
  retryable: boolean;
  details?: unknown;
}

export interface AgentArtifact {
  id: string;
  kind: 'image' | 'video' | 'audio' | 'file' | 'node' | 'link' | 'other';
  name: string;
  uri?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentVerificationResult {
  status: 'passed' | 'failed' | 'pending' | 'skipped';
  summary: string;
  checkedAt: number;
  evidence?: unknown;
}

export interface AgentRunBudget {
  maxTurns: number;
  maxToolCalls: number;
  maxDurationMs: number;
  maxToolResultChars: number;
}

export type AgentRunStatus =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export type AgentRunEventType =
  | 'run_started'
  | 'model_turn'
  | 'tool_started'
  | 'tool_finished'
  | 'verification'
  | 'checkpoint'
  | 'error'
  | 'run_cancelled'
  | 'run_completed';

export interface AgentRunEvent {
  id: string;
  type: AgentRunEventType;
  at: number;
  summary: string;
  tool?: AgentToolName;
  executionId?: string;
  success?: boolean;
  durationMs?: number;
  verification?: AgentVerificationResult;
  error?: AgentToolError;
}

export interface AgentRun {
  id: string;
  conversationId?: string;
  conversationTitle?: string;
  conversationPreview?: string;
  goal: string;
  status: AgentRunStatus;
  provider: string;
  model: string;
  budget: AgentRunBudget;
  createdAt: number;
  updatedAt: number;
  startedAt: number;
  finishedAt?: number;
  turns: number;
  toolCalls: number;
  contextSummary?: string;
  resumedFromRunId?: string;
  lastError?: string;
  events: AgentRunEvent[];
  /** 该次任务对应的轻量聊天快照，用于从任务记录重新进入对话。 */
  conversation?: CanvasAgentMessage[];
}

export type AgentTrackedTaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';

export interface AgentTrackedTask {
  id: string;
  description: string;
  status: AgentTrackedTaskStatus;
  runId?: string;
  parentId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AgentToolDefinition {
  name: AgentToolName;
  description: string;
  params: Record<string, string>;
  category: ToolCategory;
  permission: PermissionMode;
  confirm?: boolean;
}

export type PermissionMode = 'read-only' | 'canvas-write' | 'full-access';

export interface AgentToolExecution {
  tool: AgentToolCall;
  result: AgentToolResult;
  startedAt: number;
  finishedAt: number;
}

export interface AgentSourceLink {
  title: string;
  url: string;
  snippet?: string;
}

export interface CanvasAgentMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt?: number;
  thinking?: string;
  thinkingOutputs?: string[];
  textOutputs?: string[];
  attachments?: Array<{
    id: string;
    name: string;
    kind: 'image' | 'audio' | 'video' | 'file';
  }>;
  mediaAnalysis?: string;
  toolExecutions?: AgentToolExecution[];
  sources?: AgentSourceLink[];
}

export type MemoryType = 'user' | 'feedback' | 'project';

export interface MemoryEntry {
  id: string;
  name: string;
  description: string;
  type: MemoryType;
  projectId?: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  originSessionId: string;
}
