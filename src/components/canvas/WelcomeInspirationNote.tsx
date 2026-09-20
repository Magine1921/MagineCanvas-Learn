'use client';

import { useRef } from 'react';
import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from 'react';
import { GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MC_CHROME_ENTRANCE_SCALE_START, MC_CHROME_ENTRANCE_TF } from '@/lib/motion';

export type InspirationLayout = {
  docked: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
};

export const DEFAULT_INSPIRATION_LAYOUT: InspirationLayout = {
  docked: true,
  x: 0,
  y: 0,
  w: 508,
  h: 136,
};

const MIN_W = 280;
const MIN_H = 120;
const DOCK_DRAG_THRESHOLD = 8;
const DOCK_ZONE_PAD = 28;
const DOCK_OVERLAP_RATIO = 0.18;

function dockZoneRect(section: DOMRect, noteHeight: number) {
  const h = Math.max(MIN_H, noteHeight);
  return { left: section.left, top: section.top, width: section.width, height: h };
}

function noteOverlapRatio(note: DOMRect, zone: ReturnType<typeof dockZoneRect>): number {
  const zr = {
    left: zone.left,
    top: zone.top,
    right: zone.left + zone.width,
    bottom: zone.top + zone.height,
  };
  const xx = Math.max(note.left, zr.left);
  const yy = Math.max(note.top, zr.top);
  const ww = Math.min(note.right, zr.right) - xx;
  const hh = Math.min(note.bottom, zr.bottom) - yy;
  if (ww <= 0 || hh <= 0) return 0;
  const noteA = note.width * note.height;
  return noteA > 0 ? (ww * hh) / noteA : 0;
}

function noteCenterInDockZone(
  note: DOMRect,
  zone: ReturnType<typeof dockZoneRect>,
  pad: number
): boolean {
  const cx = (note.left + note.right) / 2;
  const cy = (note.top + note.bottom) / 2;
  return (
    cx >= zone.left - pad &&
    cx <= zone.left + zone.width + pad &&
    cy >= zone.top - pad &&
    cy <= zone.top + zone.height + pad
  );
}

function trySnapDockIfOverTarget(
  cur: InspirationLayout,
  dockTargetRef: RefObject<HTMLElement | null> | undefined,
  onLayoutChange: (next: InspirationLayout) => void
) {
  if (cur.docked || !dockTargetRef?.current) return;
  const sec = dockTargetRef.current.getBoundingClientRect();
  const nr = new DOMRect(cur.x, cur.y, cur.w, cur.h);
  const zone = dockZoneRect(sec, cur.h);
  const shouldDock =
    noteCenterInDockZone(nr, zone, DOCK_ZONE_PAD) ||
    noteOverlapRatio(nr, zone) >= DOCK_OVERLAP_RATIO;
  if (!shouldDock) return;
  onLayoutChange({
    docked: true,
    x: 0,
    y: 0,
    w: Math.max(MIN_W, Math.round(sec.width)),
    h: cur.h,
  });
}

/** 浮窗 layout 与右侧栏几何 → 槽位预览高度（0～h），供拖拽过程中项目区实时让位 */
function slotPreviewHeightFromFloatingLayout(
  layout: InspirationLayout,
  sectionEl: HTMLElement | null
): number {
  if (layout.docked || typeof DOMRect === 'undefined' || !sectionEl) return 0;
  const sec = sectionEl.getBoundingClientRect();
  const nr = new DOMRect(layout.x, layout.y, layout.w, layout.h);
  const zone = dockZoneRect(sec, layout.h);
  const overlap = noteOverlapRatio(nr, zone);
  let factor = Math.min(1, overlap / 0.2);
  if (noteCenterInDockZone(nr, zone, DOCK_ZONE_PAD + 32)) {
    factor = Math.max(factor, 0.45);
  }
  factor = Math.max(0, Math.min(1, factor));
  factor = factor * factor * (3 - 2 * factor);
  return Math.round(layout.h * factor);
}

type MoveSession = {
  ptr0: { x: number; y: number };
  anchor: { left: number; top: number; w: number; h: number } | null;
  startedDocked: boolean;
};

type ResizeSession = {
  ptr0: { x: number; y: number };
  w0: number;
  h0: number;
};

type Props = {
  layout: InspirationLayout;
  onLayoutChange: (next: InspirationLayout) => void;
  text: string;
  onTextChange: (next: string) => void;
  /** 欢迎页右侧栏：用于松手时判断是否拖回吸附位 */
  dockTargetRef?: RefObject<HTMLElement | null>;
  /** 拖拽/缩放浮窗时实时预留槽位高度，驱动项目区让位 */
  onSlotPreviewHeightChange?: (heightPx: number) => void;
  /** 浮窗交互中（拖拽或缩放）为 true，用于槽位 transition 与 pointerup 收尾 */
  onFloatDragActiveChange?: (active: boolean) => void;
  /** 欢迎页入场结束后再允许浮窗交互（入场时自右侧滑入） */
  chromeReveal?: boolean;
};

function clampFloating(l: InspirationLayout): InspirationLayout {
  if (typeof window === 'undefined') return l;
  const w = Math.min(window.innerWidth - 16, Math.max(MIN_W, l.w));
  const h = Math.min(window.innerHeight - 16, Math.max(MIN_H, l.h));
  const x = Math.min(Math.max(8, l.x), Math.max(8, window.innerWidth - w - 8));
  const y = Math.min(Math.max(8, l.y), Math.max(8, window.innerHeight - h - 8));
  return { docked: false, x, y, w, h };
}

export function WelcomeInspirationNote({
  layout,
  onLayoutChange,
  text,
  onTextChange,
  dockTargetRef,
  onSlotPreviewHeightChange,
  onFloatDragActiveChange,
  chromeReveal = true,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const emitSlotPreview = (floatingLayout: InspirationLayout) => {
    if (!onSlotPreviewHeightChange) return;
    const sec = dockTargetRef?.current ?? null;
    onSlotPreviewHeightChange(slotPreviewHeightFromFloatingLayout(floatingLayout, sec));
  };

  const onHeaderPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    onFloatDragActiveChange?.(true);
    const L = layoutRef.current;
    const moveSession: MoveSession = {
      ptr0: { x: e.clientX, y: e.clientY },
      anchor: L.docked ? null : { left: L.x, top: L.y, w: L.w, h: L.h },
      startedDocked: L.docked,
    };

    let lastApplied = L;
    const onMove = (ev: PointerEvent) => {
      let ax = moveSession.anchor;
      if (!ax) {
        const dx0 = ev.clientX - moveSession.ptr0.x;
        const dy0 = ev.clientY - moveSession.ptr0.y;
        if (moveSession.startedDocked) {
          if (dx0 * dx0 + dy0 * dy0 < DOCK_DRAG_THRESHOLD * DOCK_DRAG_THRESHOLD) return;
          const r = rootRef.current?.getBoundingClientRect();
          if (!r) return;
          ax = { left: r.left, top: r.top, w: r.width, h: r.height };
          moveSession.anchor = ax;
        } else {
          ax = { left: L.x, top: L.y, w: L.w, h: L.h };
          moveSession.anchor = ax;
        }
      }
      const next = clampFloating({
        docked: false,
        x: ax!.left + ev.clientX - moveSession.ptr0.x,
        y: ax!.top + ev.clientY - moveSession.ptr0.y,
        w: ax!.w,
        h: ax!.h,
      });
      lastApplied = next;
      onLayoutChange(next);
      emitSlotPreview(next);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      trySnapDockIfOverTarget(lastApplied, dockTargetRef, onLayoutChange);
      onSlotPreviewHeightChange?.(0);
      onFloatDragActiveChange?.(false);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const onResizePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const L = layoutRef.current;
    if (!L.docked) {
      onFloatDragActiveChange?.(true);
    }
    const w0 = L.docked ? rootRef.current?.offsetWidth ?? L.w : L.w;
    const resizeSession: ResizeSession = {
      ptr0: { x: e.clientX, y: e.clientY },
      w0,
      h0: L.h,
    };

    let resizeSessionLast = L;
    const onMove = (ev: PointerEvent) => {
      const cur = layoutRef.current;
      const dw = ev.clientX - resizeSession.ptr0.x;
      const dh = ev.clientY - resizeSession.ptr0.y;
      const nextH = Math.max(MIN_H, resizeSession.h0 + dh);
      if (cur.docked) {
        void dw;
        const nextDocked = {
          ...cur,
          docked: true,
          w: DEFAULT_INSPIRATION_LAYOUT.w,
          h: nextH,
        };
        resizeSessionLast = nextDocked;
        onLayoutChange(nextDocked);
      } else {
        const nextW = Math.max(MIN_W, resizeSession.w0 + dw);
        const next = clampFloating({ ...cur, docked: false, w: nextW, h: nextH });
        resizeSessionLast = next;
        onLayoutChange(next);
        emitSlotPreview(next);
      }
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      trySnapDockIfOverTarget(resizeSessionLast, dockTargetRef, onLayoutChange);
      onSlotPreviewHeightChange?.(0);
      onFloatDragActiveChange?.(false);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const floatingStyle: CSSProperties | undefined = layout.docked
    ? undefined
    : {
        position: 'fixed',
        left: layout.x,
        top: layout.y,
        width: layout.w,
        height: layout.h,
        zIndex: 25,
      };

  return (
    <div
      ref={rootRef}
      className={cn(
        'mc-ref-panel relative flex flex-col overflow-hidden shadow-[0_30px_80px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.12)]',
        layout.docked ? 'h-full w-full min-h-[120px]' : '',
        !layout.docked &&
          (chromeReveal
            ? cn('translate-x-0 translate-y-0 scale-100 origin-top-right visible', MC_CHROME_ENTRANCE_TF)
            : cn(
                'translate-x-[110vw] translate-y-[40vh]',
                MC_CHROME_ENTRANCE_SCALE_START,
                'origin-top-right invisible pointer-events-none transition-none'
              ))
      )}
      style={floatingStyle}
    >
      <div
        className="flex shrink-0 cursor-grab select-none items-center gap-2 border-b border-white/10 px-4 py-2.5 active:cursor-grabbing"
        onPointerDown={onHeaderPointerDown}
        style={{ touchAction: 'none' }}
      >
        <GripVertical className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
        <h2 className="text-base font-semibold text-zinc-100">灵感速记</h2>
        <span className="ml-auto hidden text-[10px] text-zinc-500 sm:inline">拖拽移动 · 右下角缩放</span>
      </div>
      <textarea
        value={text}
        onChange={(ev) => onTextChange(ev.target.value)}
        placeholder="随手记下想法…"
        className={cn(
          'min-h-0 w-full flex-1 resize-none border-0 bg-transparent px-4 py-3 text-sm leading-relaxed text-zinc-200/92 outline-none ring-0 placeholder:text-zinc-500/75',
          'overflow-y-auto [scrollbar-gutter:stable]',
          '[scrollbar-width:thin]',
          '[scrollbar-color:rgba(255,255,255,0.22)_transparent]',
          '[&::-webkit-scrollbar]:w-2',
          '[&::-webkit-scrollbar-thumb]:rounded-full',
          '[&::-webkit-scrollbar-thumb]:bg-white/22',
          '[&::-webkit-scrollbar-track]:bg-transparent'
        )}
        spellCheck={false}
      />
      <div
        className="absolute bottom-1 right-1 z-[2] h-5 w-5 cursor-nwse-resize rounded-br-lg border-b-2 border-r-2 border-white/25 opacity-70 hover:opacity-100"
        onPointerDown={onResizePointerDown}
        style={{ touchAction: 'none' }}
        title="缩放"
        aria-label="缩放灵感速记"
      />
    </div>
  );
}
