'use client';

export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasViewportCenterRequestDetail {
  resolve: (position: CanvasPoint) => void;
}

export const CANVAS_VIEWPORT_CENTER_REQUEST_EVENT =
  'maginecanvas:request-viewport-center';

export function requestCanvasViewportCenter(): CanvasPoint | null {
  if (typeof window === 'undefined') return null;
  let position: CanvasPoint | null = null;
  window.dispatchEvent(new CustomEvent<CanvasViewportCenterRequestDetail>(
    CANVAS_VIEWPORT_CENTER_REQUEST_EVENT,
    {
      detail: {
        resolve: (nextPosition) => {
          position = nextPosition;
        },
      },
    },
  ));
  return position;
}

const DEFAULT_NODE_PLACEMENT_SIZE: Record<string, CanvasPoint> = {
  prompt: { x: 240, y: 180 },
  llm: { x: 280, y: 180 },
  image: { x: 360, y: 203 },
  video: { x: 360, y: 203 },
  browser: { x: 300, y: 210 },
  material: { x: 360, y: 203 },
  storyboard: { x: 320, y: 220 },
  panorama: { x: 360, y: 300 },
  topazEnhance: { x: 1090, y: 320 },
  music: { x: 360, y: 202 },
  agent: { x: 380, y: 520 },
  faceCompliance: { x: 280, y: 320 },
};

export function centerCanvasNodePosition(
  type: string,
  center: CanvasPoint,
): CanvasPoint {
  const size = DEFAULT_NODE_PLACEMENT_SIZE[type] || { x: 280, y: 180 };
  return {
    x: center.x - size.x / 2,
    y: center.y - size.y / 2,
  };
}
