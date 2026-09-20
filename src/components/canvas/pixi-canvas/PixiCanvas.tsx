'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { PixiCanvasCore } from './PixiCanvasCore';
import { usePixiStoreBridge } from './usePixiStoreBridge';
import type { PixiCanvasConfig } from './types';

/**
 * PixiJS 无限画布 React 组件。
 *
 * 替代 React Flow 的渲染层，使用 WebGL 渲染节点和边。
 * React 仅负责：
 * 1. 挂载 PixiJS Application 到 DOM
 * 2. 通过 usePixiStoreBridge 订阅 zustand store 并同步到 PixiJS
 * 3. 渲染 UI 覆盖层（zoom controls, minimap, menus）
 *
 * 与 React Flow 版本的关系：
 * - 数据层 (CanvasStore) 完全复用，无需修改
 * - 节点组件 (PromptNode, ImageNode 等) 的复杂 UI 由 DOM overlay 渲染
 * - 当前版本渲染简化节点外观（纯色矩形+文字），完整版可扩展为 Texture 渲染
 *
 * 边界情况：
 * - SSR 安全：仅在客户端渲染
 * - 窗口大小变化：PixiJS Application.resizeTo 自动处理
 * - 组件卸载：正确销毁 PixiJS Application，释放 WebGL 上下文
 * - DPR 变化（外接显示器）：通过 resolution + autoDensity 处理
 */
export default function PixiCanvas({
  config,
  showStats = false,
  className,
}: {
  config?: Partial<PixiCanvasConfig>;
  showStats?: boolean;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const coreRef = useRef<PixiCanvasCore | null>(null);
  const [ready, setReady] = useState(false);
  const [fps, setFps] = useState(60);
  const [nodeCount, setNodeCount] = useState(0);
  const initRef = useRef(false);

  // 初始化 PixiJS Application
  useEffect(() => {
    if (initRef.current || !containerRef.current) return;
    initRef.current = true;

    let destroyed = false;

    async function bootstrap() {
      if (destroyed || !containerRef.current) return;

      const core = new PixiCanvasCore(config);
      coreRef.current = core;

      try {
        await core.init(containerRef.current, {
          // 初始回调留空，由 usePixiStoreBridge 注入
        });
      } catch (err) {
        console.error('PixiCanvas init failed:', err);
        return;
      }

      if (destroyed) {
        core.destroy();
        return;
      }

      setReady(true);

      // FPS 统计
      if (showStats) {
        let frames = 0;
        let last = performance.now();
        const tick = () => {
          if (destroyed) return;
          frames++;
          const now = performance.now();
          if (now - last >= 500) {
            setFps(Math.round(frames / ((now - last) / 1000)));
            setNodeCount(core.nodeRenderer.mountedCount);
            frames = 0;
            last = now;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }
    }

    bootstrap();

    return () => {
      destroyed = true;
      if (coreRef.current) {
        coreRef.current.destroy();
        coreRef.current = null;
      }
      initRef.current = false;
      setReady(false);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 桥接 zustand store → PixiJS
  const { fitView, getZoom } = usePixiStoreBridge(coreRef.current);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest('input, textarea, select, [contenteditable="true"]'))
        return;

      if (e.key === '0' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        fitView();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [fitView]);

  const handleFitView = useCallback(() => fitView(), [fitView]);

  return (
    <div
      className={className}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        background: '#0d0d15',
      }}
    >
      {/* PixiJS canvas container */}
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%' }}
      />

      {/* 加载状态 */}
      {!ready && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'rgba(255,255,255,0.4)',
            fontSize: 14,
            fontFamily: 'Inter, system-ui, sans-serif',
            pointerEvents: 'none',
          }}
        >
          Initializing WebGL canvas...
        </div>
      )}

      {/* FPS / Stats overlay */}
      {showStats && ready && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            display: 'flex',
            gap: 12,
            fontFamily: 'Inter, monospace',
            fontSize: 12,
            zIndex: 100,
          }}
        >
          <StatBadge
            label="FPS"
            value={fps}
            ok={fps >= 55}
            warn={fps >= 30}
          />
          <StatBadge label="Nodes" value={nodeCount} neutral />
          <StatBadge label="Zoom" value={`${Math.round(getZoom() * 100)}%`} neutral />
        </div>
      )}

      {/* Bottom-left: fit view button */}
      {ready && (
        <div
          style={{
            position: 'absolute',
            bottom: 16,
            left: 16,
            display: 'flex',
            gap: 8,
            zIndex: 100,
          }}
        >
          <button
            onClick={handleFitView}
            title="Fit view (Ctrl+0)"
            style={{
              padding: '6px 14px',
              borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(255,255,255,0.06)',
              color: '#ccc',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'Inter, system-ui, sans-serif',
            }}
          >
            Fit View
          </button>
        </div>
      )}

      {/* Hint overlay */}
      {ready && (
        <div
          style={{
            position: 'absolute',
            bottom: 16,
            right: 16,
            color: 'rgba(255,255,255,0.3)',
            fontSize: 11,
            fontFamily: 'Inter, system-ui, sans-serif',
            pointerEvents: 'none',
            zIndex: 100,
          }}
        >
          Scroll to zoom &middot; Middle-drag/Space+drag to pan &middot; Drag nodes to move
        </div>
      )}
    </div>
  );
}

/** 微小组件：统计标签 */
function StatBadge({
  label,
  value,
  ok,
  warn,
  neutral,
}: {
  label: string;
  value: string | number;
  ok?: boolean;
  warn?: boolean;
  neutral?: boolean;
}) {
  const color = neutral
    ? '#999'
    : ok
      ? '#10b981'
      : (warn ?? false)
        ? '#f59e0b'
        : '#ef4444';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 6,
        background: 'rgba(0,0,0,0.6)',
        border: `1px solid ${color}44`,
      }}
    >
      <span style={{ color: '#888', fontSize: 10 }}>{label}</span>
      <span
        style={{
          color,
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </span>
    </div>
  );
}
