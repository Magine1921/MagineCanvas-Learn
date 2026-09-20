import type { CanvasNodeData } from '@/components/canvas/CanvasStore';

export const TUTORIAL_NODE_CREATED_EVENT = 'magine-canvas:tutorial-node-created';
export const TUTORIAL_CANVAS_INTERACTION_EVENT = 'magine-canvas:tutorial-canvas-interaction';
export const TUTORIAL_PREPARE_CREATION_AREA_EVENT = 'magine-canvas:tutorial-prepare-creation-area';

export type TutorialCanvasInteraction =
  | 'middle-pan'
  | 'double-click-menu'
  | 'context-menu'
  | 'ctrl-wheel-zoom'
  | 'minimap-pan'
  | 'keyboard-shortcuts';

export type TutorialNodeCreatedDetail = {
  nodeId?: string;
  nodeType: CanvasNodeData['type'];
  sequence?: number;
};

export type TutorialCanvasInteractionDetail = {
  interaction: TutorialCanvasInteraction;
};

export type TutorialPrepareCreationAreaDetail = {
  nodeType: CanvasNodeData['type'];
};

type TutorialCreationCenter = {
  nodeType: CanvasNodeData['type'];
  x: number;
  y: number;
};

let pendingCreationCenter: TutorialCreationCenter | null = null;
let nodeCreatedSequence = 0;
let lastNodeCreated: Required<Pick<TutorialNodeCreatedDetail, 'nodeType' | 'sequence'>> &
  Pick<TutorialNodeCreatedDetail, 'nodeId'> | null = null;

export function notifyTutorialNodeCreated(detail: TutorialNodeCreatedDetail): void {
  if (typeof window === 'undefined') return;
  nodeCreatedSequence += 1;
  lastNodeCreated = { ...detail, sequence: nodeCreatedSequence };
  window.dispatchEvent(new CustomEvent<TutorialNodeCreatedDetail>(
    TUTORIAL_NODE_CREATED_EVENT,
    { detail: lastNodeCreated },
  ));
}

export function getTutorialNodeCreatedSnapshot(): TutorialNodeCreatedDetail | null {
  return lastNodeCreated ? { ...lastNodeCreated } : null;
}

export function notifyTutorialCanvasInteraction(interaction: TutorialCanvasInteraction): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<TutorialCanvasInteractionDetail>(
    TUTORIAL_CANVAS_INTERACTION_EVENT,
    { detail: { interaction } },
  ));
}

export function requestTutorialCreationArea(nodeType: CanvasNodeData['type']): void {
  if (typeof window === 'undefined') return;
  pendingCreationCenter = null;
  window.dispatchEvent(new CustomEvent<TutorialPrepareCreationAreaDetail>(
    TUTORIAL_PREPARE_CREATION_AREA_EVENT,
    { detail: { nodeType } },
  ));
}

export function setTutorialCreationCenter(center: TutorialCreationCenter): void {
  pendingCreationCenter = center;
}

export function consumeTutorialCreationCenter(
  nodeType: CanvasNodeData['type'],
): { x: number; y: number } | null {
  if (!pendingCreationCenter || pendingCreationCenter.nodeType !== nodeType) return null;
  const center = { x: pendingCreationCenter.x, y: pendingCreationCenter.y };
  pendingCreationCenter = null;
  return center;
}
