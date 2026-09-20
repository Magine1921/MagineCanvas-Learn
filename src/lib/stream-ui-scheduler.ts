/** 节流 UI 刷新：SSE 高频 chunk 时仍按帧/间隔更新界面 */
import { flushSync } from 'react-dom';

export function createStreamUiScheduler(flush: () => void, intervalMs = 16) {
  let rafId: number | null = null;
  let lastFlushAt = 0;

  const runFlush = () => {
    rafId = null;
    lastFlushAt = Date.now();
    flushSync(flush);
  };

  return {
    schedule() {
      const now = Date.now();
      if (now - lastFlushAt >= intervalMs) {
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        runFlush();
        return;
      }
      if (rafId !== null) return;
      rafId = requestAnimationFrame(runFlush);
    },
    flushNow() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      runFlush();
    },
    cancel() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    },
  };
}
