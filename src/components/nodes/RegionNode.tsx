'use client';

import { memo } from 'react';
import { NodeProps, NodeResizer } from 'reactflow';
import { BoxSelect } from 'lucide-react';
import { useCanvasStore, CanvasNodeData } from '../canvas/CanvasStore';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';

export interface RegionNodeData extends CanvasNodeData {
  regionName?: string;
  regionWidth?: number;
  regionHeight?: number;
  regionLabelFontPx?: number;
}

function RegionNode({ id, data, selected }: NodeProps<CanvasNodeData>) {
  const nodeData = data as RegionNodeData;
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const updateRegionGeometry = useCanvasStore((state) => state.updateRegionGeometry);

  const name = typeof nodeData.regionName === 'string' ? nodeData.regionName : '未命名区域';
  const labelPx =
    typeof nodeData.regionLabelFontPx === 'number' &&
    nodeData.regionLabelFontPx >= 10 &&
    nodeData.regionLabelFontPx <= 28
      ? nodeData.regionLabelFontPx
      : 12;

  const commitName = (raw: string) => {
    const next = raw.trim() || '未命名区域';
    updateNodeData(id, { regionName: next, label: next });
  };

  return (
    <div className="mc-region-root relative h-full min-h-[48px] w-full min-w-[80px]">
      <NodeResizer
        nodeId={id}
        isVisible={selected}
        minWidth={80}
        minHeight={48}
        color="rgba(255,255,255,0.35)"
        lineClassName="!border-0 !bg-transparent opacity-0"
        handleClassName="!h-2.5 !w-2.5 !rounded-sm !border !border-white/35 !bg-[#1b2021]/90 !shadow-[0_0_10px_rgba(255,255,255,0.12)]"
        onResizeEnd={(_, p) => {
          updateRegionGeometry(id, { x: p.x, y: p.y, width: p.width, height: p.height });
        }}
      />

      <div
        className="pointer-events-auto absolute z-[2] flex w-[220px] cursor-default flex-col gap-1.5"
        style={{ left: 0, bottom: '100%', marginBottom: 6 }}
      >
        <div className="flex min-w-0 items-end gap-2">
          <span className="mb-0.5 flex h-6 w-6 shrink-0 cursor-default items-center justify-center rounded-md border border-white/18 bg-white/[0.07] text-zinc-100/90">
            <BoxSelect className="h-3 w-3" />
          </span>
          <div className="min-w-0 flex-1 cursor-text">
            <Input
              value={name}
              onChange={(e) => updateNodeData(id, { regionName: e.target.value, label: e.target.value })}
              onBlur={(e) => commitName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.blur();
                }
              }}
              placeholder="区域名称…"
              maxLength={80}
              style={{ fontSize: labelPx }}
              className="nodrag nopan nowheel h-auto w-full min-w-0 cursor-text border-0 border-b border-white/25 bg-transparent px-0 py-0.5 font-medium text-zinc-100 shadow-none outline-none ring-0 placeholder:text-zinc-500 focus-visible:ring-0"
            />
          </div>
        </div>
        <label className="nodrag nopan nowheel flex w-full min-w-0 cursor-default items-center gap-2 text-[10px] text-zinc-500">
          <span className="shrink-0">字号</span>
          <input
            type="range"
            min={10}
            max={28}
            step={1}
            value={labelPx}
            onChange={(e) =>
              updateNodeData(id, { regionLabelFontPx: Number.parseInt(e.target.value, 10) || 12 })
            }
            className="mc-region-font-range h-1 min-w-0 flex-1 cursor-ew-resize accent-white/70"
          />
          <span className="w-6 shrink-0 cursor-default tabular-nums text-zinc-400">{labelPx}</span>
        </label>
      </div>

      <div
        className={cn(
          'mc-node-glass-shell pointer-events-none relative h-full w-full rounded-lg border bg-white/[0.03]',
          selected
            ? 'border-white/40 shadow-[0_0_0_1px_rgba(255,255,255,0.1),0_0_26px_rgba(255,255,255,0.1)]'
            : 'border-white/22'
        )}
      />
    </div>
  );
}

export default memo(RegionNode);
