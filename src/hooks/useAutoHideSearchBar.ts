'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** 无键盘/指针/输入交互 idleMs 后收起；展开后重新计时。 */
export function useAutoHideSearchBar(idleMs = 10_000, active = true) {
  const [collapsed, setCollapsed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const scheduleCollapse = useCallback(() => {
    clearTimer();
    if (!active) return;
    timerRef.current = setTimeout(() => {
      setCollapsed(true);
      timerRef.current = null;
    }, idleMs);
  }, [active, clearTimer, idleMs]);

  const bump = useCallback(() => {
    if (!active) return;
    setCollapsed(false);
    scheduleCollapse();
  }, [active, scheduleCollapse]);

  const expand = useCallback(() => {
    if (!active) return;
    setCollapsed(false);
    scheduleCollapse();
  }, [active, scheduleCollapse]);

  useEffect(() => {
    if (!active) {
      clearTimer();
      const id = requestAnimationFrame(() => {
        setCollapsed(false);
      });
      return () => {
        cancelAnimationFrame(id);
        clearTimer();
      };
    }
    scheduleCollapse();
    return clearTimer;
  }, [active, clearTimer, scheduleCollapse]);

  const searchShellHandlers = {
    onPointerDownCapture: bump,
    onKeyDownCapture: bump,
    onFocusCapture: bump,
  } as const;

  return { collapsed, bump, expand, searchShellHandlers };
}
