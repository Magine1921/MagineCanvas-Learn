import type {
  AgentToolName,
  AgentToolCall,
  AgentToolResult,
  AgentToolDefinition,
  AgentVerificationResult,
  ToolCategory,
} from './agent-types';
import { checkPermission, getToolRequiredPermission } from './agent-permissions';
import type { PermissionMode } from './agent-types';
import type { AnthropicToolDef } from '@/lib/claude-agent-stream';
import { listTemplates, getTemplateById, WORKFLOW_TEMPLATES } from '@/lib/workflow-templates';
import { normalizeAgentToolResult } from './agent-runtime';
import { useAgentRunStore } from '@/lib/agent-run-store';
import { isEditionNodeTypeDisabled } from '@/lib/edition';
import {
  canvasAgentNodeTaskState,
  collectCanvasAgentNodeOutputs,
  describeCanvasAgentNode,
  getCanvasAgentNodeCapability,
  listCanvasAgentNodeCapabilities,
  outputSelectionPatch,
  validateCanvasAgentNodePatch,
} from '@/lib/canvas-agent-capabilities';
import { probeAgentMediaOutput } from '@/lib/agent-media-verification';

// ---- Anthropic Tool 格式转换 ----

function paramDescriptionToJsonSchema(desc: string): Record<string, unknown> {
  // 简单参数描述 → JSON Schema 片段
  const lower = desc.toLowerCase();
  if (
    lower.includes('布尔') ||
    lower === 'true' ||
    lower === 'false' ||
    lower.includes('true 或 false') ||
    lower.includes('boolean') ||
    lower.includes('true/false')
  ) {
    return { type: 'boolean' };
  }
  if (
    lower.includes('坐标') ||
    lower.includes('像素') ||
    lower.includes('px') ||
    lower.includes('行号') ||
    lower.includes('offset') ||
    lower.includes('limit') ||
    lower.includes('integer') ||
    lower.includes('number') ||
    lower === 'n'
  ) {
    return { type: 'integer' };
  }
  return { type: 'string' };
}

const CANVAS_NODE_TYPE_ENUM = [
  'prompt',
  'image',
  'video',
  'agent',
  'material',
  'region',
  'storyboard',
  'panorama',
  'topazEnhance',
  'music',
  'faceCompliance',
  'browser',
];

function agentToolParamSchema(
  toolName: AgentToolName,
  key: string,
  description: string,
): Record<string, unknown> {
  if (key === 'patch_json' || key === 'params_json') {
    return { type: 'object', additionalProperties: true };
  }
  if (toolName === 'add_node' && key === 'type') {
    return { type: 'string', enum: CANVAS_NODE_TYPE_ENUM };
  }
  if (toolName === 'task_update' && key === 'status') {
    return { type: 'string', enum: ['pending', 'in_progress', 'completed', 'failed', 'cancelled'] };
  }
  if (toolName === 'verify_node_output' && key === 'kind') {
    return { type: 'string', enum: ['image', 'video', 'audio', 'file'] };
  }
  if (key === 'ratio') return { type: 'string', enum: ['9:16', '16:9'] };
  if (key === 'auto_start' || key === 'confirm' || key === 'enter') return { type: 'boolean' };
  if (key === 'duration') return { type: 'integer', minimum: 5, maximum: 180 };
  if (key === 'output_index') return { type: 'integer', minimum: 0 };
  if (key === 'width' || key === 'height') return { type: 'number', minimum: 80 };
  if (key === 'x' || key === 'y') return { type: 'number' };
  return paramDescriptionToJsonSchema(description);
}

export type ToolFilterOptions = {
  includeMusicTools?: boolean;
  includeToolNames?: ReadonlySet<AgentToolName>;
};

const HIDDEN_UNIMPLEMENTED_TOOLS = new Set<AgentToolName>([
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
]);

export function getAnthropicTools(
  permission: PermissionMode,
  options: ToolFilterOptions = {},
): AnthropicToolDef[] {
  const includeMusicTools = options.includeMusicTools !== false;
  const level: Record<PermissionMode, number> = {
    'read-only': 0,
    'canvas-write': 1,
    'full-access': 2,
  };

  return AGENT_TOOL_DEFS
    .filter((def) => {
      if (HIDDEN_UNIMPLEMENTED_TOOLS.has(def.name)) return false;
      if (!includeMusicTools && isAgentMusicToolName(def.name)) return false;
      if (options.includeToolNames && !options.includeToolNames.has(def.name)) return false;
      const requiredLevel = level[def.permission];
      return level[permission] >= requiredLevel;
    })
    .map((def) => {
      const keys = Object.keys(def.params);
      const properties: Record<string, Record<string, unknown>> = {};
      const required: string[] = [];

      for (const k of keys) {
        const schema = agentToolParamSchema(def.name, k, def.params[k]);
        properties[k] = { description: def.params[k], ...schema };

        // 判断是否必填：描述中包含 "可选" 或 "optional" 则非必填
        const lowerDesc = def.params[k].toLowerCase();
        if (!lowerDesc.includes('可选') && !lowerDesc.includes('optional')) {
          required.push(k);
        }
      }

      const inputSchema: AnthropicToolDef['input_schema'] = {
        type: 'object',
        properties: keys.length > 0 ? properties : {},
        additionalProperties: false,
      };
      if (required.length > 0) {
        inputSchema.required = required;
      }

      // 仅在非 full-access 模式下标注需确认，full-access 下所有操作直接执行
      const confirmSuffix = permission !== 'full-access' && def.confirm ? ' (需确认)' : '';

      return {
        name: def.name,
        description: def.description + confirmSuffix,
        input_schema: inputSchema,
      } satisfies AnthropicToolDef;
    });
}

// ---- Internal helper: filtered defs with JSON Schema params ----

function getFilteredToolDefs(permission: PermissionMode, options: ToolFilterOptions = {}) {
  const includeMusicTools = options.includeMusicTools !== false;
  const level: Record<PermissionMode, number> = {
    'read-only': 0,
    'canvas-write': 1,
    'full-access': 2,
  };

  return AGENT_TOOL_DEFS
    .filter((def) => {
      if (HIDDEN_UNIMPLEMENTED_TOOLS.has(def.name)) return false;
      if (!includeMusicTools && isAgentMusicToolName(def.name)) return false;
      if (options.includeToolNames && !options.includeToolNames.has(def.name)) return false;
      const requiredLevel = level[def.permission];
      return level[permission] >= requiredLevel;
    })
    .map((def) => {
      const keys = Object.keys(def.params);
      const properties: Record<string, Record<string, unknown>> = {};
      const required: string[] = [];

      for (const k of keys) {
        const schema = agentToolParamSchema(def.name, k, def.params[k]);
        properties[k] = { description: def.params[k], ...schema };

        const lowerDesc = def.params[k].toLowerCase();
        if (!lowerDesc.includes('可选') && !lowerDesc.includes('optional')) {
          required.push(k);
        }
      }

      const params: Record<string, unknown> = {
        type: 'object',
        properties: keys.length > 0 ? properties : {},
        additionalProperties: false,
      };
      if (required.length > 0) {
        params.required = required;
      }

      const confirmSuffix = permission !== 'full-access' && def.confirm ? ' (需确认)' : '';

      return { def, params, confirmSuffix };
    });
}

// ---- OpenAI Tool 格式转换（非 Claude 的 LLM 通用） ----

export type OpenAIToolDef = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export function getOpenAITools(permission: PermissionMode, options: ToolFilterOptions = {}): OpenAIToolDef[] {
  return getFilteredToolDefs(permission, options).map(({ def, params, confirmSuffix }) => ({
    type: 'function' as const,
    function: {
      name: def.name,
      description: def.description + confirmSuffix,
      parameters: params,
    },
  }));
}

// ---- Gemini functionDeclarations 格式转换 ----

export type GeminiFunctionDeclaration = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export function getGeminiFunctionDeclarations(permission: PermissionMode, options: ToolFilterOptions = {}): GeminiFunctionDeclaration[] {
  return getFilteredToolDefs(permission, options).map(({ def, params, confirmSuffix }) => ({
    name: def.name,
    description: def.description + confirmSuffix,
    parameters: params,
  }));
}

import {
  platformReadFile,
  platformWriteFile,
  platformEditFile,
  platformGlobSearch,
  platformGrepSearch,
  platformShellExec,
} from './agent-platform';
import { guardAgentMusicTool, isAgentMusicToolName } from '@/lib/voice-music-intent';
type RemovedMusicItem = {
  id: string;
  name: string;
  artists: string;
  album?: string;
  creator?: string;
  trackCount?: number;
};

type RemovedMusicState = {
  currentTrack?: RemovedMusicItem;
  progress: number;
  volume: number;
  isPlaying: boolean;
  queue: RemovedMusicItem[];
  apiConnected: boolean;
  user?: unknown;
  playlists: RemovedMusicItem[];
};

type RemovedMusicController = {
  search: (query: string) => Promise<RemovedMusicItem[]>;
  playById: (songId: string) => Promise<RemovedMusicState>;
  playByQuery: (query: string) => Promise<RemovedMusicState>;
  pause: () => void;
  resume: () => void;
  next: () => Promise<void>;
  prev: () => Promise<void>;
  setVolume: (volume: number) => void;
  getState: () => RemovedMusicState;
  loadPlaylists: () => Promise<void>;
  loadPlaylistSongs: (playlistId: string) => Promise<RemovedMusicItem[]>;
  playSong: (song: RemovedMusicItem) => Promise<RemovedMusicState>;
  loadRecommendSongs: () => Promise<RemovedMusicItem[]>;
};

const getMusicController = (): RemovedMusicController => {
  throw new Error('音乐播放服务已移除');
};
import {
  requestCanvasNodeAction,
  requestNodeGeneration,
  startNodeGenerationSequence,
} from '@/lib/canvas-generation-bridge';
import { requestCanvasNodeFocus } from '@/lib/canvas-focus-events';
import { createKlingJwt } from '@/lib/kling-jwt';
import type { SimpleCanvasLayout } from '@/lib/canvas-layout';
import {
  findWorkRoutine,
  getWorkStyleContextForPrompt,
  markWorkRoutineUsed,
  recordCanvasToolSuccess,
  recordCanvasWorkEvent,
  useCanvasWorkStyleStore,
} from '@/lib/canvas-work-style';

// ---- 工具定义 ----

export const AGENT_TOOL_DEFS: AgentToolDefinition[] = [
  // ===== Canvas =====
  {
    name: 'get_canvas_state',
    description: '获取画布当前所有节点和连线的状态摘要',
    params: {},
    category: 'canvas',
    permission: 'read-only',
  },
  {
    name: 'get_node_capabilities',
    description: 'List the supported canvas node types, configurable fields, actions and output fields.',
    params: {
      type: 'Optional node type. Omit it to list every supported node type.',
    },
    category: 'canvas',
    permission: 'read-only',
  },
  {
    name: 'get_node_detail',
    description: 'Inspect one canvas node, including safe configuration, runtime state, size and output count.',
    params: { node_id: 'Canvas node ID. Use get_canvas_state when the ID is unknown.' },
    category: 'canvas',
    permission: 'read-only',
  },
  {
    name: 'configure_node',
    description: 'Configure type-specific node fields without overwriting runtime state, history or generated outputs.',
    params: {
      node_id: 'Canvas node ID.',
      patch_json: 'JSON object string containing configuration fields. Inspect get_node_capabilities first.',
    },
    category: 'canvas',
    permission: 'canvas-write',
  },
  {
    name: 'move_resize_node',
    description: 'Move and/or resize one canvas node. Omitted geometry values remain unchanged.',
    params: {
      node_id: 'Canvas node ID.',
      x: 'Optional X canvas coordinate number.',
      y: 'Optional Y canvas coordinate number.',
      width: 'Optional width in pixels.',
      height: 'Optional height in pixels.',
    },
    category: 'canvas',
    permission: 'canvas-write',
  },
  {
    name: 'execute_node_action',
    description: 'Execute a supported node action. Inspect node capabilities first. Browser actions accept url/query in params_json.',
    params: {
      node_id: 'Canvas node ID.',
      action: 'Node action such as generate, focus, navigate, reload, back, forward, export_frame or export_video.',
      params_json: 'Optional JSON object string with action parameters.',
    },
    category: 'canvas',
    permission: 'canvas-write',
  },
  {
    name: 'get_node_task_status',
    description: 'Read the latest runtime status, progress, error, task ID and output count of a node.',
    params: { node_id: 'Canvas node ID.' },
    category: 'canvas',
    permission: 'read-only',
  },
  {
    name: 'list_node_outputs',
    description: 'List current and historical generated outputs for a node.',
    params: { node_id: 'Canvas node ID.' },
    category: 'canvas',
    permission: 'read-only',
  },
  {
    name: 'select_node_output',
    description: 'Select one historical output and display it as the node current output.',
    params: {
      node_id: 'Canvas node ID.',
      output_index: 'Output index returned by list_node_outputs.',
    },
    category: 'canvas',
    permission: 'canvas-write',
  },
  {
    name: 'verify_node_output',
    description: 'Verify that a node has a non-empty generated output matching the optional media kind.',
    params: {
      node_id: 'Canvas node ID.',
      kind: 'Optional expected kind: image, video, audio or file.',
    },
    category: 'canvas',
    permission: 'read-only',
  },
  {
    name: 'add_node',
    description: '在画布上创建一个新节点',
    params: {
      type: '节点类型：prompt|image|video|agent|material|region|storyboard|panorama|topazEnhance|music|faceCompliance|browser',
      x: '节点 X 坐标（画布像素，可选，默认300）',
      y: '节点 Y 坐标（画布像素，可选，默认200）',
      label: '节点名称（可选）',
      text: '文本内容（可选，仅 prompt/agent 类型）',
      prompt: '提示词（可选，image/video/agent 类型）',
      agentPrompt: 'Agent 系统指令（可选）',
    },
    category: 'canvas',
    permission: 'canvas-write',
  },
  {
    name: 'remove_node',
    description: '从画布删除指定节点（需要确认）',
    params: { node_id: '要删除的节点 ID' },
    category: 'canvas',
    permission: 'canvas-write',
    confirm: true,
  },
  {
    name: 'update_node',
    description: '更新节点数据（如修改文本、提示词、标签）',
    params: {
      node_id: '要更新的节点 ID',
      text: '新文本内容（可选）',
      prompt: '新提示词（可选）',
      label: '新名称（可选）',
      agentPrompt: 'Agent 系统指令（可选）',
    },
    category: 'canvas',
    permission: 'canvas-write',
  },
  {
    name: 'connect_nodes',
    description: '在两个节点之间创建连线',
    params: {
      source_id: '源节点 ID',
      target_id: '目标节点 ID',
    },
    category: 'canvas',
    permission: 'canvas-write',
  },
  {
    name: 'disconnect_nodes',
    description: '删除两个节点之间的连线',
    params: {
      source_id: '源节点 ID',
      target_id: '目标节点 ID',
    },
    category: 'canvas',
    permission: 'canvas-write',
  },
  {
    name: 'run_generation',
    description: '触发并等待支持生成动作的节点完成，包括图像、视频、音乐/语音、全景、画质提升和人脸合规',
    params: { node_id: '要触发生成的节点 ID；先读取节点能力确认支持 generate' },
    category: 'canvas',
    permission: 'canvas-write',
  },
  {
    name: 'clear_canvas',
    description: '清空整个画布（所有节点和连线）',
    params: { confirm: '必须为 true 才执行' },
    category: 'canvas',
    permission: 'canvas-write',
    confirm: true,
  },
  {
    name: 'undo',
    description: '撤销上次画布操作',
    params: {},
    category: 'canvas',
    permission: 'canvas-write',
  },
  {
    name: 'redo',
    description: '重做上次撤销的画布操作',
    params: {},
    category: 'canvas',
    permission: 'canvas-write',
  },
  {
    name: 'arrange_nodes',
    description: '自动排列画布节点位置（网格/水平/垂直）',
    params: { layout: '排列方式：flow（默认，按连线整理）| grid | horizontal | vertical' },
    category: 'canvas',
    permission: 'canvas-write',
  },
  {
    name: 'list_workflows',
    description: '列出所有可用的预设工作流模板',
    params: {},
    category: 'canvas',
    permission: 'read-only',
  },
  {
    name: 'setup_workflow',
    description: '快速搭建预设工作流（自动创建节点和连线）',
    params: {
      workflow_id: '工作流模板ID（使用 list_workflows 查看可用模板）',
    },
    category: 'canvas',
    permission: 'canvas-write',
  },
  // ===== File System =====
  {
    name: 'read_file',
    description: '读取项目中的文件内容',
    params: {
      file_path: '文件路径（相对于项目根目录）',
      offset: '起始行号（可选）',
      limit: '读取行数（可选）',
    },
    category: 'file',
    permission: 'read-only',
  },
  {
    name: 'write_file',
    description: '创建或覆写项目文件（需要确认）',
    params: {
      file_path: '文件路径（相对于项目根目录）',
      content: '要写入的文件内容',
    },
    category: 'file',
    permission: 'full-access',
    confirm: true,
  },
  {
    name: 'edit_file',
    description: '替换文件中的指定字符串（需要确认）',
    params: {
      file_path: '文件路径（相对于项目根目录）',
      old_string: '要替换的原字符串',
      new_string: '替换后的新字符串',
    },
    category: 'file',
    permission: 'full-access',
    confirm: true,
  },
  {
    name: 'glob_search',
    description: '按 glob 模式搜索文件',
    params: {
      pattern: 'Glob 匹配模式，如 **/*.tsx',
      path: '搜索目录（可选，默认项目根目录）',
    },
    category: 'file',
    permission: 'read-only',
  },
  {
    name: 'grep_search',
    description: '按正则表达式搜索文件内容',
    params: {
      pattern: '正则表达式搜索模式',
      path: '搜索目录（可选）',
      include: '文件过滤 glob（可选，如 *.ts）',
    },
    category: 'file',
    permission: 'read-only',
  },

  // ===== Web =====
  {
    name: 'web_search',
    description: '搜索互联网获取最新信息',
    params: {
      query: '搜索关键词',
      allowed_domains: '限制搜索域名（可选，JSON 数组字符串）',
    },
    category: 'web',
    permission: 'read-only',
  },
  {
    name: 'web_fetch',
    description: '获取并解析网页内容',
    params: {
      url: '目标网页 URL',
      prompt: '从网页中提取什么信息（可选）',
    },
    category: 'web',
    permission: 'read-only',
  },

  // ===== API Config =====
  {
    name: 'get_api_config',
    description: '查看当前 API 配置（密钥已脱敏）',
    params: { kind: '配置类型（可选）：image|video|llm|multimodal|enhance|elevenlabs，不填返回全部' },
    category: 'api-config',
    permission: 'read-only',
  },
  {
    name: 'set_api_config',
    description: '修改 API 配置（密钥、端点、模型），自动同步到当前活跃的 V2 Provider。支持切换 Provider',
    params: {
      kind: '配置类型：image|video|llm|multimodal|enhance|elevenlabs|claude',
      apiKey: 'API 密钥（可选）',
      apiUrl: 'API 端点 URL（可选）',
      model: '模型名称（可选，仅 multimodal/claude）',
      provider: '切换活跃 Provider（可选）：seedream|gpt-image-2|volcengine|gemini|claude|openai 等',
      voiceId: 'ElevenLabs 音色 ID（可选）',
    },
    category: 'api-config',
    permission: 'full-access',
    confirm: true,
  },
  {
    name: 'test_api_connection',
    description: '测试指定 API 的连通性',
    params: { kind: '配置类型：image|video|llm|multimodal|audio|claude|enhance' },
    category: 'api-config',
    permission: 'full-access',
  },
  {
    name: 'dreamina_check_login',
    description: '检测即梦CLI是否已登录，返回登录用户名和状态',
    params: {},
    category: 'api-config',
    permission: 'read-only',
  },
  {
    name: 'dreamina_install',
    description: '自动下载并安装即梦CLI。使用 curl -fsSL https://jimeng.jianying.com/cli | bash 在线安装脚本，支持 Windows(WSL)/Linux/macOS',
    params: {
      cli_path: '即梦CLI安装目录路径（可选，不填则使用系统默认位置）',
    },
    category: 'api-config',
    permission: 'full-access',
  },
  {
    name: 'dreamina_configure',
    description: '配置即梦CLI参数（路径、启用图片/视频生成开关）',
    params: {
      cli_path: 'CLI 二进制文件路径（可选），如 /usr/local/bin/dreamina 或 C:\\\\tools\\\\dreamina.exe',
      image_enabled: '是否在图片节点中启用即梦CLI后端（布尔值，可选）',
      video_enabled: '是否在视频节点中启用即梦CLI后端（布尔值，可选）',
    },
    category: 'api-config',
    permission: 'full-access',
  },
  {
    name: 'dreamina_test',
    description: '全面检测即梦CLI状态：检查CLI是否安装、能否执行、登录状态，并返回检测报告',
    params: {},
    category: 'api-config',
    permission: 'full-access',
  },
  {
    name: 'dreamina_text2image',
    description: '使用即梦CLI 文生图。提交 prompt 生成图片，返回 submit_id 用于后续查询',
    params: {
      prompt: '图片提示词',
      ratio: '宽高比（可选）：16:9|9:16|1:1|4:3|3:4，默认 16:9',
      resolution_type: '分辨率（可选）：1k|2k|4k，默认 2k',
      model_version: '模型版本（可选）',
      quality: '画质（可选）：standard|high',
      style: '风格（可选）',
      negative_prompt: '负面提示词（可选）',
      num_images: '生成数量（可选，默认 1）',
    },
    category: 'api-config',
    permission: 'canvas-write',
  },
  {
    name: 'dreamina_text2video',
    description: '使用即梦CLI 文生视频。提交 prompt 生成视频，返回 submit_id',
    params: {
      prompt: '视频提示词',
      ratio: '宽高比（可选）：16:9|9:16|1:1，默认 16:9',
      duration: '时长秒数（可选，Seedance 2.5 支持 4-30 秒，其他 2.0 模型支持 4-15 秒）',
      model_version: '模型版本（可选，如 seedance2.5、seedance2.0_vip）',
      resolution: '分辨率（可选；Seedance 2.5 当前 CLI 通道使用 720P）',
      negative_prompt: '负面提示词（可选）',
    },
    category: 'api-config',
    permission: 'canvas-write',
  },
  {
    name: 'dreamina_image2image',
    description: '使用即梦CLI 图生图。基于参考图生成新图片，返回 submit_id',
    params: {
      prompt: '图片提示词',
      images: '参考图路径列表（逗号分隔），如 ./ref1.jpg,./ref2.jpg',
      ratio: '宽高比（可选）：16:9|9:16|1:1|4:3|3:4，默认 16:9',
      resolution_type: '分辨率（可选）：1k|2k|4k，默认 2k',
      model_version: '模型版本（可选）',
      style: '风格（可选）',
      poll: '轮询等待秒数（可选，默认 30）',
    },
    category: 'api-config',
    permission: 'canvas-write',
  },
  {
    name: 'dreamina_image2video',
    description: '使用即梦CLI 图生视频。基于参考图生成视频，返回 submit_id',
    params: {
      prompt: '视频提示词',
      image: '主参考图路径（必填），如 ./frame.jpg',
      images: '额外参考图路径列表（可选，逗号分隔）',
      ratio: '宽高比（可选）：16:9|9:16|1:1，默认 16:9',
      duration: '时长秒数（可选，Seedance 2.5 支持 4-30 秒，其他 2.0 模型支持 4-15 秒）',
      model_version: '模型版本（可选，如 seedance2.5、seedance2.0_vip）',
      resolution: '分辨率（可选；Seedance 2.5 当前 CLI 通道使用 720P）',
    },
    category: 'api-config',
    permission: 'canvas-write',
  },
  {
    name: 'dreamina_multimodal2video',
    description: '使用即梦CLI 全能参考生成视频。支持图片+参考视频+背景音乐多模态输入，返回 submit_id',
    params: {
      prompt: '视频提示词',
      image: '主图片路径（必填）',
      video: '参考视频路径（可选）',
      audio: '背景音乐路径（可选）',
      ratio: '宽高比（可选）：16:9|9:16|1:1，默认 16:9',
      duration: '时长秒数（可选，Seedance 2.5 支持 4-30 秒，其他 2.0 模型支持 4-15 秒）',
      model_version: '模型版本（可选，如 seedance2.5、seedance2.0_vip）',
      video_resolution: '视频分辨率（可选；Seedance 2.5 当前 CLI 通道使用 720P）',
      poll: '轮询等待秒数（可选，默认 180，全能参考生成较慢）',
    },
    category: 'api-config',
    permission: 'canvas-write',
  },
  {
    name: 'dreamina_list_task',
    description: '查看即梦CLI 任务列表，可按状态过滤（success/failed/processing）',
    params: {
      gen_status: '按状态过滤（可选）：success|failed|processing',
      submit_id: '按提交ID查询（可选）',
      limit: '返回数量限制（可选，默认 20）',
    },
    category: 'api-config',
    permission: 'read-only',
  },
  {
    name: 'dreamina_query_result',
    description: '查询即梦CLI 单个任务的生成状态和结果（图片/视频 URL）',
    params: {
      submit_id: '任务提交 ID（必填）',
    },
    category: 'api-config',
    permission: 'read-only',
  },
  {
    name: 'list_providers',
    description: '列出所有可用的 API Provider（按类别分组），包括内置和自定义 provider，显示每个 provider 的活跃状态、密钥配置、模型列表、购买链接',
    params: { category: 'API 类别（可选）：image|video|audio|llm|enhance，不填返回全部' },
    category: 'api-config',
    permission: 'read-only',
  },
  {
    name: 'switch_provider',
    description: '切换当前活跃的 API Provider（如从 Seedream 切换到 GPT-Image-2）',
    params: {
      category: 'API 类别：image|video|audio|llm|enhance',
      provider_id: 'Provider ID（使用 list_providers 查看可用 ID）',
    },
    category: 'api-config',
    permission: 'full-access',
  },
  {
    name: 'add_custom_provider',
    description: '添加自定义 API Provider（如第三方兼容 API 或私有部署），需要确认',
    params: {
      category: 'API 类别：image|video|audio|llm|enhance',
      provider_id: '自定义 Provider 唯一 ID（如 my-openai）',
      label: '显示名称（如"我的 OpenAI"）',
      api_key: 'API 密钥',
      api_url: 'API 端点 URL',
      models: '模型列表（逗号分隔，如 gpt-4o,gpt-4o-mini）',
      auth_type: '鉴权方式（可选）：volcengine-bearer|gemini-bearer|standard-bearer|elevenlabs-api-key',
    },
    category: 'api-config',
    permission: 'full-access',
    confirm: true,
  },

  // ===== Project =====
  {
    name: 'get_project_info',
    description: '获取当前项目信息（名称、节点数、连线数）',
    params: {},
    category: 'project',
    permission: 'read-only',
  },
  {
    name: 'list_projects',
    description: '列出已保存的画布项目',
    params: {},
    category: 'project',
    permission: 'read-only',
  },
  {
    name: 'open_project',
    description: '打开已保存的画布项目。省略 project_id 时打开最近项目',
    params: { project_id: '项目 ID 或项目名称（可选，省略时打开最近项目）' },
    category: 'project',
    permission: 'canvas-write',
  },
  {
    name: 'create_project',
    description: '创建新画布项目，保存到本地并自动跳转进入画布编辑页面',
    params: { name: '项目名称', description: '项目描述（可选）' },
    category: 'project',
    permission: 'canvas-write',
    confirm: true,
  },

  // ===== Shell =====
  {
    name: 'bash',
    description:
      '从项目工作目录执行 shell 命令。Windows 优先使用真实 Git Bash，未安装时使用 PowerShell；其他系统使用 bash。系统破坏性命令、超时和超量输出会被 API 层阻止。',
    params: {
      command: '要执行的命令。Windows 未安装 Git Bash 时请使用 PowerShell 语法；其他情况可使用 bash 语法',
      cwd: '工作目录（可选，默认项目根目录）',
    },
    category: 'shell',
    permission: 'full-access',
    confirm: true,
  },

  // ===== Task/Agent =====
  {
    name: 'task_create',
    description: '创建一个结构化任务进行跟踪',
    params: {
      description: '任务描述',
      parent: '父任务 ID（可选）',
    },
    category: 'task',
    permission: 'canvas-write',
  },
  {
    name: 'task_update',
    description: '更新任务状态',
    params: {
      task_id: '任务 ID',
      status: '新状态：pending|in_progress|completed|failed|cancelled',
    },
    category: 'task',
    permission: 'canvas-write',
  },
  {
    name: 'sub_agent',
    description: '启动一个受限的研究/验证子 Agent。子 Agent 使用独立上下文，最多执行 6 轮，只能调用只读工具，结果返回当前 Agent',
    params: {
      prompt: '子智能体的任务描述',
      tools: '授予子智能体的工具列表（逗号分隔，可选）',
    },
    category: 'task',
    permission: 'canvas-write',
  },

  // ===== Music =====
  {
    name: 'music_search',
    description: '搜索网易云音乐歌曲',
    params: { query: '搜索关键词（歌曲名、歌手名等）' },
    category: 'music',
    permission: 'read-only',
  },
  {
    name: 'music_play',
    description: '播放歌曲。支持按搜索词播放（query）或按歌曲 ID 播放（song_id）',
    params: {
      query: '搜索关键词直接播放第一首结果（可选，与 song_id 二选一）',
      song_id: '网易云歌曲 ID（可选，与 query 二选一）',
    },
    category: 'music',
    permission: 'canvas-write',
  },
  {
    name: 'music_pause',
    description: '暂停当前播放',
    params: {},
    category: 'music',
    permission: 'canvas-write',
  },
  {
    name: 'music_resume',
    description: '继续播放',
    params: {},
    category: 'music',
    permission: 'canvas-write',
  },
  {
    name: 'music_next',
    description: '播放下一首',
    params: {},
    category: 'music',
    permission: 'canvas-write',
  },
  {
    name: 'music_prev',
    description: '播放上一首',
    params: {},
    category: 'music',
    permission: 'canvas-write',
  },
  {
    name: 'music_set_volume',
    description: '设置播放音量',
    params: { volume: '音量百分比，0-100 之间的整数' },
    category: 'music',
    permission: 'canvas-write',
  },
  {
    name: 'music_get_state',
    description: '获取当前音乐播放状态（当前曲目、进度、音量等）',
    params: {},
    category: 'music',
    permission: 'read-only',
  },
  {
    name: 'music_load_playlists',
    description: '加载用户的网易云歌单列表（需要已登录）',
    params: {},
    category: 'music',
    permission: 'read-only',
  },
  {
    name: 'music_play_playlist',
    description: '播放指定歌单中的歌曲。先加载歌单歌曲列表，再按索引或随机播放',
    params: {
      playlist_id: '歌单 ID（从 music_load_playlists 获取）',
      index: '播放第几首（可选，从0开始，默认随机）',
    },
    category: 'music',
    permission: 'canvas-write',
  },
  {
    name: 'music_get_recommend',
    description: '获取每日推荐的歌曲列表，用于发现新音乐',
    params: {},
    category: 'music',
    permission: 'read-only',
  },

  // ===== Meta =====
  {
    name: 'get_config',
    description: '读取应用配置（权限模式、模型选择、token 用量等）',
    params: { section: '配置项（可选）：permission|model|tokens|all' },
    category: 'meta',
    permission: 'read-only',
  },
  {
    name: 'plan_mode',
    description: '进入/退出规划模式（更谨慎的思考方式）',
    params: { enter: 'true 进入规划模式，false 退出' },
    category: 'meta',
    permission: 'read-only',
  },
  {
    name: 'session_info',
    description: '获取当前会话信息：消息数、token 用量、权限模式、运行时长',
    params: {},
    category: 'meta',
    permission: 'read-only',
  },
  {
    name: 'update_user_profile',
    description: '更新用户档案，如称呼、偏好等。用户说「以后叫我X」或「换个称呼」时使用此工具。',
    params: {
      name: '用户希望被如何称呼，如「马老师」「张总」「老王」等（可选）',
    },
    category: 'meta',
    permission: 'canvas-write',
  },
  {
    name: 'remember',
    description: '记录一条记忆，用于跨会话学习。当用户纠正你的行为、表达偏好、或你学到新的项目知识时使用。自动调用，无需用户指令。',
    params: {
      name: '记忆名称（简短 kebab-case 标识，如 coding-style、provider-preference）',
      description: '一句话描述这条记忆的内容',
      type: '记忆类型：user（用户身份/偏好）| feedback（用户纠正/反馈）| project（项目技术知识）',
      content: '记忆的完整内容（Markdown 格式）。feedback 类型请使用 **Why:** + **How to apply:** 格式',
    },
    category: 'memory',
    permission: 'canvas-write',
  },
  {
    name: 'recall_memories',
    description: '搜索和回顾已记录的记忆。在开始任何任务前，你应该调用此工具了解用户的偏好和历史。',
    params: {
      type: '按类型过滤（可选）：user|feedback|project，不填返回全部',
      keyword: '按关键词搜索（可选），匹配名称和内容',
      limit: '返回条数限制（可选，默认 20）',
    },
    category: 'memory',
    permission: 'read-only',
  },
  {
    name: 'forget_memory',
    description: '删除一条记忆。当用户表示某条记忆不再正确或要求忘记某事时使用。',
    params: {
      memory_id: '要删除的记忆 ID（从 recall_memories 获取）',
    },
    category: 'memory',
    permission: 'canvas-write',
  },
  {
    name: 'recall_work_style',
    description: '回顾用户在画布上的工作风格、常用节点/布局偏好，以及可一键复现的历史操作套路',
    params: {
      keyword: '按关键词筛选套路（可选）',
    },
    category: 'memory',
    permission: 'read-only',
  },
  {
    name: 'replay_work_routine',
    description: '复现用户历史成功执行过的画布操作套路。用户说「像上次一样」「再来一遍」时使用',
    params: {
      query: '套路关键词或用户原话（如「图像工作流」「像上次一样」）',
    },
    category: 'canvas',
    permission: 'canvas-write',
  },
];

// ---- 查找工具 ----

const TOOL_DEF_MAP: Record<string, AgentToolDefinition> = {};
for (const def of AGENT_TOOL_DEFS) {
  TOOL_DEF_MAP[def.name] = def;
}

export function getToolDef(name: string): AgentToolDefinition | undefined {
  return TOOL_DEF_MAP[name];
}

export function getToolsByCategory(): Record<ToolCategory, AgentToolDefinition[]> {
  const map: Record<ToolCategory, AgentToolDefinition[]> = {
    canvas: [],
    file: [],
    web: [],
    'api-config': [],
    project: [],
    shell: [],
    task: [],
    meta: [],
    music: [],
    memory: [],
  };
  for (const def of AGENT_TOOL_DEFS) {
    map[def.category].push(def);
  }
  return map;
}

function confirmationDetailsForTool(tool: AgentToolCall): { summary: string; risk: 'high' | 'medium' } {
  const p = tool.params || {};
  switch (tool.name) {
    case 'remove_node':
      return { summary: `删除节点：${String(p.node_id || '')}`, risk: 'medium' };
    case 'clear_canvas':
      return { summary: '清空整个画布，包括所有节点和连线。', risk: 'high' };
    case 'write_file':
      return { summary: `写入文件：${String(p.file_path || '')}\n内容长度：${String(p.content || '').length} 字符`, risk: 'medium' };
    case 'edit_file':
      return { summary: `编辑文件：${String(p.file_path || '')}\n替换指定字符串。`, risk: 'medium' };
    case 'set_api_config':
      return { summary: `修改 API 配置：${String(p.kind || '')}`, risk: 'medium' };
    case 'add_custom_provider':
      return { summary: `添加自定义 Provider：${String(p.category || '')}.${String(p.provider_id || '')}`, risk: 'medium' };
    case 'create_project':
      return { summary: `创建并打开项目：${String(p.name || p.title || '')}`, risk: 'medium' };
    case 'bash': {
      const command = String(p.command || '');
      const highRisk = /sudo|chown\s+\/|chmod\s+777\s+\/|shutdown|reboot|mkfs\.|dd\s+if=/i;
      return { summary: command.slice(0, 500), risk: highRisk.test(command) ? 'high' : 'medium' };
    }
    default:
      return { summary: `${tool.name}\n${JSON.stringify(p, null, 2).slice(0, 800)}`, risk: 'medium' };
  }
}

// ---- 工具调用解析 ----

export function parseToolCalls(text: string): AgentToolCall[] {
  const out: AgentToolCall[] = [];
  const seen = new Set<string>();

  const add = (tc: AgentToolCall) => {
    const key = `${tc.name}:${JSON.stringify(tc.params)}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(tc);
    }
  };

  // 1) 匹配 ```json ...``` 代码块
  const fenceRe = /```(?:json)?\s*\n?\s*([\s\S]*?)\s*```/g;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(text)) !== null) {
    const inner = m[1].trim();
    try {
      const parsed = JSON.parse(inner);
      if (isAgentToolCall(parsed)) add(parsed);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (isAgentToolCall(item)) add(item);
        }
      }
    } catch {
      // 尝试修复常见 JSON 错误
      const fixed = fixCommonJsonErrors(inner);
      if (fixed) {
        try {
          const parsed = JSON.parse(fixed);
          if (isAgentToolCall(parsed)) add(parsed);
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              if (isAgentToolCall(item)) add(item);
            }
          }
        } catch { /* skip */ }
      }
    }
  }

  // 2) 匹配独立 JSON 对象（有 params）
  const objRe = /\{\s*"name"\s*:\s*"(\w+)"\s*,\s*"params"\s*:\s*(\{[^}]*\})\s*\}/g;
  while ((m = objRe.exec(text)) !== null) {
    const name = m[1];
    if (!TOOL_DEF_MAP[name]) continue;
    try {
      const params = JSON.parse(m[2]);
      add({ name: name as AgentToolName, params });
    } catch { /* skip */ }
  }

  // 3) 无 params 的工具调用：{"name":"xxx"} 或 {"name":"xxx","params":{}}
  const noParamsRe = /\{\s*"name"\s*:\s*"(\w+)"\s*(?:,\s*"params"\s*:\s*\{[^}]*\}\s*)?\}/g;
  while ((m = noParamsRe.exec(text)) !== null) {
    const name = m[1];
    if (!TOOL_DEF_MAP[name]) continue;
    add({ name: name as AgentToolName, params: {} });
  }

  // 4) 兜底：从损坏文本中提取 "name":"tool_name" 模式
  // 匹配形如 ("name":"get_canvas_state"l 或 "name":"get_canvas_state" 的损坏 JSON
  const looseRe = /"name"\s*:\s*"(get_canvas_state|get_api_config|get_config|get_project_info|list_projects|open_project|undo|redo|clear_canvas|arrange_nodes|session_info)\s*"/g;
  while ((m = looseRe.exec(text)) !== null) {
    const name = m[1];
    if (!TOOL_DEF_MAP[name]) continue;
    // 仅对无需确认的无参工具做兜底
    const def = TOOL_DEF_MAP[name];
    if (def && !def.confirm && Object.keys(def.params).length === 0) {
      add({ name: name as AgentToolName, params: {} });
    }
  }

  // 5) [TOOL_CALL]...[/TOOL_CALL] 幻觉格式 {tool => "name", params => {...}}
  const toolCallBlockRe = /\[TOOL_CALL\]\s*([\s\S]*?)\[\/TOOL_CALL\]/g;
  while ((m = toolCallBlockRe.exec(text)) !== null) {
    const block = m[1];
    const toolMatch = /tool\s*=>\s*"(\w+)"/.exec(block);
    if (!toolMatch) continue;
    const name = toolMatch[1];
    if (!TOOL_DEF_MAP[name]) continue;

    // Extract params => {...} with brace counting
    const paramsStart = block.indexOf('params');
    let params: Record<string, unknown> = {};
    if (paramsStart !== -1) {
      const arrowIdx = block.indexOf('=>', paramsStart);
      if (arrowIdx !== -1) {
        let braceIdx = arrowIdx + 2;
        while (braceIdx < block.length && /\s/.test(block[braceIdx])) braceIdx++;
        if (block[braceIdx] === '{') {
          let depth = 1;
          let endIdx = braceIdx + 1;
          while (endIdx < block.length && depth > 0) {
            if (block[endIdx] === '{') depth++;
            else if (block[endIdx] === '}') depth--;
            endIdx++;
          }
          if (depth === 0) {
            try { params = JSON.parse(block.slice(braceIdx, endIdx)); } catch { /* use empty */ }
          }
        }
      }
    }
    add({ name: name as AgentToolName, params });
  }

  return out;
}

/** 清理助手文本中的工具调用 JSON，避免乱码显示在聊天中 */
export function cleanAssistantText(text: string): string {
  const { cleaned } = extractAndCleanText(text);
  return cleaned;
}

export interface CleanedTextResult {
  cleaned: string;
  thinking: string | undefined;
}

/** 提取思考内容并清理助手文本 */
export function extractAndCleanText(text: string): CleanedTextResult {
  const thinkingParts: string[] = [];
  const thinkOpen = '<' + 'think' + '>';
  const thinkClose = '<' + '/' + 'think' + '>';
  const thinkRe = new RegExp(thinkOpen + '([\\s\\S]*?)' + thinkClose, 'gi');
  const thinkStripRe = new RegExp(thinkOpen + '[\\s\\S]*?' + thinkClose, 'gi');
  const redactedRe = /<think>([\s\S]*?)<\/think>/gi;
  const redactedStripRe = /<think>[\s\S]*?<\/think>/gi;

  for (const match of text.matchAll(thinkRe)) {
    const part = match[1]?.trim();
    if (part) thinkingParts.push(part);
  }
  for (const match of text.matchAll(redactedRe)) {
    const part = match[1]?.trim();
    if (part) thinkingParts.push(part);
  }
  const thinking = thinkingParts.length ? thinkingParts.join('\n\n') : undefined;

  let out = text.replace(thinkStripRe, '').replace(redactedStripRe, '').trim();
  
  // 移除 ```json ...``` 代码块
  out = out.replace(/```(?:json)?\s*\n?\s*[\s\S]*?\s*```/g, '');
  // 移除 [TOOL_CALL]...[/TOOL_CALL] 幻觉块
  out = out.replace(/\[TOOL_CALL\][\s\S]*?\[\/TOOL_CALL\]/g, '');
  // 移除独立的 JSON 工具调用（含损坏形式）
  out = out.replace(/\{[^}]*"name"\s*:\s*"\w+"[^}]*\}/g, '');
  // 移除残留的损坏 JSON 片段
  out = out.replace(/\("name"\s*:\s*"\w+"[^)]*\)/g, '');
  out = out.replace(/"name"\s*:\s*"\w+"\s*[}\])]*/g, '');
  // 移除可能残留的 JSON 数组括号
  out = out.replace(/\[?\s*\{[^}]*"name"[^}]*\}\s*\]?\s*,?\s*/g, '');
  // 移除多余空行
  out = out.replace(/\n{3,}/g, '\n\n').trim();
  
  return { cleaned: out, thinking };
}

/** 尝试修复常见 LLM JSON 格式错误 */
function fixCommonJsonErrors(text: string): string | null {
  let fixed = text;
  // 括号替换（LLM 有时用括号代替花括号）
  if (fixed.startsWith('(') && fixed.endsWith(')')) {
    fixed = '{' + fixed.slice(1, -1) + '}';
  }
  // 数组括号替换
  if (fixed.startsWith('(') && fixed.includes('"name"')) {
    // 整个损坏数组
    fixed = '[' + fixed.slice(1);
    // 替换内部括号为花括号
    fixed = fixed.replace(/\(\s*"name"/g, '{"name"');
    fixed = fixed.replace(/"\s*\)/g, '"}');
    fixed = fixed.replace(/"\s*,/g, '"},');
    // 确保结尾正确
    if (!fixed.endsWith(']')) fixed = fixed.replace(/"\s*$/, '"}]');
  }
  if (fixed !== text) return fixed;
  return null;
}

function isAgentToolCall(v: unknown): v is AgentToolCall {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  if (typeof o.name !== 'string') return false;
  if (!TOOL_DEF_MAP[o.name]) return false;
  // params 可选，默认为空对象
  if (o.params != null && typeof o.params !== 'object') return false;
  return true;
}

// ---- 工具执行上下文 ----

export interface ToolExecutionContext {
  permission: PermissionMode;
  runId?: string;
  projectId?: string;
  currentUserText?: string;
  currentInputSource?: 'voice' | 'text';
  // Canvas
  getNodes(): Array<{
    id: string;
    type: string;
    data: Record<string, unknown>;
    position: { x: number; y: number };
    width?: number;
    height?: number;
  }>;
  getSelectedNodeId?(): string | null;
  getEdges(): Array<{ id: string; source: string; target: string }>;
  addNodeWithData(type: string, position: { x: number; y: number }, data: Record<string, unknown>): string;
  removeNode(nodeId: string): void;
  updateNodeData(nodeId: string, data: Record<string, unknown>): void;
  updateNodeGeometry?(
    nodeId: string,
    geometry: { x?: number; y?: number; width?: number; height?: number },
  ): void;
  setEdges(edges: Array<{ id: string; source: string; target: string; type?: string }>): void;
  pushUndoSnapshot(): void;
  undo(): void;
  redo(): void;
  clearCanvas(): void;
  applyNodeLayout(layout: SimpleCanvasLayout): void;
  // File — client-side via fetch to API routes (or direct for glob/grep)
  fetch(url: string, init?: RequestInit): Promise<Response>;
  // API config
  getSeedanceConfig(): Record<string, unknown>;
  setSeedanceConfigValue(kind: string, key: string, value: string): void;
  // Session
  getPermission(): PermissionMode;
  getTokenUsage(): { total: number };
  isPlanMode?(): boolean;
  setPlanMode?(enabled: boolean): void;
  // Confirmation — returns true if user approved, false if cancelled
  requestConfirm(details: { tool: string; summary: string; risk: 'high' | 'medium' }): Promise<boolean>;
  // Terminal — shows real-time terminal output, resolves when command completes
  requestTerminal(command: string, cwd?: string): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  // Project
  createProject(title: string, description?: string): { success: boolean; projectId?: string; message: string };
  navigateToCanvas(projectId: string): void;
  runSubAgent?(request: { prompt: string; tools?: string[] }): Promise<AgentToolResult>;
}

// ---- 统一调度器 ----

const AGENT_EXECUTION_CACHE_LIMIT = 500;
const agentExecutionCache = new Map<string, Promise<AgentToolResult>>();

function parseAgentJsonObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function optionalFiniteNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function verification(
  status: AgentVerificationResult['status'],
  summary: string,
  evidence?: unknown,
): AgentVerificationResult {
  return { status, summary, checkedAt: Date.now(), evidence };
}

async function verifyGeneratedNodeOutput(
  nodeId: string,
  ctx: ToolExecutionContext,
  expectedKind?: 'image' | 'video' | 'audio' | 'file',
): Promise<AgentVerificationResult> {
  const deadline = Date.now() + 3_000;
  let lastState: Record<string, unknown> | undefined;

  while (Date.now() <= deadline) {
    const node = ctx.getNodes().find((item) => item.id === nodeId);
    if (!node) return verification('failed', `Node ${nodeId} no longer exists.`);

    const outputs = collectCanvasAgentNodeOutputs(node)
      .filter((output) => !expectedKind || output.kind === expectedKind);
    lastState = canvasAgentNodeTaskState(node);
    const status = String(lastState.status || '').toLowerCase();
    if (['error', 'failed', 'cancelled', 'canceled'].includes(status)) {
      return verification('failed', `Node ${nodeId} generation failed.`, lastState);
    }
    for (const output of outputs) {
      const probe = await probeAgentMediaOutput(output);
      if (probe.ok) {
        return verification(
          'passed',
          `Node ${nodeId} produced a decodable ${output.kind} output.`,
          { output, probe, task: lastState },
        );
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }

  return verification(
    'failed',
    `Node ${nodeId} finished without a decodable${expectedKind ? ` ${expectedKind}` : ''} output.`,
    lastState,
  );
}

async function verifyAgentToolEffect(
  tool: AgentToolCall,
  result: AgentToolResult,
  ctx: ToolExecutionContext,
): Promise<AgentToolResult> {
  if (!result.success) return normalizeAgentToolResult(result);

  const params = tool.params || {};
  let checked: AgentVerificationResult | undefined;

  switch (tool.name) {
    case 'add_node': {
      const nodeId =
        result.data && typeof result.data === 'object'
          ? String((result.data as { nodeId?: unknown }).nodeId || '')
          : '';
      const node = nodeId ? ctx.getNodes().find((item) => item.id === nodeId) : undefined;
      checked = node
        ? verification('passed', `节点 ${nodeId} 已在画布状态中确认`, { nodeId })
        : verification('failed', '工具报告节点已创建，但画布状态中没有找到对应节点', { nodeId });
      break;
    }
    case 'remove_node': {
      const nodeId = String(params.node_id || '');
      const exists = ctx.getNodes().some((item) => item.id === nodeId);
      checked = exists
        ? verification('failed', `节点 ${nodeId} 仍然存在`)
        : verification('passed', `节点 ${nodeId} 已从画布状态中移除`);
      break;
    }
    case 'update_node': {
      const nodeId = String(params.node_id || '');
      const node = ctx.getNodes().find((item) => item.id === nodeId);
      const expected = Object.fromEntries(
        ['text', 'prompt', 'label', 'agentPrompt']
          .filter((key) => typeof params[key] === 'string')
          .map((key) => [key, params[key]]),
      );
      const mismatches = node
        ? Object.entries(expected).filter(([key, value]) => node.data[key] !== value)
        : [['node', 'missing']];
      checked = mismatches.length === 0
        ? verification('passed', `节点 ${nodeId} 的更新字段已确认`, expected)
        : verification('failed', `节点 ${nodeId} 更新后的状态与预期不一致`, { mismatches });
      break;
    }
    case 'connect_nodes': {
      const source = String(params.source_id || '');
      const target = String(params.target_id || '');
      const exists = ctx.getEdges().some((edge) => edge.source === source && edge.target === target);
      checked = exists
        ? verification('passed', `连线 ${source} → ${target} 已确认`)
        : verification('failed', `连线 ${source} → ${target} 未出现在画布状态中`);
      break;
    }
    case 'disconnect_nodes': {
      const source = String(params.source_id || '');
      const target = String(params.target_id || '');
      const exists = ctx.getEdges().some((edge) => edge.source === source && edge.target === target);
      checked = exists
        ? verification('failed', `连线 ${source} → ${target} 仍然存在`)
        : verification('passed', `连线 ${source} → ${target} 已移除`);
      break;
    }
    case 'clear_canvas': {
      const nodeCount = ctx.getNodes().length;
      const edgeCount = ctx.getEdges().length;
      checked = nodeCount === 0 && edgeCount === 0
        ? verification('passed', '画布节点和连线均已清空')
        : verification('failed', '画布清空后仍存在节点或连线', { nodeCount, edgeCount });
      break;
    }
    case 'write_file': {
      const filePath = String(params.file_path || '');
      const expected = String(params.content || '');
      const readBack = await platformReadFile(filePath);
      checked = readBack.success && readBack.content === expected
        ? verification('passed', `文件 ${filePath} 已回读确认`)
        : verification('failed', `文件 ${filePath} 写入后回读内容不一致`);
      break;
    }
    case 'edit_file': {
      const filePath = String(params.file_path || '');
      const oldString = String(params.old_string || '');
      const newString = String(params.new_string || '');
      const readBack = await platformReadFile(filePath);
      const content = readBack.content || '';
      const matches = readBack.success &&
        (newString ? content.includes(newString) : !content.includes(oldString));
      checked = matches
        ? verification('passed', `文件 ${filePath} 的编辑结果已回读确认`)
        : verification('failed', `文件 ${filePath} 编辑后未找到预期内容`);
      break;
    }
    case 'execute_node_action': {
      if (String(params.action || '').toLowerCase() === 'generate') {
        checked = await verifyGeneratedNodeOutput(String(params.node_id || ''), ctx);
      }
      break;
    }
    case 'run_generation':
      checked = await verifyGeneratedNodeOutput(String(params.node_id || ''), ctx);
      break;
  }

  if (!checked) return result;
  if (checked.status !== 'failed') return { ...result, verification: checked };
  return {
    ...result,
    success: false,
    verification: checked,
    error: {
      code: 'POSTCONDITION_FAILED',
      category: 'unknown',
      message: checked.summary,
      retryable: true,
      details: checked.evidence,
    },
    message: `${result.message}\n验证失败：${checked.summary}`,
  };
}

export async function executeAgentTool(
  tool: AgentToolCall,
  ctx: ToolExecutionContext
): Promise<AgentToolResult> {
  const executionId =
    typeof tool.params?.__agent_execution_id === 'string'
      ? tool.params.__agent_execution_id.trim()
      : '';
  if (!executionId) return executeAgentToolOnce(tool, ctx);

  const cached = agentExecutionCache.get(executionId);
  if (cached) return cached;

  const pending = executeAgentToolOnce(tool, ctx);
  agentExecutionCache.set(executionId, pending);
  if (agentExecutionCache.size > AGENT_EXECUTION_CACHE_LIMIT) {
    const oldest = agentExecutionCache.keys().next().value;
    if (oldest) agentExecutionCache.delete(oldest);
  }
  return pending;
}

async function executeAgentToolOnce(
  tool: AgentToolCall,
  ctx: ToolExecutionContext
): Promise<AgentToolResult> {
  const perm = checkPermission(tool.name, ctx.permission);
  if (!perm.allowed) {
    return normalizeAgentToolResult({ success: false, message: perm.reason ?? '权限不足' });
  }

  if (
    ctx.isPlanMode?.()
    && getToolRequiredPermission(tool.name) !== 'read-only'
    && tool.name !== 'task_create'
    && tool.name !== 'task_update'
    && tool.name !== 'sub_agent'
    && tool.name !== 'plan_mode'
  ) {
    return normalizeAgentToolResult({
      success: false,
      message: `Plan mode is active. Exit plan mode before executing ${tool.name}.`,
    });
  }

  const def = TOOL_DEF_MAP[tool.name];
  const alreadyConfirmed = tool.params?.__agent_confirmed === true;
  if (def?.confirm && !alreadyConfirmed) {
    const approved = await ctx.requestConfirm({
      tool: tool.name,
      ...confirmationDetailsForTool(tool),
    });
    if (!approved) {
      return normalizeAgentToolResult({ success: false, message: `用户取消了 ${tool.name} 操作` });
    }
    tool = { ...tool, params: { ...tool.params, __agent_confirmed: true } };
  }

  const result = await verifyAgentToolEffect(
    tool,
    normalizeAgentToolResult(await executeAgentToolImpl(tool, ctx)),
    ctx,
  );
  if (result.success) {
    const recordParams = Object.fromEntries(
      Object.entries(tool.params || {}).filter(([key]) => !key.startsWith('__')),
    );
    recordCanvasToolSuccess(tool.name, recordParams);
  }
  return result;
}

async function executeAgentToolImpl(
  tool: AgentToolCall,
  ctx: ToolExecutionContext
): Promise<AgentToolResult> {
  // 权限检查
  const perm = checkPermission(tool.name, ctx.permission);
  if (!perm.allowed) {
    return { success: false, message: perm.reason ?? '权限不足' };
  }

  const { name, params } = tool;
  const musicGuard = guardAgentMusicTool(name, ctx.currentUserText);
  if (!musicGuard.allowed) {
    return { success: false, message: musicGuard.message || '已忽略音乐操作' };
  }

  try {
    switch (name) {
      // ===== Canvas =====
      case 'get_canvas_state': {
        const nodes = ctx.getNodes();
        const edges = ctx.getEdges();
        const runtimeKeys = [
          'status',
          'statusMessage',
          'progress',
          'isLoading',
          'currentSequenceIndex',
          'activeSequenceIndex',
          'sequenceIndex',
        ] as const;
        const nodeList = nodes
          .map((n) => {
            const runtime = runtimeKeys.flatMap((key) => {
              const value = n.data[key];
              if (value === undefined || value === null || value === '') return [];
              const serialized = typeof value === 'string'
                ? value.replace(/\s+/g, ' ').slice(0, 500)
                : String(value);
              return [`${key}=${serialized}`];
            });
            const runtimeText = runtime.length > 0 ? ` | ${runtime.join(' | ')}` : '';
            return `- ${n.id} (${n.data.type || n.type}): "${n.data.label || ''}" @(${Math.round(n.position.x)},${Math.round(n.position.y)})${runtimeText}`;
          })
          .join('\n');
        const edgeList = edges.map((e) => `- ${e.source} → ${e.target}`).join('\n');
        return {
          success: true,
          message: `节点 (${nodes.length}):\n${nodeList || '(无)'}\n\n连线 (${edges.length}):\n${edgeList || '(无)'}`,
          data: {
            nodes: nodes.map((node) => ({
              id: node.id,
              type: node.type,
              label: node.data.label || '',
              position: node.position,
              status: canvasAgentNodeTaskState(node).status,
              outputCount: collectCanvasAgentNodeOutputs(node).length,
            })),
            edges: edges.map((edge) => ({
              id: edge.id,
              source: edge.source,
              target: edge.target,
            })),
          },
        };
      }

      case 'get_node_capabilities': {
        const requestedType = typeof params.type === 'string' ? params.type.trim() : '';
        if (requestedType) {
          if (isEditionNodeTypeDisabled(requestedType)) {
            return { success: false, message: `Node type ${requestedType} is not available in this edition.` };
          }
          const nodeCapability = getCanvasAgentNodeCapability(requestedType);
          return nodeCapability
            ? { success: true, message: `Capabilities for ${requestedType}`, data: nodeCapability }
            : { success: false, message: `Unsupported node type: ${requestedType}` };
        }
        const capabilities = listCanvasAgentNodeCapabilities()
          .filter((item) => !isEditionNodeTypeDisabled(item.type));
        return {
          success: true,
          message: `${capabilities.length} canvas node types are available.`,
          data: capabilities,
        };
      }

      case 'get_node_detail': {
        const nodeId = String(params.node_id || '').trim();
        const node = ctx.getNodes().find((item) => item.id === nodeId);
        if (!node) return { success: false, message: `Node ${nodeId || '(missing ID)'} does not exist.` };
        return {
          success: true,
          message: `Node ${nodeId} inspected.`,
          data: describeCanvasAgentNode(node),
        };
      }

      case 'configure_node': {
        const nodeId = String(params.node_id || '').trim();
        const node = ctx.getNodes().find((item) => item.id === nodeId);
        if (!node) return { success: false, message: `Node ${nodeId || '(missing ID)'} does not exist.` };
        const patch = parseAgentJsonObject(params.patch_json);
        if (!patch || Object.keys(patch).length === 0) {
          return { success: false, message: 'patch_json must be a non-empty JSON object.' };
        }
        const checkedPatch = validateCanvasAgentNodePatch(node.type, patch);
        if (!checkedPatch.valid) return { success: false, message: checkedPatch.message };
        ctx.pushUndoSnapshot();
        ctx.updateNodeData(nodeId, checkedPatch.patch);
        const updated = ctx.getNodes().find((item) => item.id === nodeId);
        const mismatches = Object.entries(checkedPatch.patch)
          .filter(([key, value]) => updated?.data[key] !== value)
          .map(([key]) => key);
        if (mismatches.length > 0) {
          return {
            success: false,
            message: `Node ${nodeId} configuration did not persist: ${mismatches.join(', ')}`,
            verification: verification('failed', 'Configured values did not match the canvas state.', { mismatches }),
          };
        }
        return {
          success: true,
          message: `Node ${nodeId} configured: ${Object.keys(checkedPatch.patch).join(', ')}`,
          data: describeCanvasAgentNode(updated || node),
          verification: verification('passed', 'Node configuration matches the canvas state.'),
        };
      }

      case 'move_resize_node': {
        const nodeId = String(params.node_id || '').trim();
        const node = ctx.getNodes().find((item) => item.id === nodeId);
        if (!node) return { success: false, message: `Node ${nodeId || '(missing ID)'} does not exist.` };
        if (!ctx.updateNodeGeometry) return { success: false, message: 'Node geometry editing is unavailable.' };
        const geometry = {
          x: optionalFiniteNumber(params.x),
          y: optionalFiniteNumber(params.y),
          width: optionalFiniteNumber(params.width),
          height: optionalFiniteNumber(params.height),
        };
        if (Object.values(geometry).every((value) => value === undefined)) {
          return { success: false, message: 'Provide at least one of x, y, width or height.' };
        }
        if ((geometry.width !== undefined && geometry.width < 80) || (geometry.height !== undefined && geometry.height < 80)) {
          return { success: false, message: 'Node width and height must be at least 80 pixels.' };
        }
        ctx.pushUndoSnapshot();
        ctx.updateNodeGeometry(nodeId, geometry);
        const updated = ctx.getNodes().find((item) => item.id === nodeId);
        return {
          success: true,
          message: `Node ${nodeId} geometry updated.`,
          data: updated ? describeCanvasAgentNode(updated) : { nodeId, geometry },
          verification: verification('passed', 'Node geometry update was written to canvas state.'),
        };
      }

      case 'execute_node_action': {
        const nodeId = String(params.node_id || '').trim();
        const action = String(params.action || '').trim().toLowerCase();
        const node = ctx.getNodes().find((item) => item.id === nodeId);
        if (!node) return { success: false, message: `Node ${nodeId || '(missing ID)'} does not exist.` };
        if (action === 'focus') {
          requestCanvasNodeFocus([nodeId], nodeId);
          return { success: true, message: `Focused node ${nodeId}.`, data: { nodeId, action } };
        }
        const nodeCapability = getCanvasAgentNodeCapability(node.type);
        if (!nodeCapability?.actions.some((item) => item === action)) {
          return {
            success: false,
            message: `Node type ${node.type} does not expose action ${action || '(missing)'}.`,
          };
        }
        const actionParams = parseAgentJsonObject(params.params_json) || {};
        const result = action === 'generate'
          ? await requestNodeGeneration(nodeId)
          : await requestCanvasNodeAction(nodeId, action, actionParams);
        const updated = ctx.getNodes().find((item) => item.id === nodeId);
        const outputs = updated ? collectCanvasAgentNodeOutputs(updated) : [];
        return {
          ...result,
          data: result.success ? { nodeId, action, accepted: true, outputCount: outputs.length } : undefined,
          verification: result.success
            ? verification(
              action === 'generate' && outputs.length === 0 ? 'pending' : 'passed',
              outputs.length > 0
                ? `Node action completed with ${outputs.length} available output(s).`
                : 'Node action was accepted; use get_node_task_status and verify_node_output to confirm completion.',
            )
            : verification('failed', result.message),
        };
      }

      case 'get_node_task_status': {
        const nodeId = String(params.node_id || '').trim();
        const node = ctx.getNodes().find((item) => item.id === nodeId);
        if (!node) return { success: false, message: `Node ${nodeId || '(missing ID)'} does not exist.` };
        const taskState = canvasAgentNodeTaskState(node);
        return { success: true, message: `Task status for node ${nodeId}: ${String(taskState.status)}`, data: taskState };
      }

      case 'list_node_outputs': {
        const nodeId = String(params.node_id || '').trim();
        const node = ctx.getNodes().find((item) => item.id === nodeId);
        if (!node) return { success: false, message: `Node ${nodeId || '(missing ID)'} does not exist.` };
        const outputs = collectCanvasAgentNodeOutputs(node);
        return {
          success: true,
          message: outputs.length > 0 ? `Node ${nodeId} has ${outputs.length} output(s).` : `Node ${nodeId} has no output.`,
          data: outputs,
        };
      }

      case 'select_node_output': {
        const nodeId = String(params.node_id || '').trim();
        const outputIndex = optionalFiniteNumber(params.output_index);
        const node = ctx.getNodes().find((item) => item.id === nodeId);
        if (!node) return { success: false, message: `Node ${nodeId || '(missing ID)'} does not exist.` };
        if (outputIndex === undefined || !Number.isInteger(outputIndex)) {
          return { success: false, message: 'output_index must be an integer returned by list_node_outputs.' };
        }
        const output = collectCanvasAgentNodeOutputs(node)[outputIndex];
        if (!output) return { success: false, message: `Output index ${outputIndex} does not exist on node ${nodeId}.` };
        const patch = outputSelectionPatch(node.type, output);
        if (!patch) return { success: false, message: `Node type ${node.type} cannot select a historical output.` };
        ctx.pushUndoSnapshot();
        ctx.updateNodeData(nodeId, patch);
        return {
          success: true,
          message: `Selected output ${outputIndex} on node ${nodeId}.`,
          data: { nodeId, output, patch },
          verification: verification('passed', 'Selected output was written as the current node output.', output),
        };
      }

      case 'verify_node_output': {
        const nodeId = String(params.node_id || '').trim();
        const expectedKind = typeof params.kind === 'string' ? params.kind.trim().toLowerCase() : '';
        const node = ctx.getNodes().find((item) => item.id === nodeId);
        if (!node) return { success: false, message: `Node ${nodeId || '(missing ID)'} does not exist.` };
        const outputs = collectCanvasAgentNodeOutputs(node);
        const matched = expectedKind ? outputs.filter((output) => output.kind === expectedKind) : outputs;
        if (matched.length === 0) {
          const summary = expectedKind
            ? `Node ${nodeId} has no ${expectedKind} output.`
            : `Node ${nodeId} has no generated output.`;
          return {
            success: false,
            message: summary,
            verification: verification('failed', summary, { outputs }),
          };
        }
        const probes = await Promise.all(
          matched.map(async (output) => ({ output, probe: await probeAgentMediaOutput(output) })),
        );
        const playable = probes.filter((item) => item.probe.ok);
        if (playable.length === 0) {
          const summary = `Node ${nodeId} has outputs, but none could be decoded.`;
          return {
            success: false,
            message: summary,
            data: matched,
            verification: verification('failed', summary, probes),
          };
        }
        return {
          success: true,
          message: `Verified ${playable.length} decodable ${expectedKind || 'generated'} output(s) on node ${nodeId}.`,
          data: playable.map((item) => item.output),
          verification: verification('passed', 'Node output exists and is decodable.', playable),
        };
      }

      case 'add_node': {
        const nodeType = String(params.type || 'prompt');
        if (!getCanvasAgentNodeCapability(nodeType)) {
          return { success: false, message: `Unsupported canvas node type: ${nodeType}` };
        }
        if (isEditionNodeTypeDisabled(nodeType)) {
          return { success: false, message: '当前版本不提供该节点功能' };
        }
        const x = typeof params.x === 'number' ? params.x : 300;
        const y = typeof params.y === 'number' ? params.y : 200;
        const data: Record<string, unknown> = {};
        if (typeof params.label === 'string') data.label = params.label;
        if (typeof params.text === 'string') data.text = params.text;
        if (typeof params.prompt === 'string') data.prompt = params.prompt;
        if (typeof params.agentPrompt === 'string') data.agentPrompt = params.agentPrompt;
        ctx.pushUndoSnapshot();
        const nodeId = ctx.addNodeWithData(nodeType, { x, y }, data);
        return {
          success: true,
          message: `节点 ${nodeId} (${nodeType}) 已创建于 (${x}, ${y})`,
          data: { nodeId, nodeType, position: { x, y } },
          artifacts: [{ id: nodeId, kind: 'node', name: String(data.label || nodeType) }],
        };
      }

      case 'remove_node': {
        const nodeId = String(params.node_id || '');
        if (!nodeId) return { success: false, message: '缺少 node_id 参数' };
        ctx.pushUndoSnapshot();
        ctx.removeNode(nodeId);
        return { success: true, message: `节点 ${nodeId} 已删除` };
      }

      case 'update_node': {
        const nodeId = String(params.node_id || '');
        const node = ctx.getNodes().find((item) => item.id === nodeId);
        if (!node) return { success: false, message: `Node ${nodeId || '(missing ID)'} does not exist.` };
        if (!nodeId) return { success: false, message: '缺少 node_id 参数' };
        const data: Record<string, unknown> = {};
        if (typeof params.text === 'string') data.text = params.text;
        if (typeof params.prompt === 'string') data.prompt = params.prompt;
        if (typeof params.label === 'string') data.label = params.label;
        if (typeof params.agentPrompt === 'string') data.agentPrompt = params.agentPrompt;
        const checkedPatch = validateCanvasAgentNodePatch(node.type, data);
        if (!checkedPatch.valid) return { success: false, message: checkedPatch.message };
        if (Object.keys(data).length === 0) return { success: false, message: '没有提供要更新的字段' };
        ctx.pushUndoSnapshot();
        ctx.updateNodeData(nodeId, checkedPatch.patch);
        return { success: true, message: `节点 ${nodeId} 已更新：${Object.keys(data).join(', ')}` };
      }

      case 'connect_nodes': {
        const sourceId = String(params.source_id || '');
        const targetId = String(params.target_id || '');
        if (!sourceId || !targetId) return { success: false, message: '缺少 source_id 或 target_id' };
        const existing = ctx.getEdges();
        if (existing.some((e) => e.source === sourceId && e.target === targetId)) {
          return { success: false, message: `连线 ${sourceId} → ${targetId} 已存在` };
        }
        ctx.pushUndoSnapshot();
        const newEdge = {
          id: `e-${sourceId}-${targetId}-${Date.now()}`,
          source: sourceId,
          target: targetId,
          type: 'beam' as const,
        };
        ctx.setEdges([...existing, newEdge]);
        return { success: true, message: `连线 ${sourceId} → ${targetId} 已创建` };
      }

      case 'disconnect_nodes': {
        const sourceId = String(params.source_id || '');
        const targetId = String(params.target_id || '');
        if (!sourceId || !targetId) return { success: false, message: '缺少 source_id 或 target_id' };
        const existing = ctx.getEdges();
        const filtered = existing.filter((e) => !(e.source === sourceId && e.target === targetId));
        if (filtered.length === existing.length) {
          return { success: false, message: `连线 ${sourceId} → ${targetId} 不存在` };
        }
        ctx.pushUndoSnapshot();
        ctx.setEdges(filtered);
        return { success: true, message: `连线 ${sourceId} → ${targetId} 已删除` };
      }

      case 'run_generation': {
        const nodeId = String(params.node_id || '');
        if (!nodeId) return { success: false, message: '缺少 node_id 参数' };
        const node = ctx.getNodes().find((n) => n.id === nodeId);
        if (!node) return { success: false, message: `节点 ${nodeId} 不存在` };
        const nodeType = String(node.data.type || node.type || '');
        const nodeCapability = getCanvasAgentNodeCapability(nodeType);
        if (!nodeCapability?.actions.includes('generate')) {
          return {
            success: false,
            message: `节点 ${nodeId} 类型为 ${nodeType}，该节点没有注册 generate 动作`,
          };
        }
        const result = await requestNodeGeneration(nodeId);
        return {
          ...result,
          data: result.success ? { nodeId, accepted: true } : undefined,
        };
      }

      case 'clear_canvas': {
        // 在 full-access 模式下直接执行，否则需要确认参数
        if (ctx.permission !== 'full-access' && params.confirm !== true && params.__agent_confirmed !== true) {
          return { success: false, message: '清空画布需要 confirm: true 参数来确认操作' };
        }
        ctx.clearCanvas();
        return { success: true, message: '画布已清空' };
      }

      case 'undo': {
        ctx.undo();
        return { success: true, message: '已撤销' };
      }

      case 'redo': {
        ctx.redo();
        return { success: true, message: '已重做' };
      }

      case 'arrange_nodes': {
        const rawLayout = String(params.layout || 'flow');
        const layout: SimpleCanvasLayout =
          rawLayout === 'grid' || rawLayout === 'horizontal' || rawLayout === 'vertical' || rawLayout === 'flow'
            ? rawLayout
            : 'flow';
        const nodes = ctx.getNodes();
        if (nodes.length === 0) return { success: false, message: '画布上没有节点' };
        ctx.pushUndoSnapshot();
        ctx.applyNodeLayout(layout);
        recordCanvasWorkEvent('layout', layout);
        return { success: true, message: `已按 ${layout} 布局排列 ${nodes.length} 个节点` };
      }

      case 'list_workflows': {
        const templates = listTemplates();
        return {
          success: true,
          message: JSON.stringify({
            total: templates.length,
            templates: templates,
          }, null, 2),
        };
      }

      case 'setup_workflow': {
        const workflowId = String(params.workflow_id || '');
        if (!workflowId) return { success: false, message: '缺少 workflow_id 参数' };

        const template = getTemplateById(workflowId);
        if (!template) {
          const available = listTemplates().map(t => t.id).join(', ');
          return { success: false, message: `未找到工作流模板 "${workflowId}"，可用模板: ${available}` };
        }
        if (template.nodes.some((node) => isEditionNodeTypeDisabled(node.type))) {
          return { success: false, message: '当前版本不提供该工作流中的受限节点功能' };
        }

        // 创建节点
        const nodeIdMap: Record<string, string> = {};
        for (const nodeTemplate of template.nodes) {
          const data: Record<string, unknown> = {
            label: nodeTemplate.label,
            ...nodeTemplate.data,
          };
          const nodeId = ctx.addNodeWithData(nodeTemplate.type, {
            x: nodeTemplate.x,
            y: nodeTemplate.y,
          }, data);
          nodeIdMap[nodeTemplate.id] = nodeId;
        }

        // 创建连线（使用与 connect_nodes 相同的逻辑）
        const existing = ctx.getEdges();
        const newEdges = [];
        for (const edgeTemplate of template.edges) {
          const sourceId = nodeIdMap[edgeTemplate.source];
          const targetId = nodeIdMap[edgeTemplate.target];
          if (sourceId && targetId && !existing.some((e) => e.source === sourceId && e.target === targetId)) {
            newEdges.push({
              id: `wf-e-${sourceId}-${targetId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              source: sourceId,
              target: targetId,
              type: 'beam' as const,
            });
          }
        }

        if (newEdges.length > 0) {
          ctx.pushUndoSnapshot();
          ctx.setEdges([...existing, ...newEdges]);
        }

        recordCanvasWorkEvent('workflow_setup', workflowId);
        return {
          success: true,
          message: `已搭建工作流「${template.name}」：${template.nodes.length} 个节点，${newEdges.length} 条连线`,
        };
      }

      // ===== File System =====（Electron IPC 优先，API 兜底）
      case 'read_file': {
        const filePath = String(params.file_path || '');
        if (!filePath) return { success: false, message: '缺少 file_path 参数' };
        const offset = typeof params.offset === 'number' ? params.offset : undefined;
        const limit = typeof params.limit === 'number' ? params.limit : undefined;
        const data = await platformReadFile(filePath, offset, limit);
        return { success: data.success, message: data.success ? (data.content || '') : (data.error || '读取失败') };
      }

      case 'write_file': {
        const filePath = String(params.file_path || '');
        const content = String(params.content || '');
        if (!filePath) return { success: false, message: '缺少 file_path 参数' };

        // Confirm writes to system paths or sensitive files
        const isSystemPath = /^\/(etc|usr|opt|var|boot|root|srv|tmp\/systemd|sys|proc|dev)\/|^[A-Z]:\\(Windows|Program\sFiles|ProgramData|System32)/i;
        const isSensitive = /\.env$|\.config$|\.ini$|\.conf$|package\.json$|tsconfig\.json$/i;
        if (params.__agent_confirmed !== true && (isSystemPath.test(filePath) || isSensitive.test(filePath))) {
          const approved = await ctx.requestConfirm({
            tool: 'write_file',
            summary: `写入文件：${filePath}\n内容长度：${content.length} 字符`,
            risk: isSystemPath.test(filePath) ? 'high' : 'medium',
          });
          if (!approved) return { success: false, message: '用户取消了该文件写入操作' };
        }

        const data = await platformWriteFile(filePath, content);
        return { success: data.success, message: data.success ? (data.message || '写入成功') : (data.error || '写入失败') };
      }

      case 'edit_file': {
        const filePath = String(params.file_path || '');
        const oldStr = String(params.old_string || '');
        const newStr = String(params.new_string || '');
        if (!filePath || !oldStr) return { success: false, message: '缺少 file_path 或 old_string 参数' };

        // Confirm edits to system paths or sensitive files
        const isSystemPath = /^\/(etc|usr|opt|var|boot|root|srv|tmp\/systemd|sys|proc|dev)\/|^[A-Z]:\\(Windows|Program\sFiles|ProgramData|System32)/i;
        const isSensitive = /\.env$|\.config$|\.ini$|\.conf$|package\.json$|tsconfig\.json$/i;
        if (params.__agent_confirmed !== true && (isSystemPath.test(filePath) || isSensitive.test(filePath))) {
          const approved = await ctx.requestConfirm({
            tool: 'edit_file',
            summary: `编辑文件：${filePath}\n替换字符串`,
            risk: isSystemPath.test(filePath) ? 'high' : 'medium',
          });
          if (!approved) return { success: false, message: '用户取消了该文件编辑操作' };
        }

        const data = await platformEditFile(filePath, oldStr, newStr);
        return { success: data.success, message: data.success ? (data.message || '编辑成功') : (data.error || '编辑失败') };
      }

      case 'glob_search': {
        const pattern = String(params.pattern || '');
        if (!pattern) return { success: false, message: '缺少 pattern 参数' };
        const searchPath = typeof params.path === 'string' ? params.path : undefined;
        const data = await platformGlobSearch(pattern, searchPath);
        if (!data.success) return { success: false, message: data.error || '搜索失败' };
        const files: string[] = data.files ?? [];
        return { success: true, message: files.length ? `找到 ${files.length} 个文件:\n${files.map((f) => `- ${f}`).join('\n')}` : '未找到匹配的文件' };
      }

      case 'grep_search': {
        const pattern = String(params.pattern || '');
        if (!pattern) return { success: false, message: '缺少 pattern 参数' };
        const searchPath = typeof params.path === 'string' ? params.path : undefined;
        const include = typeof params.include === 'string' ? params.include : undefined;
        const data = await platformGrepSearch(pattern, searchPath, include);
        if (!data.success) return { success: false, message: data.error || '搜索失败' };
        const matches = data.matches ?? [];
        if (!matches.length) return { success: true, message: '未找到匹配内容' };
        const lines = matches.map((m) => `- ${m.file}:${m.line}  ${m.content.slice(0, 120)}`);
        return { success: true, message: `找到 ${matches.length} 处匹配:\n${lines.join('\n')}` };
      }

      // ===== Web =====
      case 'web_search': {
        const query = String(params.query || '');
        if (!query) return { success: false, message: '缺少 query 参数' };
        const res = await ctx.fetch('/api/agent/web', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'search', query, allowed_domains: params.allowed_domains }),
        });
        return (await res.json()) as AgentToolResult;
      }

      case 'web_fetch': {
        const url = String(params.url || '');
        if (!url) return { success: false, message: '缺少 url 参数' };
        const res = await ctx.fetch('/api/agent/web', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'fetch', url, prompt: params.prompt }),
        });
        return (await res.json()) as AgentToolResult;
      }

      // ===== API Config =====
      case 'get_api_config': {
        const kind = typeof params.kind === 'string' ? params.kind : undefined;
        const config = ctx.getSeedanceConfig();
        const maskKey = (k: unknown) => {
          const s = String(k ?? '');
          if (s.length <= 8) return '***';
          return s.slice(0, 4) + '...' + s.slice(-4);
        };
        const kinds = kind ? [kind] : ['image', 'video', 'llm', 'multimodal', 'enhance', 'elevenlabs', 'dreamina'];
        const lines: string[] = [];

        const readV2Cat = (catKey: string, legacyKey?: string, legacyModel?: string): string[] => {
          const cat = config[catKey] as Record<string, unknown> | undefined;
          if (!cat) {
            const legacy = legacyKey
              ? config[legacyKey] as Record<string, unknown> | undefined
              : undefined;
            if (legacy) {
              return [`  活跃: (旧版) | key=${maskKey(legacy.apiKey)}, url=${legacy.apiUrl || '(默认)'}${legacyModel ? ', model=' + legacy.model : ''}`];
            }
            return ['  (未配置)'];
          }
          const active = String(cat.activeProviderId || '');
          const providers = (cat.providers || {}) as Record<string, Record<string, unknown>>;
          const customProviders = (cat.customProviders || {}) as Record<string, Record<string, unknown>>;
          const allProviderIds = [...Object.keys(providers), ...Object.keys(customProviders)];

          const out: string[] = [];
          out.push(`  活跃 Provider: ${active || '(无)'}`);

          // Show config for active provider
          const activeProvider = providers[active] || customProviders[active];
          if (activeProvider) {
            out.push(`  端点: ${activeProvider.apiUrl || '(默认)'} | 密钥: ${maskKey(activeProvider.apiKey)}`);
            if (activeProvider.models && Array.isArray(activeProvider.models) && activeProvider.models.length > 0) {
              out.push(`  模型: ${activeProvider.models.join(', ')}`);
            }
          }

          // List all available providers
          const availList = allProviderIds.map((pid) => {
            const p = providers[pid] || customProviders[pid];
            const isActive = pid === active ? '★' : ' ';
            const hasKey = p?.apiKey ? '已配' : '未配';
            const isCustom = pid in customProviders ? '[自定义]' : '';
            return `  ${isActive} ${pid} (${hasKey}) ${isCustom}`;
          });
          out.push(`  全部 Provider (${allProviderIds.length}):`);
          out.push(...availList);

          return out;
        };

        for (const k of kinds) {
          if (k === 'dreamina') {
            const dc = config['dreaminaCli'] as Record<string, unknown> | undefined;
            lines.push(
              `=== 即梦CLI ===\n  path=${dc?.cliPath || 'dreamina'}, loggedIn=${dc?.loggedIn ? '是(' + (dc?.loginName || '') + ')' : '否'}, 图片=${dc?.imageEnabled ? '开' : '关'}, 视频=${dc?.videoEnabled ? '开' : '关'}`
            );
            continue;
          }
          if (k === 'elevenlabs') {
            const el = config['elevenLabs'] as { voiceId?: string; apiKey?: string } | undefined;
            lines.push(`=== 语音 ===\n  voiceId=${el?.voiceId ?? '(默认)'}, apiKey=${maskKey(el?.apiKey)}`);
            const audioInfo = readV2Cat('audio', 'elevenLabs');
            lines.push(...audioInfo);
            continue;
          }
          if (k === 'multimodal') {
            const mm = config['multimodalApi'] as Record<string, unknown> | undefined;
            lines.push(`=== 多模态 (Gemini) ===\n  key=${maskKey(mm?.apiKey)}, url=${mm?.apiUrl || '(默认)'}, model=${mm?.model || '(默认)'}`);
            continue;
          }

          // image, video, llm, enhance — show V2 provider info
          const v2CatKey = k; // 'image', 'video', 'llm', 'enhance'
          const legacyKey = k === 'llm' ? undefined : `${k}Api`;
          const labelMap: Record<string, string> = { image: '图片生成', video: '视频生成', llm: 'LLM', enhance: '画质增强' };
          lines.push(`=== ${labelMap[k] || k} ===`);
          const v2Info = readV2Cat(v2CatKey, legacyKey);
          lines.push(...v2Info);
        }
        return { success: true, message: lines.join('\n') };
      }

      case 'set_api_config': {
        const kind = String(params.kind || '');
        if (!kind) return { success: false, message: '缺少 kind 参数' };
        if (typeof params.apiKey === 'string') ctx.setSeedanceConfigValue(kind, 'apiKey', params.apiKey);
        if (typeof params.apiUrl === 'string') ctx.setSeedanceConfigValue(kind, 'apiUrl', params.apiUrl);
        if (typeof params.model === 'string') ctx.setSeedanceConfigValue(kind, 'model', params.model);
        if (typeof params.provider === 'string') ctx.setSeedanceConfigValue(kind, 'provider', params.provider);
        if (typeof params.agentId === 'string') ctx.setSeedanceConfigValue(kind, 'voiceId', params.agentId);
        return { success: true, message: `${kind} API 配置已更新` };
      }

      case 'test_api_connection': {
        const kind = String(params.kind || '');
        if (!kind) return { success: false, message: '缺少 kind 参数' };
        const supported = ['image', 'video', 'llm', 'multimodal', 'audio', 'claude', 'enhance'];
        if (!supported.includes(kind)) {
          return { success: false, message: `不支持的配置类型：${kind}，支持：${supported.join(', ')}` };
        }

        const config = ctx.getSeedanceConfig();
        const proxyJson = async (
          proxyPath: '/api/proxy/openai' | '/api/proxy/volcengine' | '/api/proxy/gemini',
          targetUrl: string,
          apiKey: string,
          opts: { elevenlabs?: boolean; method?: 'GET' | 'POST'; body?: Record<string, unknown> } = {},
        ) => {
          const headers: Record<string, string> = { 'X-Target-URL': targetUrl };
          if (opts.elevenlabs) headers['X-ElevenLabs-Api-Key'] = apiKey;
          else if (proxyPath === '/api/proxy/gemini') headers['X-Goog-Api-Key'] = apiKey;
          else headers['X-API-Key'] = apiKey;
          if (opts.body) headers['Content-Type'] = 'application/json';
          const res = await ctx.fetch(proxyPath, {
            method: opts.method || 'GET',
            headers,
            body: opts.body ? JSON.stringify(opts.body) : undefined,
          });
          const text = await res.text();
          let json: unknown = text;
          try { json = text ? JSON.parse(text) : {}; } catch { /* text response */ }
          return { res, json, text };
        };

        const formatFailure = (label: string, status: number, json: unknown, text: string) => {
          const body = typeof json === 'object' && json
            ? JSON.stringify(json).slice(0, 260)
            : text.slice(0, 260);
          return `${label} 连接失败：HTTP ${status}${body ? ` — ${body}` : ''}`;
        };

        const getActiveProvider = (category: string, preferredProviderId?: string) => {
          const cat = config[category] as Record<string, unknown> | undefined;
          const providers = (cat?.providers || {}) as Record<string, Record<string, unknown>>;
          const customProviders = (cat?.customProviders || {}) as Record<string, Record<string, unknown>>;
          const active = preferredProviderId || String(cat?.activeProviderId || '');
          const provider = providers[active] || customProviders[active];
          return { category, providerId: active, provider };
        };

        const legacyMultimodal = config.multimodalApi as Record<string, unknown> | undefined;
        if (kind === 'multimodal') {
          const apiKey = String(legacyMultimodal?.apiKey || '');
          const apiUrl = String(legacyMultimodal?.apiUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
          if (!apiKey) return { success: false, message: 'multimodal API 未配置 API Key' };
          const target = `${apiUrl}/models?pageSize=1`;
          const { res, json, text } = await proxyJson('/api/proxy/gemini', target, apiKey);
          return res.ok
            ? { success: true, message: `multimodal API 真实连接成功：${target}` }
            : { success: false, message: formatFailure('multimodal API', res.status, json, text) };
        }

        const selected = kind === 'claude'
          ? (() => {
              const claudeProvider = getActiveProvider('llm', 'claude');
              return claudeProvider.provider ? claudeProvider : getActiveProvider('llm');
            })()
          : getActiveProvider(kind);
        const provider = selected.provider;
        if (!provider) return { success: false, message: `${kind} 未找到可测试的活跃 Provider` };

        const label = String(provider.label || selected.providerId || kind);
        const apiKey = String(provider.apiKey || '');
        const apiUrl = String(provider.apiUrl || '').replace(/\/+$/, '');
        const authType = String(provider.authType || 'standard-bearer');
        if (!apiKey) return { success: false, message: `${label} 未配置 API Key` };
        if (!apiUrl) return { success: false, message: `${label} 未配置 API URL` };

        if (kind === 'enhance' && (/topaz/i.test(selected.providerId) || /api\.kie\.ai/i.test(apiUrl))) {
          const res = await ctx.fetch('/api/topaz/credit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey, apiUrl }),
          });
          const text = await res.text();
          let json: { ok?: boolean; credits?: number; error?: string } = {};
          try { json = text ? JSON.parse(text) : {}; } catch { json = { error: text }; }
          if (res.ok && json.ok !== false) {
            const credits = typeof json.credits === 'number' ? json.credits.toLocaleString() : 'unknown';
            return { success: true, message: `${label} 真实连接成功，Kie credits: ${credits}` };
          }
          return {
            success: false,
            message: `${label} 连接失败：HTTP ${res.status}${json.error ? ` — ${json.error}` : text ? ` — ${text.slice(0, 260)}` : ''}`,
          };
        }

        if (authType === 'volcengine-bearer') {
          const target = `${apiUrl.endsWith('/api/v3') ? apiUrl : `${apiUrl}/api/v3`}/models`;
          const { res, json, text } = await proxyJson('/api/proxy/volcengine', target, apiKey);
          return res.ok
            ? { success: true, message: `${label} 真实连接成功：${target}` }
            : { success: false, message: formatFailure(label, res.status, json, text) };
        }

        if (authType === 'gemini-bearer') {
          const target = `${apiUrl}/models?pageSize=1`;
          const { res, json, text } = await proxyJson('/api/proxy/gemini', target, apiKey);
          return res.ok
            ? { success: true, message: `${label} 真实连接成功：${target}` }
            : { success: false, message: formatFailure(label, res.status, json, text) };
        }

        if (authType === 'elevenlabs-api-key') {
          const target = `${apiUrl}/v1/user/subscription`;
          const { res, json, text } = await proxyJson('/api/proxy/openai', target, apiKey, { elevenlabs: true });
          return res.ok
            ? { success: true, message: `${label} 真实连接成功：${target}` }
            : { success: false, message: formatFailure(label, res.status, json, text) };
        }

        if (authType === 'kling-jwt') {
          const idx = apiKey.indexOf(':');
          const jwt = idx > 0
            ? await createKlingJwt(apiKey.slice(0, idx), apiKey.slice(idx + 1))
            : apiKey;
          const target = `${apiUrl}/v1/videos/test_connection_check`;
          const { res, json, text } = await proxyJson('/api/proxy/openai', target, jwt);
          return res.status === 401 || res.status === 403
            ? { success: false, message: formatFailure(label, res.status, json, text) }
            : { success: true, message: `${label} 鉴权探测通过：HTTP ${res.status}` };
        }

        const originFromUrl = (url: string) => {
          try { return new URL(url).origin; } catch { return url.replace(/\/+$/, ''); }
        };
        const withV1Path = (url: string, path: string) => {
          const base = url.replace(/\/+$/, '');
          return `${base.endsWith('/v1') ? base : `${base}/v1`}${path}`;
        };
        const isKie = /api\.kie\.ai/i.test(apiUrl);
        const target = isKie ? `${originFromUrl(apiUrl)}/api/v1/chat/credit` : withV1Path(apiUrl, '/models');
        const { res, json, text } = await proxyJson('/api/proxy/openai', target, apiKey);
        if (res.ok) {
          let credits = '';
          if (isKie && typeof json === 'object' && json) {
            const data = (json as { data?: unknown }).data;
            const n = typeof data === 'number'
              ? data
              : data && typeof data === 'object' && typeof (data as { credits?: unknown }).credits === 'number'
                ? (data as { credits: number }).credits
                : undefined;
            credits = n != null ? `，Kie credits: ${n.toLocaleString()}` : '';
          }
          return { success: true, message: `${label} 真实连接成功：${target}${credits}` };
        }
        return { success: false, message: formatFailure(label, res.status, json, text) };
      }

      // ===== Provider Management (V2) =====
      case 'list_providers': {
        const config = ctx.getSeedanceConfig();
        const category = typeof params.category === 'string' ? params.category : undefined;
        const maskKey = (k: unknown) => {
          const s = String(k ?? '');
          if (s.length <= 8) return '***';
          return s.slice(0, 4) + '...' + s.slice(-4);
        };

        const categories = category ? [category] : ['image', 'video', 'audio', 'llm', 'enhance'];
        const validCategories = ['image', 'video', 'audio', 'llm', 'enhance'];
        const lines: string[] = [];

        for (const cat of categories) {
          if (!validCategories.includes(cat)) {
            lines.push(`${cat}: 不支持的类别（支持: ${validCategories.join(', ')}）`);
            continue;
          }
          const catConfig = config[cat] as Record<string, unknown> | undefined;
          if (!catConfig) { lines.push(`=== ${cat} ===\n  (未配置)`); continue; }

          const active = String(catConfig.activeProviderId || '');
          const providers = (catConfig.providers || {}) as Record<string, Record<string, unknown>>;
          const customProviders = (catConfig.customProviders || {}) as Record<string, Record<string, unknown>>;
          const allProviders = { ...providers, ...customProviders };
          const providerIds = Object.keys(allProviders);

          const labelMap: Record<string, string> = { image: '图片生成', video: '视频生成', audio: '音频', llm: 'LLM', enhance: '画质增强' };
          lines.push(`=== ${labelMap[cat] || cat} (${providerIds.length} 个 Provider) ===`);

          for (const pid of providerIds) {
            const p = allProviders[pid];
            const isActive = pid === active;
            const isCustom = pid in customProviders;
            const hasKey = typeof p.apiKey === 'string' && p.apiKey.trim().length > 0;
            const models = Array.isArray(p.models) ? p.models : [];
            const purchaseUrl = typeof p.purchaseUrl === 'string' && p.purchaseUrl ? p.purchaseUrl : '';
            const desc = typeof p.description === 'string' && p.description ? p.description : '';

            lines.push(`  ${isActive ? '★' : ' '} ${pid}${isCustom ? ' [自定义]' : ''} | ${hasKey ? '已配置' : '未配置'} | ${p.label || pid}`);
            if (desc) lines.push(`    ${desc}`);
            if (purchaseUrl) lines.push(`    购买: ${purchaseUrl}`);
            if (hasKey) {
              lines.push(`    端点: ${p.apiUrl || '(默认)'} | 密钥: ${maskKey(p.apiKey)}`);
            }
            if (models.length > 0) {
              lines.push(`    模型: ${models.join(', ')}`);
            }
          }
          lines.push('');
        }
        return { success: true, message: lines.join('\n').trim() };
      }

      case 'switch_provider': {
        const category = String(params.category || '');
        const providerId = String(params.provider_id || '');
        if (!category || !providerId) return { success: false, message: '缺少 category 或 provider_id 参数' };
        const validCategories = ['image', 'video', 'audio', 'llm', 'enhance'];
        if (!validCategories.includes(category)) {
          return { success: false, message: `不支持的类别：${category}，支持：${validCategories.join(', ')}` };
        }
        const config = ctx.getSeedanceConfig();
        const catConfig = config[category] as Record<string, unknown> | undefined;
        if (!catConfig) return { success: false, message: `类别 ${category} 未配置` };
        const providers = (catConfig.providers || {}) as Record<string, Record<string, unknown>>;
        const customProviders = (catConfig.customProviders || {}) as Record<string, Record<string, unknown>>;

        // Auto-fallback: if requested provider doesn't exist, find first configured one
        let targetId = providerId;
        if (!providers[targetId] && !customProviders[targetId]) {
          const allIds = [...Object.keys(providers), ...Object.keys(customProviders)];
          // Find first provider that has an API key configured
          const configured = allIds.find((pid) => {
            const p = providers[pid] || customProviders[pid];
            return p && typeof p.apiKey === 'string' && p.apiKey.trim().length > 0;
          });
          if (configured) {
            targetId = configured;
          } else if (allIds.length > 0) {
            targetId = allIds[0];
          } else {
            return { success: false, message: `Provider "${providerId}" 不存在且类别 ${category} 无可用 Provider` };
          }
        }

        ctx.setSeedanceConfigValue(category, '_activeProvider', targetId);
        const p = (providers[targetId] || customProviders[targetId]) as Record<string, unknown>;
        const hasKey = typeof p?.apiKey === 'string' && p.apiKey.trim().length > 0;
        const autoMsg = targetId !== providerId ? ` (自动回退："${providerId}" 不存在，已切换至 "${targetId}")` : '';
        return { success: true, message: `已切换 ${category} 活跃 Provider → ${targetId} (${p?.label || targetId})${autoMsg}${hasKey ? '' : ' ⚠️ 该 Provider 尚未配置 API 密钥，请使用 set_api_config 配置'}` };
      }

      case 'add_custom_provider': {
        const category = String(params.category || '');
        const providerId = String(params.provider_id || '');
        const label = String(params.label || providerId);
        const apiKey = String(params.api_key || '');
        const apiUrl = String(params.api_url || '');
        const modelsStr = String(params.models || '');
        const authType = String(params.auth_type || 'standard-bearer');
        if (!category || !providerId) return { success: false, message: '缺少 category 或 provider_id 参数' };
        const validCategories = ['image', 'video', 'audio', 'llm', 'enhance'];
        if (!validCategories.includes(category)) {
          return { success: false, message: `不支持的类别：${category}，支持：${validCategories.join(', ')}` };
        }
        const validAuthTypes = ['volcengine-bearer', 'gemini-bearer', 'standard-bearer', 'elevenlabs-api-key'];
        if (!validAuthTypes.includes(authType)) {
          return { success: false, message: `不支持的鉴权方式：${authType}，支持：${validAuthTypes.join(', ')}` };
        }
        const config = ctx.getSeedanceConfig();
        const catConfig = config[category] as Record<string, unknown> | undefined;
        if (!catConfig) return { success: false, message: `类别 ${category} 未初始化` };
        const existingProviders = { ...(catConfig.providers || {}) as Record<string, unknown>, ...(catConfig.customProviders || {}) as Record<string, unknown> };
        if (existingProviders[providerId]) {
          return { success: false, message: `Provider "${providerId}" 已存在，请使用 set_api_config 更新其配置` };
        }
        const models = modelsStr ? modelsStr.split(',').map((s: string) => s.trim()).filter(Boolean) : [];
        // Pass through context to WelcomeAgent which calls addCustomProvider
        ctx.setSeedanceConfigValue(category, '_addCustom', JSON.stringify({ providerId, label, apiKey, apiUrl, models, authType }));
        return { success: true, message: `自定义 Provider "${providerId}" (${label}) 已添加至 ${category}` };
      }

      // ===== Project =====
      case 'get_project_info': {
        const nodes = ctx.getNodes();
        const edges = ctx.getEdges();
        const types: Record<string, number> = {};
        for (const n of nodes) {
          const t = String(n.data.type || n.type || 'unknown');
          types[t] = (types[t] || 0) + 1;
        }
        const typeStr = Object.entries(types)
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ');
        return {
          success: true,
          message: `节点: ${nodes.length} (${typeStr})\n连线: ${edges.length}\n权限: ${ctx.getPermission()}\nToken: ${ctx.getTokenUsage().total}`,
        };
      }

      case 'list_projects': {
        try {
          const raw =
            typeof localStorage !== 'undefined'
              ? localStorage.getItem('magine-canvas-projects')
              : null;
          if (!raw) {
            return { success: true, message: '没有已保存的项目' };
          }
          const projects = JSON.parse(raw) as Array<{
            id?: string;
            title?: string;
            description?: string;
          }>;
          if (!Array.isArray(projects) || projects.length === 0) {
            return { success: true, message: '没有已保存的项目' };
          }
          const lines = projects.map((p) => {
            const title = p.title?.trim() || '(无标题)';
            const id = p.id?.trim() || '?';
            const desc = p.description?.trim()
              ? ` — ${p.description.trim().slice(0, 60)}`
              : '';
            return `- ${title} (ID: ${id})${desc}`;
          });
          return {
            success: true,
            message: `已保存的项目 (${projects.length}):\n${lines.join('\n')}`,
          };
        } catch {
          return { success: false, message: '读取项目列表失败' };
        }
      }

      case 'open_project': {
        try {
          const raw = typeof localStorage !== 'undefined'
            ? localStorage.getItem('magine-canvas-projects')
            : null;
          const projects = raw
            ? JSON.parse(raw) as Array<{ id?: string; title?: string }>
            : [];
          if (!Array.isArray(projects) || projects.length === 0) {
            return { success: false, message: '当前没有已保存项目，请先新建画布' };
          }
          const requested = String(params.project_id || params.project || params.name || '').trim();
          const project = requested
            ? projects.find((item) => item.id === requested || item.title?.trim() === requested)
            : projects[0];
          if (!project?.id) {
            return { success: false, message: requested ? `未找到项目「${requested}」` : '最近项目缺少有效 ID' };
          }
          ctx.navigateToCanvas(project.id);
          return {
            success: true,
            message: `已打开画布「${project.title?.trim() || '未命名项目'}」`,
            data: { projectId: project.id },
          };
        } catch {
          return { success: false, message: '读取或打开项目失败' };
        }
      }

      case 'create_project': {
        const name = String(params.name || params.title || '');
        if (!name) return { success: false, message: '缺少项目名称（name 参数）' };
        const desc = String(params.description || '');
        const result = ctx.createProject(name, desc);
        if (!result.success || !result.projectId) {
          return { success: false, message: result.message || '创建项目失败' };
        }
        ctx.clearCanvas();
        ctx.navigateToCanvas(result.projectId);
        return { success: true, message: `项目「${name}」已创建并打开，画布已就绪` };
      }

      // ===== Shell =====（Electron IPC 优先，API 兜底）
      case 'bash': {
        const command = String(params.command || '');
        if (!command) return { success: false, message: '缺少 command 参数' };
        const cwd = typeof params.cwd === 'string' ? params.cwd : undefined;

        // Risk assessment for elevated-privilege commands
        const highRisk = /sudo|chown\s+\/|chmod\s+777\s+\/|shutdown|reboot|mkfs\.|dd\s+if=/i;
        const mediumRisk = /apt-get|apt\s|yum\s|brew\s|choco\s|npm\s+(i|install)\s+-g|pip3?\s+install\s+(--user\s+)?[^-]|systemctl|service\s|docker\s+(run|stop|rm)|sc\s+|reg\s+|netsh\s|firewall|wget|curl.*[|>]|chmod\s|chown\s/i;

        if (params.__agent_confirmed !== true && highRisk.test(command)) {
          const approved = await ctx.requestConfirm({
            tool: 'bash',
            summary: command.slice(0, 300),
            risk: 'high',
          });
          if (!approved) return { success: false, message: '用户取消了该高级权限操作' };
        } else if (params.__agent_confirmed !== true && mediumRisk.test(command)) {
          const approved = await ctx.requestConfirm({
            tool: 'bash',
            summary: command.slice(0, 300),
            risk: 'medium',
          });
          if (!approved) return { success: false, message: '用户取消了该敏感操作' };
        }

        // Use streaming terminal for real-time output, fallback to buffered API
        try {
          const termResult = await ctx.requestTerminal(command, cwd);
          const { stdout, stderr, exitCode } = termResult;
          const success = exitCode === 0 || (stdout.length > 0 && stderr.length === 0);
          const resultMsg = [stdout, stderr ? `\n[stderr]\n${stderr}` : ''].filter(Boolean).join('\n');
          return { success, message: resultMsg || '(无输出)' };
        } catch {
          // Fallback to buffered API if terminal fails
          const data = await platformShellExec(command, cwd);
          if (!data.success) return { success: false, message: data.message || data.error || '命令执行失败' };
          const output = data.stdout || '';
          const stderr = data.stderr || '';
          const resultMsg = [output, stderr ? `\n[stderr]\n${stderr}` : ''].filter(Boolean).join('\n');
          return { success: true, message: resultMsg || '(无输出)' };
        }
      }

      // ===== Task/Agent =====
      case 'task_create': {
        const desc = String(params.description || '');
        if (!desc) return { success: false, message: '缺少 description 参数' };
        const parentId = typeof params.parent === 'string' && params.parent.trim()
          ? params.parent.trim()
          : undefined;
        const task = useAgentRunStore.getState().createTask(desc, parentId, ctx.runId);
        return {
          success: true,
          message: `任务 ${task.id} 已创建：${desc}\n状态：pending`,
          data: task,
        };
      }

      case 'task_update': {
        const taskId = String(params.task_id || '');
        const status = String(params.status || '') as
          | 'pending'
          | 'in_progress'
          | 'completed'
          | 'failed'
          | 'cancelled';
        if (!taskId || !status) return { success: false, message: '缺少 task_id 或 status' };
        if (!['pending', 'in_progress', 'completed', 'failed', 'cancelled'].includes(status)) {
          return { success: false, message: `无效任务状态：${status}` };
        }
        const task = useAgentRunStore.getState().getTask(taskId);
        if (!task) return { success: false, message: `任务 ${taskId} 不存在或当前会话中未创建` };
        const updated = useAgentRunStore.getState().updateTask(taskId, status);
        return {
          success: true,
          message: `任务 ${taskId} 状态已更新为 ${status}\n任务：${task.description}`,
          data: updated,
        };
      }

      case 'sub_agent': {
        const prompt = String(params.prompt || '');
        if (!prompt) return { success: false, message: '缺少 prompt 参数' };
        if (!ctx.runSubAgent) return { success: false, message: '当前运行环境没有提供子 Agent 执行器' };
        const tools = typeof params.tools === 'string'
          ? params.tools.split(',').map((item) => item.trim()).filter(Boolean)
          : undefined;
        return ctx.runSubAgent({ prompt, tools });
      }

      // ===== Music =====
      case 'music_search': {
        const query = String(params.query || '');
        if (!query) return { success: false, message: '缺少 query 参数' };
        try {
          const ctrl = getMusicController();
          const songs = await ctrl.search(query);
          if (songs.length === 0) return { success: true, message: `未找到与「${query}」相关的歌曲` };
          const lines = songs.map(
            (s, i) =>
              `- [${i + 1}] ${s.name} — ${s.artists} (ID: ${s.id}) ${s.album ? '· ' + s.album : ''}`,
          );
          return { success: true, message: `搜索「${query}」找到 ${songs.length} 首：\n${lines.join('\n')}` };
        } catch (e) {
          return { success: false, message: `搜索失败：${e instanceof Error ? e.message : '网易云 API 未连接'}` };
        }
      }

      case 'music_play': {
        const query = typeof params.query === 'string' ? params.query : '';
        const songId = typeof params.song_id === 'string' ? params.song_id : '';
        if (!query && !songId) return { success: false, message: '缺少 query 或 song_id 参数' };
        try {
          const ctrl = getMusicController();
          if (songId) {
            const s = await ctrl.playById(songId);
            return { success: true, message: `正在播放：${s.currentTrack?.name} — ${s.currentTrack?.artists}` };
          }
          const s = await ctrl.playByQuery(query);
          return { success: true, message: `正在播放：${s.currentTrack?.name} — ${s.currentTrack?.artists}` };
        } catch (e) {
          return { success: false, message: `播放失败：${e instanceof Error ? e.message : '网易云 API 未连接'}` };
        }
      }

      case 'music_pause': {
        try {
          const ctrl = getMusicController();
          ctrl.pause();
          return { success: true, message: '音乐已暂停' };
        } catch (e) {
          return { success: false, message: `操作失败：${e instanceof Error ? e.message : ''}` };
        }
      }

      case 'music_resume': {
        try {
          const ctrl = getMusicController();
          ctrl.resume();
          const s = ctrl.getState();
          if (!s.currentTrack) return { success: false, message: '队列为空，请先用 music_play 播放歌曲' };
          return { success: true, message: `继续播放：${s.currentTrack.name} — ${s.currentTrack.artists}` };
        } catch (e) {
          return { success: false, message: `操作失败：${e instanceof Error ? e.message : ''}` };
        }
      }

      case 'music_next': {
        try {
          const ctrl = getMusicController();
          await ctrl.next();
          const s = ctrl.getState();
          if (!s.currentTrack) return { success: true, message: '队列已播完' };
          return { success: true, message: `下一首：${s.currentTrack.name} — ${s.currentTrack.artists}` };
        } catch (e) {
          return { success: false, message: `操作失败：${e instanceof Error ? e.message : ''}` };
        }
      }

      case 'music_prev': {
        try {
          const ctrl = getMusicController();
          await ctrl.prev();
          const s = ctrl.getState();
          if (!s.currentTrack) return { success: true, message: '队列为空' };
          return { success: true, message: `上一首：${s.currentTrack.name} — ${s.currentTrack.artists}` };
        } catch (e) {
          return { success: false, message: `操作失败：${e instanceof Error ? e.message : ''}` };
        }
      }

      case 'music_set_volume': {
        const vol = typeof params.volume === 'number' ? params.volume : parseInt(String(params.volume || ''));
        if (isNaN(vol) || vol < 0 || vol > 100) {
          return { success: false, message: 'volume 参数需为 0-100 之间的数字' };
        }
        try {
          const ctrl = getMusicController();
          ctrl.setVolume(vol / 100);
          return { success: true, message: `音量已设为 ${vol}%` };
        } catch (e) {
          return { success: false, message: `操作失败：${e instanceof Error ? e.message : ''}` };
        }
      }

      case 'music_get_state': {
        try {
          const ctrl = getMusicController();
          const s = ctrl.getState();
          if (!s.currentTrack) return { success: true, message: '当前未播放任何歌曲，API 连接：' + (s.apiConnected ? '正常' : '未连接') };
          const pct = Math.round(s.progress * 100);
          const volPct = Math.round(s.volume * 100);
          return {
            success: true,
            message: [
              `当前：${s.currentTrack.name} — ${s.currentTrack.artists}`,
              `专辑：${s.currentTrack.album || '-'}`,
              `状态：${s.isPlaying ? '播放中' : '已暂停'}`,
              `进度：${pct}%`,
              `音量：${volPct}%`,
              `队列：${s.queue.length} 首`,
              `API：${s.apiConnected ? '已连接' : '未连接'}`,
            ].join('\n'),
          };
        } catch (e) {
          return { success: false, message: '' };
        }
      }

      case 'music_load_playlists': {
        try {
          const ctrl = getMusicController();
          const s = ctrl.getState();
          if (!s.user) return { success: false, message: '请先在音乐卡片中登录网易云账号' };
          await ctrl.loadPlaylists();
          const updated = ctrl.getState();
          if (updated.playlists.length === 0) return { success: true, message: '你的歌单为空，去网易云创建一些歌单吧' };
          const lines = updated.playlists.map(
            (p: RemovedMusicItem) => `- ${p.name} (ID: ${p.id}) · ${p.trackCount} 首 · by ${p.creator}`,
          );
          return { success: true, message: `你的歌单 (${updated.playlists.length}):\n${lines.join('\n')}` };
        } catch (e) {
          return { success: false, message: `获取歌单失败：${e instanceof Error ? e.message : '网易云 API 未连接'}` };
        }
      }

      case 'music_play_playlist': {
        const playlistId = String(params.playlist_id || '');
        if (!playlistId) return { success: false, message: '缺少 playlist_id 参数' };
        try {
          const ctrl = getMusicController();
          const songs = await ctrl.loadPlaylistSongs(playlistId);
          if (songs.length === 0) return { success: false, message: '歌单为空或无法获取歌曲列表' };
          const idx = typeof params.index === 'number' && params.index >= 0 && params.index < songs.length
            ? params.index
            : Math.floor(Math.random() * songs.length);
          const song = songs[idx];
          const state = await ctrl.playSong(song);
          return { success: true, message: `正在播放歌单第${idx + 1}首：${state.currentTrack?.name} — ${state.currentTrack?.artists} (共${songs.length}首)` };
        } catch (e) {
          return { success: false, message: `播放歌单失败：${e instanceof Error ? e.message : '网易云 API 未连接'}` };
        }
      }

      case 'music_get_recommend': {
        try {
          const ctrl = getMusicController();
          const songs = await ctrl.loadRecommendSongs();
          if (songs.length === 0) return { success: true, message: '暂无每日推荐（可能未登录或推荐池为空），试试用 music_search 搜索吧' };
          const lines = songs.slice(0, 10).map(
            (s, i) =>
              `- [${i + 1}] ${s.name} — ${s.artists} (ID: ${s.id}) ${s.album ? '· ' + s.album : ''}`,
          );
          return { success: true, message: `今日推荐 (前${Math.min(10, songs.length)}首):\n${lines.join('\n')}` };
        } catch (e) {
          return { success: false, message: `获取推荐失败：${e instanceof Error ? e.message : '网易云 API 未连接'}` };
        }
      }

      // ===== Meta =====
      case 'get_config': {
        const section = typeof params.section === 'string' ? params.section : 'all';
        const lines: string[] = [];
        if (section === 'permission' || section === 'all') {
          lines.push(`权限模式: ${ctx.getPermission()}`);
        }
        if (section === 'tokens' || section === 'all') {
          lines.push(`Token 用量: ${ctx.getTokenUsage().total}`);
        }
        return { success: true, message: lines.join('\n') };
      }

      case 'plan_mode': {
        const enter = params.enter === true;
        ctx.setPlanMode?.(enter);
        return {
          success: true,
          message: enter ? '已进入规划模式' : '已退出规划模式',
          data: { enabled: enter },
        };
      }

      case 'session_info': {
        return {
          success: true,
          message: `权限: ${ctx.getPermission()}\nToken 用量: ${ctx.getTokenUsage().total}`,
        };
      }

      case 'update_user_profile': {
        const newName = typeof params.name === 'string' ? params.name.trim() : '';
        if (!newName) return { success: false, message: '请提供要更改的称呼' };
        // 动态导入避免循环引用
        const { useUserProfileStore } = await import('@/lib/user-profile-store');
        useUserProfileStore.getState().setName(newName);
        return { success: true, message: `已更新用户称呼为「${newName}」` };
      }

      // ===== 记忆工具 =====
      case 'remember': {
        const entryName = String(params.name || '').trim();
        const description = String(params.description || '').trim();
        const memType = String(params.type || 'project').trim();
        const content = String(params.content || '').trim();

        if (!entryName || !content) return { success: false, message: '缺少 name 或 content 参数' };
        if (!['user', 'feedback', 'project'].includes(memType)) {
          return { success: false, message: `无效的记忆类型：${memType}，应为 user/feedback/project` };
        }

        const { useMemoryStore } = await import('@/lib/memory-store');
        const memory = useMemoryStore.getState().addMemory({
          name: entryName,
          description: description || entryName,
          type: memType as 'user' | 'feedback' | 'project',
          projectId: memType === 'project' ? ctx.projectId : undefined,
          content,
        });
        return { success: true, message: `记忆「${entryName}」已记录 (${memory.id})` };
      }

      case 'recall_memories': {
        const { useMemoryStore } = await import('@/lib/memory-store');
        const all = useMemoryStore.getState().getAllMemories();
        const filterType = typeof params.type === 'string' ? params.type : undefined;
        const keyword = typeof params.keyword === 'string' ? params.keyword.toLowerCase() : undefined;
        const limit = typeof params.limit === 'number' ? params.limit : 20;

        let filtered = all.filter((memory) => (
          memory.type !== 'project'
          || (!ctx.projectId && !memory.projectId)
          || Boolean(ctx.projectId && memory.projectId === ctx.projectId)
        ));
        if (filterType && ['user', 'feedback', 'project'].includes(filterType)) {
          filtered = filtered.filter((m) => m.type === filterType);
        }
        if (keyword) {
          filtered = filtered.filter(
            (m) => m.name.toLowerCase().includes(keyword) || m.content.toLowerCase().includes(keyword)
          );
        }
        filtered = filtered.slice(0, limit);

        if (filtered.length === 0) return { success: true, message: '没有找到匹配的记忆。' };

        const lines = filtered.map((m) => {
          const date = new Date(m.updatedAt).toLocaleString('zh-CN');
          return `### ${m.name} (${m.id})\n类型: ${m.type} | 更新: ${date}\n${m.description}\n\n${m.content.slice(0, 500)}${m.content.length > 500 ? '\n...(截断)' : ''}`;
        });
        return { success: true, message: `找到 ${filtered.length} 条记忆：\n\n${lines.join('\n\n---\n\n')}` };
      }

      case 'forget_memory': {
        const memoryId = String(params.memory_id || '').trim();
        if (!memoryId) return { success: false, message: '缺少 memory_id 参数' };

        const { useMemoryStore } = await import('@/lib/memory-store');
        const store = useMemoryStore.getState();
        const target = store.memories.find((m) => m.id === memoryId);
        if (!target) return { success: false, message: `未找到记忆 ${memoryId}` };

        store.deleteMemory(memoryId);
        return { success: true, message: `记忆「${target.name}」已删除` };
      }

      case 'recall_work_style': {
        useCanvasWorkStyleStore.getState().reflectToMemory();
        const keyword = typeof params.keyword === 'string' ? params.keyword.trim() : '';
        const ctxMd = getWorkStyleContextForPrompt();
        if (!ctxMd.trim()) {
          return { success: true, message: '还没有足够的使用数据来总结工作风格，继续创作后会自动学习。' };
        }
        if (keyword) {
          const routine = findWorkRoutine(keyword);
          if (routine) {
            return {
              success: true,
              message: `${ctxMd}\n\n---\n\n匹配套路：**${routine.label}**\n工具序列：${routine.tools.map((t) => t.name).join(' → ')}`,
            };
          }
        }
        return { success: true, message: ctxMd };
      }

      case 'replay_work_routine': {
        const query = String(params.query || '').trim();
        if (!query) return { success: false, message: '缺少 query 参数' };
        const routine = findWorkRoutine(query);
        if (!routine) {
          return { success: false, message: `没找到匹配「${query}」的历史套路。可以说具体一点，或先完成一次操作让我学习。` };
        }
        markWorkRoutineUsed(routine.id);
        const lines: string[] = [`复现套路：${routine.label}`, `共 ${routine.tools.length} 步`];
        for (const tc of routine.tools) {
          if (tc.name === 'replay_work_routine') {
            return { success: false, message: `${lines.join('\n')}\n历史套路不能递归调用自身。` };
          }
          const nodeReferences = ['node_id', 'source_id', 'target_id']
            .map((key) => ({ key, value: typeof tc.params[key] === 'string' ? String(tc.params[key]) : '' }))
            .filter((item) => item.value);
          const currentNodeIds = new Set(ctx.getNodes().map((node) => node.id));
          const missingReference = nodeReferences.find((item) => !currentNodeIds.has(item.value));
          if (missingReference) {
            return {
              success: false,
              message: `${lines.join('\n')}\n历史套路引用的节点 ${missingReference.value} 已不存在，请根据当前画布重新规划。`,
            };
          }
          const replayCall: AgentToolCall = {
            name: tc.name,
            params: Object.fromEntries(
              Object.entries(tc.params).filter(([key]) => !key.startsWith('__')),
            ),
          };
          const stepResult = await executeAgentTool(replayCall, ctx);
          lines.push(`${tc.name} → ${stepResult.success ? '成功' : '失败'}: ${stepResult.message.split('\n')[0]}`);
          if (!stepResult.success) {
            return { success: false, message: lines.join('\n') };
          }
        }
        return { success: true, message: lines.join('\n') };
      }

      // ===== 即梦CLI =====
      case 'dreamina_check_login': {
        const config = ctx.getSeedanceConfig();
        const dc = config['dreaminaCli'] as Record<string, unknown> | undefined;
        const rawPath = (typeof dc?.cliPath === 'string' && dc.cliPath) || 'dreamina';
        // Validate path
        if (/[|;&><`$]/.test(rawPath)) {
          return { success: false, message: `CLI 路径无效："${rawPath.slice(0, 80)}" —— 包含 shell 特殊字符。请使用 dreamina_configure 设置正确的二进制路径。` };
        }
        const cliPath = rawPath;
        const res = await ctx.fetch('/api/dreamina/user-credit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cliPath }),
        });
        const json = await res.json().catch(() => ({})) as Record<string, unknown>;
        if (json.ok && json.loggedIn) {
          ctx.setSeedanceConfigValue('dreaminaCli', 'loggedIn', 'true');
          ctx.setSeedanceConfigValue('dreaminaCli', 'loginName', String(json.loginName || ''));
          return { success: true, message: `即梦CLI 已登录：${json.loginName || '未知用户'}\n详情：${JSON.stringify(json.data || json, null, 2)}` };
        }
        return { success: false, message: `即梦CLI 未登录。请在终端执行 dreamina login 登录，或使用 dreamina_install 安装。\n${json.error ? '错误：' + String(json.error) : ''}` };
      }

      case 'dreamina_install': {
        // The install API expects an install DIRECTORY (not binary path).
        // Don't pass the configured CLI binary path as the install dir.
        const res = await ctx.fetch('/api/dreamina/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cliPath: '' }),
        });
        const json = await res.json().catch(() => ({})) as Record<string, unknown>;
        if (json.ok) {
          // After install, save the default binary path
          ctx.setSeedanceConfigValue('dreaminaCli', 'cliPath', 'dreamina');
          ctx.setSeedanceConfigValue('dreaminaCli', 'loggedIn', 'false');
          return { success: true, message: `即梦CLI 安装成功！\n${json.detail || json.message || ''}` };
        }
        const manualCmd = typeof json.manualCmd === 'string' ? json.manualCmd : '';
        const detail = typeof json.detail === 'string' ? json.detail : '';
        const errorMsg = typeof json.error === 'string' ? json.error : '';
        // Emphasize failure so LLM doesn't hallucinate success
        return {
          success: false,
          message: [
            `❌ 即梦CLI 安装失败。${errorMsg}`,
            detail ? `详情：${detail}` : '',
            manualCmd ? `手动安装：${manualCmd}` : '',
            '',
            '请使用 bash 工具手动执行安装命令，实时查看终端输出排查问题。',
          ].filter(Boolean).join('\n'),
        };
      }

      case 'dreamina_configure': {
        if (typeof params.cli_path === 'string') {
          const p = params.cli_path.trim();
          // Reject paths that look like shell commands (pipes, redirects, command chains)
          if (/[|;&><`$]/.test(p)) {
            return { success: false, message: `无效的 CLI 路径："${p.slice(0, 100)}" —— 路径中不能包含 | ; & > < $ 等 shell 特殊字符。请输入 dreamina 二进制文件的完整路径，如 /usr/local/bin/dreamina。` };
          }
          ctx.setSeedanceConfigValue('dreaminaCli', 'cliPath', p);
        }
        if (typeof params.image_enabled === 'boolean') {
          ctx.setSeedanceConfigValue('dreaminaCli', 'imageEnabled', String(params.image_enabled));
        }
        if (typeof params.video_enabled === 'boolean') {
          ctx.setSeedanceConfigValue('dreaminaCli', 'videoEnabled', String(params.video_enabled));
        }
        const updated: string[] = [];
        if (typeof params.cli_path === 'string') updated.push(`路径: ${params.cli_path.trim()}`);
        if (typeof params.image_enabled === 'boolean') updated.push(`图片生成: ${params.image_enabled ? '开' : '关'}`);
        if (typeof params.video_enabled === 'boolean') updated.push(`视频生成: ${params.video_enabled ? '开' : '关'}`);
        return { success: true, message: updated.length > 0 ? `即梦CLI 配置已更新：${updated.join(', ')}` : '未提供任何配置项' };
      }

      case 'dreamina_test': {
        const config = ctx.getSeedanceConfig();
        const dc = config['dreaminaCli'] as Record<string, unknown> | undefined;
        const rawPath = (typeof dc?.cliPath === 'string' && dc.cliPath) || 'dreamina';
        const lines: string[] = ['即梦CLI 检测报告：', ''];

        // Validate path — reject shell commands
        if (/[|;&><`$]/.test(rawPath)) {
          lines.push(`CLI 路径无效："${rawPath.slice(0, 80)}" —— 包含 shell 特殊字符`);
          lines.push('请使用 dreamina_configure 设置正确的 CLI 二进制路径');
          lines.push('提示：默认路径为 dreamina（如果在 PATH 中）或 /usr/local/bin/dreamina');
          return { success: true, message: lines.join('\n') };
        }
        const cliPath = rawPath;

        // 1) Check if CLI binary is available via shell (which dreamina)
        const shellResult = await platformShellExec(`which "${cliPath}" 2>/dev/null || where "${cliPath}" 2>/dev/null || command -v "${cliPath}" 2>/dev/null || echo "NOT_FOUND"`);
        if (shellResult.success && shellResult.stdout && !shellResult.stdout.includes('NOT_FOUND')) {
          const paths = shellResult.stdout.trim().split('\n').filter(Boolean);
          lines.push(`CLI 路径：${paths[0]}`);
        } else {
          lines.push(`CLI 状态：未找到 ${cliPath}（PATH 中不存在）`);
        }

        // 2) Check login status via user-credit API
        try {
          const loginRes = await ctx.fetch('/api/dreamina/user-credit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cliPath }),
          });
          const loginJson = await loginRes.json().catch(() => ({})) as Record<string, unknown>;
          if (loginJson.ok && loginJson.loggedIn) {
            lines.push(`登录状态：已登录（${loginJson.loginName || '未知用户'}）`);
          } else {
            lines.push(`登录状态：未登录 — 请在终端执行 "${cliPath} login" 登录`);
          }
        } catch {
          lines.push('登录状态：检测失败（CLI 可能未安装）');
        }

        // 3) Config summary
        lines.push('');
        lines.push(`图片生成：${dc?.imageEnabled !== false ? '已启用' : '已禁用'}`);
        lines.push(`视频生成：${dc?.videoEnabled !== false ? '已启用' : '已禁用'}`);
        lines.push(`配置路径：${cliPath}`);

        // 4) next steps hint
        lines.push('');
        lines.push('如需安装：使用 dreamina_install 工具');
        lines.push('如需登录：终端执行 dreamina login');
        lines.push('如需配置：使用 dreamina_configure 工具');

        return { success: true, message: lines.join('\n') };
      }

      // ===== 即梦CLI 生成工具 =====
      case 'dreamina_text2image': {
        const cliPath = getDreaminaCliPath(ctx);
        const prompt = String(params.prompt || '');
        if (!prompt) return { success: false, message: '缺少 prompt 参数' };
        const body: Record<string, unknown> = { cliPath, prompt };
        if (params.ratio) body.ratio = String(params.ratio);
        if (params.resolution_type) body.resolution_type = String(params.resolution_type);
        if (params.model_version) body.model_version = String(params.model_version);
        if (params.quality) body.quality = String(params.quality);
        if (params.style) body.style = String(params.style);
        if (params.negative_prompt) body.negative_prompt = String(params.negative_prompt);
        if (params.num_images != null) body.num_images = Number(params.num_images);
        const res = await ctx.fetch('/api/dreamina/text2image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = await res.json().catch(() => ({})) as Record<string, unknown>;
        if (json.ok) {
          const data = (json.data || json) as Record<string, unknown>;
          const sid = data.submit_id || data.id || data.task_id;
          return { success: true, message: `文生图任务已提交\nsubmit_id: ${sid || '未知'}\n使用 dreamina_query_result 查询结果，参数 submit_id=${sid}` };
        }
        return { success: false, message: `文生图失败：${json.error || '未知错误'}` };
      }

      case 'dreamina_text2video': {
        const cliPath = getDreaminaCliPath(ctx);
        const prompt = String(params.prompt || '');
        if (!prompt) return { success: false, message: '缺少 prompt 参数' };
        const body: Record<string, unknown> = { cliPath, prompt };
        if (params.ratio) body.ratio = String(params.ratio);
        if (params.duration) body.duration = Number(params.duration);
        if (params.model_version) body.model_version = String(params.model_version);
        if (params.resolution) body.resolution = String(params.resolution);
        if (params.negative_prompt) body.negative_prompt = String(params.negative_prompt);
        const res = await ctx.fetch('/api/dreamina/text2video', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = await res.json().catch(() => ({})) as Record<string, unknown>;
        if (json.ok) {
          const data = (json.data || json) as Record<string, unknown>;
          const sid = data.submit_id || data.id || data.task_id;
          return { success: true, message: `文生视频任务已提交\nsubmit_id: ${sid || '未知'}\n使用 dreamina_query_result 查询结果` };
        }
        return { success: false, message: `文生视频失败：${json.error || '未知错误'}` };
      }

      case 'dreamina_image2image': {
        const cliPath = getDreaminaCliPath(ctx);
        const prompt = String(params.prompt || '');
        if (!prompt) return { success: false, message: '缺少 prompt 参数' };
        const imagesStr = String(params.images || '');
        if (!imagesStr) return { success: false, message: '缺少 images 参数（参考图路径，逗号分隔）' };
        const images = imagesStr.split(',').map((s: string) => s.trim()).filter(Boolean);
        const body: Record<string, unknown> = { cliPath, prompt, images };
        if (params.ratio) body.ratio = String(params.ratio);
        if (params.resolution_type) body.resolution_type = String(params.resolution_type);
        if (params.model_version) body.model_version = String(params.model_version);
        if (params.style) body.style = String(params.style);
        if (params.poll != null) body.poll = Number(params.poll);
        const res = await ctx.fetch('/api/dreamina/image2image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = await res.json().catch(() => ({})) as Record<string, unknown>;
        if (json.ok) {
          const data = (json.data || json) as Record<string, unknown>;
          const sid = data.submit_id || data.id || data.task_id;
          return { success: true, message: `图生图任务已提交\nsubmit_id: ${sid || '未知'}\n使用 dreamina_query_result 查询结果` };
        }
        return { success: false, message: `图生图失败：${json.error || '未知错误'}` };
      }

      case 'dreamina_image2video': {
        const cliPath = getDreaminaCliPath(ctx);
        const prompt = String(params.prompt || '');
        if (!prompt) return { success: false, message: '缺少 prompt 参数' };
        const image = String(params.image || '');
        if (!image) return { success: false, message: '缺少 image 参数（主参考图路径）' };
        const body: Record<string, unknown> = { cliPath, prompt, image };
        if (params.images) {
          body.images = String(params.images).split(',').map((s: string) => s.trim()).filter(Boolean);
        }
        if (params.ratio) body.ratio = String(params.ratio);
        if (params.duration) body.duration = Number(params.duration);
        if (params.model_version) body.model_version = String(params.model_version);
        if (params.resolution) body.resolution = String(params.resolution);
        const res = await ctx.fetch('/api/dreamina/image2video', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = await res.json().catch(() => ({})) as Record<string, unknown>;
        if (json.ok) {
          const data = (json.data || json) as Record<string, unknown>;
          const sid = data.submit_id || data.id || data.task_id;
          return { success: true, message: `图生视频任务已提交\nsubmit_id: ${sid || '未知'}\n使用 dreamina_query_result 查询结果` };
        }
        return { success: false, message: `图生视频失败：${json.error || '未知错误'}` };
      }

      case 'dreamina_multimodal2video': {
        const cliPath = getDreaminaCliPath(ctx);
        const prompt = String(params.prompt || '');
        if (!prompt) return { success: false, message: '缺少 prompt 参数' };
        const image = String(params.image || '');
        if (!image) return { success: false, message: '缺少 image 参数（主图片路径）' };
        const body: Record<string, unknown> = { cliPath, prompt, image };
        if (params.video) body.video = String(params.video);
        if (params.audio) body.audio = String(params.audio);
        if (params.ratio) body.ratio = String(params.ratio);
        if (params.duration) body.duration = Number(params.duration);
        if (params.model_version) body.model_version = String(params.model_version);
        if (params.video_resolution) body.video_resolution = String(params.video_resolution);
        if (params.poll != null) body.poll = Number(params.poll);
        const res = await ctx.fetch('/api/dreamina/multimodal2video', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = await res.json().catch(() => ({})) as Record<string, unknown>;
        if (json.ok) {
          const data = (json.data || json) as Record<string, unknown>;
          const sid = data.submit_id || data.id || data.task_id;
          return { success: true, message: `全能参考视频任务已提交\nsubmit_id: ${sid || '未知'}\n生成时间较长（5-10分钟），请耐心等待后用 dreamina_query_result 查询` };
        }
        return { success: false, message: `全能参考视频失败：${json.error || '未知错误'}` };
      }

      case 'dreamina_list_task': {
        const cliPath = getDreaminaCliPath(ctx);
        const body: Record<string, unknown> = { cliPath };
        if (params.gen_status) body.gen_status = String(params.gen_status);
        if (params.submit_id) body.submit_id = String(params.submit_id);
        if (params.limit != null) body.limit = Number(params.limit);
        const res = await ctx.fetch('/api/dreamina/list-task', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = await res.json().catch(() => ({})) as Record<string, unknown>;
        if (json.ok) {
          const tasks = (json.tasks || json.data || []) as Array<Record<string, unknown>>;
          if (!Array.isArray(tasks) || tasks.length === 0) {
            return { success: true, message: '暂无任务记录' };
          }
          const lines = tasks.map((t: Record<string, unknown>, i: number) => {
            const sid = t.submit_id || t.id || '?';
            const st = t.gen_status || t.status || '?';
            const img = t.image_url || '';
            const vid = t.video_url || '';
            const result = img ? `图片: ${img}` : vid ? `视频: ${vid}` : '生成中';
            return `- [${i + 1}] ${sid} | ${st} | ${result}`;
          });
          return { success: true, message: `任务列表 (${tasks.length}):\n${lines.join('\n')}` };
        }
        return { success: false, message: `查询任务列表失败：${json.error || '未知错误'}` };
      }

      case 'dreamina_query_result': {
        const cliPath = getDreaminaCliPath(ctx);
        const submitId = String(params.submit_id || '');
        if (!submitId) return { success: false, message: '缺少 submit_id 参数' };
        const res = await ctx.fetch('/api/dreamina/query-result', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cliPath, submit_id: submitId }),
        });
        const json = await res.json().catch(() => ({})) as Record<string, unknown>;
        if (json.ok) {
          const data = (json.data || json) as Record<string, unknown>;
          const status = data.gen_status || data.status || 'unknown';
          const imageUrl = data.image_url;
          const videoUrl = data.video_url;
          const coverUrl = data.cover_url;
          const images = data.images;
          const failReason = data.fail_reason || data.error;
          const parts: string[] = [`submit_id: ${submitId}`, `状态: ${status}`];
          if (imageUrl) parts.push(`图片: ${imageUrl}`);
          if (videoUrl) parts.push(`视频: ${videoUrl}`);
          if (coverUrl) parts.push(`封面: ${coverUrl}`);
          if (images && Array.isArray(images)) {
            parts.push(`图片列表: ${(images as Array<Record<string, unknown>>).map((img: Record<string, unknown>) => img.image_url).join(', ')}`);
          }
          if (failReason) parts.push(`失败原因: ${failReason}`);
          return { success: true, message: parts.join('\n') };
        }
        return { success: false, message: `查询失败：${json.error || '未知错误'}` };
      }

      default:
        return { success: false, message: `未知工具：${name}` };
    }
  } catch (err: unknown) {
    return {
      success: false,
      message: `工具执行出错：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** 从配置中提取 dreamina CLI 路径并校验 */
function getDreaminaCliPath(ctx: ToolExecutionContext): string {
  const config = ctx.getSeedanceConfig();
  const dc = config['dreaminaCli'] as Record<string, unknown> | undefined;
  const rawPath = (typeof dc?.cliPath === 'string' && dc.cliPath) || 'dreamina';
  if (/[|;&><`$]/.test(rawPath)) {
    return 'dreamina';
  }
  return rawPath;
}
