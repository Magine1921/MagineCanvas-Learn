'use client';

import { useCallback, useRef } from 'react';

/**
 * 画布缩放管理。
 * 从 Canvas.tsx 提取约 30 行 zoom 相关逻辑。
 *
 * 职责：
 * - 缩放百分比显示（含去抖：变化 < 0.25% 不更新 state，避免整树重渲）
 * - zoom-sharp 模式管理（zoom < 0.52 时追加 data-mc-zoom-sharp 属性优化渲染）
 */

const ZOOM_SHARP_THRESHOLD = 0.52;
const ZOOM_DISPLAY_HYSTERESIS = 0.0025;

export function useCanvasZoom(canvasRootRef: React.RefObject<HTMLDivElement | null>) {
  const zoomDisplayRef = useRef(1);
  const zoomSharpLowRef = useRef<boolean | null>(null);

  /** 更新 zoom 百分比（带 hysteresis，避免纯平移松手时不必要的 setState） */
  const commitZoomDisplay = useCallback(
    (nextZoom: number, setZoom: (z: number) => void) => {
      if (!Number.isFinite(nextZoom)) return;

      const shell = canvasRootRef.current;
      if (shell) {
        const low = nextZoom < ZOOM_SHARP_THRESHOLD;
        if (zoomSharpLowRef.current !== low) {
          zoomSharpLowRef.current = low;
          if (low) shell.setAttribute('data-mc-zoom-sharp', '');
          else shell.removeAttribute('data-mc-zoom-sharp');
        }
      }

      if (Math.abs(nextZoom - zoomDisplayRef.current) <= ZOOM_DISPLAY_HYSTERESIS) return;
      zoomDisplayRef.current = nextZoom;
      setZoom(nextZoom);
    },
    [canvasRootRef],
  );

  /** 平移/缩放过程中轻量更新（只维护 zoom-sharp attr，不更新 state） */
  const onViewportMove = useCallback(
    (zoom: number) => {
      if (!Number.isFinite(zoom)) return;
      const shell = canvasRootRef.current;
      if (!shell) return;
      const low = zoom < ZOOM_SHARP_THRESHOLD;
      if (zoomSharpLowRef.current === low) return;
      zoomSharpLowRef.current = low;
      if (low) shell.setAttribute('data-mc-zoom-sharp', '');
      else shell.removeAttribute('data-mc-zoom-sharp');
    },
    [canvasRootRef],
  );

  return {
    zoomDisplayRef,
    zoomSharpLowRef,
    ZOOM_SHARP_THRESHOLD,
    commitZoomDisplay,
    onViewportMove,
  };
}
