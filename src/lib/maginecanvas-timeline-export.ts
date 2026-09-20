import {
  EDIT_TRACK_AUDIO,
  EDIT_TRACK_VIDEO,
  type EditClip,
  type EditMediaKind,
  type InboundEditClipCandidate,
} from '@/lib/edit-timeline-types';
import type {
  MaginecanvasTimelineClipSnapshot,
  MaginecanvasTimelineSnapshot,
  MaginecanvasTimelineTrackSnapshot,
} from '@/lib/maginecanvas-edit-station-bridge';

type BuildResult = {
  clips: EditClip[];
  missing: string[];
};

function numberOr(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function sanitizeMaginecanvasSourceId(sourceNodeId: string): string {
  const raw = String(sourceNodeId || 'asset').trim() || 'asset';
  const safe = raw.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  return (safe || 'asset').slice(0, 120);
}

function stripQueryAndHash(value: string): string {
  return value.split('#')[0]?.split('?')[0] ?? value;
}

function baseName(value: string | undefined): string {
  const raw = stripQueryAndHash(String(value || '').trim());
  if (!raw) return '';
  const normalized = raw.replace(/\\/g, '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

function stripExt(value: string): string {
  return value.replace(/\.[a-z0-9]+$/i, '');
}

function normalizeKey(value: string | undefined): string {
  return stripExt(baseName(value)).trim().toLowerCase();
}

function mediaKindFromSnapshot(
  clip: MaginecanvasTimelineClipSnapshot,
  track: MaginecanvasTimelineTrackSnapshot,
  inbound?: InboundEditClipCandidate
): EditMediaKind {
  if (inbound?.mediaKind) return inbound.mediaKind;
  const raw = `${clip.file?.type || ''} ${clip.type || ''} ${track.type || ''}`.toLowerCase();
  if (raw.includes('audio')) return 'audio';
  if (raw.includes('image') || raw.includes('gif') || /\.(png|jpe?g|webp|gif|bmp|svg|avif|heic|heif)$/i.test(clip.file?.label || '')) {
    return 'image';
  }
  return 'video';
}

function sourceKindFromMediaKind(kind: EditMediaKind): EditClip['sourceKind'] {
  if (kind === 'video') return 'video';
  if (kind === 'image') return 'image';
  return 'material';
}

function buildInboundIndexes(inbound: InboundEditClipCandidate[]) {
  const bySource = new Map<string, InboundEditClipCandidate>();
  const bySafe = new Map<string, InboundEditClipCandidate>();
  const byImportedStem = new Map<string, InboundEditClipCandidate>();
  const byFileStem = new Map<string, InboundEditClipCandidate>();

  for (const item of inbound) {
    bySource.set(item.sourceNodeId, item);
    const safe = sanitizeMaginecanvasSourceId(item.sourceNodeId).toLowerCase();
    bySafe.set(safe, item);
    byImportedStem.set(`magine-${safe}`, item);
    const stem = normalizeKey(item.fileName);
    if (stem) byFileStem.set(stem, item);
  }

  return { bySource, bySafe, byImportedStem, byFileStem };
}

function findInboundForClip(
  clip: MaginecanvasTimelineClipSnapshot,
  indexes: ReturnType<typeof buildInboundIndexes>
): InboundEditClipCandidate | undefined {
  const candidates = [
    normalizeKey(clip.file?.label),
    normalizeKey(clip.file?.fileBaseName),
    normalizeKey(clip.name),
  ].filter(Boolean);

  for (const key of candidates) {
    const exact = indexes.byImportedStem.get(key) || indexes.byFileStem.get(key);
    if (exact) return exact;
    if (key.startsWith('magine-')) {
      const safe = key.slice('magine-'.length);
      const bySafe = indexes.bySafe.get(safe);
      if (bySafe) return bySafe;
    }
  }

  return undefined;
}

function trackExportIndex(track: MaginecanvasTimelineTrackSnapshot, visualOrdinal: number, audioOrdinal: number): number {
  const raw = String(track.type || '').toLowerCase();
  if (raw.includes('audio')) return EDIT_TRACK_AUDIO + audioOrdinal * 2;
  return EDIT_TRACK_VIDEO + visualOrdinal * 2;
}

function clipLabel(clip: MaginecanvasTimelineClipSnapshot): string {
  return clip.file?.label || clip.file?.fileBaseName || clip.name || clip.uuid || '未命名片段';
}

export function clipsFromMaginecanvasTimelineSnapshot(
  snapshot: MaginecanvasTimelineSnapshot | null | undefined,
  inbound: InboundEditClipCandidate[]
): BuildResult {
  const tracks = Array.isArray(snapshot?.tracks) ? snapshot.tracks : [];
  const indexes = buildInboundIndexes(inbound);
  const clips: EditClip[] = [];
  const missing: string[] = [];
  let visualOrdinal = 0;
  let audioOrdinal = 0;

  for (let ti = 0; ti < tracks.length; ti += 1) {
    const track = tracks[ti];
    const rawTrackType = String(track.type || '').toLowerCase();
    const isAudioTrack = rawTrackType.includes('audio');
    const exportTrackIndex = trackExportIndex(track, visualOrdinal, audioOrdinal);
    if (isAudioTrack) audioOrdinal += 1;
    else visualOrdinal += 1;

    const trackClips = Array.isArray(track.clips) ? track.clips : [];
    for (let ci = 0; ci < trackClips.length; ci += 1) {
      const sourceClip = trackClips[ci];
      const time = sourceClip.time || {};
      const timelineStartMs = Math.max(0, Math.round(numberOr(time.start)));
      const timelineEndMs = Math.max(timelineStartMs, Math.round(numberOr(time.end, timelineStartMs)));
      const visibleDurationMs = Math.max(1, timelineEndMs - timelineStartMs);
      const startCutMs = Math.max(0, Math.round(numberOr(time.startCut)));
      const endCutMs = Math.max(0, Math.round(numberOr(time.endCut)));
      const inboundClip = findInboundForClip(sourceClip, indexes);
      const mediaKind = mediaKindFromSnapshot(sourceClip, track, inboundClip);
      const fallbackUrl = String(sourceClip.file?.path || '').trim();
      const url = inboundClip?.url || fallbackUrl;

      if (!url) {
        missing.push(clipLabel(sourceClip));
        continue;
      }

      const fileDurationMs = Math.round(numberOr(sourceClip.file?.duration) * 1000);
      const sourceDurationMs =
        inboundClip?.durationMs ||
        (fileDurationMs > 0 ? fileDurationMs : startCutMs + visibleDurationMs + endCutMs);
      const inMs = mediaKind === 'image' ? 0 : startCutMs;
      const outMs = mediaKind === 'image' ? visibleDurationMs : startCutMs + visibleDurationMs;

      clips.push({
        id: sourceClip.uuid || `maginecanvas-${ti}-${ci}-${Date.now()}`,
        sourceNodeId: inboundClip?.sourceNodeId || sourceClip.mediaId || sourceClip.uuid || `maginecanvas-${ti}-${ci}`,
        sourceKind: inboundClip?.sourceKind || sourceKindFromMediaKind(mediaKind),
        mediaKind,
        url,
        fileName: inboundClip?.fileName || baseName(sourceClip.file?.label) || clipLabel(sourceClip),
        thumbnailUrl: inboundClip?.thumbnailUrl || sourceClip.file?.thumbnail || undefined,
        durationMs: sourceDurationMs > 0 ? sourceDurationMs : visibleDurationMs,
        inMs,
        outMs,
        timelineStartMs,
        trackIndex: exportTrackIndex,
      });
    }
  }

  clips.sort((a, b) => a.trackIndex - b.trackIndex || a.timelineStartMs - b.timelineStartMs);
  return { clips, missing };
}
