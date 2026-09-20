'use client';

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { useStoreApi } from 'reactflow';
import { cn } from '@/lib/utils';

type PanelPosition = {
  left: number;
  top: number;
  nodeId: string;
};

interface ScreenSpaceNodePanelProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  anchorRef: RefObject<HTMLElement | null>;
  children: ReactNode;
  className?: string;
  width?: number;
  gap?: number;
}

export function ScreenSpaceNodePanel({
  anchorRef,
  children,
  className,
  width = 660,
  gap = 16,
  ...panelProps
}: ScreenSpaceNodePanelProps) {
  const storeApi = useStoreApi();
  const frameRef = useRef<number | null>(null);
  const lastTransformRef = useRef<[number, number, number] | null>(null);
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState<PanelPosition | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useLayoutEffect(() => {
    const updatePosition = () => {
      const anchor = anchorRef.current;
      if (!anchor) {
        setPosition(null);
        return;
      }

      const rect = anchor.getBoundingClientRect();
      const nodeId = anchor.closest<HTMLElement>('.react-flow__node')?.dataset.id || '';
      const nextPosition = {
        left: Math.round(rect.left + rect.width / 2 - width / 2),
        top: Math.round(rect.bottom + gap),
        nodeId,
      };
      setPosition((current) => {
        if (
          current?.left === nextPosition.left &&
          current.top === nextPosition.top &&
          current.nodeId === nextPosition.nodeId
        ) return current;
        return nextPosition;
      });
    };

    const scheduleUpdate = () => {
      if (frameRef.current !== null) return;
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        updatePosition();
      });
    };

    updatePosition();
    lastTransformRef.current = storeApi.getState().transform;
    const unsubscribe = storeApi.subscribe((state) => {
      const next = state.transform;
      const prev = lastTransformRef.current;
      if (!prev || next[0] !== prev[0] || next[1] !== prev[1] || next[2] !== prev[2]) {
        lastTransformRef.current = next;
        scheduleUpdate();
      }
    });

    const resizeObserver =
      typeof ResizeObserver !== 'undefined' && anchorRef.current
        ? new ResizeObserver(scheduleUpdate)
        : null;
    if (resizeObserver && anchorRef.current) resizeObserver.observe(anchorRef.current);

    const nodeElement = anchorRef.current?.closest('.react-flow__node');
    const positionObserver =
      typeof MutationObserver !== 'undefined' && nodeElement
        ? new MutationObserver(scheduleUpdate)
        : null;
    if (positionObserver && nodeElement) {
      positionObserver.observe(nodeElement, {
        attributes: true,
        attributeFilter: ['class', 'style'],
      });
    }

    window.addEventListener('resize', scheduleUpdate);
    window.addEventListener('scroll', scheduleUpdate, true);

    return () => {
      unsubscribe();
      resizeObserver?.disconnect();
      positionObserver?.disconnect();
      window.removeEventListener('resize', scheduleUpdate);
      window.removeEventListener('scroll', scheduleUpdate, true);
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [anchorRef, gap, storeApi, width]);

  if (!mounted || !position) return null;

  return createPortal(
    <div
      {...panelProps}
      data-screen-space-node-id={position.nodeId || undefined}
      className={cn('mc-node-screen-edit-panel fixed z-[40] will-change-[left,top]', className)}
      style={{ left: position.left, top: position.top, width }}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      {children}
    </div>,
    document.body
  );
}
