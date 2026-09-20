import type { AgentToolName, PermissionMode } from './agent-types';

const TOOL_PERMISSION_MAP: Record<string, PermissionMode> = {
  get_canvas_state: 'read-only',
  get_node_capabilities: 'read-only',
  get_node_detail: 'read-only',
  configure_node: 'canvas-write',
  move_resize_node: 'canvas-write',
  execute_node_action: 'canvas-write',
  get_node_task_status: 'read-only',
  list_node_outputs: 'read-only',
  select_node_output: 'canvas-write',
  verify_node_output: 'read-only',
  add_node: 'canvas-write',
  remove_node: 'canvas-write',
  update_node: 'canvas-write',
  connect_nodes: 'canvas-write',
  disconnect_nodes: 'canvas-write',
  run_generation: 'canvas-write',
  clear_canvas: 'canvas-write',
  undo: 'canvas-write',
  redo: 'canvas-write',
  arrange_nodes: 'canvas-write',
  list_workflows: 'read-only',
  setup_workflow: 'canvas-write',
  read_file: 'read-only',
  write_file: 'full-access',
  edit_file: 'full-access',
  glob_search: 'read-only',
  grep_search: 'read-only',
  web_search: 'read-only',
  web_fetch: 'read-only',
  get_api_config: 'read-only',
  set_api_config: 'full-access',
  test_api_connection: 'full-access',
  get_project_info: 'read-only',
  list_projects: 'read-only',
  open_project: 'canvas-write',
  create_project: 'canvas-write',
  bash: 'full-access',
  task_create: 'canvas-write',
  task_update: 'canvas-write',
  sub_agent: 'canvas-write',
  get_config: 'read-only',
  plan_mode: 'read-only',
  session_info: 'read-only',
  update_user_profile: 'canvas-write',
  // 音乐控制
  music_search: 'read-only',
  music_play: 'canvas-write',
  music_pause: 'canvas-write',
  music_resume: 'canvas-write',
  music_next: 'canvas-write',
  music_prev: 'canvas-write',
  music_set_volume: 'canvas-write',
  music_get_state: 'read-only',
  music_load_playlists: 'read-only',
  music_play_playlist: 'canvas-write',
  music_get_recommend: 'read-only',
  dreamina_check_login: 'read-only',
  dreamina_install: 'full-access',
  dreamina_configure: 'full-access',
  dreamina_test: 'full-access',
  dreamina_text2image: 'canvas-write',
  dreamina_text2video: 'canvas-write',
  dreamina_image2image: 'canvas-write',
  dreamina_image2video: 'canvas-write',
  dreamina_multimodal2video: 'canvas-write',
  dreamina_list_task: 'read-only',
  dreamina_query_result: 'read-only',
  list_providers: 'read-only',
  switch_provider: 'full-access',
  add_custom_provider: 'full-access',
  remember: 'canvas-write',
  recall_memories: 'read-only',
  forget_memory: 'canvas-write',
  recall_work_style: 'read-only',
  replay_work_routine: 'canvas-write',
};

export function getToolRequiredPermission(toolName: AgentToolName | string): PermissionMode | undefined {
  return TOOL_PERMISSION_MAP[toolName];
}

export function checkPermission(
  toolName: AgentToolName | string,
  currentPermission: PermissionMode
): { allowed: boolean; reason?: string } {
  const required = TOOL_PERMISSION_MAP[toolName];
  if (!required) {
    return { allowed: false, reason: `未知工具：${toolName}` };
  }

  const levels: Record<PermissionMode, number> = {
    'read-only': 0,
    'canvas-write': 1,
    'full-access': 2,
  };

  if (levels[currentPermission] >= levels[required]) {
    return { allowed: true };
  }

  const labels: Record<PermissionMode, string> = {
    'read-only': '只读',
    'canvas-write': '画布编辑',
    'full-access': '完全访问',
  };

  return {
    allowed: false,
    reason: `工具 ${toolName} 需要「${labels[required]}」权限，当前权限为「${labels[currentPermission]}」`,
  };
}
