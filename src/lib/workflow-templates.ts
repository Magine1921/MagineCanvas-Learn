/**
 * MagineCanvas 预设工作流模板库
 * 为 AI 助手提供快速搭建常用工作流的模板
 */

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: 'image' | 'video' | 'storyboard' | 'enhance' | 'composite';
  nodes: WorkflowNodeTemplate[];
  edges: WorkflowEdgeTemplate[];
}

export interface WorkflowNodeTemplate {
  id: string;
  type: 'prompt' | 'llm' | 'image' | 'video' | 'agent' | 'material' | 'storyboard' | 'panorama' | 'topazEnhance' | 'faceCompliance' | 'music' | 'browser' | 'region';
  x: number;
  y: number;
  label?: string;
  data?: Record<string, unknown>;
}

export interface WorkflowEdgeTemplate {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

/** 常用工作流模板 */
export const WORKFLOW_TEMPLATES: Record<string, WorkflowTemplate> = {
  /** 电商主图替换：参考主图、商品素材与文字要求共同生成新主图 */
  'ecommerce-main-image-replacement': {
    id: 'ecommerce-main-image-replacement',
    name: '电商主图替换',
    description: '文本要求 + 主图参考 + 商品素材 → 图像生成，保留参考图设计并替换商品主体',
    category: 'image',
    nodes: [
      {
        id: 'prompt-1',
        type: 'prompt',
        x: 100,
        y: 80,
        label: '文本',
        data: {
          text: '提取输入的图片的构图、光影、色彩、风格、比例、视觉设计、文案设计，生成商品图片提示词\n将主体替换为我的商品：茶杯',
        },
      },
      {
        id: 'material-reference',
        type: 'material',
        x: 100,
        y: 330,
        label: '素材',
      },
      {
        id: 'material-product',
        type: 'material',
        x: 100,
        y: 580,
        label: '素材',
      },
      {
        id: 'image-1',
        type: 'image',
        x: 550,
        y: 270,
        label: '图像生成',
        data: {
          aspectRatio: '16:9',
          imageResolution: '2K',
        },
      },
    ],
    edges: [
      { id: 'e-prompt-image', source: 'prompt-1', target: 'image-1' },
      { id: 'e-reference-image', source: 'material-reference', target: 'image-1' },
      { id: 'e-product-image', source: 'material-product', target: 'image-1' },
    ],
  },

  /** 基础图像生成工作流 */
  'image-basic': {
    id: 'image-basic',
    name: '基础图像生成',
    description: 'prompt → image 基础工作流，快速生成单张图像',
    category: 'image',
    nodes: [
      {
        id: 'prompt-1',
        type: 'prompt',
        x: 100,
        y: 200,
        label: '提示词',
        data: {
          text: '请在此输入您的图像生成提示词',
        },
      },
      {
        id: 'image-1',
        type: 'image',
        x: 550,
        y: 200,
        label: '图像生成',
      },
    ],
    edges: [
      { id: 'e-1', source: 'prompt-1', target: 'image-1' },
    ],
  },

  /** 图像生成 + 画质增强工作流 */
  'image-enhance': {
    id: 'image-enhance',
    name: '图像生成 + 画质增强',
    description: 'prompt → image → topazEnhance，生成后自动增强画质',
    category: 'image',
    nodes: [
      {
        id: 'prompt-1',
        type: 'prompt',
        x: 100,
        y: 200,
        label: '提示词',
        data: {
          text: '请在此输入您的图像生成提示词',
        },
      },
      {
        id: 'image-1',
        type: 'image',
        x: 550,
        y: 200,
        label: '图像生成',
      },
      {
        id: 'enhance-1',
        type: 'topazEnhance',
        x: 1000,
        y: 200,
        label: '画质增强',
      },
    ],
    edges: [
      { id: 'e-1', source: 'prompt-1', target: 'image-1' },
      { id: 'e-2', source: 'image-1', target: 'enhance-1' },
    ],
  },

  /** 分镜 → 图像工作流 */
  'storyboard-image': {
    id: 'storyboard-image',
    name: '手绘分镜 → 图像生成',
    description: 'storyboard → prompt → image，手绘分镜后生成图像',
    category: 'storyboard',
    nodes: [
      {
        id: 'storyboard-1',
        type: 'storyboard',
        x: 100,
        y: 200,
        label: '分镜绘制',
      },
      {
        id: 'prompt-1',
        type: 'prompt',
        x: 550,
        y: 200,
        label: '图像提示词',
        data: {
          text: '基于上方分镜内容，生成一张高质量图像',
        },
      },
      {
        id: 'image-1',
        type: 'image',
        x: 1000,
        y: 200,
        label: '图像生成',
      },
    ],
    edges: [
      { id: 'e-1', source: 'storyboard-1', target: 'prompt-1' },
      { id: 'e-2', source: 'prompt-1', target: 'image-1' },
    ],
  },

  /** 基础视频生成工作流 */
  'video-basic': {
    id: 'video-basic',
    name: '基础视频生成',
    description: 'prompt → video 基础工作流，快速生成视频',
    category: 'video',
    nodes: [
      {
        id: 'prompt-1',
        type: 'prompt',
        x: 100,
        y: 200,
        label: '视频提示词',
        data: {
          text: '请在此输入您的视频生成提示词',
        },
      },
      {
        id: 'video-1',
        type: 'video',
        x: 550,
        y: 200,
        label: '视频生成',
      },
    ],
    edges: [
      { id: 'e-1', source: 'prompt-1', target: 'video-1' },
    ],
  },

  /** 图像 → 视频工作流 */
  'image-to-video': {
    id: 'image-to-video',
    name: '图像 → 视频',
    description: 'material/image → video，从图像生成视频',
    category: 'video',
    nodes: [
      {
        id: 'material-1',
        type: 'material',
        x: 100,
        y: 200,
        label: '图像素材',
      },
      {
        id: 'prompt-1',
        type: 'prompt',
        x: 550,
        y: 200,
        label: '视频提示词',
        data: {
          text: '基于上方图像，生成一段流畅的视频动画',
        },
      },
      {
        id: 'video-1',
        type: 'video',
        x: 1000,
        y: 200,
        label: '视频生成',
      },
    ],
    edges: [
      { id: 'e-1', source: 'material-1', target: 'prompt-1' },
      { id: 'e-2', source: 'prompt-1', target: 'video-1' },
    ],
  },

  /** 全景生成工作流 */
  'panorama-basic': {
    id: 'panorama-basic',
    name: '全景图生成',
    description: 'prompt → panorama，生成 720° 全景图',
    category: 'composite',
    nodes: [
      {
        id: 'prompt-1',
        type: 'prompt',
        x: 100,
        y: 200,
        label: '全景提示词',
        data: {
          text: '生成一张 720° VR 全景图，等距柱状投影，2:1 宽高比',
        },
      },
      {
        id: 'image-1',
        type: 'image',
        x: 550,
        y: 200,
        label: '图像生成',
      },
      {
        id: 'panorama-1',
        type: 'panorama',
        x: 1000,
        y: 200,
        label: '全景查看',
      },
    ],
    edges: [
      { id: 'e-1', source: 'prompt-1', target: 'image-1' },
      { id: 'e-2', source: 'image-1', target: 'panorama-1' },
    ],
  },

  /** 多图像对比工作流 */
  'multi-image': {
    id: 'multi-image',
    name: '多图像对比',
    description: '多个 prompt 并行生成图像，方便对比不同提示词效果',
    category: 'image',
    nodes: [
      {
        id: 'prompt-1',
        type: 'prompt',
        x: 100,
        y: 150,
        label: '方案A',
        data: { text: '版本A的提示词' },
      },
      {
        id: 'prompt-2',
        type: 'prompt',
        x: 100,
        y: 350,
        label: '方案B',
        data: { text: '版本B的提示词' },
      },
      {
        id: 'image-1',
        type: 'image',
        x: 550,
        y: 150,
        label: '图像A',
      },
      {
        id: 'image-2',
        type: 'image',
        x: 550,
        y: 350,
        label: '图像B',
      },
    ],
    edges: [
      { id: 'e-1', source: 'prompt-1', target: 'image-1' },
      { id: 'e-2', source: 'prompt-2', target: 'image-2' },
    ],
  },
};

/** 获取分类列表 */
export function getTemplateCategories(): string[] {
  return ['image', 'video', 'storyboard', 'enhance', 'composite'];
}

/** 获取某个分类的所有模板 */
export function getTemplatesByCategory(category: string): WorkflowTemplate[] {
  return Object.values(WORKFLOW_TEMPLATES).filter(t => t.category === category);
}

/** 按 ID 获取模板 */
export function getTemplateById(id: string): WorkflowTemplate | null {
  return WORKFLOW_TEMPLATES[id] || null;
}

/** 列出所有可用模板的摘要 */
export function listTemplates(): Array<{ id: string; name: string; description: string; category: string }> {
  return Object.values(WORKFLOW_TEMPLATES).map(t => ({
    id: t.id,
    name: t.name,
    description: t.description,
    category: t.category,
  }));
}
