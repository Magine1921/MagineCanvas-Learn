import {
  DEFAULT_EDIT_PANEL_LAYOUT,
  DEFAULT_IMAGE_CLIP_MS,
  DEFAULT_VIDEO_CLIP_MS,
  type EditClip,
  type EditPanelLayout,
  type EditSequenceSettings,
} from '@/lib/edit-timeline-types';
export function clipEffectiveDurationMs(clip: EditClip): number {
  const dur =
    typeof clip.durationMs === 'number' && clip.durationMs > 0
      ? clip.durationMs
      : clip.mediaKind === 'image'
        ? DEFAULT_IMAGE_CLIP_MS
        : DEFAULT_VIDEO_CLIP_MS;
  const span = Math.max(0, clip.outMs - clip.inMs);
  if (clip.mediaKind === 'image') return span > 0 ? span : DEFAULT_IMAGE_CLIP_MS;
  return span > 0 ? span : dur;
}

/** @deprecated 仅用于显式「收紧空隙」；默认剪辑不调用 */
export function recomputeLinearTimelineStarts(clips: EditClip[]): EditClip[] {
  const tracks = [...new Set(clips.map((c) => c.trackIndex))].sort((a, b) => a - b);
  let result = [...clips];
  for (const t of tracks) {
    const onTrack = result.filter((c) => c.trackIndex === t).sort((a, b) => a.timelineStartMs - b.timelineStartMs);
    let cursor = 0;
    const packed = onTrack.map((c) => {
      const next = { ...c, timelineStartMs: cursor };
      cursor += clipEffectiveDurationMs(next);
      return next;
    });
    result = result.filter((c) => c.trackIndex !== t).concat(packed);
  }
  return result;
}

export function totalTimelineDurationMs(clips: EditClip[]): number {
  if (clips.length === 0) return 0;
  let max = 0;
  for (const c of clips) {
    max = Math.max(max, c.timelineStartMs + clipEffectiveDurationMs(c));
  }
  return max;
}

export function msToFrames(ms: number, fps: number): number {
  return Math.max(1, Math.round((ms / 1000) * fps));
}

export function framesToMs(frames: number, fps: number): number {
  return Math.round((frames / fps) * 1000);
}

/** 将节点上持久化的布局（含旧版 topFraction / materialFraction）规范为 EditPanelLayout */
export function coerceEditPanelLayout(raw: unknown): EditPanelLayout {
  const d = DEFAULT_EDIT_PANEL_LAYOUT;
  if (!raw || typeof raw !== 'object') {
    return { ...d, panelSizesVertical: [...d.panelSizesVertical], panelSizesHorizontal: [...d.panelSizesHorizontal], materialSplits: [...d.materialSplits] };
  }
  const o = raw as Record<string, unknown>;

  let panelSizesVertical: [number, number] = [...d.panelSizesVertical];
  const pvRaw = o.panelSizesVertical;
  if (Array.isArray(pvRaw) && pvRaw.length >= 2) {
    const a = Number(pvRaw[0]);
    const b = Number(pvRaw[1]);
    if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0) {
      panelSizesVertical = [a, b];
    }
  } else {
    const top = o.topFraction;
    if (typeof top === 'number' && Number.isFinite(top)) {
      const t = top <= 1 ? top * 100 : top;
      const topClamped = Math.min(85, Math.max(18, t));
      panelSizesVertical = [topClamped, 100 - topClamped];
    }
  }

  let panelSizesHorizontal: [number, number] = [...d.panelSizesHorizontal];
  const phRaw = o.panelSizesHorizontal;
  if (Array.isArray(phRaw) && phRaw.length >= 2) {
    const a = Number(phRaw[0]);
    const b = Number(phRaw[1]);
    if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0) {
      panelSizesHorizontal = [a, b];
    }
  } else {
    const mf = o.materialFraction;
    if (typeof mf === 'number' && Number.isFinite(mf)) {
      const left = mf <= 1 ? mf * 100 : mf;
      const leftClamped = Math.min(85, Math.max(15, left));
      panelSizesHorizontal = [leftClamped, 100 - leftClamped];
    }
  }

  let materialSplits: [number, number, number] = [...d.materialSplits];
  const msRaw = o.materialSplits;
  if (Array.isArray(msRaw) && msRaw.length >= 3) {
    const x = Number(msRaw[0]);
    const y = Number(msRaw[1]);
    const z = Number(msRaw[2]);
    if ([x, y, z].every((n) => Number.isFinite(n) && n >= 0)) {
      const sum = x + y + z;
      if (sum > 0) materialSplits = [x / sum, y / sum, z / sum];
    }
  }

  return { panelSizesVertical, panelSizesHorizontal, materialSplits };
}

export function normalizeSequence(seq: Partial<EditSequenceSettings> | undefined): EditSequenceSettings {
  let w = Number(seq?.width);
  let h = Number(seq?.height);
  let fps = Number(seq?.fps);
  if (!Number.isFinite(w) || w < 320) w = 1920;
  if (!Number.isFinite(h) || h < 240) h = 1080;
  if (!Number.isFinite(fps) || fps < 1) fps = 30;
  return { width: Math.round(w), height: Math.round(h), fps: Math.min(60, Math.max(1, Math.round(fps))) };
}

export function formatTimelineTime(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const fr = Math.floor((s % 1) * 100);
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(fr).padStart(2, '0')}`;
}
