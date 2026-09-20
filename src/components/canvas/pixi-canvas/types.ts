import type { Node, Edge } from 'reactflow';
import type { CanvasNodeData } from '../CanvasStore';

/** 画布视口状态 */
export interface ViewportState {
  x: number;
  y: number;
  zoom: number;
  width: number;
  height: number;
}

/** 可见区域（世界坐标），含 off-screen padding */
export interface VisibleBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** 节点渲染数据（从 store 映射而来） */
export interface RenderNode {
  id: string;
  type: CanvasNodeData['type'];
  x: number;
  y: number;
  width: number;
  height: number;
  selected: boolean;
  color: number;
  label: string;
  parentId?: string;
  zIndex?: number;
}

/** 边渲染数据 */
export interface RenderEdge {
  id: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  selected: boolean;
  dissolving: boolean;
  fading: boolean;
}

/** 边端点坐标缓存 key */
export type EdgeEndpointKey = string;

/** 边渲染签名缓存 */
export interface EdgeRenderCache {
  signature: string;
  endpoints: Map<EdgeEndpointKey, { x: number; y: number }>;
  pathData: string;
}

/** 渲染帧请求类型 */
export type RenderFrameRequest =
  | { type: 'full' }
  | { type: 'culling-only' }
  | { type: 'edges-only' }
  | { type: 'nodes-only'; nodeIds: string[] };

/** PixiJS 画布配置 */
export interface PixiCanvasConfig {
  /** 视口外扩展的渲染 padding（像素） */
  viewportPadding: number;
  /** 背景色 */
  backgroundColor: number;
  /** 网格颜色 */
  gridColor: number;
  /** 网格间距 */
  gridSize: number;
  /** 最小缩放 */
  minZoom: number;
  /** 最大缩放 */
  maxZoom: number;
  /** 缩放灵敏度 */
  zoomSensitivity: number;
  /** 是否启用抗锯齿 */
  antialias: boolean;
}

export const DEFAULT_PIXI_CANVAS_CONFIG: PixiCanvasConfig = {
  viewportPadding: 256,
  backgroundColor: 0x0d0d15,
  gridColor: 0xffffff,
  gridSize: 100,
  minZoom: 0.1,
  maxZoom: 2,
  zoomSensitivity: 0.001,
  antialias: true,
};

/** 节点类型 → 颜色映射 */
export const NODE_TYPE_COLORS: Record<string, number> = {
  prompt: 0x6366f1,
  image: 0xf97316,
  video: 0xef4444,
  agent: 0x8b5cf6,
  material: 0x10b981,
  region: 0xd4d4d8,
  storyboard: 0xf59e0b,
  panorama: 0x22c55e,
  topazEnhance: 0xa78bfa,
  faceCompliance: 0xec4899,
  music: 0x3b82f6,
  browser: 0x22d3ee,
};
