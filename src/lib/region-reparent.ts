import type { Node } from 'reactflow';
import type { CanvasNodeData } from '@/components/canvas/CanvasStore';
import { getCanvasNodeSize } from '@/lib/canvas-layout';

/** 与 Canvas `withCollapsibleNodeFlowDimensions` 折叠态命中盒一致 */
const COLLAPSED_FLOW: Partial<Record<CanvasNodeData['type'], { w: number; h: number }>> = {
  agent: { w: 280, h: 248 },
  topazEnhance: { w: 280, h: 192 },
  material: { w: 360, h: 203 },
  faceCompliance: { w: 260, h: 200 },
  browser: { w: 300, h: 210 },
};

export type RegionReparentOptions = {
  /** 当前在画布上展开的大节点 id（与 RF 命中盒一致） */
  expandedNodeId?: string | null;
};

function parentKey(n: Node<CanvasNodeData>): string | undefined {
  return n.parentId ?? (n as { parentNode?: string }).parentNode;
}

/** 父节点始终排在子节点之前，满足 React Flow parentId 要求 */
export function sortNodesParentsFirst(nodes: Node<CanvasNodeData>[]): Node<CanvasNodeData>[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const result: Node<CanvasNodeData>[] = [];
  const placed = new Set<string>();
  let remaining = [...nodes];

  while (remaining.length > 0) {
    const ready = remaining.filter((n) => {
      const pid = parentKey(n);
      return !pid || !byId.has(pid) || placed.has(pid);
    });
    if (ready.length === 0) {
      for (const n of remaining) {
        if (!placed.has(n.id)) {
          placed.add(n.id);
          result.push(n);
        }
      }
      break;
    }
    for (const n of ready) {
      if (!placed.has(n.id)) {
        placed.add(n.id);
        result.push(n);
      }
    }
    remaining = remaining.filter((n) => !placed.has(n.id));
  }
  return result;
}

export function getAbsoluteTopLeft(
  node: Node<CanvasNodeData>,
  byId: Map<string, Node<CanvasNodeData>>
): { x: number; y: number } {
  let x = node.position.x;
  let y = node.position.y;
  let cur: Node<CanvasNodeData> | undefined = node;
  for (let i = 0; i < 48; i++) {
    const pid = cur ? parentKey(cur) : undefined;
    if (!pid) break;
    const p = byId.get(pid);
    if (!p) break;
    x += p.position.x;
    y += p.position.y;
    cur = p;
  }
  return { x, y };
}

function nodePixelSize(
  node: Node<CanvasNodeData>,
  expandedNodeId?: string | null,
): { w: number; h: number } {
  if (typeof node.width === 'number' && node.width > 0 && typeof node.height === 'number' && node.height > 0) {
    return { w: node.width, h: node.height };
  }

  const measured = node as Node<CanvasNodeData> & { measured?: { width?: number; height?: number } };
  if (typeof measured.measured?.width === 'number' && measured.measured.width > 0) {
    return {
      w: measured.measured.width,
      h: measured.measured.height ?? measured.measured.width,
    };
  }

  const collapsed = COLLAPSED_FLOW[node.data?.type];
  if (collapsed && expandedNodeId !== node.id) {
    return collapsed;
  }

  const { width, height } = getCanvasNodeSize(node);
  return { w: width, h: height };
}

function regionAbsBounds(region: Node<CanvasNodeData>, byId: Map<string, Node<CanvasNodeData>>) {
  const { x, y } = getAbsoluteTopLeft(region, byId);
  const { w, h } = nodePixelSize(region);
  return { x, y, w, h };
}

function pointInRect(px: number, py: number, r: { x: number; y: number; w: number; h: number }) {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function pickSmallestOverlappingRegion(
  nodeBounds: { x: number; y: number; w: number; h: number },
  regions: Node<CanvasNodeData>[],
  byId: Map<string, Node<CanvasNodeData>>,
): Node<CanvasNodeData> | null {
  let best: Node<CanvasNodeData> | null = null;
  let bestArea = Infinity;
  for (const r of regions) {
    const rb = regionAbsBounds(r, byId);
    if (!rectsOverlap(nodeBounds, rb)) continue;
    const area = rb.w * rb.h;
    if (area < bestArea) {
      bestArea = area;
      best = r;
    }
  }
  return best;
}

function pickSmallestRegionContainingPoint(
  cx: number,
  cy: number,
  regions: Node<CanvasNodeData>[],
  byId: Map<string, Node<CanvasNodeData>>,
): Node<CanvasNodeData> | null {
  let best: Node<CanvasNodeData> | null = null;
  let bestArea = Infinity;
  for (const r of regions) {
    const rb = regionAbsBounds(r, byId);
    if (!pointInRect(cx, cy, rb)) continue;
    const area = rb.w * rb.h;
    if (area < bestArea) {
      bestArea = area;
      best = r;
    }
  }
  return best;
}

function regionMembershipSig(nodes: Node<CanvasNodeData>[]): string {
  return [...nodes]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((n) => `${n.id}:${parentKey(n) ?? ''}:${Math.round(n.position.x)}:${Math.round(n.position.y)}`)
    .join('|');
}

/** 将尚未挂 parent 且与新区域矩形相交的节点挂到该区域下（相对坐标） */
export function attachUnparentedNodesOverlappingRegion(
  nodes: Node<CanvasNodeData>[],
  regionId: string,
  options?: RegionReparentOptions,
): Node<CanvasNodeData>[] {
  const next = nodes.map((n) => ({ ...n }));
  const by = new Map(next.map((x) => [x.id, x]));
  const region = by.get(regionId);
  if (!region || region.data?.type !== 'region') return nodes;

  const rb = regionAbsBounds(region, by);
  let changed = false;
  const expandedNodeId = options?.expandedNodeId ?? null;

  for (const n of next) {
    if (n.id === regionId || n.data?.type === 'region') continue;
    if (parentKey(n)) continue;

    const { w, h } = nodePixelSize(n, expandedNodeId);
    const absTL = getAbsoluteTopLeft(n, by);
    const nb = { x: absTL.x, y: absTL.y, w, h };
    if (!rectsOverlap(nb, rb)) continue;

    n.position = { x: absTL.x - rb.x, y: absTL.y - rb.y };
    n.parentId = regionId;
    delete (n as { parentNode?: string }).parentNode;
    n.extent = undefined;
    changed = true;
  }

  return changed ? sortNodesParentsFirst(next) : nodes;
}

/**
 * 区域编组：
 * - 拖出区域（节点中心离开区域）：解除 parentId，转为画布绝对坐标
 * - 拖入（节点中心进入区域）：仅对尚未编组的节点挂 parentId
 * - 新建区域框选：用 attachUnparentedNodesOverlappingRegion（矩形相交）
 * 不使用 extent: 'parent'，否则无法拖出区域。
 */
export function applyRegionReparenting(
  nodes: Node<CanvasNodeData>[],
  options?: RegionReparentOptions,
): Node<CanvasNodeData>[] {
  const regions = nodes.filter((n) => n.data?.type === 'region');
  if (regions.length === 0) return nodes;

  const expandedNodeId = options?.expandedNodeId ?? null;
  const next = nodes.map((n) => ({ ...n }));

  const pass1Detach = () => {
    const by = new Map(next.map((x) => [x.id, x]));
    for (const n of next) {
      if (n.data?.type === 'region') continue;
      const pid = parentKey(n);
      if (!pid) continue;
      const p = by.get(pid);
      if (p?.data?.type !== 'region') continue;
      const { w, h } = nodePixelSize(n, expandedNodeId);
      const absTL = getAbsoluteTopLeft(n, by);
      const cx = absTL.x + w / 2;
      const cy = absTL.y + h / 2;
      const rb = regionAbsBounds(p, by);
      if (!pointInRect(cx, cy, rb)) {
        n.position = { ...absTL };
        n.parentId = undefined;
        delete (n as { parentNode?: string }).parentNode;
        n.extent = undefined;
      }
    }
  };

  const pass2Attach = () => {
    const by = new Map(next.map((x) => [x.id, x]));
    for (const n of next) {
      if (n.data?.type === 'region') continue;
      if (parentKey(n)) continue;

      const { w, h } = nodePixelSize(n, expandedNodeId);
      const absTL = getAbsoluteTopLeft(n, by);
      const cx = absTL.x + w / 2;
      const cy = absTL.y + h / 2;
      const best = pickSmallestRegionContainingPoint(cx, cy, regions, by);
      if (!best) continue;

      const rb = regionAbsBounds(best, by);
      n.position = { x: absTL.x - rb.x, y: absTL.y - rb.y };
      n.parentId = best.id;
      delete (n as { parentNode?: string }).parentNode;
      n.extent = undefined;
    }
  };

  pass1Detach();
  pass2Attach();
  return sortNodesParentsFirst(next);
}

export function canvasAbsoluteLayoutSig(nodes: Node<CanvasNodeData>[]): string {
  const by = new Map(nodes.map((n) => [n.id, n]));
  return [...nodes]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((n) => {
      const abs = getAbsoluteTopLeft(n, by);
      return `${n.id}:${parentKey(n) ?? ''}:${Math.round(abs.x)}:${Math.round(abs.y)}`;
    })
    .join('|');
}

export function regionMembershipChanged(
  before: Node<CanvasNodeData>[],
  after: Node<CanvasNodeData>[],
): boolean {
  return regionMembershipSig(before) !== regionMembershipSig(after);
}
