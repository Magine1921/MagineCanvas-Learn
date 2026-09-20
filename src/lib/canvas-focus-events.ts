'use client';

export const CANVAS_FOCUS_NODES_EVENT = 'maginecanvas:focus-nodes';
export const CANVAS_TASK_FOCUS_DURATION_MS = 780;

export interface CanvasFocusNodesDetail {
  nodeIds: string[];
  selectedNodeId?: string;
  selectNode?: boolean;
  motion?: 'default' | 'task';
}

export function requestCanvasNodeFocus(
  nodeIds: string[],
  selectedNodeId?: string,
  options?: { selectNode?: boolean; motion?: CanvasFocusNodesDetail['motion'] },
): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<CanvasFocusNodesDetail>(CANVAS_FOCUS_NODES_EVENT, {
    detail: {
      nodeIds: nodeIds.filter(Boolean),
      selectedNodeId,
      selectNode: options?.selectNode !== false,
      motion: options?.motion || 'default',
    },
  }));
}
