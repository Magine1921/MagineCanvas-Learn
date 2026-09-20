import type { AgentToolName, PermissionMode } from './agent-types';
import {
  agentRequestRequiresMutation,
  agentRequestRequiresToolExecution,
} from './agent-tool-policy.ts';

const CORE_CANVAS_TOOLS: AgentToolName[] = [
  'get_canvas_state',
  'get_node_capabilities',
  'get_node_detail',
  'configure_node',
  'move_resize_node',
  'execute_node_action',
  'get_node_task_status',
  'list_node_outputs',
  'select_node_output',
  'verify_node_output',
  'add_node',
  'remove_node',
  'update_node',
  'connect_nodes',
  'disconnect_nodes',
  'run_generation',
  'undo',
  'redo',
  'arrange_nodes',
];

const WORKFLOW_TOOLS: AgentToolName[] = [
  'list_workflows',
  'setup_workflow',
];

const READ_CONTEXT_TOOLS: AgentToolName[] = [
  'get_canvas_state',
  'get_project_info',
  'session_info',
  'recall_memories',
  'recall_work_style',
];

const DREAMINA_TOOLS: AgentToolName[] = [
  'dreamina_check_login',
  'dreamina_install',
  'dreamina_configure',
  'dreamina_test',
  'dreamina_text2image',
  'dreamina_text2video',
  'dreamina_image2image',
  'dreamina_image2video',
  'dreamina_multimodal2video',
  'dreamina_list_task',
  'dreamina_query_result',
];

const API_TOOLS: AgentToolName[] = [
  'get_api_config',
  'set_api_config',
  'test_api_connection',
  'list_providers',
  'switch_provider',
  'add_custom_provider',
  'get_config',
];

const WEB_TOOLS: AgentToolName[] = ['web_search', 'web_fetch'];
const PROJECT_READ_TOOLS: AgentToolName[] = ['list_projects', 'get_project_info'];
const FILE_TOOLS: AgentToolName[] = [
  'read_file',
  'write_file',
  'edit_file',
  'glob_search',
  'grep_search',
  'bash',
];
const MEMORY_TOOLS: AgentToolName[] = [
  'remember',
  'recall_memories',
  'forget_memory',
  'recall_work_style',
  'replay_work_routine',
  'update_user_profile',
];
const AGENT_COORDINATION_TOOLS: AgentToolName[] = [
  'task_create',
  'task_update',
  'sub_agent',
  'plan_mode',
];
const MUSIC_TOOLS: AgentToolName[] = [
  'music_search',
  'music_play',
  'music_pause',
  'music_resume',
  'music_next',
  'music_prev',
  'music_set_volume',
  'music_get_state',
  'music_load_playlists',
  'music_play_playlist',
  'music_get_recommend',
];

const TOOL_PERMISSION_LEVEL: Record<PermissionMode, number> = {
  'read-only': 0,
  'canvas-write': 1,
  'full-access': 2,
};

function selectCanvasToolsForText(text: string): AgentToolName[] {
  const selected = new Set<AgentToolName>(['get_canvas_state', 'get_node_detail']);
  const add = (...names: AgentToolName[]) => names.forEach((name) => selected.add(name));

  if (/配置|设置|修改|更新|提示词|模型|比例|时长|configure|update|prompt|model/iu.test(text)) {
    add('get_node_capabilities', 'configure_node', 'update_node');
  }
  if (/创建|新建|添加|打开.*(?:节点|浏览器)|create|add|open.*(?:node|browser)/iu.test(text)) add('add_node');
  if (/删除|移除|delete|remove/iu.test(text)) add('remove_node');
  if (/移动|缩放|尺寸|宽|高|位置|move|resize|width|height/iu.test(text)) {
    add('move_resize_node');
  }
  if (/连接|连线|断开|connect|disconnect|edge/iu.test(text)) {
    add('connect_nodes', 'disconnect_nodes');
  }
  if (/生成|制作|做|运行|执行|处理|导出|generate|run|execute|export/iu.test(text)) {
    add(
      'add_node',
      'get_node_capabilities',
      'configure_node',
      'execute_node_action',
      'run_generation',
      'get_node_task_status',
      'verify_node_output',
    );
  }
  if (/历史|产物|输出|选择|切换|预览|history|output|select|preview/iu.test(text)) {
    add('list_node_outputs', 'select_node_output', 'verify_node_output');
  }
  if (
    /浏览器|网页|网站|browser|webpage|website/iu.test(text) &&
    /打开|访问|导航|搜索|刷新|后退|前进|open|visit|navigate|search|reload|back|forward/iu.test(text)
  ) {
    add('get_node_capabilities', 'configure_node', 'execute_node_action');
  }
  if (/撤回|撤销|重做|undo|redo/iu.test(text)) add('undo', 'redo');
  if (/整理|排列|布局|arrange|layout/iu.test(text)) add('arrange_nodes');
  if (/清空|clear/iu.test(text)) add('clear_canvas');

  if (/工作流|完整流程|批量|多个|依次|workflow|batch|multiple/iu.test(text)) {
    CORE_CANVAS_TOOLS.forEach((name) => selected.add(name));
  }
  return [...selected];
}

export const DEEP_AGENT_TOOL_ALIASES: Partial<Record<AgentToolName, string>> = {
  read_file: 'project_read_file',
  write_file: 'project_write_file',
  edit_file: 'project_edit_file',
};

export function shouldUseDeepAgentRuntime(): boolean {
  return process.env.NEXT_PUBLIC_MAGINE_AGENT_ENGINE !== 'legacy';
}

export function shouldRouteToDeepAgent(text: string): boolean {
  if (!shouldUseDeepAgentRuntime()) return false;
  return agentRequestRequiresToolExecution(text);
}

/** Select one concrete mutation tool when a model ignored an explicit execution request. */
export function selectForcedAgentToolName(text: string): AgentToolName | null {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (/清空|clear/iu.test(normalized)) return 'clear_canvas';
  if (/撤回|撤销|undo/iu.test(normalized)) return 'undo';
  if (/重做|redo/iu.test(normalized)) return 'redo';
  if (/整理|排列|布局|arrange|layout/iu.test(normalized)) return 'arrange_nodes';
  if (/断开|disconnect/iu.test(normalized)) return 'disconnect_nodes';
  if (/连接|连线|connect|edge/iu.test(normalized)) return 'connect_nodes';
  if (/删除|移除|delete|remove/iu.test(normalized)) return 'remove_node';
  if (/移动|缩放|尺寸|宽|高|位置|move|resize|width|height/iu.test(normalized)) return 'move_resize_node';
  if (/配置|设置|修改|更新|提示词|模型|比例|时长|configure|update|prompt|model/iu.test(normalized)) {
    return 'configure_node';
  }
  if (/创建|新建|添加|create|add/iu.test(normalized)) return 'add_node';
  if (/生成|制作|做|运行|执行|处理|generate|run|execute/iu.test(normalized)) return 'execute_node_action';
  return null;
}

export function selectDeepAgentToolNames(
  text: string,
  permission: PermissionMode,
  availablePermissions?: Partial<Record<AgentToolName, PermissionMode>>,
): AgentToolName[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const selected = new Set<AgentToolName>(READ_CONTEXT_TOOLS);
  const requiresExecution = agentRequestRequiresToolExecution(normalized);
  if (requiresExecution && agentRequestRequiresMutation(normalized) && permission !== 'read-only') {
    CORE_CANVAS_TOOLS.forEach((name) => selected.add(name));
    WORKFLOW_TOOLS.forEach((name) => selected.add(name));
  }
  const canvasMutation = /创建|新建|添加|删除|移除|修改|更新|连接|断开|生成|制作|做|处理|运行|执行|整理|排列|清空|撤回|重做|打开|关闭|导入|导出|create|add|remove|delete|update|connect|run|arrange|open/iu.test(normalized);

  if (
    canvasMutation &&
    /画布|节点|连线|素材|文本|图片|图像|视频|全景|摄像机|浏览器|网页|故事板|分镜|角色|场景|道具|组合|区域|画质|音乐|语音|Agent|AI助手|canvas|node|edge|workflow|image|video|audio|browser/iu.test(
      normalized,
    )
  ) {
    selectCanvasToolsForText(normalized).forEach((name) => selected.add(name));
  }

  if (/工作流|流程|workflow/iu.test(normalized)) {
    WORKFLOW_TOOLS.forEach((name) => selected.add(name));
  }

  if (/即梦|Dreamina|Seedance|CLI|登录账号|浏览器账号/iu.test(normalized)) {
    DREAMINA_TOOLS.forEach((name) => selected.add(name));
  }

  if (/API|模型|供应商|provider|密钥|额度|积分|credits?|连接测试|配置/iu.test(normalized)) {
    API_TOOLS.forEach((name) => selected.add(name));
  }

  if (/搜索|联网|网页|网站|资料|文档|官网|web|search|http/iu.test(normalized)) {
    WEB_TOOLS.forEach((name) => selected.add(name));
  }

  if (/项目|工程|新建画布|打开画布|project/iu.test(normalized)) {
    PROJECT_READ_TOOLS.forEach((name) => selected.add(name));
    if (/打开|进入|open/iu.test(normalized)) selected.add('open_project');
    if (/新建|创建|create/iu.test(normalized)) selected.add('create_project');
  }

  if (/文件|目录|源码|代码|终端|命令|脚本|日志|报告|file|folder|code|shell|terminal/iu.test(normalized)) {
    FILE_TOOLS.forEach((name) => selected.add(name));
  }

  if (/记住|记忆|偏好|习惯|称呼|memory|remember/iu.test(normalized)) {
    MEMORY_TOOLS.forEach((name) => selected.add(name));
  }

  if (/音乐|歌曲|歌单|播放|暂停|音量|上一首|下一首|music|song|playlist/iu.test(normalized)) {
    MUSIC_TOOLS.forEach((name) => selected.add(name));
  }

  const complexExecution = normalized.length >= 60
    || /并且|然后|接着|随后|先.+再|全流程|完整流程|批量|多个|分步骤/iu.test(normalized);
  if (agentRequestRequiresToolExecution(normalized) && complexExecution) {
    AGENT_COORDINATION_TOOLS.forEach((name) => selected.add(name));
  }

  const currentLevel = TOOL_PERMISSION_LEVEL[permission];
  return [...selected].filter((name) => {
    const required = availablePermissions?.[name];
    if (availablePermissions && !required) return false;
    return !required || currentLevel >= TOOL_PERMISSION_LEVEL[required];
  });
}
