import type { Edge, Node } from 'reactflow';
import type { CanvasNodeData } from '@/components/canvas/CanvasStore';

const FALLBACK_NODE_SIZE: Partial<Record<CanvasNodeData['type'], { width: number; height: number }>> = {
  prompt: { width: 240, height: 150 },
  image: { width: 260, height: 190 },
  video: { width: 280, height: 200 },
  agent: { width: 380, height: 520 },
  material: { width: 260, height: 190 },
  region: { width: 200, height: 120 },
  storyboard: { width: 320, height: 220 },
  panorama: { width: 360, height: 300 },
  topazEnhance: { width: 1090, height: 320 },
  faceCompliance: { width: 260, height: 200 },
  browser: { width: 920, height: 700 },
};

export function getCanvasNodeSize(node: Node<CanvasNodeData>) {
  const measured = node as Node<CanvasNodeData> & {
    measured?: { width?: number; height?: number };
  };
  const style = node.style as { width?: unknown; height?: unknown } | undefined;
  const renderedWidth = node.width || measured.measured?.width || (typeof style?.width === 'number' ? style.width : 0);
  const renderedHeight = node.height || measured.measured?.height || (typeof style?.height === 'number' ? style.height : 0);
  if (renderedWidth > 0 && renderedHeight > 0) {
    return { width: renderedWidth, height: renderedHeight };
  }
  if (node.data.type === 'region') {
    const d = node.data as { regionWidth?: unknown; regionHeight?: unknown };
    const rw = typeof d.regionWidth === 'number' ? d.regionWidth : FALLBACK_NODE_SIZE.region!.width;
    const rh = typeof d.regionHeight === 'number' ? d.regionHeight : FALLBACK_NODE_SIZE.region!.height;
    return { width: rw, height: rh };
  }
  if (node.data.type === 'storyboard') {
    const d = node.data as { storyboardWidth?: unknown; storyboardHeight?: unknown };
    const sw = typeof d.storyboardWidth === 'number' ? d.storyboardWidth : FALLBACK_NODE_SIZE.storyboard!.width;
    const sh = typeof d.storyboardHeight === 'number' ? d.storyboardHeight : FALLBACK_NODE_SIZE.storyboard!.height;
    return { width: sw, height: sh };
  }
  if (node.data.type === 'panorama') {
    const d = node.data as { panoramaWidth?: unknown; panoramaHeight?: unknown };
    const pw = typeof d.panoramaWidth === 'number' ? d.panoramaWidth : FALLBACK_NODE_SIZE.panorama!.width;
    const ph = typeof d.panoramaHeight === 'number' ? d.panoramaHeight : FALLBACK_NODE_SIZE.panorama!.height;
    return { width: pw, height: ph };
  }
  if (node.data.type === 'topazEnhance') {
    const d = node.data as { topazWidth?: unknown; topazHeight?: unknown };
    const tw = typeof d.topazWidth === 'number' ? d.topazWidth : FALLBACK_NODE_SIZE.topazEnhance!.width;
    const th = typeof d.topazHeight === 'number' ? d.topazHeight : FALLBACK_NODE_SIZE.topazEnhance!.height;
    return { width: tw, height: th };
  }
  if (node.data.type === 'material') {
    const d = node.data as { materialWidth?: unknown; materialHeight?: unknown };
    const mw = typeof d.materialWidth === 'number' ? d.materialWidth : FALLBACK_NODE_SIZE.material!.width;
    const mh = typeof d.materialHeight === 'number' ? d.materialHeight : FALLBACK_NODE_SIZE.material!.height;
    return { width: mw, height: mh };
  }
  if (node.data.type === 'agent') {
    const d = node.data as { agentWidth?: unknown; agentHeight?: unknown };
    const aw = typeof d.agentWidth === 'number' ? d.agentWidth : FALLBACK_NODE_SIZE.agent!.width;
    const ah = typeof d.agentHeight === 'number' ? d.agentHeight : FALLBACK_NODE_SIZE.agent!.height;
    return { width: aw, height: ah };
  }
  if (node.data.type === 'browser') {
    const d = node.data as { browserWidth?: unknown; browserHeight?: unknown };
    const bw = typeof d.browserWidth === 'number' ? d.browserWidth : FALLBACK_NODE_SIZE.browser!.width;
    const bh = typeof d.browserHeight === 'number' ? d.browserHeight : FALLBACK_NODE_SIZE.browser!.height;
    return { width: bw, height: bh };
  }
  const fallback = FALLBACK_NODE_SIZE[node.data.type] || { width: 260, height: 170 };

  return {
    width: node.width || measured.measured?.width || fallback.width,
    height: node.height || measured.measured?.height || fallback.height,
  };
}

type PositionedComponent = {
  nodes: Node<CanvasNodeData>[];
  width: number;
  height: number;
  originalX: number;
  originalY: number;
};

function getNodeBounds(nodes: Node<CanvasNodeData>[]) {
  const left = Math.min(...nodes.map((node) => node.position.x));
  const top = Math.min(...nodes.map((node) => node.position.y));
  const right = Math.max(...nodes.map((node) => node.position.x + getCanvasNodeSize(node).width));
  const bottom = Math.max(...nodes.map((node) => node.position.y + getCanvasNodeSize(node).height));
  return { left, top, width: right - left, height: bottom - top };
}

function resolveLayoutUnitOverlaps(nodes: Node<CanvasNodeData>[]): Node<CanvasNodeData>[] {
  const units = new Map<string, Node<CanvasNodeData>[]>();
  for (const node of nodes) {
    units.set(node.id, [node]);
  }
  if (units.size <= 1) return nodes;

  const orderedUnits = [...units.entries()]
    .map(([key, members]) => ({ key, members, bounds: getNodeBounds(members) }))
    .sort((a, b) => a.bounds.top - b.bounds.top || a.bounds.left - b.bounds.left);
  const shiftedByNodeId = new Map<string, Node<CanvasNodeData>>();
  const placed: Array<{ left: number; top: number; right: number; bottom: number }> = [];
  const horizontalPadding = 80;
  const verticalPadding = 140;

  for (const unit of orderedUnits) {
    let shiftY = 0;
    while (true) {
      const top = unit.bounds.top + shiftY;
      const bottom = top + unit.bounds.height;
      const conflicting = placed.filter((other) => (
        unit.bounds.left < other.right + horizontalPadding
        && unit.bounds.left + unit.bounds.width > other.left - horizontalPadding
        && top < other.bottom + verticalPadding
        && bottom > other.top - verticalPadding
      ));
      if (conflicting.length === 0) break;
      shiftY = Math.max(
        shiftY,
        ...conflicting.map((other) => other.bottom + verticalPadding - unit.bounds.top),
      );
    }

    for (const node of unit.members) {
      shiftedByNodeId.set(node.id, {
        ...node,
        position: { x: node.position.x, y: node.position.y + shiftY },
      });
    }
    placed.push({
      left: unit.bounds.left,
      top: unit.bounds.top + shiftY,
      right: unit.bounds.left + unit.bounds.width,
      bottom: unit.bounds.top + shiftY + unit.bounds.height,
    });
  }

  return nodes.map((node) => shiftedByNodeId.get(node.id) || node);
}

function layoutConnectedComponent(
  nodes: Node<CanvasNodeData>[],
  edges: Edge[],
): PositionedComponent {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const validEdges = edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  const indegree = new Map<string, number>();

  for (const node of nodes) {
    outgoing.set(node.id, []);
    incoming.set(node.id, []);
    indegree.set(node.id, 0);
  }
  for (const edge of validEdges) {
    outgoing.get(edge.source)?.push(edge.target);
    incoming.get(edge.target)?.push(edge.source);
    indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1);
  }

  const byOriginalPosition = [...nodes].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
  const originalX = Math.min(...nodes.map((node) => node.position.x));
  const originalY = Math.min(...nodes.map((node) => node.position.y));
  const level = new Map<string, number>();
  const queue = byOriginalPosition.filter((node) => (indegree.get(node.id) || 0) === 0).map((node) => node.id);
  const workIndegree = new Map(indegree);
  const visited = new Set<string>();

  if (queue.length === 0 && byOriginalPosition[0]) queue.push(byOriginalPosition[0].id);

  while (queue.length > 0) {
    const source = queue.shift();
    if (!source || visited.has(source)) continue;
    visited.add(source);
    const sourceLevel = level.get(source) || 0;
    for (const target of outgoing.get(source) || []) {
      level.set(target, Math.max(level.get(target) || 0, sourceLevel + 1));
      workIndegree.set(target, Math.max(0, (workIndegree.get(target) || 0) - 1));
      if ((workIndegree.get(target) || 0) === 0) queue.push(target);
    }
  }

  for (const node of byOriginalPosition) {
    if (level.has(node.id)) continue;
    const parentLevels = (incoming.get(node.id) || []).map((source) => (level.get(source) || 0) + 1);
    level.set(node.id, parentLevels.length > 0 ? Math.max(...parentLevels) : 0);
  }

  const groups = new Map<number, Node<CanvasNodeData>[]>();
  for (const node of byOriginalPosition) {
    const groupLevel = level.get(node.id) || 0;
    groups.set(groupLevel, [...(groups.get(groupLevel) || []), node]);
  }

  const columns = [...groups.entries()].sort(([a], [b]) => a - b);
  const columnGap = 140;
  const rowGap = 48;
  const columnHeights = columns.map(([, columnNodes]) =>
    columnNodes.reduce((sum, node) => sum + getCanvasNodeSize(node).height, 0)
      + Math.max(0, columnNodes.length - 1) * rowGap
  );
  const maxColumnHeight = Math.max(...columnHeights);
  const positionById = new Map<string, { x: number; y: number }>();
  let nextX = 0;

  columns.forEach(([, columnNodes], index) => {
    const columnWidth = Math.max(...columnNodes.map((node) => getCanvasNodeSize(node).width));
    let nextY = Math.max(0, (maxColumnHeight - columnHeights[index]) / 2);
    for (const node of columnNodes) {
      const size = getCanvasNodeSize(node);
      positionById.set(node.id, {
        x: nextX + Math.max(0, (columnWidth - size.width) / 2),
        y: nextY,
      });
      nextY += size.height + rowGap;
    }
    nextX += columnWidth + columnGap;
  });

  const restored = resolveLayoutUnitOverlaps(
    nodes.map((node) => ({
      ...node,
      dragging: false,
      position: positionById.get(node.id) || node.position,
    })),
  );
  const bounds = getNodeBounds(restored);
  return {
    nodes: restored.map((node) => ({
      ...node,
      position: {
        x: node.position.x - bounds.left,
        y: node.position.y - bounds.top,
      },
    })),
    width: bounds.width,
    height: bounds.height,
    originalX,
    originalY,
  };
}

/** Flow-aware layout used by canvas「一键整理」 */
export function layoutCanvasNodes(nodes: Node<CanvasNodeData>[], edges: Edge[]): Node<CanvasNodeData>[] {
  if (nodes.length <= 1) return nodes;
  const minX = Math.min(...nodes.map((node) => node.position.x));
  const minY = Math.min(...nodes.map((node) => node.position.y));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const topLevelNodes = nodes.filter((node) => {
    const parentId = node.parentId || (node as Node<CanvasNodeData> & { parentNode?: string }).parentNode;
    return !parentId || !nodeById.has(parentId);
  });
  const rootIdByNodeId = new Map<string, string>();
  const resolveRootId = (nodeId: string): string => {
    const cached = rootIdByNodeId.get(nodeId);
    if (cached) return cached;
    let current = nodeById.get(nodeId);
    const seen = new Set<string>();
    while (current) {
      const parentId = current.parentId || (current as Node<CanvasNodeData> & { parentNode?: string }).parentNode;
      if (!parentId || !nodeById.has(parentId) || seen.has(parentId)) break;
      seen.add(parentId);
      current = nodeById.get(parentId);
    }
    const rootId = current?.id || nodeId;
    rootIdByNodeId.set(nodeId, rootId);
    return rootId;
  };
  const rootEdges: Edge[] = [];
  const rootEdgeKeys = new Set<string>();
  for (const edge of edges) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue;
    const source = resolveRootId(edge.source);
    const target = resolveRootId(edge.target);
    if (source === target) continue;
    const key = `${source}->${target}`;
    if (rootEdgeKeys.has(key)) continue;
    rootEdgeKeys.add(key);
    rootEdges.push({ ...edge, source, target });
  }

  const adjacency = new Map(topLevelNodes.map((node) => [node.id, new Set<string>()]));
  for (const edge of rootEdges) {
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  }
  const orderedRoots = [...topLevelNodes].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
  const visited = new Set<string>();
  const components: PositionedComponent[] = [];
  for (const root of orderedRoots) {
    if (visited.has(root.id)) continue;
    const pending = [root.id];
    const componentIds = new Set<string>();
    while (pending.length > 0) {
      const nodeId = pending.shift();
      if (!nodeId || visited.has(nodeId)) continue;
      visited.add(nodeId);
      componentIds.add(nodeId);
      pending.push(...(adjacency.get(nodeId) || []));
    }
    const componentNodes = topLevelNodes.filter((node) => componentIds.has(node.id));
    components.push(layoutConnectedComponent(componentNodes, rootEdges));
  }

  components.sort((a, b) => a.originalY - b.originalY || a.originalX - b.originalX);
  const horizontalGap = 220;
  const verticalGap = 180;
  const totalArea = components.reduce(
    (sum, component) => sum + (component.width + horizontalGap) * (component.height + verticalGap),
    0,
  );
  const widestComponent = Math.max(...components.map((component) => component.width));
  const targetRowWidth = Math.min(5200, Math.max(widestComponent, 1500, Math.sqrt(totalArea * 1.65)));
  const arrangedById = new Map<string, Node<CanvasNodeData>>();
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;

  for (const component of components) {
    if (cursorX > 0 && cursorX + component.width > targetRowWidth) {
      cursorX = 0;
      cursorY += rowHeight + verticalGap;
      rowHeight = 0;
    }
    for (const node of component.nodes) {
      arrangedById.set(node.id, {
        ...node,
        position: {
          x: minX + cursorX + node.position.x,
          y: minY + cursorY + node.position.y,
        },
      });
    }
    cursorX += component.width + horizontalGap;
    rowHeight = Math.max(rowHeight, component.height);
  }

  return nodes.map((node) => arrangedById.get(node.id) || { ...node, dragging: false });
}

export type SimpleCanvasLayout = 'grid' | 'horizontal' | 'vertical' | 'flow';

export function applySimpleNodeLayout(
  nodes: Node<CanvasNodeData>[],
  edges: Edge[],
  layout: SimpleCanvasLayout
): Node<CanvasNodeData>[] {
  if (layout === 'flow') {
    return layoutCanvasNodes(nodes, edges);
  }
  if (nodes.length === 0) return nodes;

  const cols = Math.ceil(Math.sqrt(nodes.length));
  const gapX = 360;
  const gapY = 200;
  const startX = 200;
  const startY = 150;

  return nodes.map((node, i) => {
    let x: number;
    let y: number;
    if (layout === 'grid') {
      x = startX + (i % cols) * gapX;
      y = startY + Math.floor(i / cols) * gapY;
    } else if (layout === 'horizontal') {
      x = startX + i * gapX;
      y = startY;
    } else {
      x = startX;
      y = startY + i * gapY;
    }
    return { ...node, position: { x, y } };
  });
}
