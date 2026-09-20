export type CanvasSnapAlignment = 'start' | 'center' | 'end';

export type CanvasSnapRect = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  parentId?: string;
};

export type CanvasAlignmentGuide = {
  axis: 'x' | 'y';
  coordinate: number;
  alignment: CanvasSnapAlignment;
  targetNodeId: string;
};

export type CanvasNodeSnapResult = {
  position: { x: number; y: number };
  guides: CanvasAlignmentGuide[];
};

const ALIGNMENTS: Array<{ alignment: CanvasSnapAlignment; ratio: number }> = [
  { alignment: 'start', ratio: 0 },
  { alignment: 'end', ratio: 1 },
  { alignment: 'center', ratio: 0.5 },
];

type AxisSnap = {
  delta: number;
  distance: number;
  guide: CanvasAlignmentGuide;
};

function findAxisSnap(
  moving: CanvasSnapRect,
  candidates: CanvasSnapRect[],
  axis: 'x' | 'y',
  threshold: number,
): AxisSnap | null {
  const positionKey = axis;
  const sizeKey = axis === 'x' ? 'width' : 'height';
  let best: AxisSnap | null = null;

  for (const candidate of candidates) {
    for (const { alignment, ratio } of ALIGNMENTS) {
      const movingAnchor = moving[positionKey] + moving[sizeKey] * ratio;
      const candidateAnchor = candidate[positionKey] + candidate[sizeKey] * ratio;
      const delta = candidateAnchor - movingAnchor;
      const distance = Math.abs(delta);
      if (distance > threshold) continue;
      if (best && distance >= best.distance - 1e-6) continue;

      best = {
        delta,
        distance,
        guide: {
          axis,
          coordinate: candidateAnchor,
          alignment,
          targetNodeId: candidate.id,
        },
      };
    }
  }

  return best;
}

export function snapCanvasNodeRect(
  moving: CanvasSnapRect,
  nodes: CanvasSnapRect[],
  threshold: number,
): CanvasNodeSnapResult {
  const safeThreshold = Number.isFinite(threshold) ? Math.max(0, threshold) : 0;
  const candidates = nodes.filter((node) => (
    node.id !== moving.id && (node.parentId || '') === (moving.parentId || '')
  ));
  const xSnap = findAxisSnap(moving, candidates, 'x', safeThreshold);
  const ySnap = findAxisSnap(moving, candidates, 'y', safeThreshold);

  return {
    position: {
      x: moving.x + (xSnap?.delta ?? 0),
      y: moving.y + (ySnap?.delta ?? 0),
    },
    guides: [xSnap?.guide, ySnap?.guide].filter(
      (guide): guide is CanvasAlignmentGuide => guide != null,
    ),
  };
}
