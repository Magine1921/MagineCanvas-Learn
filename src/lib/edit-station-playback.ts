import { EDIT_TRACK_VIDEO, type EditClip } from '@/lib/edit-timeline-types';
import { clipEffectiveDurationMs, totalTimelineDurationMs } from '@/lib/edit-timeline-utils';
import { clipEndMs } from '@/lib/edit-timeline-engine';

function maxSourceTimeMs(clip: EditClip): number {
  const span = clipEffectiveDurationMs(clip);
  if (clip.outMs > clip.inMs) return clip.outMs;
  return clip.inMs + span;
}

export function thumbUrlForClip(clip: Pick<EditClip, 'mediaKind' | 'url' | 'thumbnailUrl'>): string {
  const thumb = clip.thumbnailUrl?.trim();
  if (thumb) return thumb;
  if (clip.mediaKind === 'image') return clip.url;
  if (clip.mediaKind === 'video' && clip.url) return clip.url;
  return '';
}

/**
 * 主轨预览：播放头处的视频/图片片段
 * 重叠时取起点最晚者（上层覆盖，贴近剪映主轨叠放语义）
 */
export function getClipAtPlayhead(clips: EditClip[], playheadMs: number): EditClip | null {
  const candidates = clips
    .filter((c) => c.trackIndex === EDIT_TRACK_VIDEO && c.mediaKind !== 'audio')
    .filter((c) => playheadMs >= c.timelineStartMs && playheadMs < clipEndMs(c))
    .sort((a, b) => b.timelineStartMs - a.timelineStartMs);
  return candidates[0] ?? null;
}

/** 分割目标：优先「选中且播放头落在片内」，否则主轨预览片，再否则任意轨上覆盖播放头的片段 */
export function findClipToSplitAtPlayhead(
  clips: EditClip[],
  playheadMs: number,
  selectedClipId: string | null
): EditClip | null {
  if (selectedClipId) {
    const sel = clips.find((c) => c.id === selectedClipId);
    if (sel && playheadMs > sel.timelineStartMs && playheadMs < clipEndMs(sel)) return sel;
  }
  const primary = getClipAtPlayhead(clips, playheadMs);
  if (primary) return primary;
  return clips.find((c) => playheadMs > c.timelineStartMs && playheadMs < clipEndMs(c)) ?? null;
}

/** 源媒体时间（ms），夹在 [in, out) 内，避免 seek 越界导致来回跳 / 卡顿 */
export function localTimeInClip(clip: EditClip, playheadMs: number): number {
  const offset = Math.max(0, playheadMs - clip.timelineStartMs);
  const raw = clip.inMs + offset;
  const hi = maxSourceTimeMs(clip);
  const eps = 1e-3;
  return Math.max(clip.inMs, Math.min(hi - eps, raw));
}

export function timelineDurationMs(clips: EditClip[], minMs = 3000): number {
  const t = totalTimelineDurationMs(clips);
  return Math.max(minMs, t);
}

/** 时间线画布总时长：在内容末端与播放头之后保留空白，便于继续拖放与移动播放头 */
export function timelineViewportTotalMs(clips: EditClip[], playheadMs: number): number {
  const content = totalTimelineDurationMs(clips);
  const tailPadMs = 180_000;
  const playheadPadMs = 90_000;
  return Math.max(30_000, content + tailPadMs, playheadMs + playheadPadMs);
}

export function trackXToMs(clientX: number, rect: DOMRect, totalMs: number): number {
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)));
  return Math.round(ratio * totalMs);
}

export function msToTrackX(ms: number, totalMs: number, trackWidth: number): number {
  if (totalMs <= 0) return 0;
  return (ms / totalMs) * trackWidth;
}
