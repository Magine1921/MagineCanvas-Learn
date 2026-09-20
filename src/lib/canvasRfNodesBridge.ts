import type { Node } from 'reactflow';

/** 供 store（如 onConnect）读取 RF 内部节点态（含 selected），避免把 select 写入 zustand 后整表订阅重渲 */
let getRfNodesImpl: (() => Node[]) | null = null;

export function setCanvasRfGetNodes(fn: (() => Node[]) | null): void {
  getRfNodesImpl = fn;
}

export function getCanvasRfNodesOrFallback(fallback: Node[]): Node[] {
  try {
    const live = getRfNodesImpl?.();
    if (Array.isArray(live)) return live;
  } catch {
    /* ignore */
  }
  return fallback;
}
