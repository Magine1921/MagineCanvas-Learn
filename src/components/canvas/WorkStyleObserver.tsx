'use client';

import { useEffect, useRef } from 'react';
import { useCanvasStore } from '@/components/canvas/CanvasStore';
import { recordCanvasWorkEvent, useCanvasWorkStyleStore } from '@/lib/canvas-work-style';

const REFLECT_INTERVAL_MS = 15 * 60 * 1000;
const MIN_EVENTS_FOR_REFLECT = 8;

/** 订阅画布变化，采集工作风格并在空闲时写入 Agent 记忆。 */
export function WorkStyleObserver() {
  const prevNodesRef = useRef(useCanvasStore.getState().nodes);
  const prevEdgesRef = useRef(useCanvasStore.getState().edges);

  useEffect(() => {
    const unsub = useCanvasStore.subscribe((state) => {
      const prevNodes = prevNodesRef.current;
      const prevEdges = prevEdgesRef.current;

      if (state.nodes.length > prevNodes.length) {
        const added = state.nodes.filter((n) => !prevNodes.some((p) => p.id === n.id));
        for (const n of added.slice(0, 3)) {
          const type = String(n.data?.type || n.type || 'unknown');
          recordCanvasWorkEvent('node_add', `${type}:${n.data?.label || ''}`.slice(0, 80));
        }
      } else if (state.nodes.length < prevNodes.length) {
        recordCanvasWorkEvent('node_remove', `removed ${prevNodes.length - state.nodes.length}`);
      }

      if (state.edges.length > prevEdges.length) {
        recordCanvasWorkEvent('connect', `+${state.edges.length - prevEdges.length} edges`);
      }

      prevNodesRef.current = state.nodes;
      prevEdgesRef.current = state.edges;
    });

    return unsub;
  }, []);

  useEffect(() => {
    const tick = () => {
      const { events, lastReflectAt, reflectToMemory } = useCanvasWorkStyleStore.getState();
      if (events.length < MIN_EVENTS_FOR_REFLECT) return;
      if (Date.now() - lastReflectAt < REFLECT_INTERVAL_MS) return;
      reflectToMemory();
    };

    const id = window.setInterval(tick, REFLECT_INTERVAL_MS);
    const onHide = () => {
      const { events, reflectToMemory } = useCanvasWorkStyleStore.getState();
      if (events.length >= MIN_EVENTS_FOR_REFLECT) reflectToMemory();
    };
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) onHide();
    });

    return () => {
      window.clearInterval(id);
    };
  }, []);

  return null;
}
