'use client';

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import type { Edge } from 'reactflow';

/**
 * 画布边（连线）的选中、渐隐、溶解动画状态管理。
 * 从 Canvas.tsx 提取，约 120 行 → 独立 hook。
 *
 * 行为：
 * - Ctrl/Cmd + 点击边：多选/取消选中
 * - 点击已选中的边（无修饰键）：断开所有已选边
 * - 点画布空白区：已选边渐变回常态（fading, 700ms）
 * - 断开边：先播放溶解动画（dissolving, 640ms）再移除
 */

const MC_EDGE_PANE_FADE_MS = 700;
const MC_EDGE_DISSOLVE_MS = 640;

/** 已是空数组时返回原引用，避免不必要的状态更新 */
function keepIfEmpty<T>(prev: T[]): T[] {
  return prev.length === 0 ? prev : [];
}

export function useCanvasEdges(onEdgesChange: (changes: { type: 'remove'; id: string }[]) => void) {
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const [fadingEdgeIds, setFadingEdgeIds] = useState<string[]>([]);
  const [dissolvingEdgeIds, setDissolvingEdgeIds] = useState<string[]>([]);

  const pendingEdgeRemovalsRef = useRef<string[]>([]);
  const edgeDissolveTimerRef = useRef<number | null>(null);
  const edgePaneFadeTimerRef = useRef<number | null>(null);

  // ---- 清理定时器 ----
  const clearDissolveTimer = useCallback(() => {
    if (edgeDissolveTimerRef.current !== null) {
      clearTimeout(edgeDissolveTimerRef.current);
      edgeDissolveTimerRef.current = null;
    }
  }, []);

  const clearPaneFadeTimer = useCallback(() => {
    if (edgePaneFadeTimerRef.current !== null) {
      clearTimeout(edgePaneFadeTimerRef.current);
      edgePaneFadeTimerRef.current = null;
    }
  }, []);

  // 组件卸载清理
  useEffect(() => {
    return () => {
      clearDissolveTimer();
      clearPaneFadeTimer();
      const pending = pendingEdgeRemovalsRef.current;
      pendingEdgeRemovalsRef.current = [];
      if (pending.length > 0) {
        onEdgesChange(pending.map((id) => ({ type: 'remove', id })));
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- 排空待移除的边 ----
  const flushPendingRemovals = useCallback(() => {
    clearDissolveTimer();
    const toRemove = pendingEdgeRemovalsRef.current;
    pendingEdgeRemovalsRef.current = [];
    setDissolvingEdgeIds((prev) => {
      if (toRemove.length > 0) return [];
      return keepIfEmpty(prev);
    });
    if (toRemove.length > 0) {
      onEdgesChange(toRemove.map((id) => ({ type: 'remove', id })));
    }
  }, [clearDissolveTimer, onEdgesChange]);

  // ---- 安排边移除（先播溶解动画） ----
  const scheduleEdgeRemovals = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      flushPendingRemovals();
      pendingEdgeRemovalsRef.current = ids;
      setDissolvingEdgeIds(ids);
      edgeDissolveTimerRef.current = window.setTimeout(() => {
        edgeDissolveTimerRef.current = null;
        const pending = pendingEdgeRemovalsRef.current;
        pendingEdgeRemovalsRef.current = [];
        setDissolvingEdgeIds(keepIfEmpty);
        if (pending.length > 0) {
          onEdgesChange(pending.map((id) => ({ type: 'remove', id })));
        }
      }, MC_EDGE_DISSOLVE_MS);
    },
    [flushPendingRemovals, onEdgesChange],
  );

  // ---- 点画布空白区：已选边渐变 ----
  const handlePaneClick = useCallback(() => {
    flushPendingRemovals();
    clearPaneFadeTimer();
    if (selectedEdgeIds.length > 0) {
      setFadingEdgeIds([...selectedEdgeIds]);
      setSelectedEdgeIds([]);
      edgePaneFadeTimerRef.current = window.setTimeout(() => {
        edgePaneFadeTimerRef.current = null;
        setFadingEdgeIds(keepIfEmpty);
      }, MC_EDGE_PANE_FADE_MS);
    } else {
      setFadingEdgeIds(keepIfEmpty);
    }
  }, [clearPaneFadeTimer, flushPendingRemovals, selectedEdgeIds]);

  // ---- 边点击 ----
  const handleEdgeClick = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      event.stopPropagation();
      flushPendingRemovals();
      clearPaneFadeTimer();
      setFadingEdgeIds(keepIfEmpty);

      if (event.ctrlKey || event.metaKey) {
        setSelectedEdgeIds((prev) =>
          prev.includes(edge.id) ? prev.filter((id) => id !== edge.id) : [...prev, edge.id],
        );
        return;
      }

      if (selectedEdgeIds.includes(edge.id) && selectedEdgeIds.length > 0) {
        const toRemove = [...selectedEdgeIds];
        setSelectedEdgeIds([]);
        scheduleEdgeRemovals(toRemove);
        return;
      }

      setSelectedEdgeIds([edge.id]);
    },
    [clearPaneFadeTimer, flushPendingRemovals, scheduleEdgeRemovals, selectedEdgeIds],
  );

  // ---- store edges 变化时清理已删除边的状态 ----
  const syncFromStore = useCallback((storeEdges: Edge[]) => {
    const ids = new Set(storeEdges.map((e) => e.id));
    setSelectedEdgeIds((prev) => (prev.some((id) => !ids.has(id)) ? prev.filter((id) => ids.has(id)) : prev));
    setFadingEdgeIds((prev) => (prev.some((id) => !ids.has(id)) ? prev.filter((id) => ids.has(id)) : prev));
    setDissolvingEdgeIds((prev) => {
      const next = prev.filter((id) => ids.has(id));
      if (next.length !== prev.length) {
        pendingEdgeRemovalsRef.current = pendingEdgeRemovalsRef.current.filter((id) => ids.has(id));
      }
      return next.length === prev.length ? prev : next;
    });
  }, []);

  // ---- memoized sets ----
  const selectedEdgeIdSet = useMemo(() => new Set(selectedEdgeIds), [selectedEdgeIds]);
  const fadingEdgeIdSet = useMemo(() => new Set(fadingEdgeIds), [fadingEdgeIds]);
  const dissolvingEdgeIdSet = useMemo(() => new Set(dissolvingEdgeIds), [dissolvingEdgeIds]);

  return {
    selectedEdgeIds,
    selectedEdgeIdSet,
    fadingEdgeIdSet,
    dissolvingEdgeIdSet,
    handleEdgeClick,
    handlePaneClick,
    scheduleEdgeRemovals,
    flushPendingRemovals,
    clearPaneFadeTimer,
    syncFromStore,
  };
}
