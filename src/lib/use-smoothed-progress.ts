'use client';

import { useEffect, useRef, useState } from 'react';

function clampProgress(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

export function useSmoothedProgress(value: unknown): number {
  const target = clampProgress(value);
  const [display, setDisplay] = useState(target);
  const displayRef = useRef(target);
  const targetRef = useRef(target);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (target <= 0) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      targetRef.current = 0;
      displayRef.current = 0;
      setDisplay(0);
      return;
    }

    if (target < displayRef.current) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      targetRef.current = target;
      displayRef.current = target;
      setDisplay(target);
      return;
    }

    targetRef.current = target;

    const tick = () => {
      const current = displayRef.current;
      const nextTarget = targetRef.current;
      const diff = nextTarget - current;

      if (Math.abs(diff) < 0.15) {
        displayRef.current = nextTarget;
        setDisplay(nextTarget);
        rafRef.current = null;
        return;
      }

      const step = Math.max(0.08, Math.min(0.9, Math.abs(diff) * 0.045));
      const next = current + Math.sign(diff) * step;
      displayRef.current = next;
      setDisplay(next);
      rafRef.current = requestAnimationFrame(tick);
    };

    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(tick);
    }

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [target]);

  return display;
}
