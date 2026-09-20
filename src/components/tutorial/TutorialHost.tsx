'use client';

import {
  BookOpenCheck,
  Bot,
  Box,
  BoxSelect,
  Check,
  Circle,
  CircleCheck,
  ChevronLeft,
  Compass,
  Clock3,
  GraduationCap,
  Image as ImageIcon,
  Layers,
  Lightbulb,
  LocateFixed,
  Music,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  Settings2,
  Sparkles,
  Video,
  Volume2,
  VolumeX,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { type CanvasNodeData, useCanvasStore } from '@/components/canvas/CanvasStore';
import { type SeedanceConfig, useSeedanceStore } from '@/components/seedance/SeedanceStore';
import { VoiceAssistantWaveStrip } from '@/components/voice/VoiceAssistantWaveStrip';
import { requestCanvasNodeFocus } from '@/lib/canvas-focus-events';
import {
  getTutorialNodeCreatedSnapshot,
  requestTutorialCreationArea,
  TUTORIAL_CANVAS_INTERACTION_EVENT,
  TUTORIAL_NODE_CREATED_EVENT,
  type TutorialCanvasInteraction,
  type TutorialCanvasInteractionDetail,
  type TutorialNodeCreatedDetail,
} from '@/lib/tutorial-events';

import { useTutorialAudio } from './useTutorialAudio';

type CourseId =
  | 'canvas-basics'
  | 'image-generation'
  | 'video-generation'
  | 'asset-management'
  | 'panorama-generation'
  | 'music-generation'
  | 'assistant'
  | 'agent-node'
  | 'browser-node'
  | 'storyboard-node'
  | 'quality-enhancement'
  | 'region-management';

type TutorialAction = 'manual' | 'node-created' | 'click' | 'input' | 'preflight' | 'canvas-gesture';
type TutorialTarget =
  | 'canvas-fullscreen'
  | 'canvas-pane'
  | 'canvas-minimap'
  | 'canvas-node-menu'
  | 'canvas-sidebar'
  | 'canvas-zoom-controls'
  | 'canvas-agent-entry'
  | 'canvas-agent-window'
  | 'canvas-agent-conversation'
  | 'canvas-agent-models'
  | 'canvas-agent-attachments'
  | 'canvas-agent-voice'
  | 'canvas-agent-send'
  | 'active-node'
  | 'material-upload-button'
  | 'material-settings-panel'
  | 'material-mention-input'
  | 'material-seedance-settings'
  | 'material-face-compliance'
  | 'image-prompt-input'
  | 'image-generate-button'
  | 'video-prompt-input'
  | 'video-generate-button'
  | 'music-preview-panel'
  | 'music-editor-panel'
  | `sidebar-node-${CanvasNodeData['type']}`;

type TutorialStep = {
  id: string;
  title: string;
  description: string;
  action: TutorialAction;
  target?: TutorialTarget;
  nodeType?: CanvasNodeData['type'];
  interaction?: TutorialCanvasInteraction;
  safetyNote?: string;
};

type TutorialCourse = {
  id: CourseId;
  title: string;
  description: string;
  duration: string;
  icon: LucideIcon;
  primaryNodeType?: CanvasNodeData['type'];
  steps: TutorialStep[];
};

type TutorialProgress = {
  steps: Partial<Record<CourseId, number>>;
  completed: CourseId[];
  stats: Partial<Record<CourseId, TutorialCourseStats>>;
};

type TutorialCourseStats = {
  hintsUsed: number;
  skips: number;
  wrongActions: number;
  mastery?: number;
  completedAt?: number;
};

type TutorialCompletion = {
  courseId: CourseId;
  mastery: number;
};

type TutorialCheck = {
  id: string;
  label: string;
  detail: string;
  passed: boolean;
};

const STORAGE_KEY = 'magine-canvas-tutorial-progress-v1';
const EMPTY_PROGRESS: TutorialProgress = { steps: {}, completed: [], stats: {} };

const COURSES: TutorialCourse[] = [
  {
    id: 'canvas-basics',
    title: '鼠标与快捷键',
    description: '先掌握画布平移、菜单、缩放、小地图和常用键盘操作。',
    duration: '约 5 分钟',
    icon: BookOpenCheck,
    primaryNodeType: 'prompt',
    steps: [
      { id: 'intro', title: '先学习画布操作', description: '进入画布后，先掌握鼠标和键盘操作，再开始创建节点。高亮区域是本步骤需要操作的位置。', action: 'manual', target: 'canvas-pane' },
      { id: 'double-click', title: '双击打开功能菜单', description: '在画布空白处双击鼠标左键，打开添加节点功能菜单。', action: 'canvas-gesture', target: 'canvas-pane', interaction: 'double-click-menu' },
      { id: 'add-node', title: '添加任意节点', description: '在功能菜单中任选一种节点并单击添加。节点创建成功后，教学会自动进入下一步。', action: 'node-created', target: 'canvas-node-menu' },
      { id: 'middle-pan', title: '中键拖动画布', description: '把鼠标放在画布空白处，按住滚轮中键并拖动，移动整个画布视角。松开中键后自动进入下一步。', action: 'canvas-gesture', target: 'canvas-pane', interaction: 'middle-pan' },
      { id: 'ctrl-wheel', title: 'Ctrl 加滚轮缩放', description: '按住 Ctrl，再滚动鼠标滚轮。向上放大画布，向下缩小画布，并以当前视角为中心平滑缩放。', action: 'canvas-gesture', target: 'canvas-pane', interaction: 'ctrl-wheel-zoom' },
      { id: 'minimap', title: '使用左下角小地图', description: '按住左下角小地图的视口区域并拖动，快速移动到画布的其他位置。', action: 'canvas-gesture', target: 'canvas-minimap', interaction: 'minimap-pan' },
      { id: 'context-menu', title: '右键打开选项菜单', description: '在画布空白处单击鼠标右键，打开上传、添加节点和整理画布等选项。', action: 'canvas-gesture', target: 'canvas-pane', interaction: 'context-menu' },
      { id: 'keyboard', title: '常用键盘快捷键', description: 'Ctrl+Z 撤销，Ctrl+Y 或 Ctrl+Shift+Z 重做；Delete 或 Backspace 删除已选内容；Esc 退出当前菜单或操作。输入文字时，这些按键优先作用于输入框。', action: 'manual', target: 'canvas-fullscreen' },
      { id: 'bottom-toolbar', title: '认识底部功能栏', description: '底部功能栏可以缩小或放大画布、查看当前缩放比例、一键整理节点、适配全部内容，并切换画布性能模式。', action: 'manual', target: 'canvas-zoom-controls' },
      { id: 'toolbar', title: '认识左侧工具栏', description: '左侧工具栏也可以直接创建文本、图像、视频、Agent 和全景等节点。', action: 'manual', target: 'canvas-sidebar' },
      { id: 'done', title: '画布操作完成', description: '你已经依次掌握左键双击添加节点、中键平移、Ctrl 加滚轮缩放、小地图移动、右键菜单和常用键盘快捷键。', action: 'manual' },
    ],
  },
  {
    id: 'image-generation',
    title: '图像生成',
    description: '创建图像节点、填写提示词并认识生成入口。',
    duration: '约 3 分钟',
    icon: ImageIcon,
    primaryNodeType: 'image',
    steps: [
      { id: 'intro', title: '开始图像生成教学', description: '先创建图像节点，再打开节点编辑面板填写提示词。', action: 'manual', target: 'sidebar-node-image' },
      { id: 'create', title: '创建图像节点', description: '点击左侧“图像”。', action: 'node-created', target: 'sidebar-node-image', nodeType: 'image' },
      { id: 'select', title: '展开图像编辑面板', description: '点击刚创建的图像节点。', action: 'click', target: 'active-node' },
      { id: 'prompt', title: '输入图像提示词', description: '在提示词框内输入你想生成的画面描述。', action: 'input', target: 'image-prompt-input' },
      { id: 'generate', title: '生成前安全检查', description: '教学模式会检查提示词、模型路径和输出参数，但不会提交生成。', action: 'preflight', target: 'image-generate-button', safetyNote: '生成会产生真实 API 或即梦额度消耗，教学模式不会替你点击。' },
      { id: 'done', title: '图像节点教学完成', description: '你已经掌握图像节点的基本生成流程。', action: 'manual' },
    ],
  },
  {
    id: 'video-generation',
    title: '视频生成',
    description: '创建视频节点、填写提示词并认识生成参数。',
    duration: '约 3 分钟',
    icon: Video,
    primaryNodeType: 'video',
    steps: [
      { id: 'intro', title: '开始视频生成教学', description: '视频节点支持 API 和即梦 CLI 路径。教学不会自动提交任务。', action: 'manual', target: 'sidebar-node-video' },
      { id: 'create', title: '创建视频节点', description: '点击左侧“视频”。', action: 'node-created', target: 'sidebar-node-video', nodeType: 'video' },
      { id: 'select', title: '展开视频编辑面板', description: '点击刚创建的视频节点。', action: 'click', target: 'active-node' },
      { id: 'prompt', title: '输入视频提示词', description: '填写镜头内容、动作和运镜要求。', action: 'input', target: 'video-prompt-input' },
      { id: 'generate', title: '视频生成前安全检查', description: '教学模式会检查输入、模型路径、比例、分辨率和时长，但不会提交任务。', action: 'preflight', target: 'video-generate-button', safetyNote: '生成会产生真实额度消耗，教学模式不会替你点击。' },
      { id: 'done', title: '视频节点教学完成', description: '你已经掌握视频节点的基本生成流程。', action: 'manual' },
    ],
  },
  {
    id: 'asset-management',
    title: '素材节点',
    description: '上传并管理单个图片、视频或音频素材，供其他节点连接和引用。',
    duration: '约 4 分钟',
    icon: Layers,
    primaryNodeType: 'material',
    steps: [
      { id: 'intro', title: '认识素材节点', description: '素材节点用于承载一个外部图片、视频或音频文件，并把媒体作为参考输入传给下游节点。', action: 'manual', target: 'sidebar-node-material' },
      { id: 'create', title: '创建素材节点', description: '点击左侧“素材”，在当前画布视口中间创建空素材节点。', action: 'node-created', target: 'sidebar-node-material', nodeType: 'material' },
      { id: 'select', title: '展开素材设置', description: '点击刚创建的素材节点，展开节点下方的素材设置面板。', action: 'click', target: 'active-node' },
      { id: 'upload', title: '上传本地素材', description: '点击节点中的“上传素材”，可选择图片、视频或音频。文件选中后会立即显示本地预览，并保存到当前项目素材缓存。', action: 'manual', target: 'material-upload-button' },
      { id: 'mention', title: '设置 @ 引用名称', description: '引用名称是其他提示词框中 @这个素材 时使用的短名称。名称应简短且唯一；素材连接到下游节点后，当前文件会同步作为参考输入。', action: 'manual', target: 'material-mention-input' },
      { id: 'seedance', title: '配置 Seedance 资产标识', description: '普通本地素材不要求填写 Asset ID。只有已在 Seedance 注册为长期资产时，才填写 asset:// 开头的 Asset ID；Asset Group ID 用于关联同一组资产。', action: 'manual', target: 'material-seedance-settings' },
      { id: 'actions', title: '预览与素材操作', description: '节点会按原始比例预览图片或视频。鼠标悬停素材后，可导入组合节点、下载、替换或移除当前文件；连接线用于把素材传给图像、视频、Agent 等下游节点。', action: 'manual', target: 'material-settings-panel' },
      { id: 'face-compliance', title: '图片人脸合规', description: '上传图片后，设置面板会出现人脸合规开关。开启即开始检测处理，后续连接优先使用合规处理结果；视频和音频不会显示此选项。', action: 'manual', target: 'material-face-compliance' },
      { id: 'done', title: '素材节点教学完成', description: '你已经掌握素材上传、引用命名、预览、下载、替换和移除等操作。', action: 'manual' },
    ],
  },
  {
    id: 'panorama-generation',
    title: '全景场景',
    description: '学习参考图输入、标准/智能模式、环视、历史记录和截帧导出。',
    duration: '约 5 分钟',
    icon: Box,
    primaryNodeType: 'panorama',
    steps: [
      { id: 'intro', title: '认识全景节点', description: '全景节点接收场景图片，并生成可以拖动环视的场景，也能生成左侧、右侧和反向方位参考。', action: 'manual', target: 'sidebar-node-panorama' },
      { id: 'create', title: '创建全景节点', description: '点击左侧“全景”。', action: 'node-created', target: 'sidebar-node-panorama', nodeType: 'panorama' },
      { id: 'select', title: '展开全景节点', description: '点击节点，查看预览、生成路径、图片模型和提示词补充。', action: 'click', target: 'active-node' },
      { id: 'input', title: '连接或上传场景图', description: '将图像生成、素材或手绘分镜节点连接到左侧入点，也可以在节点内上传场景图。参考图断开后，预览会恢复无全景状态。', action: 'manual', target: 'active-node' },
      { id: 'modes', title: '标准模式与智能模式', description: '标准模式直接显示输入的全景纹理；智能模式会调用支持参考图的图片模型，结合内置引导生成可环视场景。纯文生图模型不能用于参考图生成。', action: 'manual', target: 'active-node' },
      { id: 'settings', title: '配置模型与提示词', description: '选择可用图片模型、分辨率和预览比例。提示词补充只追加场景要求，不会覆盖内置全景结构约束。', action: 'manual', target: 'active-node' },
      { id: 'preview', title: '环视与历史场景', description: '生成后在预览框内拖动查看不同方向。历史全景保存在节点中，可以横向选择并恢复对应版本。', action: 'manual', target: 'active-node' },
      { id: 'capture', title: '截取与下载', description: '一键截取会把当前环视角度生成新的图片素材节点；下载按钮把当前全景或截帧保存到本机文件夹。', action: 'manual', target: 'active-node' },
      { id: 'done', title: '全景节点教学完成', description: '生成前确认输入图、模型是否支持参考图以及额度信息。教学不会自动提交生成任务。', action: 'manual', safetyNote: '智能全景会调用云端图片模型并产生真实额度消耗。' },
    ],
  },
  {
    id: 'music-generation',
    title: '音乐 / 语音',
    description: '学习音乐与语音模式、音色、播放波形、历史素材和额度。',
    duration: '约 5 分钟',
    icon: Music,
    primaryNodeType: 'music',
    steps: [
      { id: 'intro', title: '认识音乐 / 语音节点', description: '同一节点可以切换音乐生成和语音合成，两种模式使用不同模型和输入参数。', action: 'manual', target: 'sidebar-node-music' },
      { id: 'create', title: '创建音乐 / 语音节点', description: '点击左侧“音乐/语音”。', action: 'node-created', target: 'sidebar-node-music', nodeType: 'music' },
      { id: 'select', title: '展开音频编辑面板', description: '点击节点，查看波形预览、模式、模型、输入内容和历史列表。', action: 'click', target: 'active-node' },
      { id: 'music-mode', title: '音乐生成模式', description: '音乐模式可填写歌曲主题、风格、歌词或纯音乐要求，并选择支持的音乐模型。生成后只点击播放按钮才会播放。', action: 'manual', target: 'music-editor-panel' },
      { id: 'voice-mode', title: '语音生成模式', description: '语音模式填写朗读文本并选择模型、语言和音色。选择自定义音色后，可从音色管理中使用已经配置的声音。', action: 'manual', target: 'music-editor-panel' },
      { id: 'waveform', title: '播放与实时波形', description: '音频播放时，节点波形会根据真实音频幅度变化；暂停或停止后波形恢复静止。点击画布空白处不会触发播放。', action: 'manual', target: 'music-preview-panel' },
      { id: 'history', title: '管理历史音频', description: '每次成功生成都会形成独立历史素材。可以选择、播放、暂停、下载或单独删除，重新进入工程后仍可恢复。', action: 'manual', target: 'music-preview-panel' },
      { id: 'usage', title: '查看额度与错误', description: '编辑面板底部显示当前模型、账户余额和上次任务消耗。额度不足或云端维护时，节点会显示对应中文提示。', action: 'manual', target: 'music-editor-panel' },
      { id: 'done', title: '音乐 / 语音教学完成', description: '提交前确认模式、模型、音色与额度。教学不会替你提交真实生成任务。', action: 'manual', safetyNote: '音乐和语音生成会产生云端额度消耗。' },
    ],
  },
  {
    id: 'assistant',
    title: 'AI 助手',
    description: '在画布内提问、分析多模态素材并调用画布工具执行任务。',
    duration: '约 5 分钟',
    icon: Bot,
    steps: [
      { id: 'intro', title: '认识 AI 助手', description: 'AI 助手可以结合当前画布回答操作问题、理解任务，并在获得明确要求后调用画布工具。它与可连接的 Agent 节点是两个不同入口。', action: 'manual', target: 'canvas-agent-entry' },
      { id: 'open', title: '打开 AI 助手', description: '点击画布右下角的 AI 助手按钮，打开 Magine 助手对话窗口。', action: 'click', target: 'canvas-agent-entry' },
      { id: 'conversation', title: '提出明确需求', description: '描述目标、已有素材、期望输出和限制条件。助手会结合画布与对话上下文灵活回答，每条对话都会显示时间。', action: 'manual', target: 'canvas-agent-conversation' },
      { id: 'models', title: '切换大语言模型', description: '底部可以选择已经配置的厂商与模型。所有支持的模型都使用统一流式输出与工具协议；无响应时先检查模型可用性、API 配置和账户额度。', action: 'manual', target: 'canvas-agent-models' },
      { id: 'attachments', title: '发送图片、视频和音频', description: '点击回形针添加多模态附件。只有具备对应能力的模型才能理解这些文件，发送附件不会删除或断开画布中的素材连接。', action: 'manual', target: 'canvas-agent-attachments' },
      { id: 'tools', title: '调用画布工具', description: '明确要求创建、连接、修改或运行时，助手会先选择工具再执行，并在完成后核对画布状态。', action: 'manual', target: 'canvas-agent-window', safetyNote: '涉及图片、视频或音乐生成的工具可能消耗真实云端额度。' },
      { id: 'voice', title: '语音输入与播报', description: '麦克风使用本地 STT 把语音转为文字；启用语音助手后可以播放回复，说话时可以打断播报。', action: 'manual', target: 'canvas-agent-voice' },
      { id: 'cancel', title: '取消和恢复任务', description: '执行期间发送按钮会变为停止图标。点击停止后立即取消当前任务，按钮和波形恢复初始状态，已经完成的画布内容不会被回滚。', action: 'manual', target: 'canvas-agent-send' },
      { id: 'done', title: 'AI 助手教学完成', description: '自然语言问答交给 AI 助手，需要独立连接和复用的智能体放进 Agent 节点。关闭助手窗口不会删除对话或画布内容。', action: 'manual', target: 'canvas-agent-window' },
    ],
  },
  {
    id: 'agent-node',
    title: 'Agent 节点',
    description: '创建可连接素材、理解多模态输入并持续执行任务的画布智能体。',
    duration: '约 6 分钟',
    icon: Bot,
    primaryNodeType: 'agent',
    steps: [
      { id: 'intro', title: '认识 Agent 节点', description: 'Agent 节点是画布中的可连接智能体。它拥有独立角色说明、模型路由、对话历史和输出端口，可以把结果继续传给下游节点。', action: 'manual', target: 'sidebar-node-agent' },
      { id: 'create', title: '创建 Agent 节点', description: '点击左侧“Agent”，在新的空白区域创建节点。', action: 'node-created', target: 'sidebar-node-agent', nodeType: 'agent' },
      { id: 'select', title: '展开 Agent 节点', description: '点击节点，打开完整聊天、角色配置和模型选择界面。', action: 'click', target: 'active-node' },
      { id: 'role', title: '设置名称与角色说明', description: 'Agent 名称用于区分职责；角色说明应写清目标、边界、输出格式和禁止行为。具体、可验证的说明能减少乱回和错误工具调用。', action: 'manual', target: 'active-node' },
      { id: 'route', title: '选择模型与路由', description: '选择已经配置的大语言模型服务与模型。需要分析图片、视频或音频时，必须选择支持对应多模态输入的模型；不同模型都通过统一工具协议执行画布操作。', action: 'manual', target: 'active-node' },
      { id: 'inputs', title: '连接和附加多模态素材', description: '图片、视频和音频素材可以通过连接线输入，也可以用回形针添加。发送时连接不会被删除，文件会转换成模型可读取的输入；过大或不支持的文件会显示明确提示。', action: 'manual', target: 'active-node' },
      { id: 'chat', title: '发送、流式输出与取消', description: '输入任务后点击发送。模型会流式输出思考结果；生成中按钮变为停止图标，点击后立即取消并恢复发送状态，输入框在执行期间仍可编辑。', action: 'manual', target: 'active-node' },
      { id: 'history', title: '上下文与持久化', description: 'Agent 会保存当前节点的对话历史、附件和执行结果，退出工程后可以恢复。清空历史只影响当前 Agent，不会删除画布素材。', action: 'manual', target: 'active-node' },
      { id: 'done', title: 'Agent 节点教学完成', description: '为复杂任务先定义角色和输出要求，再连接素材、选择具备相应能力的模型并发送。涉及生成服务的工具调用可能产生真实额度消耗。', action: 'manual', safetyNote: 'Agent 调用图片、视频、音乐等生成工具时会使用对应云端额度。' },
    ],
  },
  {
    id: 'browser-node',
    title: '浏览器节点',
    description: '在画布内打开网页、搜索资料并保持桌面端登录会话。',
    duration: '约 4 分钟',
    icon: Compass,
    primaryNodeType: 'browser',
    steps: [
      { id: 'intro', title: '认识浏览器节点', description: '浏览器节点在 Electron 桌面端嵌入真实网页，可用于搜索、登录模型网站或查看购买与控制台页面。', action: 'manual', target: 'sidebar-node-browser' },
      { id: 'create', title: '创建浏览器节点', description: '点击左侧“浏览器”，在空白区域创建节点。', action: 'node-created', target: 'sidebar-node-browser', nodeType: 'browser' },
      { id: 'select', title: '展开浏览器', description: '点击节点，显示地址栏、导航按钮和网页内容。', action: 'click', target: 'active-node' },
      { id: 'address', title: '输入网址或搜索词', description: '地址栏支持完整网址和普通关键词。没有协议的网址会自动补全，关键词会使用默认搜索引擎打开。', action: 'manual', target: 'active-node' },
      { id: 'navigation', title: '导航与外部打开', description: '使用后退、前进和刷新控制页面；“在系统浏览器打开”会把当前地址交给默认浏览器。网页内部滚动不会缩放画布。', action: 'manual', target: 'active-node' },
      { id: 'session', title: '登录状态与使用限制', description: '画布内浏览器使用固定桌面会话分区，登录状态可以保留。部分网站禁止嵌入或要求额外验证时，请改用系统浏览器。网页版不支持 Electron 内嵌浏览器。', action: 'manual', target: 'active-node' },
      { id: 'done', title: '浏览器节点教学完成', description: '浏览器节点适合在创作过程中查资料和管理服务，不会自动把网页内容发送给大模型。', action: 'manual' },
    ],
  },
  {
    id: 'storyboard-node',
    title: '手绘分镜',
    description: '导入底图，使用画笔、形状和文字绘制可连接的分镜参考。',
    duration: '约 6 分钟',
    icon: Pencil,
    primaryNodeType: 'storyboard',
    steps: [
      { id: 'intro', title: '认识手绘分镜节点', description: '手绘分镜节点用于快速画构图、人物位置、运动方向和文字标注，输出可以连接到图像、视频和全景节点作为参考。', action: 'manual', target: 'sidebar-node-storyboard' },
      { id: 'create', title: '创建手绘分镜节点', description: '点击左侧“分镜”，在空白区域创建节点。', action: 'node-created', target: 'sidebar-node-storyboard', nodeType: 'storyboard' },
      { id: 'select', title: '展开分镜画板', description: '点击节点，打开完整画板和绘制工具。', action: 'click', target: 'active-node' },
      { id: 'background', title: '接入或导入底图', description: '左侧可以连接素材或图像节点作为底图，也可以直接导入图片。底图只作为绘制基础，不会覆盖已有笔划。', action: 'manual', target: 'active-node' },
      { id: 'tools', title: '使用绘制工具', description: '选择画笔、橡皮、直线、箭头、矩形和文字工具，再调整颜色与粗细。文字创建后可以重新选择并编辑。', action: 'manual', target: 'active-node' },
      { id: 'history', title: '撤销、重做与删除', description: 'Ctrl+Z 和 Ctrl+Y 优先处理当前分镜笔划。选择元素后按 Delete 删除；画板自己的历史不会误触发整个画布撤销。', action: 'manual', target: 'active-node' },
      { id: 'output', title: '输出与 @ 引用', description: '节点会把底图和笔划合成为一张图片输出。设置简短唯一的引用名称后，可以在提示词中 @引用，也可以用连接线传给下游节点。', action: 'manual', target: 'active-node' },
      { id: 'done', title: '手绘分镜教学完成', description: '用底图确定场景，用线条与文字说明构图和动作，再把合成结果连接给生成节点。', action: 'manual' },
    ],
  },
  {
    id: 'quality-enhancement',
    title: '画质提升',
    description: '使用 Topaz 云端模型提升图片清晰度并查看真实任务状态。',
    duration: '约 5 分钟',
    icon: Sparkles,
    primaryNodeType: 'topazEnhance',
    steps: [
      { id: 'intro', title: '认识画质提升节点', description: '画质提升节点只使用已经配置的 Topaz 云端 API。左侧是原始素材，中间是增强参数，右侧显示云端成功返回的结果。', action: 'manual', target: 'sidebar-node-topazEnhance' },
      { id: 'create', title: '创建画质提升节点', description: '点击左侧“画质”，在空白区域创建横向节点。', action: 'node-created', target: 'sidebar-node-topazEnhance', nodeType: 'topazEnhance' },
      { id: 'select', title: '展开画质提升节点', description: '点击节点，完整显示原图、选项、增强结果与额度信息。', action: 'click', target: 'active-node' },
      { id: 'input', title: '连接原始图片', description: '把图片素材或图像生成节点连接到左侧入点。节点会保留原图比例，输入更清晰的大图通常能得到更稳定结果。', action: 'manual', target: 'active-node' },
      { id: 'settings', title: '设置增强参数', description: '选择放大倍数和增强模型。参数会直接传给云端任务；节点不会在云端失败时伪造本地成功结果。', action: 'manual', target: 'active-node' },
      { id: 'status', title: '查看云端状态与额度', description: '处理中会持续轮询 Topaz/Kie 云端任务。只有控制台返回成功并提供下载链接，右侧才显示结果；失败原因、Token、积分或 Credits 会在节点内同步展示。', action: 'manual', target: 'active-node' },
      { id: 'done', title: '画质提升教学完成', description: '确认 API Key、账户额度、输入文件和模型参数后再提交。云端失败时根据节点错误码排查，不会切换本地增强。', action: 'manual', safetyNote: '画质提升是云端付费任务，教学不会自动运行。' },
    ],
  },
  {
    id: 'region-management',
    title: '区域节点',
    description: '框选画布区域，把相关节点分组、命名并整体移动。',
    duration: '约 4 分钟',
    icon: BoxSelect,
    primaryNodeType: 'region',
    steps: [
      { id: 'intro', title: '认识区域节点', description: '区域节点是画布分组容器，用于整理同一阶段或同一主题的节点。区域本身不调用模型，也不改变内部连接。', action: 'manual', target: 'sidebar-node-region' },
      { id: 'create', title: '框选创建区域', description: '点击左侧“区域”，然后在新的空白区域按住左键拖出范围，松开完成创建。', action: 'node-created', target: 'sidebar-node-region', nodeType: 'region' },
      { id: 'select', title: '选择区域', description: '点击区域边框，查看区域名称与范围。', action: 'click', target: 'active-node' },
      { id: 'members', title: '管理区域内节点', description: '把普通节点拖进区域后会自动成为区域成员；拖出区域可以解除归属。移动区域时，成员节点会保持相对位置一起移动。', action: 'manual', target: 'active-node' },
      { id: 'resize', title: '命名与调整范围', description: '编辑区域名称用于区分工作阶段。拖动区域边缘可以调整范围，已经落在范围内的节点会重新计算归属。', action: 'manual', target: 'active-node' },
      { id: 'done', title: '区域节点教学完成', description: '使用区域整理大型工作流；删除区域时先确认内部节点的处理方式，避免误删需要保留的内容。', action: 'manual' },
    ],
  },
];

const AVAILABLE_COURSES = COURSES;

const COURSE_BY_NODE_TYPE: Partial<Record<CanvasNodeData['type'], CourseId>> = {
  prompt: 'canvas-basics',
  image: 'image-generation',
  video: 'video-generation',
  material: 'asset-management',
  panorama: 'panorama-generation',
  music: 'music-generation',
  agent: 'agent-node',
  browser: 'browser-node',
  storyboard: 'storyboard-node',
  topazEnhance: 'quality-enhancement',
  region: 'region-management',
};

interface TutorialHostProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenApiConfig?: () => void;
  onOpenAgent?: (prompt: string) => void;
  isAgentOpen?: boolean;
  onOpenAgentWindow?: () => void;
  onCloseAgentWindow?: () => void;
  autoStartCourseId?: CourseId;
  autoStartRequestId?: number;
}

function findCourseForNodeType(nodeType: CanvasNodeData['type'] | undefined): TutorialCourse | null {
  const courseId = nodeType ? COURSE_BY_NODE_TYPE[nodeType] : undefined;
  return courseId ? AVAILABLE_COURSES.find((course) => course.id === courseId) || null : null;
}

function getConfiguredProvider(
  category: SeedanceConfig['image'] | SeedanceConfig['video'],
  providerId: string
) {
  return category.providers[providerId] || category.customProviders[providerId] || null;
}

function buildGenerationChecks(
  courseId: CourseId,
  nodeData: CanvasNodeData | undefined,
  config: SeedanceConfig,
  hasConnectedInput: boolean
): TutorialCheck[] {
  if (!nodeData || (courseId !== 'image-generation' && courseId !== 'video-generation')) return [];

  const isImage = courseId === 'image-generation';
  const backend = nodeData.generationBackend === 'dreamina-cli' ? 'dreamina-cli' : 'api';
  const category = isImage ? config.image : config.video;
  const providerId = String(nodeData.providerId || category.activeProviderId || '');
  const provider = getConfiguredProvider(category, providerId);
  const prompt = String(nodeData.customPrompt || nodeData.prompt || '').trim();
  const hasPromptOrReference = isImage ? prompt.length > 0 : prompt.length > 0 || hasConnectedInput;
  const model = backend === 'dreamina-cli'
    ? String(nodeData.dreaminaCliModel || nodeData.model || config.dreaminaCli.enabledModels[0] || '')
    : String(nodeData.model || provider?.models[0] || '');
  const routeReady = backend === 'dreamina-cli'
    ? config.dreaminaCli.loggedIn && (isImage ? config.dreaminaCli.imageEnabled : config.dreaminaCli.videoEnabled)
    : Boolean(provider?.enabled && provider.apiKey.trim() && provider.apiUrl.trim());
  const ratio = String(isImage ? nodeData.aspectRatio || '16:9' : nodeData.ratio || '16:9');
  const resolution = String(isImage ? nodeData.imageResolution || '2K' : nodeData.resolution || '720P');
  const duration = Number(nodeData.duration || 5);

  return [
    {
      id: 'input',
      label: isImage ? '图像提示词' : '视频内容输入',
      detail: hasPromptOrReference ? (prompt ? '已填写提示词' : '已连接参考素材') : '请填写提示词或连接参考素材',
      passed: hasPromptOrReference,
    },
    {
      id: 'route',
      label: backend === 'dreamina-cli' ? '即梦 CLI 登录状态' : 'API 模型路径',
      detail: routeReady
        ? backend === 'dreamina-cli' ? '即梦 CLI 已登录并启用' : `${provider?.label || providerId} 已配置`
        : backend === 'dreamina-cli' ? '即梦 CLI 尚未登录或未启用' : '当前模型厂商缺少可用密钥或地址',
      passed: routeReady,
    },
    {
      id: 'model',
      label: '生成模型',
      detail: model || '尚未选择可用模型',
      passed: model.trim().length > 0,
    },
    {
      id: 'output',
      label: '输出参数',
      detail: isImage ? `${ratio} · ${resolution}` : `${ratio} · ${resolution} · ${duration} 秒`,
      passed: Boolean(ratio && resolution && (isImage || duration > 0)),
    },
  ];
}

function calculateMastery(stats: TutorialCourseStats | undefined): number {
  if (!stats) return 100;
  return Math.max(55, 100 - stats.hintsUsed * 6 - stats.skips * 12 - Math.min(18, stats.wrongActions * 3));
}

function buildCoachHints(step: TutorialStep, checks: TutorialCheck[]): string[] {
  if (step.action === 'canvas-gesture') {
    const gestureHint: Partial<Record<TutorialCanvasInteraction, string>> = {
      'middle-pan': '在画布空白处按下鼠标滚轮中键，保持按住并拖动一小段距离。',
      'double-click-menu': '在没有节点的画布空白处，快速连续点击两次鼠标左键。',
      'context-menu': '在画布空白处单击鼠标右键，不需要长按。',
      'ctrl-wheel-zoom': '保持 Ctrl 键按下，再向上或向下滚动鼠标滚轮。',
      'minimap-pan': '在左下角小地图内按住视口区域拖动，而不是点击普通画布。',
    };
    return [
      step.interaction ? gestureHint[step.interaction] || '请按步骤说明完成当前鼠标操作。' : '请按步骤说明完成当前鼠标操作。',
      '操作被识别后会自动进入下一步，不需要点击教学卡片。',
      '如果当前设备没有中键或小地图，可以使用“跳过”继续。',
    ];
  }
  if (step.action === 'node-created') {
    return [
      '请找到淡黄色高亮的左侧工具按钮。',
      '单击高亮按钮一次，节点会创建在当前画布视口中间。',
      '如果按钮不在可见区域，可先点击“重新定位”。',
    ];
  }
  if (step.action === 'click') {
    return [
      '淡黄色边框标出了本步骤需要选择的节点。',
      '单击节点主体，不要按住拖动。',
      '节点选中并展开后，本步骤会自动完成。',
    ];
  }
  if (step.action === 'input') {
    return [
      '点击高亮的提示词输入区域。',
      '输入一段完整描述，至少保留一个非空字符。',
      '输入生效后教学会自动进入生成前检查。',
    ];
  }
  if (step.action === 'preflight') {
    const failed = checks.find((check) => !check.passed);
    return [
      failed ? `当前先处理：${failed.detail}` : '当前检查项已经全部通过。',
      '黄色空心项表示仍需处理，绿色勾选项表示已就绪。',
      '教学只检查配置，不会点击生成按钮或消耗额度。',
    ];
  }
  return [
    '先阅读当前步骤说明，再观察高亮区域。',
    '完成界面中的尝试后，点击“下一步”。',
    '仍不确定时，可点击“询问 AI 助手”获得针对当前画布的解释。',
  ];
}

function readProgress(): TutorialProgress {
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}') as Partial<TutorialProgress>;
    return {
      steps: saved.steps && typeof saved.steps === 'object' ? saved.steps : {},
      completed: Array.isArray(saved.completed)
        ? saved.completed.filter((id): id is CourseId => AVAILABLE_COURSES.some((course) => course.id === id))
        : [],
      stats: saved.stats && typeof saved.stats === 'object' ? saved.stats : {},
    };
  } catch {
    return EMPTY_PROGRESS;
  }
}

function findNodeElement(nodeId: string): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>('.react-flow__node')).find(
    (element) => element.dataset.id === nodeId
  ) || null;
}

function resolveTarget(target: TutorialTarget | undefined, nodeId: string | null): HTMLElement | null {
  if (!target) return null;
  if (target === 'canvas-fullscreen') return document.documentElement;
  if (target === 'active-node') return nodeId ? findNodeElement(nodeId) : null;
  if (target === 'canvas-pane') return document.querySelector<HTMLElement>('.react-flow__pane');
  if (target === 'canvas-minimap') return document.querySelector<HTMLElement>('.react-flow__minimap');
  const matches = Array.from(document.querySelectorAll<HTMLElement>(`[data-tutorial-id="${target}"]`));
  if (nodeId) {
    const nodeMatch = matches.find((element) => element.dataset.tutorialNodeId === nodeId);
    if (nodeMatch) return nodeMatch;

  }
  return matches[0] || null;
}

function hasInputValue(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null;
  if (!element) return false;
  const input = element.closest('input, textarea, [contenteditable="true"]') as HTMLInputElement | HTMLTextAreaElement | HTMLElement | null;
  if (!input) return false;
  const value = 'value' in input ? String(input.value) : input.textContent || '';
  return value.trim().length > 0;
}

export function TutorialHost({
  isOpen,
  onClose,
  onOpenApiConfig,
  onOpenAgent,
  isAgentOpen = false,
  onOpenAgentWindow,
  onCloseAgentWindow,
  autoStartCourseId,
  autoStartRequestId,
}: TutorialHostProps) {
  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const selectedNode = useCanvasStore((state) => state.selectedNode);
  const config = useSeedanceStore((state) => state.config);
  const nodesRef = useRef(nodes);
  const baselineNodeIdsRef = useRef<Set<string>>(new Set());
  const baselineNodeCreationSequenceRef = useRef(0);
  const autoAdvanceKeyRef = useRef('');
  const consumedAutoStartRequestRef = useRef<number | null>(null);
  const wrongActionCountRef = useRef(0);
  const [mounted, setMounted] = useState(false);
  const [progress, setProgress] = useState<TutorialProgress>(EMPTY_PROGRESS);
  const [activeCourseId, setActiveCourseId] = useState<CourseId | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [lastCompletion, setLastCompletion] = useState<TutorialCompletion | null>(null);
  const [coachHintLevel, setCoachHintLevel] = useState(0);
  const [wrongActionCount, setWrongActionCount] = useState(0);

  const activeCourse = useMemo(
    () => AVAILABLE_COURSES.find((course) => course.id === activeCourseId) || null,
    [activeCourseId]
  );
  const currentStep = activeCourse?.steps[stepIndex] || null;
  const focusedNode = useMemo(
    () => nodes.find((node) => node.id === focusNodeId),
    [focusNodeId, nodes]
  );
  const contextualCourse = useMemo(
    () => findCourseForNodeType(selectedNode?.data.type),
    [selectedNode?.data.type]
  );
  const generationChecks = useMemo(
    () => activeCourse
      ? buildGenerationChecks(
          activeCourse.id,
          focusedNode?.data,
          config,
          Boolean(focusNodeId && edges.some((edge) => edge.target === focusNodeId))
        )
      : [],
    [activeCourse, config, edges, focusNodeId, focusedNode?.data]
  );

  useEffect(() => {
    if (activeCourseId !== 'assistant' || !currentStep) return;
    if (currentStep.id === 'intro' || currentStep.id === 'open') return;
    if (!isAgentOpen) onOpenAgentWindow?.();
  }, [activeCourseId, currentStep, isAgentOpen, onOpenAgentWindow]);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setProgress(readProgress());
      setMounted(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  }, [mounted, progress]);

  const recordMetric = useCallback((metric: 'hintsUsed' | 'skips' | 'wrongActions') => {
    if (!activeCourseId) return;
    setProgress((previous) => {
      const current = previous.stats[activeCourseId] || { hintsUsed: 0, skips: 0, wrongActions: 0 };
      return {
        ...previous,
        stats: {
          ...previous.stats,
          [activeCourseId]: { ...current, [metric]: current[metric] + 1 },
        },
      };
    });
  }, [activeCourseId]);

  const finishCourse = useCallback(() => {
    if (!activeCourseId) return;
    const currentStats = progress.stats[activeCourseId] || { hintsUsed: 0, skips: 0, wrongActions: 0 };
    const mastery = calculateMastery(currentStats);
    setProgress((previous) => ({
      ...previous,
      steps: { ...previous.steps, [activeCourseId]: 0 },
      completed: previous.completed.includes(activeCourseId)
        ? previous.completed
        : [...previous.completed, activeCourseId],
      stats: {
        ...previous.stats,
        [activeCourseId]: { ...currentStats, mastery, completedAt: Date.now() },
      },
    }));
    setLastCompletion({ courseId: activeCourseId, mastery });
    setActiveCourseId(null);
    setFocusNodeId(null);
    setTargetRect(null);
  }, [activeCourseId, progress.stats]);

  const advance = useCallback(() => {
    if (!activeCourse || !activeCourseId) return;
    if (stepIndex >= activeCourse.steps.length - 1) {
      finishCourse();
      return;
    }
    const nextIndex = stepIndex + 1;
    const nextStep = activeCourse.steps[nextIndex];
    if (activeCourseId === 'assistant' && nextStep.id !== 'intro' && nextStep.id !== 'open' && !isAgentOpen) {
      onOpenAgentWindow?.();
    }
    setStepIndex(nextIndex);
    setProgress((previous) => ({
      ...previous,
      steps: { ...previous.steps, [activeCourseId]: nextIndex },
    }));
  }, [activeCourse, activeCourseId, finishCourse, isAgentOpen, onOpenAgentWindow, stepIndex]);

  const startCourse = useCallback((
    course: TutorialCourse,
    contextualNodeId?: string,
    forceRestart = false,
  ) => {
    const contextualNode = contextualNodeId
      ? nodesRef.current.find((node) => node.id === contextualNodeId)
      : undefined;
    const existingNode = contextualNode || (course.primaryNodeType
      ? [...nodesRef.current].reverse().find((node) => node.data.type === course.primaryNodeType)
      : undefined);
    const createStepIndex = course.steps.findIndex((step) => step.action === 'node-created');
    const clickStepIndex = course.steps.findIndex((step) => step.action === 'click');
    let resumeAt = forceRestart
      ? 0
      : contextualNode
      ? Math.min(course.steps.length - 1, Math.max(0, clickStepIndex + 1))
      : progress.completed.includes(course.id)
        ? 0
        : Math.min(progress.steps[course.id] || 0, course.steps.length - 1);
    if (!existingNode && createStepIndex >= 0 && resumeAt > createStepIndex) resumeAt = createStepIndex;
    if (course.id === 'assistant') {
      const openingStepIndex = course.steps.findIndex((step) => step.id === 'open');
      if (resumeAt <= openingStepIndex) {
        if (isAgentOpen) onCloseAgentWindow?.();
      } else if (!isAgentOpen) {
        onOpenAgentWindow?.();
      }
    }
    setFocusNodeId(existingNode?.id || null);
    setStepIndex(resumeAt);
    setActiveCourseId(course.id);
    setLastCompletion(null);
    if (progress.completed.includes(course.id)) {
      setProgress((previous) => ({
        ...previous,
        stats: {
          ...previous.stats,
          [course.id]: { hintsUsed: 0, skips: 0, wrongActions: 0 },
        },
      }));
    }
  }, [isAgentOpen, onCloseAgentWindow, onOpenAgentWindow, progress]);

  useEffect(() => {
    if (!isOpen || !autoStartCourseId || autoStartRequestId === undefined) return;
    if (consumedAutoStartRequestRef.current === autoStartRequestId) return;
    const course = AVAILABLE_COURSES.find((candidate) => candidate.id === autoStartCourseId);
    if (!course) return;
    consumedAutoStartRequestRef.current = autoStartRequestId;
    startCourse(course, undefined, true);
  }, [autoStartCourseId, autoStartRequestId, isOpen, startCourse]);

  const resetProgress = useCallback(() => {
    if (!window.confirm('只重置教学进度，不会删除画布内容。确定继续吗？')) return;
    setProgress(EMPTY_PROGRESS);
    setLastCompletion(null);
  }, []);

  const handleClose = useCallback(() => {
    setActiveCourseId(null);
    setFocusNodeId(null);
    setTargetRect(null);
    onClose();
  }, [onClose]);

  const handleOpenApiConfig = useCallback(() => {
    setActiveCourseId(null);
    setFocusNodeId(null);
    setTargetRect(null);
    onClose();
    onOpenApiConfig?.();
  }, [onClose, onOpenApiConfig]);

  const handleOpenAgent = useCallback(() => {
    if (!activeCourse || !currentStep || !onOpenAgent) return;
    const failedChecks = generationChecks.filter((check) => !check.passed).map((check) => check.detail);
    const context = [
      `我正在使用教学模式学习“${activeCourse.title}”。`,
      `当前步骤是“${currentStep.title}”：${currentStep.description}`,
      focusedNode ? `当前节点是“${String(focusedNode.data.label || focusedNode.data.type)}”。` : '',
      failedChecks.length > 0 ? `当前未通过的检查：${failedChecks.join('；')}。` : '',
      '请结合当前画布状态，简洁告诉我下一步应当怎么操作。不要替我提交任何会消耗额度的生成任务。',
    ].filter(Boolean).join('\n');
    setActiveCourseId(null);
    setFocusNodeId(null);
    setTargetRect(null);
    onClose();
    onOpenAgent(context);
  }, [activeCourse, currentStep, focusedNode, generationChecks, onClose, onOpenAgent]);

  const revealCoachHint = useCallback(() => {
    setCoachHintLevel((current) => Math.min(3, current + 1));
    recordMetric('hintsUsed');
  }, [recordMetric]);

  const handleSkip = useCallback(() => {
    recordMetric('skips');
    advance();
  }, [advance, recordMetric]);

  const handleLocateTarget = useCallback(() => {
    if (!currentStep) return;
    const target = resolveTarget(currentStep.target, focusNodeId);
    const targetNodeId = target?.closest<HTMLElement>('.react-flow__node')?.dataset.id;
    const requestedNodeId = targetNodeId || focusNodeId;
    if (requestedNodeId) requestCanvasNodeFocus([requestedNodeId], requestedNodeId);
    window.setTimeout(() => {
      resolveTarget(currentStep.target, focusNodeId)?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }, 220);
  }, [currentStep, focusNodeId]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleClose, isOpen]);

  useLayoutEffect(() => {
    baselineNodeIdsRef.current = new Set(nodesRef.current.map((node) => node.id));
    baselineNodeCreationSequenceRef.current = getTutorialNodeCreatedSnapshot()?.sequence || 0;
    autoAdvanceKeyRef.current = '';
  }, [activeCourseId, stepIndex]);

  useEffect(() => {
    if (!currentStep || currentStep.action !== 'node-created' || !currentStep.nodeType) return;
    requestTutorialCreationArea(currentStep.nodeType);
  }, [currentStep]);

  useEffect(() => {
    if (!currentStep) return;
    const resetFrame = window.requestAnimationFrame(() => {
      wrongActionCountRef.current = 0;
      setCoachHintLevel(0);
      setWrongActionCount(0);
    });
    const firstHint = window.setTimeout(() => setCoachHintLevel((current) => Math.max(current, 1)), 12_000);
    const secondHint = window.setTimeout(() => setCoachHintLevel((current) => Math.max(current, 2)), 28_000);
    return () => {
      window.cancelAnimationFrame(resetFrame);
      window.clearTimeout(firstHint);
      window.clearTimeout(secondHint);
    };
  }, [currentStep]);

  useEffect(() => {
    if (!currentStep || !['node-created', 'click', 'input'].includes(currentStep.action)) return;
    const handleWrongInteraction = (event: PointerEvent) => {
      const eventElement = event.target instanceof Element ? event.target : null;
      if (!eventElement || eventElement.closest('[data-tutorial-surface="true"]')) return;
      const target = resolveTarget(currentStep.target, focusNodeId);
      if (target?.contains(eventElement)) return;
      const next = wrongActionCountRef.current + 1;
      wrongActionCountRef.current = next;
      setWrongActionCount(next);
      if (next >= 4) setCoachHintLevel((level) => Math.max(level, 2));
      else if (next >= 2) setCoachHintLevel((level) => Math.max(level, 1));
      recordMetric('wrongActions');
    };
    document.addEventListener('pointerdown', handleWrongInteraction, true);
    return () => document.removeEventListener('pointerdown', handleWrongInteraction, true);
  }, [currentStep, focusNodeId, recordMetric]);

  useEffect(() => {
    if (!currentStep || currentStep.action !== 'node-created') return;
    const snapshot = getTutorialNodeCreatedSnapshot();
    const snapshotMatches = Boolean(
      snapshot?.sequence &&
      snapshot.sequence > baselineNodeCreationSequenceRef.current &&
      (!currentStep.nodeType || snapshot.nodeType === currentStep.nodeType)
    );
    const createdNode = snapshotMatches && snapshot?.nodeId
      ? nodes.find((node) => node.id === snapshot.nodeId)
      : [...nodes].reverse().find(
      (node) =>
        !baselineNodeIdsRef.current.has(node.id) &&
        (!currentStep.nodeType || node.data.type === currentStep.nodeType)
      );
    if (!createdNode && !snapshotMatches) return;
    const key = snapshotMatches
      ? `${currentStep.id}:creation-${snapshot!.sequence}`
      : `${currentStep.id}:${createdNode!.id}`;
    if (autoAdvanceKeyRef.current === key) return;
    autoAdvanceKeyRef.current = key;
    if (createdNode) {
      setFocusNodeId(createdNode.id);
      requestCanvasNodeFocus(
        [createdNode.id],
        currentStep.nodeType ? createdNode.id : undefined,
        currentStep.nodeType ? undefined : { selectNode: false },
      );
    }
    window.setTimeout(advance, 120);
  }, [advance, currentStep, nodes]);

  useEffect(() => {
    if (!currentStep || currentStep.action !== 'node-created') return;
    const handleNodeCreated = (event: Event) => {
      const detail = (event as CustomEvent<TutorialNodeCreatedDetail>).detail;
      if (!detail || (currentStep.nodeType && detail.nodeType !== currentStep.nodeType)) return;
      const createdNode = detail.nodeId
        ? useCanvasStore.getState().nodes.find((node) => node.id === detail.nodeId)
        : [...useCanvasStore.getState().nodes].reverse().find((node) => node.data.type === detail.nodeType);
      const key = `${currentStep.id}:creation-${detail.sequence || detail.nodeId || detail.nodeType}`;
      if (autoAdvanceKeyRef.current === key) return;
      autoAdvanceKeyRef.current = key;
      setFocusNodeId(createdNode?.id || null);
      if (createdNode) {
        requestCanvasNodeFocus(
          [createdNode.id],
          currentStep.nodeType ? createdNode.id : undefined,
          currentStep.nodeType ? undefined : { selectNode: false },
        );
      }
      advance();
    };
    window.addEventListener(TUTORIAL_NODE_CREATED_EVENT, handleNodeCreated);
    return () => window.removeEventListener(TUTORIAL_NODE_CREATED_EVENT, handleNodeCreated);
  }, [advance, currentStep]);

  useEffect(() => {
    if (!currentStep || currentStep.action !== 'canvas-gesture' || !currentStep.interaction) return;
    const handleCanvasInteraction = (event: Event) => {
      const detail = (event as CustomEvent<TutorialCanvasInteractionDetail>).detail;
      if (detail?.interaction !== currentStep.interaction) return;
      const key = `${currentStep.id}:${detail.interaction}`;
      if (autoAdvanceKeyRef.current === key) return;
      autoAdvanceKeyRef.current = key;
      window.setTimeout(advance, 180);
    };
    window.addEventListener(TUTORIAL_CANVAS_INTERACTION_EVENT, handleCanvasInteraction);
    return () => window.removeEventListener(TUTORIAL_CANVAS_INTERACTION_EVENT, handleCanvasInteraction);
  }, [advance, currentStep]);

  useEffect(() => {
    if (!currentStep || !['click', 'input'].includes(currentStep.action)) return;
    const handleInteraction = (event: Event) => {
      const target = resolveTarget(currentStep.target, focusNodeId);
      if (!target || !(event.target instanceof Node) || !target.contains(event.target)) return;
      if (currentStep.action === 'input' && !hasInputValue(event.target)) return;
      const key = `${currentStep.id}:${event.type}`;
      if (autoAdvanceKeyRef.current === key) return;
      autoAdvanceKeyRef.current = key;
      window.setTimeout(advance, 180);
    };
    document.addEventListener('click', handleInteraction, true);
    document.addEventListener('input', handleInteraction, true);
    return () => {
      document.removeEventListener('click', handleInteraction, true);
      document.removeEventListener('input', handleInteraction, true);
    };
  }, [activeCourseId, advance, currentStep, focusNodeId]);

  useEffect(() => {
    if (!isOpen || !currentStep) {
      return;
    }
    let frame = 0;
    let previous = '';
    const updateRect = () => {
      const target = resolveTarget(currentStep.target, focusNodeId);
      if (!target) {
        if (previous) {
          previous = '';
          setTargetRect(null);
        }
      } else {
        const rect = target.getBoundingClientRect();
        const next = `${Math.round(rect.left)}:${Math.round(rect.top)}:${Math.round(rect.width)}:${Math.round(rect.height)}`;
        if (next !== previous) {
          previous = next;
          setTargetRect(rect);
        }
      }
      frame = window.requestAnimationFrame(updateRect);
    };
    frame = window.requestAnimationFrame(updateRect);
    return () => window.cancelAnimationFrame(frame);
  }, [currentStep, focusNodeId, isOpen]);

  if (!mounted || !isOpen) return null;

  const content = activeCourse && currentStep ? (
    <TutorialGuide
      course={activeCourse}
      step={currentStep}
      stepIndex={stepIndex}
      targetRect={targetRect}
      checks={generationChecks}
      hintLevel={coachHintLevel}
      wrongActionCount={wrongActionCount}
      onAdvance={advance}
      onBack={() => {
        if (!activeCourseId || stepIndex === 0) return;
        const previousIndex = stepIndex - 1;
        const previousStep = activeCourse.steps[previousIndex];
        if (activeCourseId === 'assistant' && previousStep.id === 'open' && isAgentOpen) {
          onCloseAgentWindow?.();
        }
        setStepIndex(previousIndex);
        setProgress((previous) => ({ ...previous, steps: { ...previous.steps, [activeCourseId]: previousIndex } }));
      }}
      onSkip={handleSkip}
      onExit={() => setActiveCourseId(null)}
      onLocate={handleLocateTarget}
      onRevealHint={revealCoachHint}
      onOpenApiConfig={handleOpenApiConfig}
      onOpenAgent={handleOpenAgent}
      canOpenAgent={Boolean(onOpenAgent)}
    />
  ) : (
    <TutorialCenter
      progress={progress}
      selectedNode={selectedNode}
      contextualCourse={contextualCourse}
      completedCourse={lastCompletion ? AVAILABLE_COURSES.find((course) => course.id === lastCompletion.courseId) || null : null}
      completionMastery={lastCompletion?.mastery}
      onStart={startCourse}
      onReset={resetProgress}
      onDismissCompletion={() => setLastCompletion(null)}
      onClose={handleClose}
    />
  );

  return createPortal(content, document.body);
}

function TutorialCenter({
  progress,
  selectedNode,
  contextualCourse,
  completedCourse,
  completionMastery,
  onStart,
  onReset,
  onDismissCompletion,
  onClose,
}: {
  progress: TutorialProgress;
  selectedNode: { id: string; data: CanvasNodeData } | null;
  contextualCourse: TutorialCourse | null;
  completedCourse: TutorialCourse | null;
  completionMastery?: number;
  onStart: (course: TutorialCourse, contextualNodeId?: string) => void;
  onReset: () => void;
  onDismissCompletion: () => void;
  onClose: () => void;
}) {
  const completedCount = progress.completed.length;
  const overallPercent = Math.round((completedCount / AVAILABLE_COURSES.length) * 100);
  const nextCourse = AVAILABLE_COURSES.find((course) => !progress.completed.includes(course.id)) || null;

  return (
    <div className="fixed inset-0 z-[10080] flex items-center justify-center bg-black/68 p-5 backdrop-blur-md">
      <section className="flex max-h-[min(760px,calc(100vh-40px))] w-full max-w-[920px] flex-col overflow-hidden rounded-lg border border-white/14 bg-[#0d1113]/94 shadow-[0_30px_100px_rgba(0,0,0,0.68),inset_0_1px_0_rgba(255,255,255,0.08)]">
        <header className="flex items-center justify-between border-b border-white/10 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md border border-amber-200/20 bg-amber-300/10 text-amber-100">
              <GraduationCap className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-zinc-100">教学模式</h2>
              <p className="mt-1 text-xs text-zinc-400">按实际操作推进，不改动画布内容</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={onReset} className="flex h-9 w-9 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white/8 hover:text-zinc-100" title="重置教学进度" aria-label="重置教学进度">
              <RotateCcw className="h-4 w-4" />
            </button>
            <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-white/8 hover:text-white" title="关闭教学模式" aria-label="关闭教学模式">
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="min-h-0 overflow-y-auto p-6">
          {completedCourse && (
            <div className="mb-4 flex items-center justify-between gap-4 rounded-md border border-emerald-300/16 bg-emerald-400/[0.07] px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-300/10 text-emerald-300">
                  <Check className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-emerald-100">已完成“{completedCourse.title}”</div>
                  <div className="mt-0.5 text-xs text-emerald-100/55">
                    掌握度 {completionMastery ?? 100}% · {nextCourse ? `建议下一步：${nextCourse.title}` : '全部核心课程已完成'}
                  </div>
                </div>
              </div>
              <button type="button" onClick={onDismissCompletion} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-emerald-100/45 transition-colors hover:bg-white/8 hover:text-emerald-100" title="关闭完成提示" aria-label="关闭完成提示">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {selectedNode && contextualCourse ? (
            <div className="mb-4 flex items-center justify-between gap-4 rounded-md border border-amber-200/16 bg-amber-300/[0.055] px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <Sparkles className="h-4 w-4 shrink-0 text-amber-200" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-zinc-100">当前节点：{String(selectedNode.data.label || contextualCourse.title)}</div>
                  <div className="mt-0.5 text-xs text-zinc-500">从当前节点继续，不会重复创建节点</div>
                </div>
              </div>
              <button type="button" onClick={() => onStart(contextualCourse, selectedNode.id)} className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-amber-200/18 bg-amber-300/10 px-3 text-xs font-medium text-amber-100 transition-colors hover:bg-amber-300/16">
                <Play className="h-3.5 w-3.5" />学习当前节点
              </button>
            </div>
          ) : (
            <div className="mb-4 rounded-md border border-white/8 bg-white/[0.025] px-4 py-3 text-xs text-zinc-500">
              先在画布上选择节点，再打开教学模式，可直接学习当前节点。
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {AVAILABLE_COURSES.map((course) => {
              const Icon = course.icon;
              const completed = progress.completed.includes(course.id);
              const savedStep = progress.steps[course.id] || 0;
              const mastery = progress.stats[course.id]?.mastery;
              const percent = completed ? 100 : Math.round((savedStep / Math.max(1, course.steps.length - 1)) * 100);
              return (
                <article key={course.id} className="rounded-md border border-white/10 bg-white/[0.035] p-4 transition-colors hover:border-white/18 hover:bg-white/[0.055]">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/10 bg-black/20 text-zinc-200">
                      <Icon className="h-[18px] w-[18px]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="text-sm font-semibold text-zinc-100">{course.title}</h3>
                        {completed && <span className="flex items-center gap-1 text-[11px] text-emerald-300"><Check className="h-3 w-3" />已完成{typeof mastery === 'number' ? ` · ${mastery}` : ''}</span>}
                      </div>
                      <p className="mt-1.5 min-h-9 text-xs leading-5 text-zinc-400">{course.description}</p>
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <span className="flex items-center gap-1.5 text-[11px] text-zinc-500"><Clock3 className="h-3 w-3" />{course.duration}</span>
                        <button type="button" onClick={() => onStart(course)} className="flex h-8 items-center gap-1.5 rounded-md border border-amber-200/18 bg-amber-300/10 px-3 text-xs font-medium text-amber-100 transition-colors hover:bg-amber-300/16">
                          <Play className="h-3.5 w-3.5" />
                          {completed ? '重新学习' : savedStep > 0 ? '继续' : '开始'}
                        </button>
                      </div>
                      {percent > 0 && !completed && (
                        <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/8">
                          <div className="h-full rounded-full bg-amber-200/70" style={{ width: `${percent}%` }} />
                        </div>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        <footer className="border-t border-white/10 px-6 py-3">
          <div className="flex items-center justify-between gap-4 text-[11px] text-zinc-500">
            <span>总学习进度 {completedCount}/{AVAILABLE_COURSES.length}</span>
            <span>{overallPercent}% · 进度保存在本机</span>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/8">
            <div className="h-full rounded-full bg-amber-200/70 transition-[width] duration-300" style={{ width: `${overallPercent}%` }} />
          </div>
        </footer>
      </section>
    </div>
  );
}

function TutorialGuide({
  course,
  step,
  stepIndex,
  targetRect,
  checks,
  hintLevel,
  wrongActionCount,
  onAdvance,
  onBack,
  onSkip,
  onExit,
  onLocate,
  onRevealHint,
  onOpenApiConfig,
  onOpenAgent,
  canOpenAgent,
}: {
  course: TutorialCourse;
  step: TutorialStep;
  stepIndex: number;
  targetRect: DOMRect | null;
  checks: TutorialCheck[];
  hintLevel: number;
  wrongActionCount: number;
  onAdvance: () => void;
  onBack: () => void;
  onSkip: () => void;
  onExit: () => void;
  onLocate: () => void;
  onRevealHint: () => void;
  onOpenApiConfig: () => void;
  onOpenAgent: () => void;
  canOpenAgent: boolean;
}) {
  const tutorialAudio = useTutorialAudio(`${course.id}.${step.id}`);
  const idleAudioLevelRef = useRef(0);
  const isLast = stepIndex === course.steps.length - 1;
  const allChecksPassed = checks.length > 0 && checks.every((check) => check.passed);
  const routeCheckFailed = checks.some((check) => check.id === 'route' && !check.passed);
  const coachHints = useMemo(() => buildCoachHints(step, checks), [checks, step]);
  const isFullscreenHighlight = step.target === 'canvas-fullscreen';
  const cardWidth = 360;
  const rightPosition = targetRect ? targetRect.right + 18 : 0;
  const leftPosition = targetRect ? targetRect.left - cardWidth - 18 : 0;
  const estimatedCardHeight = step.action === 'preflight' ? 680 : hintLevel > 0 ? 560 : 460;
  const cardLeft = isFullscreenHighlight
    ? Math.max(20, window.innerWidth - cardWidth - 32)
    : targetRect
    ? rightPosition + cardWidth <= window.innerWidth - 20
      ? rightPosition
      : Math.max(20, leftPosition)
    : Math.max(20, (window.innerWidth - cardWidth) / 2);
  const cardTop = isFullscreenHighlight
    ? Math.max(20, (window.innerHeight - estimatedCardHeight) / 2)
    : targetRect
    ? Math.min(Math.max(20, window.innerHeight - estimatedCardHeight - 20), Math.max(20, targetRect.top))
    : Math.max(20, (window.innerHeight - estimatedCardHeight) / 2);
  const progressPercent = Math.round(((stepIndex + 1) / course.steps.length) * 100);

  return (
    <div className="pointer-events-none fixed inset-0 z-[10080]">
      {targetRect ? (
        <div
          className="fixed rounded-md border border-amber-100/80 shadow-[0_0_0_9999px_rgba(2,5,8,0.72),0_0_32px_rgba(251,191,36,0.28)] transition-[left,top,width,height] duration-200 ease-out"
          style={isFullscreenHighlight
            ? { left: 0, top: 0, width: '100vw', height: '100vh' }
            : {
                left: Math.max(4, targetRect.left - 6),
                top: Math.max(4, targetRect.top - 6),
                width: targetRect.width + 12,
                height: targetRect.height + 12,
              }}
        />
      ) : (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-[2px]" />
      )}

      <section
        data-tutorial-surface="true"
        className="pointer-events-auto fixed max-h-[calc(100vh-40px)] w-[360px] overflow-y-auto rounded-lg border border-white/14 bg-[#101416]/96 shadow-[0_24px_80px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.08)]"
        style={{
          left: cardLeft,
          top: cardTop,
          maxHeight: Math.max(260, window.innerHeight - cardTop - 20),
        }}
      >
        <div className="h-1 bg-white/8">
          <div className="h-full bg-amber-200/80 transition-[width] duration-300" style={{ width: `${progressPercent}%` }} />
        </div>
        <div className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[11px] text-amber-100/70">{course.title} · {stepIndex + 1}/{course.steps.length}</div>
              <h3 className="mt-1.5 text-base font-semibold text-zinc-100">{step.title}</h3>
            </div>
            <button type="button" onClick={onExit} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white/8 hover:text-white" title="退出当前课程" aria-label="退出当前课程">
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-3 text-sm leading-6 text-zinc-300">{step.description}</p>
          {step.safetyNote && (
            <div className="mt-3 rounded-md border border-amber-200/14 bg-amber-300/[0.06] px-3 py-2 text-xs leading-5 text-amber-100/80">
              {step.safetyNote}
            </div>
          )}
          {step.action === 'preflight' && checks.length > 0 && (
            <div className="mt-3 space-y-1.5 rounded-md border border-white/9 bg-black/18 p-2.5">
              {checks.map((check) => (
                <div key={check.id} className="flex items-start gap-2 rounded-md px-1.5 py-1.5">
                  {check.passed ? (
                    <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                  ) : (
                    <Circle className="mt-0.5 h-4 w-4 shrink-0 text-amber-200/70" />
                  )}
                  <div className="min-w-0">
                    <div className={check.passed ? 'text-xs text-zinc-200' : 'text-xs text-amber-100'}>{check.label}</div>
                    <div className="mt-0.5 text-[11px] leading-4 text-zinc-500">{check.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {!targetRect && step.target && (
            <p className="mt-3 text-xs text-zinc-500">目标控件尚未显示，请先打开或选中对应节点。</p>
          )}
          {hintLevel > 0 && (
            <div className="mt-3 rounded-md border border-sky-200/12 bg-sky-300/[0.055] px-3 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-xs font-medium text-sky-100/85">
                  <Lightbulb className="h-3.5 w-3.5" />教练提示 {Math.min(hintLevel, coachHints.length)}/{coachHints.length}
                </span>
                {wrongActionCount > 0 && <span className="text-[10px] text-zinc-500">检测到 {wrongActionCount} 次偏离操作</span>}
              </div>
              <p className="mt-1.5 text-xs leading-5 text-sky-50/65">{coachHints[Math.min(hintLevel, coachHints.length) - 1]}</p>
            </div>
          )}
          <VoiceAssistantWaveStrip
            active
            audioLevelRef={
              tutorialAudio.isPlaying && !tutorialAudio.muted
                ? tutorialAudio.audioLevelRef
                : idleAudioLevelRef
            }
            intensity={1.3}
            motionSpeed={1.55}
            className="mt-3 h-9 items-center overflow-hidden [&_svg]:!h-9"
          />
          <div className="mt-4 flex flex-nowrap items-center gap-0.5 border-t border-white/8 pt-3">
            <button type="button" onClick={onLocate} className="flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 text-[11px] text-zinc-400 transition-colors hover:bg-white/8 hover:text-zinc-100" title="重新定位当前操作目标">
              <LocateFixed className="h-3.5 w-3.5" />重新定位
            </button>
            <button type="button" onClick={onRevealHint} disabled={hintLevel >= coachHints.length} className="flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 text-[11px] text-zinc-400 transition-colors hover:bg-white/8 hover:text-zinc-100 disabled:pointer-events-none disabled:opacity-30" title="显示下一条提示">
              <Lightbulb className="h-3.5 w-3.5" />提示
            </button>
            <button type="button" onClick={tutorialAudio.togglePlayback} className="flex h-8 w-7 shrink-0 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-white/8 hover:text-zinc-100" title={tutorialAudio.isPlaying ? '暂停教学语音' : '播放教学语音'} aria-label={tutorialAudio.isPlaying ? '暂停教学语音' : '播放教学语音'}>
              {tutorialAudio.isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </button>
            <button type="button" onClick={tutorialAudio.replay} className="flex h-8 w-7 shrink-0 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-white/8 hover:text-zinc-100" title="重新播放教学语音" aria-label="重新播放教学语音">
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={tutorialAudio.toggleMuted} className="flex h-8 w-7 shrink-0 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-white/8 hover:text-zinc-100" title={tutorialAudio.muted ? '开启教学语音' : '静音教学语音'} aria-label={tutorialAudio.muted ? '开启教学语音' : '静音教学语音'}>
              {tutorialAudio.muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            </button>
            {canOpenAgent && (
              <button type="button" onClick={onOpenAgent} className="ml-auto flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-white/9 bg-white/[0.04] px-1.5 text-[11px] text-zinc-300 transition-colors hover:bg-white/9 hover:text-white" title="让 AI 助手结合当前画布解释本步骤">
                <Bot className="h-3.5 w-3.5" />询问 AI
              </button>
            )}
          </div>
          <div className="mt-5 flex items-center justify-between gap-3">
            <button type="button" onClick={onBack} disabled={stepIndex === 0} className="flex h-9 items-center gap-1 rounded-md px-2 text-xs text-zinc-400 transition-colors hover:bg-white/8 hover:text-zinc-100 disabled:pointer-events-none disabled:opacity-25">
              <ChevronLeft className="h-4 w-4" />上一步
            </button>
            <div className="flex items-center gap-2">
              {step.action !== 'manual' && step.action !== 'preflight' && (
                <button type="button" onClick={onSkip} className="h-9 rounded-md px-3 text-xs text-zinc-500 transition-colors hover:bg-white/8 hover:text-zinc-200">跳过</button>
              )}
              {step.action === 'preflight' && !allChecksPassed && (
                <button type="button" onClick={onSkip} className="h-9 rounded-md px-3 text-xs text-zinc-500 transition-colors hover:bg-white/8 hover:text-zinc-200">稍后处理</button>
              )}
              {step.action === 'manual' ? (
                <button type="button" onClick={onAdvance} className="flex h-9 items-center gap-1.5 rounded-md border border-amber-200/18 bg-amber-300/12 px-4 text-xs font-medium text-amber-100 transition-colors hover:bg-amber-300/18">
                  {isLast ? <Check className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  {isLast ? '完成课程' : '下一步'}
                </button>
              ) : step.action === 'preflight' ? (
                allChecksPassed ? (
                  <button type="button" onClick={onAdvance} className="flex h-9 items-center gap-1.5 rounded-md border border-emerald-200/18 bg-emerald-300/10 px-4 text-xs font-medium text-emerald-100 transition-colors hover:bg-emerald-300/16">
                    <Check className="h-3.5 w-3.5" />检查通过
                  </button>
                ) : routeCheckFailed ? (
                  <button type="button" onClick={onOpenApiConfig} className="flex h-9 items-center gap-1.5 rounded-md border border-amber-200/18 bg-amber-300/10 px-3 text-xs font-medium text-amber-100 transition-colors hover:bg-amber-300/16">
                    <Settings2 className="h-3.5 w-3.5" />模型列表设置
                  </button>
                ) : (
                  <span className="text-xs text-amber-100/65">请完成缺失项</span>
                )
              ) : (
                <span className="text-xs text-zinc-500">等待你的操作...</span>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
