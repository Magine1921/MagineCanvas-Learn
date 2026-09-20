/**
 * 剪辑台时间线引擎 — 剪映式操作语义
 * - 片段保持 timelineStartMs，不做隐式线性重排
 * - 视频/图片 → 主轨；音频 → 音频轨
 * - 磁吸：播放头、0、同轨片段入出点
 */
import {
  DEFAULT_IMAGE_CLIP_MS,
  DEFAULT_VIDEO_CLIP_MS,
  EDIT_TRACK_AUDIO,
  EDIT_TRACK_VIDEO,
  type EditClip,
  type InboundEditClipCandidate,
} from '@/lib/edit-timeline-types';
import { clipEffectiveDurationMs } from '@/lib/edit-timeline-utils';

export function newClipId(): string {
  return `clip_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const SNAP_THRESHOLD_MS = 100;

export function defaultTrackForMediaKind(kind: EditClip['mediaKind']): number {
  return kind === 'audio' ? EDIT_TRACK_AUDIO : EDIT_TRACK_VIDEO;
}

export function clipsOnTrack(clips: EditClip[], trackIndex: number): EditClip[] {
  return clips.filter((c) => c.trackIndex === trackIndex);
}

export function trackEndMs(clips: EditClip[], trackIndex: number): number {
  let end = 0;
  for (const c of clipsOnTrack(clips, trackIndex)) {
    end = Math.max(end, c.timelineStartMs + clipEffectiveDurationMs(c));
  }
  return end;
}

export function clipEndMs(clip: EditClip): number {
  return clip.timelineStartMs + clipEffectiveDurationMs(clip);
}

/** 收集磁吸候选点 */
export function collectSnapPoints(
  clips: EditClip[],
  trackIndex: number,
  opts: { playheadMs?: number; excludeClipId?: string }
): number[] {
  const points = new Set<number>([0]);
  if (typeof opts.playheadMs === 'number') points.add(Math.max(0, opts.playheadMs));
  for (const c of clipsOnTrack(clips, trackIndex)) {
    if (c.id === opts.excludeClipId) continue;
    points.add(c.timelineStartMs);
    points.add(clipEndMs(c));
  }
  return [...points];
}

export function snapTimeMs(
  rawMs: number,
  clips: EditClip[],
  trackIndex: number,
  opts: { enabled: boolean; playheadMs?: number; excludeClipId?: string }
): number {
  if (!opts.enabled) return Math.max(0, rawMs);
  const points = collectSnapPoints(clips, trackIndex, {
    playheadMs: opts.playheadMs,
    excludeClipId: opts.excludeClipId,
  });
  let best = Math.max(0, rawMs);
  let bestDist = SNAP_THRESHOLD_MS + 1;
  for (const p of points) {
    const d = Math.abs(p - rawMs);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return bestDist <= SNAP_THRESHOLD_MS ? best : Math.max(0, rawMs);
}

export function inboundToEditClip(
  c: InboundEditClipCandidate,
  timelineStartMs: number,
  trackIndex?: number
): EditClip {
  const track = trackIndex ?? defaultTrackForMediaKind(c.mediaKind);
  const probed =
    typeof c.durationMs === 'number' && c.durationMs > 0 ? c.durationMs : undefined;
  const durationMs =
    probed ??
    (c.mediaKind === 'image'
      ? DEFAULT_IMAGE_CLIP_MS
      : c.mediaKind === 'audio'
        ? DEFAULT_VIDEO_CLIP_MS
        : DEFAULT_VIDEO_CLIP_MS);
  return {
    id: newClipId(),
    sourceNodeId: c.sourceNodeId,
    sourceKind: c.sourceKind,
    mediaKind: c.mediaKind,
    url: c.url,
    fileName: c.fileName,
    thumbnailUrl: c.thumbnailUrl,
    durationMs,
    inMs: 0,
    outMs: durationMs,
    timelineStartMs: Math.max(0, timelineStartMs),
    trackIndex: track,
  };
}

/** 从素材库插入片段（不触发线性重排） */
export function insertPoolItemAt(
  pool: InboundEditClipCandidate,
  clips: EditClip[],
  atMs: number,
  opts: {
    trackIndex?: number;
    snapEnabled: boolean;
    playheadMs?: number;
  }
): { clips: EditClip[]; added: EditClip } {
  const track = opts.trackIndex ?? defaultTrackForMediaKind(pool.mediaKind);
  const startMs = snapTimeMs(atMs, clips, track, {
    enabled: opts.snapEnabled,
    playheadMs: opts.playheadMs,
  });
  const added = inboundToEditClip(pool, startMs, track);
  return { clips: [...clips, added], added };
}

/** 插入到播放头（剪映：拖入时间线默认对齐播放头） */
export function insertPoolItemAtPlayhead(
  pool: InboundEditClipCandidate,
  clips: EditClip[],
  playheadMs: number,
  snapEnabled: boolean
): { clips: EditClip[]; added: EditClip } {
  const track = defaultTrackForMediaKind(pool.mediaKind);
  const at = snapEnabled ? playheadMs : Math.max(0, playheadMs);
  return insertPoolItemAt(pool, clips, at, { trackIndex: track, snapEnabled, playheadMs });
}

/** 插入到轨道末尾（无空隙时接在最后一个片段后） */
export function insertPoolItemAfterLast(
  pool: InboundEditClipCandidate,
  clips: EditClip[],
  snapEnabled: boolean
): { clips: EditClip[]; added: EditClip } {
  const track = defaultTrackForMediaKind(pool.mediaKind);
  const at = trackEndMs(clips, track);
  return insertPoolItemAt(pool, clips, at, { trackIndex: track, snapEnabled, playheadMs: at });
}

export function moveClip(
  clips: EditClip[],
  clipId: string,
  newStartMs: number,
  opts: { snapEnabled: boolean; playheadMs?: number }
): EditClip[] {
  const clip = clips.find((c) => c.id === clipId);
  if (!clip) return clips;
  const start = snapTimeMs(newStartMs, clips, clip.trackIndex, {
    enabled: opts.snapEnabled,
    playheadMs: opts.playheadMs,
    excludeClipId: clipId,
  });
  return clips.map((c) => (c.id === clipId ? { ...c, timelineStartMs: Math.max(0, start) } : c));
}

/** 左缘裁剪：同时移动入点与片段起点（剪映拖左缘） */
export function trimClipStart(
  clips: EditClip[],
  clipId: string,
  newTimelineStartMs: number
): EditClip[] {
  const clip = clips.find((c) => c.id === clipId);
  if (!clip) return clips;
  const delta = newTimelineStartMs - clip.timelineStartMs;
  if (delta === 0) return clips;
  const newIn = clip.inMs + delta;
  const maxIn = (clip.outMs || clipEffectiveDurationMs(clip)) - 100;
  if (newIn >= maxIn) return clips;
  return clips.map((c) =>
    c.id === clipId
      ? {
          ...c,
          timelineStartMs: Math.max(0, newTimelineStartMs),
          inMs: Math.max(0, newIn),
        }
      : c
  );
}

/** 右缘裁剪：调整出点 */
export function trimClipEnd(clips: EditClip[], clipId: string, newEndMs: number): EditClip[] {
  const clip = clips.find((c) => c.id === clipId);
  if (!clip) return clips;
  const newOut = clip.inMs + (newEndMs - clip.timelineStartMs);
  const minOut = clip.inMs + 100;
  if (newOut <= minOut) return clips;
  return clips.map((c) => (c.id === clipId ? { ...c, outMs: newOut } : c));
}

/** 在播放头位置分割选中片段（剪映 Ctrl+B） */
export function splitClipAt(
  clips: EditClip[],
  clipId: string,
  splitMs: number
): EditClip[] | null {
  const clip = clips.find((c) => c.id === clipId);
  if (!clip) return null;
  const start = clip.timelineStartMs;
  const end = clipEndMs(clip);
  if (splitMs <= start + 50 || splitMs >= end - 50) return null;
  const offset = splitMs - start;
  const left: EditClip = { ...clip, outMs: clip.inMs + offset };
  const right: EditClip = {
    ...clip,
    id: newClipId(),
    inMs: clip.inMs + offset,
    timelineStartMs: splitMs,
  };
  return clips.filter((c) => c.id !== clipId).concat([left, right]);
}

export function deleteClip(clips: EditClip[], clipId: string): EditClip[] {
  return clips.filter((c) => c.id !== clipId);
}

/** 可选：消除空隙 — 按轨线性拼接（显式操作，非默认） */
export function packTrackLinear(clips: EditClip[], trackIndex: number): EditClip[] {
  const onTrack = clipsOnTrack(clips, trackIndex).sort((a, b) => a.timelineStartMs - b.timelineStartMs);
  let cursor = 0;
  const packed = onTrack.map((c) => {
    const next = { ...c, timelineStartMs: cursor };
    cursor += clipEffectiveDurationMs(next);
    return next;
  });
  const other = clips.filter((c) => c.trackIndex !== trackIndex);
  return [...other, ...packed];
}
