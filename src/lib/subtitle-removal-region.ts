export type SubtitleRemovalMode = 'auto' | 'custom';

export interface SubtitleRemovalRegion {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const MIN_REGION_SPAN = 0.005;
const MAX_PERCENT_COORDINATE = 0.9999;

function clampCoordinate(value: number) {
  return Math.max(0, Math.min(MAX_PERCENT_COORDINATE, value));
}

export function normalizeSubtitleRemovalRegion(value: unknown): SubtitleRemovalRegion | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<SubtitleRemovalRegion>;
  const coordinates = [candidate.left, candidate.top, candidate.right, candidate.bottom].map(Number);
  if (!coordinates.every(Number.isFinite)) return null;

  const [rawLeft, rawTop, rawRight, rawBottom] = coordinates;
  const left = clampCoordinate(Math.min(rawLeft, rawRight));
  const top = clampCoordinate(Math.min(rawTop, rawBottom));
  const right = clampCoordinate(Math.max(rawLeft, rawRight));
  const bottom = clampCoordinate(Math.max(rawTop, rawBottom));
  if (right - left < MIN_REGION_SPAN || bottom - top < MIN_REGION_SPAN) return null;

  return { left, top, right, bottom };
}

export function subtitleRemovalRegionToTencentArea(region: SubtitleRemovalRegion) {
  const normalized = normalizeSubtitleRemovalRegion(region);
  if (!normalized) throw new Error('指定区域擦除缺少有效框选区域');
  return {
    LeftTopX: normalized.left,
    LeftTopY: normalized.top,
    RightBottomX: normalized.right,
    RightBottomY: normalized.bottom,
    Unit: 1,
  };
}
