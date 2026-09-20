/**
 * 主故事线磁性时间轴（Ripple）：无重叠、无空隙；插入/删除时下游整体平移。
 * 仅作用于 EDIT_TRACK_VIDEO（视频+图片）；音频轨独立。
 */
import { EDIT_TRACK_VIDEO, type EditClip, type InboundEditClipCandidate } from '@/lib/edit-timeline-types';
import { clipEffectiveDurationMs } from '@/lib/edit-timeline-utils';
import {
  clipEndMs,
  inboundToEditClip,
  newClipId,
  snapTimeMs,
} from '@/lib/edit-timeline-engine';

export function isPrimaryStoryClip(c: EditClip): boolean {
  return c.trackIndex === EDIT_TRACK_VIDEO && c.mediaKind !== 'audio';
}

export function primaryClipsSorted(clips: EditClip[]): EditClip[] {
  return clips.filter(isPrimaryStoryClip).sort((a, b) => a.timelineStartMs - b.timelineStartMs);
}

/** 主轨片段按起点紧密排列（消除空隙），保持相对顺序 */
export function packPrimaryStoryline(clips: EditClip[]): EditClip[] {
  const sorted = primaryClipsSorted(clips);
  let t = 0;
  const packed = sorted.map((c) => {
    const next = { ...c, timelineStartMs: t };
    t += clipEffectiveDurationMs(next);
    return next;
  });
  const map = new Map(packed.map((c) => [c.id, c]));
  return clips.map((c) => (isPrimaryStoryClip(c) ? map.get(c.id) ?? c : c));
}

function shiftPrimaryFrom(clips: EditClip[], fromMs: number, deltaMs: number, excludeId?: string): EditClip[] {
  return clips.map((c) => {
    if (!isPrimaryStoryClip(c) || c.id === excludeId) return c;
    if (c.timelineStartMs >= fromMs) {
      return { ...c, timelineStartMs: Math.max(0, c.timelineStartMs + deltaMs) };
    }
    return c;
  });
}

/** 在绝对时间 T 涟漪插入新主轨片段（T 之后的主轨整体右移 D） */
export function magneticRippleInsertPrimary(
  clips: EditClip[],
  newClip: EditClip,
  opts?: { snapEnabled?: boolean; playheadMs?: number }
): EditClip[] {
  const c = { ...newClip, trackIndex: EDIT_TRACK_VIDEO };
  const D = clipEffectiveDurationMs(c);
  let T = Math.max(0, c.timelineStartMs);
  if (opts?.snapEnabled) {
    T = snapTimeMs(T, clips, EDIT_TRACK_VIDEO, {
      enabled: true,
      playheadMs: opts.playheadMs,
      excludeClipId: c.id,
    });
  }
  const shifted = shiftPrimaryFrom(clips, T, D, c.id);
  const placed: EditClip = { ...c, timelineStartMs: T };
  return [...shifted.filter((x) => x.id !== placed.id), placed];
}

export function magneticInsertPoolAtPrimary(
  clips: EditClip[],
  pool: InboundEditClipCandidate,
  atMs: number,
  opts: { snapEnabled: boolean; playheadMs?: number }
): { clips: EditClip[]; added: EditClip } {
  const base = inboundToEditClip(pool, atMs, EDIT_TRACK_VIDEO);
  const next = magneticRippleInsertPrimary(clips, base, opts);
  const added = next.find((x) => x.id === base.id) ?? base;
  return { clips: next, added };
}

/** 涟漪删除：移除片段后，其结束时间之后的主轨片段左移 D */
export function magneticRippleDeletePrimary(clips: EditClip[], clipId: string): EditClip[] {
  const victim = clips.find((c) => c.id === clipId);
  if (!victim || !isPrimaryStoryClip(victim)) {
    return clips.filter((c) => c.id !== clipId);
  }
  const D = clipEffectiveDurationMs(victim);
  const splitAt = clipEndMs(victim);
  const rest = clips.filter((c) => c.id !== clipId);
  return shiftPrimaryFrom(rest, splitAt, -D);
}

/**
 * 拖拽重排主轨片段：先闭合原洞再在新位置打开涟漪。
 */
export function magneticRelocatePrimary(
  clips: EditClip[],
  clipId: string,
  desiredStartMs: number,
  opts: { snapEnabled: boolean; playheadMs?: number }
): EditClip[] {
  const moving = clips.find((c) => c.id === clipId);
  if (!moving || !isPrimaryStoryClip(moving)) {
    return moveClipFree(clips, clipId, desiredStartMs, opts);
  }
  const D = clipEffectiveDurationMs(moving);
  const oldEnd = clipEndMs(moving);
  const without = clips.filter((c) => c.id !== clipId);
  const closed = shiftPrimaryFrom(without, oldEnd, -D);
  let T = Math.max(0, desiredStartMs);
  if (opts.snapEnabled) {
    T = snapTimeMs(T, closed, EDIT_TRACK_VIDEO, {
      enabled: true,
      playheadMs: opts.playheadMs,
    });
  }
  const opened = shiftPrimaryFrom(closed, T, D);
  const placed: EditClip = { ...moving, timelineStartMs: T };
  return [...opened.filter((c) => c.id !== clipId), placed];
}

function moveClipFree(
  clips: EditClip[],
  clipId: string,
  desiredStartMs: number,
  opts: { snapEnabled: boolean; playheadMs?: number }
): EditClip[] {
  const clip = clips.find((c) => c.id === clipId);
  if (!clip) return clips;
  const T = snapTimeMs(desiredStartMs, clips, clip.trackIndex, {
    enabled: opts.snapEnabled,
    playheadMs: opts.playheadMs,
    excludeClipId: clipId,
  });
  return clips.map((c) => (c.id === clipId ? { ...c, timelineStartMs: Math.max(0, T) } : c));
}

/** 主轨右缘裁剪变短：右侧主轨片段左移 (oldEnd - newEnd) */
export function magneticTrimEndPrimary(clips: EditClip[], clipId: string, newEndMs: number): EditClip[] {
  const clip = clips.find((c) => c.id === clipId);
  if (!clip || !isPrimaryStoryClip(clip)) {
    return trimClipEndGeneric(clips, clipId, newEndMs);
  }
  const oldEnd = clipEndMs(clip);
  const newOut = clip.inMs + (newEndMs - clip.timelineStartMs);
  const minOut = clip.inMs + 100;
  if (newOut <= minOut) return clips;
  const patched = clips.map((c) => (c.id === clipId ? { ...c, outMs: newOut } : c));
  const updated = patched.find((c) => c.id === clipId)!;
  const newClipEnd = clipEndMs(updated);
  const delta = oldEnd - newClipEnd;
  if (delta <= 0) return patched;
  return shiftPrimaryFrom(patched, oldEnd, -delta);
}

/** 主轨左缘裁剪：左侧变长等价于 start 右移 + in 增加，下游从原 end 左移 */
export function magneticTrimStartPrimary(clips: EditClip[], clipId: string, newTimelineStartMs: number): EditClip[] {
  const clip = clips.find((c) => c.id === clipId);
  if (!clip || !isPrimaryStoryClip(clip)) {
    return trimStartGeneric(clips, clipId, newTimelineStartMs);
  }
  const delta = newTimelineStartMs - clip.timelineStartMs;
  if (delta === 0) return clips;
  const newIn = clip.inMs + delta;
  const maxIn = (clip.outMs || clipEffectiveDurationMs(clip)) - 100;
  if (newIn >= maxIn) return clips;
  const oldEnd = clipEndMs(clip);
  const shortenedBy = delta;
  const patched = clips.map((c) =>
    c.id === clipId
      ? { ...c, timelineStartMs: Math.max(0, newTimelineStartMs), inMs: Math.max(0, newIn) }
      : c
  );
  return shiftPrimaryFrom(patched, oldEnd, -shortenedBy);
}

function trimClipEndGeneric(clips: EditClip[], clipId: string, newEndMs: number): EditClip[] {
  const clip = clips.find((c) => c.id === clipId);
  if (!clip) return clips;
  const newOut = clip.inMs + (newEndMs - clip.timelineStartMs);
  const minOut = clip.inMs + 100;
  if (newOut <= minOut) return clips;
  return clips.map((c) => (c.id === clipId ? { ...c, outMs: newOut } : c));
}

function trimStartGeneric(clips: EditClip[], clipId: string, newTimelineStartMs: number): EditClip[] {
  const clip = clips.find((c) => c.id === clipId);
  if (!clip) return clips;
  const delta = newTimelineStartMs - clip.timelineStartMs;
  if (delta === 0) return clips;
  const newIn = clip.inMs + delta;
  const maxIn = (clip.outMs || clipEffectiveDurationMs(clip)) - 100;
  if (newIn >= maxIn) return clips;
  return clips.map((c) =>
    c.id === clipId
      ? { ...c, timelineStartMs: Math.max(0, newTimelineStartMs), inMs: Math.max(0, newIn) }
      : c
  );
}

/** 分割主轨片段（总时长不变，无需涟漪平移下游） */
export function magneticSplitPrimary(
  clips: EditClip[],
  clipId: string,
  splitMs: number
): EditClip[] | null {
  const clip = clips.find((c) => c.id === clipId);
  if (!clip || !isPrimaryStoryClip(clip)) return null;
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
