'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useCanvasStore } from '../CanvasStore';
import type { PixiCanvasCore } from './PixiCanvasCore';
import type { RenderNode, RenderEdge } from './types';
import { NODE_TYPE_COLORS } from './types';
import type { PixiInteractionCallbacks } from './PixiInteraction';
import type { CanvasNodeData } from '../CanvasStore';
import type { Node, Edge } from 'reactflow';

/**
 * 桥接 zustand store → PixiJS 渲染引擎。
 *
 * 职责：
 * 1. 订阅 store.nodes / store.edges 变化
 * 2. 将 Node<CanvasNodeData>[] 映射为 RenderNode[]
 * 3. 将 Edge[] 映射为 RenderEdge[]
 * 4. 将用户交互回调映射为 store actions
 * 5. 处理 undo snapshot（拖拽前后的位置快照）
 *
 * 关键性能点：
 * - 使用 useShallow 比较 store 引用，避免不必要的订阅触发
 * - 使用 ref 持有定时器 handle，防止闭包过期
 * - 交互回调使用 useCallback 稳定引用
 */
export function usePixiStoreBridge(
  core: PixiCanvasCore | null,
) {
  const coreRef = useRef<PixiCanvasCore | null>(core);
  coreRef.current = core;

  // ---- zustand subscriptions ----

  const storeNodes = useCanvasStore((s) => s.nodes);
  const storeEdges = useCanvasStore((s) => s.edges);
  const selectedNodeId = useCanvasStore((s) => s.selectedNode?.id ?? null);
  const selectedEdgeIds = useCanvasStore((s) => {
    // 读取 selected edge ids（通过 CanvasStore 的 side channel；
    // 如果需要精确同步需要把此状态也迁移到 store）
    return (s as any)._selectedEdgeIds as string[] | undefined ?? [];
  });

  const { pushUndoSnapshot, setNodes, onConnect, addNode } = useCanvasStore(
    useShallow((state) => ({
      pushUndoSnapshot: state.pushUndoSnapshot,
      setNodes: state.setNodes,
      onConnect: state.onConnect,
      addNode: state.addNode,
    })),
  );

  // ---- 将 store nodes 映射为 RenderNode[] 并同步到 PixiJS ----

  // 节点拖拽偏移累积（拖拽使用增量 delta，避免每帧读回 store）
  const dragAccumRef = useRef<Map<string, { dx: number; dy: number }>>(new Map());

  // 上次同步时的 store nodes 快照（用于 diff 检测）
  const prevStoreNodesRef = useRef<Node<CanvasNodeData>[]>(storeNodes);
  const prevStoreEdgesRef = useRef<Edge[]>(storeEdges);

  // 从拖拽开始时 store 中的节点位置快照
  const dragStartPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const dragUndoCapturedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!coreRef.current) return;

    const nodes: Node<CanvasNodeData>[] = storeNodes;
    const prevNodes = prevStoreNodesRef.current;

    // 简单引用比较：如果引用相同、长度相同、第一个和最后一个 id 相同 → 大概率没变
    if (
      nodes === prevNodes &&
      nodes.length === prevNodes.length &&
      (nodes.length === 0 || nodes[0]?.id === prevNodes[0]?.id)
    ) {
      return;
    }

    prevStoreNodesRef.current = nodes;

    const renderNodes: RenderNode[] = nodes.map((n) => {
      const type = (n.data as CanvasNodeData).type;
      const size = getNodeRenderSize(n);
      return {
        id: n.id,
        type,
        x: n.position.x,
        y: n.position.y,
        width: size.width,
        height: size.height,
        selected: n.selected ?? false,
        color: NODE_TYPE_COLORS[type] ?? 0x6366f1,
        label: ((n.data as CanvasNodeData).label as string) || type,
        parentId: n.parentId,
        zIndex: n.zIndex,
      };
    });

    coreRef.current.syncNodes(renderNodes);
  }, [storeNodes]);

  // ---- 将 store edges 映射为 RenderEdge[] ----

  useEffect(() => {
    if (!coreRef.current) return;

    const edges = storeEdges;
    const prevEdges = prevStoreEdgesRef.current;

    if (edges === prevEdges) return;
    prevStoreEdgesRef.current = edges;

    // 需要从节点位置计算边的端点坐标
    const nodeMap = new Map(storeNodes.map((n) => [n.id, n]));

    const renderEdges: RenderEdge[] = edges.map((e) => {
      const sourceNode = nodeMap.get(e.source);
      const targetNode = nodeMap.get(e.target);
      const srcSize = sourceNode
        ? getNodeRenderSize(sourceNode)
        : { width: 120, height: 60 };
      const tgtSize = targetNode
        ? getNodeRenderSize(targetNode)
        : { width: 120, height: 60 };

      return {
        id: e.id,
        sourceX: (sourceNode?.position.x ?? 0) + srcSize.width / 2,
        sourceY: (sourceNode?.position.y ?? 0) + srcSize.height / 2,
        targetX: (targetNode?.position.x ?? 0) - tgtSize.width / 2,
        targetY: (targetNode?.position.y ?? 0) + tgtSize.height / 2,
        selected: selectedEdgeIds.includes(e.id),
        dissolving: false,
        fading: false,
      };
    });

    coreRef.current.syncEdges(renderEdges);
  }, [storeEdges, storeNodes, selectedEdgeIds]);

  // ---- 交互回调 → store actions ----

  const interactionCallbacks: PixiInteractionCallbacks = {
    onNodeDragStart: useCallback(
      (nodeId: string) => {
        dragUndoCapturedRef.current.delete(nodeId);
        const node = storeNodes.find((n) => n.id === nodeId);
        if (node) {
          dragStartPositionsRef.current.set(nodeId, {
            x: node.position.x,
            y: node.position.y,
          });
        }
        dragAccumRef.current.set(nodeId, { dx: 0, dy: 0 });
      },
      [storeNodes],
    ),

    onNodeDrag: useCallback(
      (nodeId: string, worldDx: number, worldDy: number) => {
        if (!dragUndoCapturedRef.current.has(nodeId)) {
          pushUndoSnapshot();
          dragUndoCapturedRef.current.add(nodeId);
        }
        const accum = dragAccumRef.current.get(nodeId) ?? { dx: 0, dy: 0 };
        accum.dx += worldDx;
        accum.dy += worldDy;
        dragAccumRef.current.set(nodeId, accum);
        // 实时更新 store 中的节点位置（不提交快照）
        // 注意：高频更新，直接操作 store
        const state = useCanvasStore.getState();
        const newNodes = state.nodes.map((n) => {
          if (n.id !== nodeId) return n;
          const start = dragStartPositionsRef.current.get(nodeId);
          if (!start) return n;
          return {
            ...n,
            position: {
              x: start.x + accum.dx,
              y: start.y + accum.dy,
            },
          };
        });
        state.setNodes(newNodes);
      },
      [pushUndoSnapshot],
    ),

    onNodeDragEnd: useCallback(
      (nodeId: string) => {
        dragStartPositionsRef.current.delete(nodeId);
        dragAccumRef.current.delete(nodeId);
        dragUndoCapturedRef.current.delete(nodeId);
      },
      [],
    ),

    onNodeClick: useCallback(
      (_nodeId: string, _event: PointerEvent) => {
        // 选中节点：由上层 React 组件的 setSelectedNode 处理
      },
      [],
    ),

    onPaneDoubleClick: useCallback(
      (_event: MouseEvent, worldX: number, worldY: number) => {
        // 双击空白区创建节点 — 默认创建 prompt 节点
        addNode('prompt', { x: worldX, y: worldY });
      },
      [addNode],
    ),

    onPanStart: useCallback(() => {
      // 可关闭 minimap / 降低特效
    }, []),

    onPanEnd: useCallback(() => {
      // 恢复特效
    }, []),

    onZoomChange: useCallback((_zoom: number) => {
      // zoom 百分比显示更新
    }, []),
  };

  // 将回调注入到 core（每次回调变化时更新）
  useEffect(() => {
    coreRef.current?.setCallbacks(interactionCallbacks);
  }, [interactionCallbacks]);

  return {
    /** 手动触发 fitView */
    fitView: useCallback(
      (padding?: number) => {
        const nodes = storeNodes;
        const rns: RenderNode[] = nodes.map((n) => {
          const type = (n.data as CanvasNodeData).type;
          const size = getNodeRenderSize(n);
          return {
            id: n.id,
            type,
            x: n.position.x,
            y: n.position.y,
            width: size.width,
            height: size.height,
            selected: false,
            color: 0,
            label: '',
          };
        });
        coreRef.current?.fitView(rns, padding);
      },
      [storeNodes],
    ),
    /** 获取当前 zoom */
    getZoom: useCallback(() => coreRef.current?.viewport.zoom ?? 1, []),
  };
}

/**
 * 从 Node 中提取渲染尺寸。
 * 与 Canvas.tsx 中的 getNodeSize 保持逻辑一致（简化版）。
 */
function getNodeRenderSize(node: Node<CanvasNodeData>): {
  width: number;
  height: number;
} {
  const type = (node.data as CanvasNodeData).type;
  const fallback = FALLBACK_SIZES[type] ?? { width: 260, height: 170 };
  return {
    width: node.width || (node as any).measured?.width || fallback.width,
    height: node.height || (node as any).measured?.height || fallback.height,
  };
}

const FALLBACK_SIZES: Partial<
  Record<CanvasNodeData['type'], { width: number; height: number }>
> = {
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
  music: { width: 240, height: 170 },
  browser: { width: 920, height: 700 },
};
