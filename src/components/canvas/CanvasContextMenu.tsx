'use client';

import { cn } from '@/lib/utils';

interface CanvasContextMenuProps {
  position: { x: number; y: number };
  onClose: () => void;
  onUpload: () => void;
  onAddNode: () => void;
  canSaveWorkflowPreset?: boolean;
  onSaveWorkflowPreset?: () => void;
  canBatchSaveMedia?: boolean;
  onBatchSaveMedia?: () => void;
  onArrangeCanvas: () => void;
}

interface MenuItem {
  label: string;
  action: () => void;
  separated?: boolean;
}

const itemButtonClass =
  'flex h-11 w-full items-center rounded-lg px-3.5 text-left text-sm font-medium text-zinc-100 transition-colors hover:bg-white/[0.1] active:bg-white/[0.08]';

export default function CanvasContextMenu({
  position,
  onClose,
  onUpload,
  onAddNode,
  canSaveWorkflowPreset = false,
  onSaveWorkflowPreset,
  canBatchSaveMedia = false,
  onBatchSaveMedia,
  onArrangeCanvas,
}: CanvasContextMenuProps) {
  const items: MenuItem[] = [
    { label: '上传', action: onUpload },
    { label: '添加节点', action: onAddNode, separated: true },
    ...(canSaveWorkflowPreset && onSaveWorkflowPreset
      ? [{ label: '保存工作流预设', action: onSaveWorkflowPreset, separated: true }]
      : []),
    ...(canBatchSaveMedia && onBatchSaveMedia
      ? [{ label: '批量保存', action: onBatchSaveMedia, separated: true }]
      : []),
    { label: '一键整理画布', action: onArrangeCanvas, separated: true },
  ];

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      />

      <div
        className="mc-popover fixed z-50 w-[238px] overflow-hidden rounded-xl border border-white/12 bg-[#1c1e20]/92 p-1.5 shadow-2xl shadow-black/50 backdrop-blur-2xl"
        style={{ left: position.x, top: position.y }}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
      >
        {items.map((item) => (
          <div key={item.label}>
            {item.separated ? <div className="my-1 h-px bg-white/10" /> : null}
            <button
              type="button"
              onClick={() => {
                item.action();
                onClose();
              }}
              className={cn(itemButtonClass)}
            >
              {item.label}
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
