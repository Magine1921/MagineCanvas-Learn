/** 剪辑台时间线 — 画布持久化与导出共用类型 */

export type EditClipSourceKind = 'material' | 'video' | 'topazEnhance' | 'image' | 'storyboard';

export type EditMediaKind = 'video' | 'image' | 'audio';

/** 主视频轨：视频 + 图片；音频轨：仅音频（参考剪映上下分轨） */
export const EDIT_TRACK_VIDEO = 0;
export const EDIT_TRACK_AUDIO = 1;

export type EditClip = {
  id: string;
  sourceNodeId: string;
  sourceKind: EditClipSourceKind;
  mediaKind: EditMediaKind;
  url: string;
  fileName?: string;
  thumbnailUrl?: string;
  durationMs?: number;
  inMs: number;
  outMs: number;
  timelineStartMs: number;
  trackIndex: number;
  /** Export-only media library folder ownership. */
  mediaFolderId?: string;
  /** 若附着于主轨某片段，主轨涟漪时同步平移（预留） */
  parentClipId?: string;
};

export type EditSequenceSettings = {
  width: number;
  height: number;
  fps: number;
};

export type EditStationSequence = EditSequenceSettings;

export const DEFAULT_EDIT_SEQUENCE: EditSequenceSettings = {
  width: 1920,
  height: 1080,
  fps: 30,
};

export const DEFAULT_IMAGE_CLIP_MS = 3000;
export const DEFAULT_VIDEO_CLIP_MS = 5000;

/** 三视窗布局：react-resizable-panels 百分比 + 素材区内三分比 */
export type EditPanelLayout = {
  /** 垂直：上区 vs 时间线（各占百分比，和不必为 100 — 库会归一化） */
  panelSizesVertical: [number, number];
  /** 水平：素材库 vs 播放（仅上区） */
  panelSizesHorizontal: [number, number];
  /** 兼容旧版：若仅有 topFraction/materialFraction 则由 coerce 填充 panelSizes* */
  topFraction?: number;
  materialFraction?: number;
  materialSplits: [number, number, number];
};

export const DEFAULT_EDIT_PANEL_LAYOUT: EditPanelLayout = {
  panelSizesVertical: [52, 48],
  panelSizesHorizontal: [48, 52],
  materialSplits: [0.34, 0.33, 0.33],
};

/** 剪辑偏好 */
export type EditTimelinePrefs = {
  snapEnabled: boolean;
  /** 主故事线启用磁性涟漪（插入/删除/裁剪联动下游） */
  magneticPrimary: boolean;
};

export const DEFAULT_EDIT_TIMELINE_PREFS: EditTimelinePrefs = {
  snapEnabled: true,
  magneticPrimary: true,
};

export type EditExportFormat = 'jianying' | 'premiere' | 'aftereffects';

export type InboundEditClipCandidate = {
  sourceNodeId: string;
  sourceKind: EditClipSourceKind;
  mediaKind: EditMediaKind;
  url: string;
  fileName?: string;
  thumbnailUrl?: string;
  /** 探测到的媒体时长（可选） */
  durationMs?: number;
};

export const EDIT_POOL_DRAG_MIME = 'application/x-magine-edit-pool';
