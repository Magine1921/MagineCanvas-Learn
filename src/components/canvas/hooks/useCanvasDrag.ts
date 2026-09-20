'use client';

import { useCallback, useRef } from 'react';
import type { Node } from 'reactflow';
import type { ReactFlowInstance } from 'reactflow';
import { useCanvasStore, type CanvasNodeData } from '../CanvasStore';
import { applyRegionReparenting } from '@/lib/region-reparent';

/**
 * 节点拖拽状态管理。
 * 从 Canvas.tsx 提取约 80 行拖拽相关逻辑。
 *
 * 关键性能决策：
 * - 拖拽中不做 updateNodeInternals（避免 getBoundingClientRect 强制重排）
 * - 拖拽结束后通过 rAF 链统一刷新手柄位置和视觉类名
 * - 使用代数计数器（commitSeq）丢弃过期的 rAF 回调，防止跨轮交错
 */

export function useCanvasDrag(
  reactFlowInstanceRef: React.MutableRefObject<ReactFlowInstance | null>,
  updateNodeInternals: (nodeIds: string[]) => void,
) {
  const isNodeDraggingRef = useRef(false);
  const dragStopSyncFrameRef = useRef<number | null>(null);
  const flowLayoutCommitSeqRef = useRef(0);
  const isFlowLayoutCommitRef = useRef(false);
  const nodeResizerLiveRef = useRef(false);

  // ---- 拖拽开始 ----
  const handleNodeDragStart = useCallback(() => {
    if (dragStopSyncFrameRef.current !== null) {
      window.cancelAnimationFrame(dragStopSyncFrameRef.current);
      dragStopSyncFrameRef.current = null;
    }
    useCanvasStore.getState().pushUndoSnapshot();
    flowLayoutCommitSeqRef.current += 1;
    isNodeDraggingRef.current = true;
  }, []);

  const handleSelectionDragStart = useCallback(() => {
    if (dragStopSyncFrameRef.current !== null) {
      window.cancelAnimationFrame(dragStopSyncFrameRef.current);
      dragStopSyncFrameRef.current = null;
    }
    useCanvasStore.getState().pushUndoSnapshot();
    flowLayoutCommitSeqRef.current += 1;
    isNodeDraggingRef.current = true;
  }, []);

  // ---- 拖拽中（noop：不做 DOM 测量） ----
  const handleNodeDrag = useCallback(() => {}, []);
  const handleSelectionDrag = useCallback(() => {}, []);

  // ---- 拖拽结束后提交 ----
  const commitNodesAfterDrag = useCallback(
    (reactFlowInstance: ReactFlowInstance | null, storeNodes: Node<CanvasNodeData>[]) => {
      if (dragStopSyncFrameRef.current !== null) {
        window.cancelAnimationFrame(dragStopSyncFrameRef.current);
      }

      const scheduledSeq = flowLayoutCommitSeqRef.current;
      dragStopSyncFrameRef.current = window.requestAnimationFrame(() => {
        dragStopSyncFrameRef.current = null;
        if (scheduledSeq !== flowLayoutCommitSeqRef.current) return;

        isFlowLayoutCommitRef.current = true;
        let nextNodes = (reactFlowInstance?.getNodes() || storeNodes) as Node<CanvasNodeData>[];
        nextNodes = applyRegionReparenting(nextNodes);

        useCanvasStore.getState().setNodes(nextNodes);

        // 下一帧刷新手柄
        window.requestAnimationFrame(() => {
          if (scheduledSeq !== flowLayoutCommitSeqRef.current) {
            isFlowLayoutCommitRef.current = false;
            return;
          }
          const inst = reactFlowInstanceRef.current;
          const ids = inst?.getNodes().map((n) => n.id) ?? nextNodes.map((n) => n.id);
          if (ids.length) updateNodeInternals(ids);
          isFlowLayoutCommitRef.current = false;
        });
      });
    },
    [updateNodeInternals, reactFlowInstanceRef],
  );

  const handleNodeDragStop = useCallback(
    (reactFlowInstance: ReactFlowInstance | null, storeNodes: Node<CanvasNodeData>[]) => {
      isNodeDraggingRef.current = false;
      commitNodesAfterDrag(reactFlowInstance, storeNodes);
    },
    [commitNodesAfterDrag],
  );

  const handleSelectionDragStop = useCallback(
    (reactFlowInstance: ReactFlowInstance | null, storeNodes: Node<CanvasNodeData>[]) => {
      isNodeDraggingRef.current = false;
      commitNodesAfterDrag(reactFlowInstance, storeNodes);
    },
    [commitNodesAfterDrag],
  );

  return {
    isNodeDraggingRef,
    nodeResizerLiveRef,
    flowLayoutCommitSeqRef,
    isFlowLayoutCommitRef,
    dragStopSyncFrameRef,
    handleNodeDragStart,
    handleNodeDrag,
    handleNodeDragStop,
    handleSelectionDragStart,
    handleSelectionDrag,
    handleSelectionDragStop,
    commitNodesAfterDrag,
  };
}
