'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { ReactFlowProvider } from 'reactflow';
import { useShallow } from 'zustand/react/shallow';
import { useCanvasStore, type CanvasNodeData } from '@/components/canvas/CanvasStore';
import type { PixiCanvasCore } from '@/components/canvas/pixi-canvas/PixiCanvasCore';
import type { PixiCanvasConfig } from '@/components/canvas/pixi-canvas/types';

// 只在前端加载 PixiJS 模块
const PixiCanvasCoreModule = () =>
  import('@/components/canvas/pixi-canvas/PixiCanvasCore');

const PIXI_CONFIG: Partial<PixiCanvasConfig> = {
  backgroundColor: 0x0d0d15,
  viewportPadding: 256,
  minZoom: 0.1,
  maxZoom: 2,
};

export default function PixiCanvasDemoClient() {
  const containerRef = useRef<HTMLDivElement>(null);
  const coreRef = useRef<PixiCanvasCore | null>(null);
  const [ready, setReady] = useState(false);
  const [fps, setFps] = useState(60);
  const [nodeCount, setNodeCount] = useState(0);
  const [storeNodeCount, setStoreNodeCount] = useState(0);

  // zustand store
  const storeNodes = useCanvasStore((s) => s.nodes);
  const storeEdges = useCanvasStore((s) => s.edges);
  const addNode = useCanvasStore((s) => s.addNode);
  const { setNodes, setEdges } = useCanvasStore(
    useShallow((s) => ({ setNodes: s.setNodes, setEdges: s.setEdges })),
  );

  // 初始化 PixiJS 引擎
  useEffect(() => {
    let destroyed = false;

    async function bootstrap() {
      if (!containerRef.current) return;

      const { PixiCanvasCore: Core } = await PixiCanvasCoreModule();
      if (destroyed) return;

      const core = new Core(PIXI_CONFIG);
      coreRef.current = core;

      try {
        await core.init(containerRef.current);
      } catch (err) {
        console.error('PixiCanvas init failed:', err);
        return;
      }

      if (destroyed) {
        core.destroy();
        return;
      }

      setReady(true);
    }

    bootstrap();

    return () => {
      destroyed = true;
      if (coreRef.current) {
        coreRef.current.destroy();
        coreRef.current = null;
      }
      setReady(false);
    };
  }, []);

  // 同步 store → PixiJS（每帧检查）
  useEffect(() => {
    if (!ready || !coreRef.current) return;

    const core = coreRef.current;

    let rafId: number;
    let lastSync = 0;
    const SYNC_INTERVAL = 50; // 20fps 同步即可（渲染层自己跑 60fps）

    function syncLoop() {
      const now = performance.now();
      if (now - lastSync >= SYNC_INTERVAL) {
        lastSync = now;

        // 映射 nodes
        const rns = storeNodes.map((n: any) => {
          const type = n.data?.type || 'prompt';
          const size = getNodeSize(n, type);
          return {
            id: n.id,
            type,
            x: n.position.x,
            y: n.position.y,
            width: size.width,
            height: size.height,
            selected: n.selected ?? false,
            color: NODE_COLORS[type] ?? 0x6366f1,
            label: (n.data?.label as string) || type,
            parentId: n.parentId,
            zIndex: n.zIndex ?? 0,
          };
        });

        core.syncNodes(rns);

        // 映射 edges
        const nodeMap = new Map(storeNodes.map((n: any) => [n.id, n]));
        const res = storeEdges.map((e: any) => {
          const sn = nodeMap.get(e.source);
          const tn = nodeMap.get(e.target);
          const ss = sn ? getNodeSize(sn, sn.data?.type) : { width: 120, height: 60 };
          const ts = tn ? getNodeSize(tn, tn.data?.type) : { width: 120, height: 60 };
          return {
            id: e.id,
            sourceX: (sn?.position.x ?? 0) + ss.width / 2,
            sourceY: (sn?.position.y ?? 0) + ss.height / 2,
            targetX: (tn?.position.x ?? 0) - ts.width / 2,
            targetY: (tn?.position.y ?? 0) + ts.height / 2,
            selected: false,
            dissolving: false,
            fading: false,
          };
        });

        core.syncEdges(res);
        setNodeCount(rns.length);
        setStoreNodeCount(storeNodes.length);
      }

      rafId = requestAnimationFrame(syncLoop);
    }

    rafId = requestAnimationFrame(syncLoop);

    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [ready, storeNodes, storeEdges]);

  // FPS 统计
  useEffect(() => {
    if (!ready) return;
    let frames = 0;
    let last = performance.now();
    let active = true;

    const tick = () => {
      if (!active) return;
      frames++;
      const now = performance.now();
      if (now - last >= 500) {
        setFps(Math.round(frames / ((now - last) / 1000)));
        frames = 0;
        last = now;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    return () => {
      active = false;
    };
  }, [ready]);

  // 添加测试节点
  const spawnNodes = useCallback(
    (count: number) => {
      const types: CanvasNodeData['type'][] = [
        'prompt',
        'image',
        'video',
        'agent',
        'material',
      ];
      for (let i = 0; i < count; i++) {
        const type = types[Math.floor(Math.random() * types.length)];
        addNode(type, {
          x: 200 + Math.random() * 7000,
          y: 200 + Math.random() * 5000,
        });
      }
    },
    [addNode],
  );

  const clearAll = useCallback(() => {
    setNodes([]);
    setEdges([]);
  }, [setNodes, setEdges]);

  const fitView = useCallback(() => {
    const core = coreRef.current;
    if (!core || storeNodes.length === 0) return;
    const rns = storeNodes.map((n: any) => {
      const type = n.data?.type || 'prompt';
      const size = getNodeSize(n, type);
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
    core.fitView(rns, 0.15);
  }, [storeNodes]);

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        background: '#0a0a10',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'Inter, system-ui, sans-serif',
        overflow: 'hidden',
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 20px',
          background: 'rgba(255,255,255,0.04)',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          flexShrink: 0,
          zIndex: 10,
        }}
      >
        <span
          style={{
            color: '#6366f1',
            fontWeight: 700,
            fontSize: 15,
          }}
        >
          PixiJS WebGL Canvas
        </span>
        <span style={{ color: '#666', fontSize: 12 }}>v8.18 · WebGL 2 · Production</span>

        <div style={{ flex: 1 }} />

        {/* FPS */}
        <StatBadge
          label="FPS"
          value={fps}
          ok={fps >= 55}
          warn={fps >= 30}
        />
        <StatBadge label="Nodes" value={storeNodeCount} neutral />
        <StatBadge
          label="Visible"
          value={nodeCount}
          neutral
        />

        <button
          onClick={() => spawnNodes(1)}
          style={btnStyle}
        >
          +1 Node
        </button>
        <button
          onClick={() => spawnNodes(50)}
          style={{ ...btnStyle, background: '#6366f1', color: '#fff' }}
        >
          +50 Nodes
        </button>
        <button
          onClick={() => spawnNodes(200)}
          style={{ ...btnStyle, background: '#5558e6', color: '#fff' }}
        >
          +200 Nodes
        </button>
        <button
          onClick={fitView}
          style={{ ...btnStyle, border: '1px solid rgba(255,255,255,0.15)' }}
        >
          Fit View
        </button>
        <button
          onClick={clearAll}
          style={{
            ...btnStyle,
            border: '1px solid rgba(239,68,68,0.3)',
            color: '#ef4444',
          }}
        >
          Clear
        </button>
      </div>

      {/* Canvas */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <div
          ref={containerRef}
          style={{ width: '100%', height: '100%' }}
        />

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
              pointerEvents: 'none',
            }}
          >
            Initializing WebGL canvas...
          </div>
        )}

        <div
          style={{
            position: 'absolute',
            bottom: 16,
            right: 16,
            color: 'rgba(255,255,255,0.3)',
            fontSize: 11,
            pointerEvents: 'none',
          }}
        >
          Scroll to zoom · Middle-drag/Space+drag to pan · Drag nodes
        </div>
      </div>
    </div>
  );
}

// ---- helpers ----

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
        background: 'rgba(0,0,0,0.4)',
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

function getNodeSize(
  node: any,
  type: string,
): { width: number; height: number } {
  const fallback = FALLBACK_SIZES[type] ?? { width: 260, height: 170 };
  return {
    width: node.width || node.measured?.width || fallback.width,
    height: node.height || node.measured?.height || fallback.height,
  };
}

const FALLBACK_SIZES: Record<string, { width: number; height: number }> = {
  prompt: { width: 240, height: 150 },
  image: { width: 260, height: 190 },
  video: { width: 280, height: 200 },
  agent: { width: 380, height: 520 },
  material: { width: 260, height: 190 },
  region: { width: 200, height: 120 },
  storyboard: { width: 320, height: 220 },
  panorama: { width: 360, height: 300 },
  topazEnhance: { width: 280, height: 420 },
  faceCompliance: { width: 260, height: 200 },
  music: { width: 240, height: 170 },
};

const NODE_COLORS: Record<string, number> = {
  prompt: 0x6366f1,
  image: 0xf97316,
  video: 0xef4444,
  agent: 0x8b5cf6,
  material: 0x10b981,
  region: 0xd4d4d8,
  storyboard: 0xf59e0b,
  panorama: 0x22c55e,
  topazEnhance: 0xa78bfa,
  faceCompliance: 0xec4899,
  music: 0x3b82f6,
};

const btnStyle: React.CSSProperties = {
  padding: '7px 14px',
  borderRadius: 8,
  border: 'none',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 600,
  background: 'rgba(255,255,255,0.08)',
  color: '#ccc',
};
