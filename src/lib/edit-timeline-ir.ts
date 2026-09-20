import type { EditClip, EditSequenceSettings } from '@/lib/edit-timeline-types';
import {
  clipEffectiveDurationMs,
  msToFrames,
  normalizeSequence,
  totalTimelineDurationMs,
} from '@/lib/edit-timeline-utils';

export type MaterializedClipFile = {
  clipId: string;
  relativePath: string;
  absolutePath: string;
  mediaKind: EditClip['mediaKind'];
  fileName: string;
};

export type EditTimelineIR = {
  sequence: EditSequenceSettings;
  clips: EditClip[];
  totalDurationMs: number;
  totalFrames: number;
  materials: MaterializedClipFile[];
};

export function buildEditTimelineIR(
  clips: EditClip[],
  sequence: Partial<EditSequenceSettings> | undefined,
  materials: MaterializedClipFile[]
): EditTimelineIR {
  const seq = normalizeSequence(sequence);
  const totalDurationMs = totalTimelineDurationMs(clips);
  return {
    sequence: seq,
    clips,
    totalDurationMs,
    totalFrames: msToFrames(totalDurationMs, seq.fps),
    materials,
  };
}

export function getMaterialForClip(ir: EditTimelineIR, clipId: string): MaterializedClipFile | undefined {
  return ir.materials.find((m) => m.clipId === clipId);
}

export function clipTimelineFrames(clip: EditClip, fps: number): {
  startFrame: number;
  durationFrames: number;
  inFrame: number;
  outFrame: number;
} {
  const durationMs = clipEffectiveDurationMs(clip);
  const durationFrames = msToFrames(durationMs, fps);
  const startFrame = msToFrames(clip.timelineStartMs, fps);
  const inFrame = msToFrames(clip.inMs, fps);
  const outFrame = inFrame + durationFrames;
  return { startFrame, durationFrames, inFrame, outFrame };
}
