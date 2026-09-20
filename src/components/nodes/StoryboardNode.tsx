'use client';

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import type { Edge, Node } from 'reactflow';
import { Handle, Position, NodeProps, NodeResizer } from 'reactflow';
import { useShallow } from 'zustand/react/shallow';
import { PenLine, Pencil, Redo2, Square, MousePointer2, Trash2, Type, Undo2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { isNativeTextUndoTarget } from '@/lib/keyboard-undo-target';
import { useCanvasStore, CanvasNodeData } from '../canvas/CanvasStore';

function sanitizeStoryboardSlugInput(value: string): string {
  return value.replace(/[^a-zA-Z0-9_\u4e00-\u9fff\-.:]/g, '').slice(0, 30);
}

function defaultStoryboardSlug(nodeId: string): string {
  const tail = nodeId.replace(/\D/g, '').slice(-4) || '0';
  return `分镜${tail}`;
}

export type StoryboardStroke = {
  points: { x: number; y: number }[];
  color: string;
  widthFrac: number;
  /** 橡皮擦轨迹：仅作用于笔迹层，不擦底图 */
  eraser?: boolean;
  /** 形状类型：自由画笔 / 矩形 / 箭头 / 文字 */
  shape?: 'freehand' | 'rect' | 'arrow' | 'text';
  /** 文字内容（仅 shape='text' 时有效） */
  text?: string;
  /** 已被橡皮擦擦除（不可选、不可见） */
  erased?: boolean;
  /** 选中笔画的旋转角度（弧度） */
  rotation?: number;
};

/** 分镜工具栏：圆形橡皮图标（与画布指针风格一致） */
function StoryboardEraserIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <circle cx="12" cy="12" r="8" fill="transparent" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

/** 橡皮擦光标：黑色细边框圆形，中间透明。base64 编码避免 encodeURIComponent 对 SVG 内 # 重复转义 */
function makeEraserCursorDataUrl(sizePx: number): string {
  const s = Math.max(16, Math.min(128, Math.round(sizePx)));
  const r = s / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">` +
    `<circle cx="${r}" cy="${r}" r="${r - 1.5}" fill="none" stroke="black" stroke-width="1.5" />` +
    `</svg>`;
  const b64 = typeof btoa !== 'undefined' ? btoa(svg) : Buffer.from(svg).toString('base64');
  return `url("data:image/svg+xml;base64,${b64}") ${r} ${r}, crosshair`;
}

/** 箭头工具图标：向右箭头 */
function ArrowRightIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden>
      <line x1="4" y1="12" x2="18" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <polyline points="13,6 19,12 13,18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export interface StoryboardNodeData extends CanvasNodeData {
  fileUrl?: string;
  mentionSlug?: string;
  storyboardWidth?: number;
  storyboardHeight?: number;
  strokes?: unknown;
}

const STORYBOARD_HISTORY_MAX = 48;
const BRUSH_WIDTH_MIN = 0.0016;
const BRUSH_WIDTH_MAX = 0.072;
const BRUSH_WIDTH_STEP = 0.0004;
const STORYBOARD_EXPORT_MAX_SIDE = 4096;

/** 从 pointer 事件采样坐标/时间（用于 coalesced 批处理） */
type PenClientSample = Pick<PointerEvent, 'clientX' | 'clientY' | 'timeStamp'>;

function imageBitmapReady(img: HTMLImageElement | null | undefined): img is HTMLImageElement {
  if (!img?.complete) return false;
  const iw = img.naturalWidth || img.width || 0;
  const ih = img.naturalHeight || img.height || 0;
  return iw > 0 && ih > 0;
}

/** 无底图参考时：按画布比例导出，尽量高于 UI 像素（避免固定 640 长边导致下游分辨率过低） */
function computePaintboardExportSize(wCss: number, hCss: number): { w: number; h: number } {
  const maxSide = STORYBOARD_EXPORT_MAX_SIDE;
  const dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
  const scale = Math.min(maxSide / Math.max(wCss, hCss, 1), Math.max(2, dpr * 2));
  const w = Math.max(32, Math.round(wCss * scale));
  const h = Math.max(32, Math.round(hCss * scale));
  return { w, h };
}

function cloneStrokes(strokes: StoryboardStroke[]): StoryboardStroke[] {
  return JSON.parse(JSON.stringify(strokes)) as StoryboardStroke[];
}

function normPointFromClientRect(
  rect: DOMRectReadOnly,
  clientX: number,
  clientY: number,
  /** 数位笔在边缘易略出元素；硬夹到 0..1 会让多点落在同一边界 → 去重后像断笔，与 parseStrokes 容忍区间对齐 */
  softEdges?: boolean
): { x: number; y: number } | null {
  if (rect.width < 1 || rect.height < 1) return null;
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;
  if (softEdges) {
    return {
      x: Math.min(1.02, Math.max(-0.02, x)),
      y: Math.min(1.02, Math.max(-0.02, y)),
    };
  }
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
}

/**
 * 手绘区位图尺寸须用布局像素（clientWidth/Height），勿用 getBoundingClientRect 的视口缩放后尺寸，
 * 否则画布缩小（RF zoom）时位图被压到极小，笔迹/底图在拉伸后像「消失」。
 */
function readStoryboardPaintBox(wrap: HTMLElement): { w: number; h: number } {
  let w = Math.floor(wrap.clientWidth);
  let h = Math.floor(wrap.clientHeight);
  if (w < 8 || h < 8) {
    const r = wrap.getBoundingClientRect();
    w = Math.max(32, Math.floor(r.width));
    h = Math.max(32, Math.floor(r.height));
  } else {
    w = Math.max(32, w);
    h = Math.max(32, h);
  }
  return { w, h };
}

/** 与 ImageNode 中「当前展示图」一致：data.imageUrl 或 generatedImages 中最新一张 */
function resolveImageNodeBaseUrl(d: Record<string, unknown>): string {
  const direct = typeof d.imageUrl === 'string' ? d.imageUrl.trim() : '';
  if (direct) return direct;
  const raw = d.generatedImages;
  if (!Array.isArray(raw)) return '';
  let best = '';
  let bestCreated = -1;
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const u =
      typeof r.imageUrl === 'string'
        ? r.imageUrl
        : typeof r.image_url === 'string'
          ? r.image_url
          : '';
    const url = typeof u === 'string' ? u.trim() : '';
    if (!url) continue;
    const created = typeof r.createdAt === 'number' ? r.createdAt : 0;
    if (created >= bestCreated) {
      bestCreated = created;
      best = url;
    }
  }
  return best;
}

/** 与素材引用 URL 一致：fileUrl，否则 seedance asset，再否则缩略图 */
function resolveMaterialBaseUrl(d: Record<string, unknown>): string {
  const fileUrl = typeof d.fileUrl === 'string' ? d.fileUrl.trim() : '';
  const seedUri =
    typeof d.seedanceAssetUri === 'string'
      ? d.seedanceAssetUri.trim()
      : typeof d.seedanceAssetId === 'string' && d.seedanceAssetId.trim()
        ? `asset://${d.seedanceAssetId.trim()}`
        : '';
  if (fileUrl) return fileUrl;
  if (seedUri) return seedUri;
  const thumb = typeof d.thumbnailUrl === 'string' ? d.thumbnailUrl.trim() : '';
  return thumb;
}

/**
 * 素材节点作为底图时的加载 URL 列表（按顺序尝试）。
 * 与 MaterialNode 展示一致：缩略图常更稳；主 fileUrl 偶发 CORS/过期时回退缩略图可避免「底图全黑/全空」。
 */
function materialStoryboardLoadCandidates(d: Record<string, unknown>): string[] {
  const fileType = typeof d.fileType === 'string' ? d.fileType : '';
  const fileUrl = typeof d.fileUrl === 'string' ? d.fileUrl.trim() : '';
  const thumb = typeof d.thumbnailUrl === 'string' ? d.thumbnailUrl.trim() : '';
  const seedUri =
    typeof d.seedanceAssetUri === 'string'
      ? d.seedanceAssetUri.trim()
      : typeof d.seedanceAssetId === 'string' && d.seedanceAssetId.trim()
        ? `asset://${d.seedanceAssetId.trim()}`
        : '';
  if (fileType === 'video' || fileType === 'audio') return [];
  const anyVisual = fileUrl || seedUri || thumb;
  if (!anyVisual) return [];
  if (fileType === 'image' || fileType === '') {
    if (fileType === '' && !isLikelyMaterialImageUrl(anyVisual)) return [];
  } else {
    return [];
  }
  const primary = resolveMaterialBaseUrl(d);
  if (!primary) return [];
  const out: string[] = [primary];
  if (thumb && thumb !== primary) out.push(thumb);
  if (fileUrl && fileUrl !== primary && !out.includes(fileUrl)) out.push(fileUrl);
  return out;
}

const SB_LOAD_KEY_SEP = '\u001e';

/** 从左侧连入的边解析底图 URL 列表；同目标多条边时以后连入的为准 */
function resolveStoryboardBaseImageLoadCandidates(
  nodes: Node<CanvasNodeData>[],
  edges: Edge[],
  storyboardId: string
): string[] {
  let candidates: string[] = [];
  for (const e of edges) {
    if (e.target !== storyboardId) continue;
    const n = nodes.find((x) => x.id === e.source);
    if (!n?.data) continue;
    const d = n.data as Record<string, unknown>;
    const nodeType = String(n.type ?? d.type ?? '');

    if (nodeType === 'material') {
      const next = materialStoryboardLoadCandidates(d);
      if (next.length) candidates = next;
    } else if (nodeType === 'image') {
      const imageUrl = resolveImageNodeBaseUrl(d);
      if (imageUrl) candidates = [imageUrl];
    } else if (nodeType === 'storyboard') {
      const fileUrl = typeof d.fileUrl === 'string' ? d.fileUrl.trim() : '';
      if (fileUrl) candidates = [fileUrl];
    }
  }
  return candidates;
}

/** 素材 fileType 为空时仍可能为图（API 直链无扩展名、blob、方舟 asset 等） */
function isLikelyMaterialImageUrl(fileUrl: string): boolean {
  const t = fileUrl.trim();
  if (!t) return false;
  if (/^data:image\//i.test(t)) return true;
  if (/^asset:\/\//i.test(t)) return true;
  if (/\.(mp4|webm|mov|mpe?g|mp3|wav|m4a|aac)(\?|#|$)/i.test(t)) return false;
  if (/\.(png|jpe?g|webp|gif|bmp|avif|heic)(\?|#|$)/i.test(t)) return true;
  return /^(https?:\/\/|blob:)/i.test(t);
}

function drawImageContain(ctx: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (iw < 1 || ih < 1) return;
  const scale = Math.min(w / iw, h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  const ox = (w - dw) / 2;
  const oy = (h - dh) / 2;
  ctx.drawImage(img, ox, oy, dw, dh);
}

/** 与 drawImageContain 一致：返回底图在容器内的像素矩形 */
function getContainRect(cssW: number, cssH: number, img: HTMLImageElement) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (iw < 1 || ih < 1 || cssW < 1 || cssH < 1) return null;
  const scale = Math.min(cssW / iw, cssH / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  const ox = (cssW - dw) / 2;
  const oy = (cssH - dh) / 2;
  return { ix: ox, iy: oy, iw: dw, ih: dh };
}

/** 底图层：铺底色 + contain 底图（无笔迹） */
function drawBackgroundLayer(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  clearBg: string,
  baseImage?: HTMLImageElement | null
) {
  ctx.fillStyle = clearBg;
  ctx.fillRect(0, 0, w, h);
  if (baseImage && imageBitmapReady(baseImage)) {
    drawImageContain(ctx, baseImage, w, h);
  }
}

/** 单条笔迹（与 drawForegroundStrokes 中单圈逻辑一致，不清 canvas） */
function drawOneStoryboardStroke(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  s: StoryboardStroke,
  mapPoint?: (nx: number, ny: number) => { x: number; y: number }
) {
  const map = mapPoint ?? ((nx: number, ny: number) => ({ x: nx * w, y: ny * h }));
  const lw = Math.max(1, s.widthFrac * Math.min(w, h));
  const eraser = Boolean(s.eraser);
  ctx.save();
  if (s.shape === 'text') {
    if (s.points.length < 1) { ctx.restore(); return; }
    const fontSize = Math.max(22, s.widthFrac * Math.min(w, h) * 24);
    const p0 = map(s.points[0].x, s.points[0].y);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = s.color;
    ctx.font = `${fontSize}px "PingFang SC", "Microsoft YaHei", sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(s.text ?? '', p0.x, p0.y);
    ctx.restore();
    return;
  }
  if (s.points.length < 2) { ctx.restore(); return; }
  if (s.shape === 'rect') {
    const a = map(s.points[0].x, s.points[0].y);
    const b = map(s.points[1].x, s.points[1].y);
    ctx.globalCompositeOperation = eraser ? 'destination-out' : 'source-over';
    ctx.strokeStyle = eraser ? 'rgba(0,0,0,1)' : s.color;
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  } else if (s.shape === 'arrow') {
    const p0 = map(s.points[0].x, s.points[0].y);
    const p1 = map(s.points[1].x, s.points[1].y);
    const alw = lw * 2.5;
    const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x);
    const headLen = Math.max(alw * 9, 28);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = s.color;
    // 先画箭头三角形（保证尖端锐利）
    ctx.beginPath();
    ctx.moveTo(p1.x - headLen * Math.cos(angle - Math.PI / 8),
      p1.y - headLen * Math.sin(angle - Math.PI / 8));
    ctx.lineTo(p1.x, p1.y);
    ctx.lineTo(p1.x - headLen * Math.cos(angle + Math.PI / 8),
      p1.y - headLen * Math.sin(angle + Math.PI / 8));
    ctx.closePath();
    ctx.fill();
    // 箭杆缩入箭头内部，避免杆端平头在尖端两侧露出
    const shaftEndDist = alw * 1.3;
    const sx = p1.x - shaftEndDist * Math.cos(angle);
    const sy = p1.y - shaftEndDist * Math.sin(angle);
    ctx.strokeStyle = s.color;
    ctx.lineWidth = alw;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(sx, sy);
    ctx.stroke();
  } else {
    ctx.globalCompositeOperation = eraser ? 'destination-out' : 'source-over';
    ctx.strokeStyle = eraser ? 'rgba(0,0,0,1)' : s.color;
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    const p0f = s.points[0];
    const m0 = map(p0f.x, p0f.y);
    ctx.moveTo(m0.x, m0.y);
    for (let i = 1; i < s.points.length; i++) {
      const p = s.points[i];
      const m = map(p.x, p.y);
      ctx.lineTo(m.x, m.y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawShapePreview(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  start: { x: number; y: number },
  current: { x: number; y: number },
  tool: 'rect' | 'arrow',
  color: string,
  lw: number
) {
  const x1 = start.x * w;
  const y1 = start.y * h;
  const x2 = current.x * w;
  const y2 = current.y * h;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (tool === 'rect') {
    ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
  } else {
    const alw = lw * 2.5;
    ctx.lineWidth = alw;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const headLen = Math.max(alw * 9, 28);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x2 - headLen * Math.cos(angle - Math.PI / 8),
      y2 - headLen * Math.sin(angle - Math.PI / 8));
    ctx.lineTo(x2, y2);
    ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 8),
      y2 - headLen * Math.sin(angle + Math.PI / 8));
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function strokeBounds(
  s: StoryboardStroke,
  w: number,
  h: number
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (s.shape === 'text' && s.points.length >= 1) {
    const fontSize = Math.max(22, s.widthFrac * Math.min(w, h) * 24);
    const tw = (s.text ?? '').length * fontSize * 0.6;
    const th = fontSize * 1.2;
    const px = s.points[0].x * w;
    const py = s.points[0].y * h;
    return { minX: px, minY: py, maxX: px + tw, maxY: py + th };
  }
  if (s.points.length < 2) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of s.points) {
    const px = p.x * w;
    const py = p.y * h;
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
  }
  return { minX, minY, maxX, maxY };
}

function hitTestHandle(
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  px: number,
  py: number
): string | null {
  const hs = 8;
  const corners: [string, number, number][] = [
    ['nw', bounds.minX, bounds.minY],
    ['ne', bounds.maxX, bounds.minY],
    ['sw', bounds.minX, bounds.maxY],
    ['se', bounds.maxX, bounds.maxY],
  ];
  for (const [name, cx, cy] of corners) {
    if (Math.abs(px - cx) <= hs && Math.abs(py - cy) <= hs) return name;
  }
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const rotateHandleY = bounds.minY - 28;
  const rotateHandleDist = Math.hypot(px - centerX, py - rotateHandleY);
  if (rotateHandleDist <= hs + 4) return 'rotate';
  return null;
}

function hitTestStroke(
  s: StoryboardStroke,
  clickPx: number,
  clickPy: number,
  w: number,
  h: number,
  threshold: number
): boolean {
  if (s.shape === 'text') {
    if (s.points.length < 1) return false;
    const fontSize = Math.max(22, s.widthFrac * Math.min(w, h) * 24);
    const tw = (s.text ?? '').length * fontSize * 0.6;
    const th = fontSize * 1.2;
    const tx = s.points[0].x * w;
    const ty = s.points[0].y * h;
    return (
      clickPx >= tx - threshold &&
      clickPx <= tx + tw + threshold &&
      clickPy >= ty - threshold &&
      clickPy <= ty + th + threshold
    );
  }
  if (s.points.length < 2) return false;
  if (s.shape === 'rect') {
    const a = s.points[0];
    const b = s.points[1];
    const rx = Math.min(a.x, b.x) * w;
    const ry = Math.min(a.y, b.y) * h;
    const rw = Math.abs(b.x - a.x) * w;
    const rh = Math.abs(b.y - a.y) * h;
    const t2 = threshold;
    return (
      clickPx >= rx - t2 &&
      clickPx <= rx + rw + t2 &&
      clickPy >= ry - t2 &&
      clickPy <= ry + rh + t2
    );
  }
  // freehand / arrow: point-to-segment distance
  for (let i = 1; i < s.points.length; i++) {
    const ax = s.points[i - 1].x * w;
    const ay = s.points[i - 1].y * h;
    const bx = s.points[i].x * w;
    const by = s.points[i].y * h;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 < 0.01) {
      const d = Math.hypot(clickPx - ax, clickPy - ay);
      if (d < threshold) return true;
      continue;
    }
    let t = ((clickPx - ax) * dx + (clickPy - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    if (Math.hypot(clickPx - cx, clickPy - cy) < threshold) return true;
  }
  return false;
}

function distPointToSegmentPx(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 0.01) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function eraserRadiusPx(widthFrac: number, w: number, h: number): number {
  return Math.max(1, widthFrac * Math.min(w, h)) * 0.5;
}

function sampleEraserTouchPoints(
  eraserPoints: { x: number; y: number }[],
  w: number,
  h: number
): { px: number; py: number }[] {
  if (eraserPoints.length === 0) return [];
  if (eraserPoints.length === 1) {
    return [{ px: eraserPoints[0].x * w, py: eraserPoints[0].y * h }];
  }
  const out: { px: number; py: number }[] = [];
  for (let i = 1; i < eraserPoints.length; i++) {
    const ax = eraserPoints[i - 1].x * w;
    const ay = eraserPoints[i - 1].y * h;
    const bx = eraserPoints[i].x * w;
    const by = eraserPoints[i].y * h;
    const dist = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(dist / 3));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      out.push({ px: ax + (bx - ax) * t, py: ay + (by - ay) * t });
    }
  }
  return out;
}

function strokeHitByEraserPath(
  s: StoryboardStroke,
  eraserPoints: { x: number; y: number }[],
  eraserWidthFrac: number,
  w: number,
  h: number
): boolean {
  const threshold =
    eraserRadiusPx(eraserWidthFrac, w, h) +
    Math.max(1, s.widthFrac * Math.min(w, h)) * 0.5;
  for (const { px, py } of sampleEraserTouchPoints(eraserPoints, w, h)) {
    if (hitTestStroke(s, px, py, w, h, threshold)) return true;
  }
  return false;
}

function splitFreehandByEraser(
  stroke: StoryboardStroke,
  eraserPoints: { x: number; y: number }[],
  eraserWidthFrac: number,
  w: number,
  h: number
): StoryboardStroke[] {
  const targetHalf = Math.max(1, stroke.widthFrac * Math.min(w, h)) * 0.5;
  const eraserHalf = eraserRadiusPx(eraserWidthFrac, w, h);
  const threshold = targetHalf + eraserHalf;

  const segments: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];

  for (const pt of stroke.points) {
    const px = pt.x * w;
    const py = pt.y * h;
    let erased = false;
    if (eraserPoints.length === 1) {
      const ex = eraserPoints[0].x * w;
      const ey = eraserPoints[0].y * h;
      erased = Math.hypot(px - ex, py - ey) <= threshold;
    } else {
      for (let i = 1; i < eraserPoints.length; i++) {
        const ax = eraserPoints[i - 1].x * w;
        const ay = eraserPoints[i - 1].y * h;
        const bx = eraserPoints[i].x * w;
        const by = eraserPoints[i].y * h;
        if (distPointToSegmentPx(px, py, ax, ay, bx, by) <= threshold) {
          erased = true;
          break;
        }
      }
    }
    if (erased) {
      if (current.length >= 2) segments.push(current);
      current = [];
    } else {
      current.push(pt);
    }
  }
  if (current.length >= 2) segments.push(current);

  return segments.map((points) => ({
    ...stroke,
    points,
    rotation: undefined,
  }));
}

/** 将橡皮擦轨迹真正作用到矢量笔迹（避免 destination-out 仅视觉擦除、移动后复活） */
function applyEraserToStrokes(
  strokes: StoryboardStroke[],
  eraserPoints: { x: number; y: number }[],
  eraserWidthFrac: number,
  w: number,
  h: number
): StoryboardStroke[] {
  if (eraserPoints.length < 1 || w < 2 || h < 2) return strokes;

  const out: StoryboardStroke[] = [];
  for (const s of strokes) {
    if (s.eraser || s.erased) continue;

    if (s.shape === 'rect' || s.shape === 'arrow' || s.shape === 'text') {
      if (strokeHitByEraserPath(s, eraserPoints, eraserWidthFrac, w, h)) continue;
      out.push(s);
      continue;
    }

    out.push(...splitFreehandByEraser(s, eraserPoints, eraserWidthFrac, w, h));
  }
  return out;
}

function getStrokeRotationCenter(
  s: StoryboardStroke,
  w: number,
  h: number
): { cx: number; cy: number } | null {
  const b = strokeBounds(s, w, h);
  if (!b) return null;
  return {
    cx: (b.minX + b.maxX) / 2 / w,
    cy: (b.minY + b.maxY) / 2 / h,
  };
}

function rotateNormalizedPoints(
  points: { x: number; y: number }[],
  cx: number,
  cy: number,
  angle: number
): { x: number; y: number }[] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return points.map((pt) => {
    const dx = pt.x - cx;
    const dy = pt.y - cy;
    return {
      x: cx + dx * cos - dy * sin,
      y: cy + dx * sin + dy * cos,
    };
  });
}

/** 笔迹层：透明底；橡皮仅擦掉本层已绘内容，不伤底图 */
function drawForegroundStrokes(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  strokes: StoryboardStroke[],
  mapPoint?: (nx: number, ny: number) => { x: number; y: number }
) {
  ctx.clearRect(0, 0, w, h);
  for (const s of strokes) {
    if (s.erased) continue;
    drawOneStoryboardStroke(ctx, w, h, s, mapPoint);
  }
}

/** 有上游位图时：导出尺寸 = 原图 intrinsic；底图 + 独立笔迹层合成 */
function exportPngSyncWithBaseIntrinsic(
  strokes: StoryboardStroke[],
  wrapW: number,
  wrapH: number,
  base: HTMLImageElement
): string {
  const natW = base.naturalWidth || base.width;
  const natH = base.naturalHeight || base.height;
  if (natW < 1 || natH < 1 || wrapW < 8 || wrapH < 8) return '';
  const rect = getContainRect(wrapW, wrapH, base);
  if (!rect) return '';
  const { ix, iy, iw, ih } = rect;
  const canvas = document.createElement('canvas');
  canvas.width = natW;
  canvas.height = natH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(base, 0, 0, natW, natH);
  const fg = document.createElement('canvas');
  fg.width = natW;
  fg.height = natH;
  const fgCtx = fg.getContext('2d');
  if (!fgCtx) return '';
  const map = (nx: number, ny: number) => {
    const px = nx * wrapW;
    const py = ny * wrapH;
    const u = (px - ix) / iw;
    const v = (py - iy) / ih;
    return { x: u * natW, y: v * natH };
  };
  drawForegroundStrokes(fgCtx, natW, natH, strokes, map);
  ctx.drawImage(fg, 0, 0);
  try {
    return canvas.toDataURL('image/png', 0.92);
  } catch {
    return '';
  }
}

function parseStrokes(raw: unknown): StoryboardStroke[] {
  if (!Array.isArray(raw)) return [];
  const out: StoryboardStroke[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const shape =
      o.shape === 'rect' || o.shape === 'arrow' || o.shape === 'freehand' || o.shape === 'text'
        ? o.shape
        : undefined;
    const pts = o.points;
    if (!Array.isArray(pts)) continue;
    // 文字笔迹仅需1个定位点，其他笔迹至少需要2个点
    if (shape === 'text' ? pts.length < 1 : pts.length < 2) continue;
    const points: { x: number; y: number }[] = [];
    for (const p of pts) {
      if (!p || typeof p !== 'object') continue;
      const r = p as Record<string, unknown>;
      if (typeof r.x !== 'number' || typeof r.y !== 'number') continue;
      if (r.x < -0.02 || r.x > 1.02 || r.y < -0.02 || r.y > 1.02) continue;
      points.push({ x: r.x, y: r.y });
    }
    // 解析后的点数校验（防止 pts 中有无效坐标）
    if (shape === 'text' ? points.length < 1 : points.length < 2) continue;
    const color = typeof o.color === 'string' ? o.color : '#171717';
    const widthFrac =
      typeof o.widthFrac === 'number' && o.widthFrac > 0 && o.widthFrac < 0.2 ? o.widthFrac : 0.004;
    const eraser = Boolean(o.eraser);
    const text = shape === 'text' && typeof o.text === 'string' ? o.text : undefined;
    const erased = Boolean(o.erased);
    const rotation = typeof o.rotation === 'number' ? o.rotation : undefined;
    out.push({ points, color, widthFrac, eraser, shape, text, erased, rotation });
  }
  return out;
}

function exportPngSync(
  strokes: StoryboardStroke[],
  wCss: number,
  hCss: number,
  baseImage: HTMLImageElement | null
): string {
  if (strokes.length === 0 || wCss < 8 || hCss < 8) return '';
  if (imageBitmapReady(baseImage)) {
    return exportPngSyncWithBaseIntrinsic(strokes, wCss, hCss, baseImage);
  }
  const { w, h } = computePaintboardExportSize(wCss, hCss);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  drawBackgroundLayer(ctx, w, h, '#fafafa', baseImage);
  const fg = document.createElement('canvas');
  fg.width = w;
  fg.height = h;
  const fgCtx = fg.getContext('2d');
  if (!fgCtx) return '';
  drawForegroundStrokes(fgCtx, w, h, strokes);
  ctx.drawImage(fg, 0, 0);
  try {
    return canvas.toDataURL('image/png', 0.92);
  } catch {
    return '';
  }
}

/** 先尝试带 CORS（便于导出），失败则回退为普通加载以尽量显示底图 */
function loadImageElementFlexible(src: string): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null);
  return new Promise((resolve) => {
    const attempt = (withCors: boolean) => {
      const img = new Image();
      img.onload = () => {
        void (async () => {
          try {
            if ('decode' in img && typeof img.decode === 'function') {
              await img.decode();
            }
          } catch {
            /* ignore */
          }
          resolve(img);
        })();
      };
      img.onerror = () => {
        if (withCors && !src.startsWith('data:')) {
          attempt(false);
        } else {
          resolve(null);
        }
      };
      if (withCors && !src.startsWith('data:')) {
        img.crossOrigin = 'anonymous';
      }
      img.src = src;
    };
    attempt(true);
  });
}

async function loadImageFromCandidates(urls: readonly string[]): Promise<HTMLImageElement | null> {
  for (const u of urls) {
    const img = await loadImageElementFlexible(u);
    if (imageBitmapReady(img)) return img;
  }
  return null;
}

/** 同源或可 CORS 的 http(s) 图：拉成 blob 再解码，避免 <img> 无 CORS 导致 canvas 污染、toDataURL 失败 */
async function loadImageForExportBlobFetch(src: string): Promise<HTMLImageElement | null> {
  const t = src.trim();
  if (!t.startsWith('http://') && !t.startsWith('https://')) return null;
  try {
    const r = await fetch(t, { mode: 'cors', credentials: 'omit', cache: 'no-store' });
    if (!r.ok) return null;
    const blob = await r.blob();
    if (!blob.type.startsWith('image/')) return null;
    const obj = URL.createObjectURL(blob);
    try {
      const img = await new Promise<HTMLImageElement | null>((resolve) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => resolve(null);
        i.src = obj;
      });
      return imageBitmapReady(img) ? img : null;
    } finally {
      URL.revokeObjectURL(obj);
    }
  } catch {
    return null;
  }
}

async function exportPngAsync(
  strokes: StoryboardStroke[],
  wCss: number,
  hCss: number,
  baseImageUrl: string,
  cachedBase: HTMLImageElement | null
): Promise<string> {
  if (strokes.length === 0 || wCss < 8 || hCss < 8) return '';
  let base: HTMLImageElement | null = imageBitmapReady(cachedBase) ? cachedBase : null;
  if (!base && baseImageUrl) {
    base = await loadImageElementFlexible(baseImageUrl);
  }
  if (!imageBitmapReady(base) && /^https?:\/\//i.test(baseImageUrl)) {
    const fetched = await loadImageForExportBlobFetch(baseImageUrl);
    if (imageBitmapReady(fetched)) base = fetched;
  }
  if (!imageBitmapReady(base)) {
    base = null;
  }
  return exportPngSync(strokes, wCss, hCss, base);
}

function StoryboardNode({ id, data, selected }: NodeProps<CanvasNodeData>) {
  const nodeData = data as StoryboardNodeData;
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const updateStoryboardGeometry = useCanvasStore((state) => state.updateStoryboardGeometry);
  const downstreamTargetIds = useCanvasStore(
    useShallow((state) => state.downstreamNodeIdsBySource[id] ?? [])
  );
  const storyboardBaseLoadKey = useCanvasStore(
    useShallow((state) =>
      resolveStoryboardBaseImageLoadCandidates(state.nodes, state.edges, id).join(SB_LOAD_KEY_SEP)
    )
  );
  const baseImageUrl =
    storyboardBaseLoadKey.length === 0
      ? ''
      : storyboardBaseLoadKey.split(SB_LOAD_KEY_SEP).filter(Boolean)[0] ?? '';

  const wrapRef = useRef<HTMLDivElement>(null);
  const bgCanvasRef = useRef<HTMLCanvasElement>(null);
  const fgCanvasRef = useRef<HTMLCanvasElement>(null);
  /** 前景笔迹层：与 bitmap 尺寸绑定，pointermove 内复用，避免反复 getContext */
  const fgCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const bgImageRef = useRef<HTMLImageElement | null>(null);
  const bgLoadingUrlRef = useRef<string | null>(null);
  const strokesRef = useRef<StoryboardStroke[]>([]);
  const undoStackRef = useRef<StoryboardStroke[][]>([]);
  const redoStackRef = useRef<StoryboardStroke[][]>([]);
  const drawingRef = useRef(false);
  /** 与 setPointerCapture 对应，避免多指时误处理 */
  const capturedPointerIdRef = useRef<number | null>(null);
  const currentStrokeRef = useRef<{ x: number; y: number }[]>([]);
  const penWidthFracRef = useRef(0.004);
  const eraserWidthFracRef = useRef(0.004);
  const exportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [baseDecodeTick, setBaseDecodeTick] = useState(0);
  const [brushColor, setBrushColor] = useState('#171717');
  const [penWidthFrac, setPenWidthFrac] = useState(0.004);
  const [eraserWidthFrac, setEraserWidthFrac] = useState(0.004);
  const [tool, setTool] = useState<'pen' | 'eraser' | 'rect' | 'arrow' | 'select' | 'text'>('pen');
  const [widthPreviewActive, setWidthPreviewActive] = useState(false);
  const [, bumpHistory] = useReducer((x: number) => x + 1, 0);
  const brushColorRef = useRef(brushColor);
  const toolRef = useRef(tool);
  const [selectedStrokeIndex, setSelectedStrokeIndex] = useState<number | null>(null);
  const selectedStrokeIndexRef = useRef<number | null>(null);
  const selectionDragRef = useRef<{
    startNx: number;
    startNy: number;
    originalPoints: { x: number; y: number }[];
    originalRotation: number;
    rotateCenterNx: number;
    rotateCenterNy: number;
  } | null>(null);
  /** 选择拖拽中的临时笔迹，避免 React 重渲染把 strokesRef 重置回旧状态 */
  const selectionDraftStrokesRef = useRef<StoryboardStroke[] | null>(null);
  /** 选区尺寸手柄：null=未拖拽，'nw'|'ne'|'sw'|'se' 四个角，'rotate' 旋转 */
  const selectionHandleRef = useRef<string | null>(null);
  const selectionRotationStartRef = useRef<number>(0);
  const selectionBoundsRef = useRef<{
    minX: number; minY: number; maxX: number; maxY: number;
  } | null>(null);
  const [textInputState, setTextInputState] = useState<{
    active: boolean;
    nx: number;
    ny: number;
    text: string;
    editingIndex: number | null;
  } | null>(null);
  const textEditRef = useRef<{
    active: boolean;
    nx: number;
    ny: number;
    text: string;
    editingIndex: number | null;
  } | null>(null);
  const textInputRef = useRef<HTMLInputElement | null>(null);
  const cursorBlinkRef = useRef(true);
  const cursorBlinkTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  penWidthFracRef.current = penWidthFrac;
  eraserWidthFracRef.current = eraserWidthFrac;
  brushColorRef.current = brushColor;
  toolRef.current = tool;

  useEffect(() => {
    if (!widthPreviewActive) return;
    const end = () => setWidthPreviewActive(false);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [widthPreviewActive]);

  useEffect(() => {
    if (tool !== 'select') {
      setSelectedStrokeIndex(null);
      selectedStrokeIndexRef.current = null;
      selectionBoundsRef.current = null;
      selectionDraftStrokesRef.current = null;
      selectionDragRef.current = null;
      redrawRef.current();
    }
    if (tool !== 'text') {
      const prev = textEditRef.current;
      if (prev?.active && prev.text.trim()) {
        const stroke: StoryboardStroke = {
          points: [{ x: prev.nx, y: prev.ny }],
          color: brushColorRef.current,
          widthFrac: penWidthFracRef.current,
          shape: 'text',
          text: prev.text.trim(),
        };
        let next: StoryboardStroke[];
        if (prev.editingIndex !== null) {
          next = [...strokesRef.current];
          next[prev.editingIndex] = stroke;
        } else {
          next = [...strokesRef.current, stroke];
        }
        strokesRef.current = next;
        commitStrokesRef.current(next);
      }
      setTextInputState(null);
    }
  }, [tool]);

  useEffect(() => {
    textEditRef.current = textInputState;
    if (textInputState?.active) {
      redrawRef.current();
    }
  }, [textInputState]);

  useEffect(() => {
    if (textInputState?.active && textInputRef.current) {
      textInputRef.current.focus();
    }
    if (textInputState?.active) {
      cursorBlinkRef.current = true;
      cursorBlinkTimerRef.current = setInterval(() => {
        cursorBlinkRef.current = !cursorBlinkRef.current;
        redrawRef.current();
      }, 530);
      return () => {
        if (cursorBlinkTimerRef.current) {
          clearInterval(cursorBlinkTimerRef.current);
          cursorBlinkTimerRef.current = null;
        }
      };
    } else {
      if (cursorBlinkTimerRef.current) {
        clearInterval(cursorBlinkTimerRef.current);
        cursorBlinkTimerRef.current = null;
      }
    }
  }, [textInputState?.active]);

  /** 须 memo：parse 每次返回新数组，否则 [strokes] 的 redraw effect 会在任意重渲染（如导出 fileUrl、底图 decode）时误触发，清画布时 live<2 会整段不叠笔迹 → 断连感 */
  const strokes = useMemo(() => parseStrokes(nodeData.strokes), [nodeData.strokes]);
  strokesRef.current = selectionDraftStrokesRef.current ?? strokes;
  const strokesExportSig = useMemo(() => JSON.stringify(nodeData.strokes ?? []), [nodeData.strokes]);

  useEffect(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    bumpHistory();
  }, [id, bumpHistory]);

  useEffect(() => {
    if (typeof nodeData.mentionSlug !== 'string' || !nodeData.mentionSlug.trim()) {
      updateNodeData(id, { mentionSlug: defaultStoryboardSlug(id) });
    }
  }, [id, nodeData.mentionSlug, updateNodeData]);

  useEffect(() => {
    downstreamTargetIds.forEach((targetId) => {
      updateNodeData(targetId, { imageRef: nodeData.fileUrl || '' });
    });
  }, [nodeData.fileUrl, downstreamTargetIds, updateNodeData]);

  const redraw = useCallback(() => {
    const wrap = wrapRef.current;
    const bg = bgCanvasRef.current;
    const fg = fgCanvasRef.current;
    if (!wrap || !bg || !fg) return;
    const { w, h } = readStoryboardPaintBox(wrap);
    if (bg.width !== w || bg.height !== h) {
      bg.width = w;
      bg.height = h;
      fg.width = w;
      fg.height = h;
    }
    const bgCtx = bg.getContext('2d');
    const fgCtx = fg.getContext('2d', { alpha: true }) ?? fg.getContext('2d');
    if (!bgCtx || !fgCtx) return;
    fgCtxRef.current = fgCtx;
    drawBackgroundLayer(bgCtx, w, h, '#f4f4f5', bgImageRef.current);
    const activeStrokes = selectionDraftStrokesRef.current ?? strokesRef.current;
    drawForegroundStrokes(fgCtx, w, h, activeStrokes);
    if (drawingRef.current) {
      const live = currentStrokeRef.current;
      const t = toolRef.current;
      if (live.length >= 2) {
        if (t === 'rect' || t === 'arrow') {
          const lw = Math.max(1, penWidthFracRef.current * Math.min(w, h));
          drawShapePreview(fgCtx, w, h, live[0], live[live.length - 1], t, brushColorRef.current, lw);
        } else {
          drawOneStoryboardStroke(fgCtx, w, h, {
            points: live,
            color: t === 'eraser' ? '#000000' : brushColorRef.current,
            widthFrac:
              t === 'eraser'
                ? eraserWidthFracRef.current * 1.45
                : penWidthFracRef.current,
            eraser: t === 'eraser' ? true : undefined,
          });
        }
      } else if (live.length === 1) {
        const p0 = live[0];
        const erasing = t === 'eraser';
        const wf = erasing ? eraserWidthFracRef.current * 1.45 : penWidthFracRef.current;
        const lw = Math.max(1, wf * Math.min(w, h));
        const cx = p0.x * w;
        const cy = p0.y * h;
        fgCtx.save();
        fgCtx.globalCompositeOperation = erasing ? 'destination-out' : 'source-over';
        fgCtx.fillStyle = erasing ? 'rgba(0,0,0,1)' : brushColorRef.current;
        fgCtx.beginPath();
        fgCtx.arc(cx, cy, lw * 0.5, 0, Math.PI * 2);
        fgCtx.fill();
        fgCtx.restore();
      }
    }
    // 文字编辑中的实时文字 + 光标
    const textEdit = textEditRef.current;
    if (textEdit?.active) {
      const fontSize = Math.max(22, penWidthFracRef.current * Math.min(w, h) * 24);
      const tx = textEdit.nx * w;
      const ty = textEdit.ny * h;
      fgCtx.save();
      fgCtx.globalCompositeOperation = 'source-over';
      fgCtx.fillStyle = brushColorRef.current;
      fgCtx.font = `${fontSize}px "PingFang SC", "Microsoft YaHei", sans-serif`;
      fgCtx.textBaseline = 'top';
      fgCtx.fillText(textEdit.text, tx, ty);
      if (cursorBlinkRef.current) {
        const tw = textEdit.text.length > 0 ? fgCtx.measureText(textEdit.text).width : 0;
        fgCtx.fillRect(tx + tw + 1, ty, 2, fontSize);
      }
      fgCtx.restore();
    }
    // 选择工具的选中边框
    if (toolRef.current === 'select') {
      const si = selectedStrokeIndexRef.current;
      const activeStrokes = selectionDraftStrokesRef.current ?? strokesRef.current;
      if (si !== null && si < activeStrokes.length) {
        const s = activeStrokes[si];
        const b = strokeBounds(s, w, h);
        if (b) {
          const hs = 7;
          const centerX = (b.minX + b.maxX) / 2;
          const rotateHandleY = b.minY - 28;
          const rotateHandleRadius = 5;
          fgCtx.save();
          fgCtx.strokeStyle = '#3b82f6';
          fgCtx.lineWidth = 1.5;
          fgCtx.setLineDash([4, 3]);
          fgCtx.strokeRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
          fgCtx.setLineDash([]);
          fgCtx.fillStyle = '#ffffff';
          for (const [cx, cy] of [[b.minX, b.minY], [b.maxX, b.minY], [b.minX, b.maxY], [b.maxX, b.maxY]]) {
            fgCtx.fillRect(cx - hs / 2, cy - hs / 2, hs, hs);
            fgCtx.strokeRect(cx - hs / 2, cy - hs / 2, hs, hs);
          }
          fgCtx.strokeStyle = '#3b82f6';
          fgCtx.lineWidth = 1.5;
          fgCtx.beginPath();
          fgCtx.moveTo(centerX, b.minY);
          fgCtx.lineTo(centerX, rotateHandleY);
          fgCtx.stroke();
          fgCtx.fillStyle = '#ffffff';
          fgCtx.strokeStyle = '#3b82f6';
          fgCtx.beginPath();
          fgCtx.arc(centerX, rotateHandleY, rotateHandleRadius, 0, Math.PI * 2);
          fgCtx.fill();
          fgCtx.stroke();
          fgCtx.restore();
        }
      }
    }
  }, []);

  const redrawRef = useRef(redraw);
  redrawRef.current = redraw;

  useEffect(() => {
    const urls = storyboardBaseLoadKey
      ? storyboardBaseLoadKey.split(SB_LOAD_KEY_SEP).filter(Boolean)
      : [];
    if (!urls.length) {
      bgImageRef.current = null;
      bgLoadingUrlRef.current = null;
      redrawRef.current();
      return;
    }
    if (bgLoadingUrlRef.current === storyboardBaseLoadKey && imageBitmapReady(bgImageRef.current)) {
      redrawRef.current();
      return;
    }
    bgLoadingUrlRef.current = storyboardBaseLoadKey;
    const keyAtStart = storyboardBaseLoadKey;
    let cancelled = false;
    void loadImageFromCandidates(urls).then((img) => {
      if (cancelled || bgLoadingUrlRef.current !== keyAtStart) return;
      bgImageRef.current = img;
      redrawRef.current();
      setBaseDecodeTick((t) => t + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [storyboardBaseLoadKey]);

  useEffect(() => {
    redraw();
  }, [strokes, redraw]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => { if (!drawingRef.current) redraw(); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [redraw]);

  const scheduleExport = useCallback(
    (nextStrokes: StoryboardStroke[], bgUrl: string) => {
      if (drawingRef.current) return; // 绘制中不导出，onPointerUp 会触发最终导出
      if (exportTimerRef.current) clearTimeout(exportTimerRef.current);
      exportTimerRef.current = setTimeout(() => {
        exportTimerRef.current = null;
        const wrap = wrapRef.current;
        if (!wrap) return;
        const { w: width, h: height } = readStoryboardPaintBox(wrap);
        void exportPngAsync(nextStrokes, width, height, bgUrl, bgImageRef.current).then((url) => {
          updateNodeData(id, { fileUrl: url || '' });
        });
      }, 380);
    },
    [id, updateNodeData]
  );

  useEffect(() => {
    if (strokesRef.current.length === 0) return;
    scheduleExport(strokesRef.current, baseImageUrl);
  }, [baseImageUrl, baseDecodeTick, strokesExportSig, scheduleExport]);

  const commitStrokes = useCallback(
    (next: StoryboardStroke[]) => {
      undoStackRef.current.push(cloneStrokes(strokesRef.current));
      if (undoStackRef.current.length > STORYBOARD_HISTORY_MAX) {
        undoStackRef.current.shift();
      }
      redoStackRef.current = [];
      updateNodeData(id, { strokes: next }, { recordUndo: false });
      scheduleExport(next, baseImageUrl);
      bumpHistory();
    },
    [baseImageUrl, bumpHistory, id, scheduleExport, updateNodeData]
  );

  const commitStrokesRef = useRef(commitStrokes);
  commitStrokesRef.current = commitStrokes;

  useLayoutEffect(() => {
    const canvas = fgCanvasRef.current;
    if (!canvas) return;

    const paintOpts = { capture: true, passive: false } as const;

    const processBatch = (list: PenClientSample[]) => {
      if (!drawingRef.current) return;
      const c = fgCanvasRef.current;
      if (!c) return;
      const ctx =
        fgCtxRef.current ??
        c.getContext('2d', { alpha: true }) ??
        c.getContext('2d');
      if (!ctx) return;
      fgCtxRef.current = ctx;
      const w = c.width;
      const h = c.height;
      if (w < 2 || h < 2) {
        return;
      }
      const rect = c.getBoundingClientRect();
      const startLen = currentStrokeRef.current.length;
      const ordered = list.length <= 1 ? list : [...list].sort((a, b) => a.timeStamp - b.timeStamp);
      for (const ev of ordered) {
        const p = normPointFromClientRect(rect, ev.clientX, ev.clientY, true);
        if (!p) continue;
        const last = currentStrokeRef.current[currentStrokeRef.current.length - 1];
        const dx = p.x - last.x;
        const dy = p.y - last.y;
        const pxdx = dx * w;
        const pxdy = dy * h;
        if (pxdx * pxdx + pxdy * pxdy < 0.25) continue;
        currentStrokeRef.current.push(p);
      }
      const endLen = currentStrokeRef.current.length;
      if (endLen <= startLen || startLen < 1) {
        return;
      }
      const pts = currentStrokeRef.current;
      const erasing = toolRef.current === 'eraser';
      const wf = erasing ? eraserWidthFracRef.current * 1.45 : penWidthFracRef.current;
      const lw = Math.max(1, wf * Math.min(w, h));
      ctx.save();
      ctx.globalCompositeOperation = erasing ? 'destination-out' : 'source-over';
      ctx.strokeStyle = erasing ? 'rgba(0,0,0,1)' : brushColorRef.current;
      ctx.lineWidth = lw;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(pts[startLen - 1].x * w, pts[startLen - 1].y * h);
      for (let i = startLen; i < endLen; i++) {
        ctx.lineTo(pts[i].x * w, pts[i].y * h);
      }
      ctx.stroke();
      ctx.restore();
    };

    // ---- pointerdown ----
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const c = fgCanvasRef.current;
      if (!c) return;
      const rect = c.getBoundingClientRect();
      const p = normPointFromClientRect(rect, e.clientX, e.clientY, true);
      if (!p) return;

      const t = toolRef.current;

      if (t === 'select') {
        const cssW = c.clientWidth || c.width;
        const cssH = c.clientHeight || c.height;
        const px = p.x * cssW;
        const py = p.y * cssH;
        const strokes = strokesRef.current;

        // 先检查是否拖拽当前选区的尺寸手柄
        if (selectedStrokeIndexRef.current !== null) {
          const si = selectedStrokeIndexRef.current;
          if (si < strokes.length) {
            const sb = strokeBounds(strokes[si], cssW, cssH);
            if (sb) {
              const handle = hitTestHandle(sb, px, py);
              if (handle) {
                const center = getStrokeRotationCenter(strokes[si], cssW, cssH);
                selectionDraftStrokesRef.current = cloneStrokes(strokes);
                selectionHandleRef.current = handle;
                selectionBoundsRef.current = sb;
                selectionDragRef.current = {
                  startNx: p.x,
                  startNy: p.y,
                  originalPoints: strokes[si].points.map((pt) => ({ ...pt })),
                  originalRotation: strokes[si].rotation ?? 0,
                  rotateCenterNx: center?.cx ?? (sb.minX + sb.maxX) / 2 / cssW,
                  rotateCenterNy: center?.cy ?? (sb.minY + sb.maxY) / 2 / cssH,
                };
                if (handle === 'rotate') {
                  const centerX = (sb.minX + sb.maxX) / 2;
                  const centerY = (sb.minY + sb.maxY) / 2;
                  selectionRotationStartRef.current = Math.atan2(py - centerY, px - centerX);
                }
                drawingRef.current = true;
                capturedPointerIdRef.current = e.pointerId;
                try { c.setPointerCapture(e.pointerId); } catch { /* ignore */ }
                return;
              }
              if (px >= sb.minX && px <= sb.maxX && py >= sb.minY && py <= sb.maxY) {
                selectionDraftStrokesRef.current = cloneStrokes(strokes);
                const center = getStrokeRotationCenter(strokes[si], cssW, cssH);
                selectionDragRef.current = {
                  startNx: p.x,
                  startNy: p.y,
                  originalPoints: strokes[si].points.map((pt) => ({ ...pt })),
                  originalRotation: strokes[si].rotation ?? 0,
                  rotateCenterNx: center?.cx ?? (sb.minX + sb.maxX) / 2 / cssW,
                  rotateCenterNy: center?.cy ?? (sb.minY + sb.maxY) / 2 / cssH,
                };
                drawingRef.current = true;
                capturedPointerIdRef.current = e.pointerId;
                try { c.setPointerCapture(e.pointerId); } catch { /* ignore */ }
                return;
              }
            }
          }
        }

        // 命中测试所有笔迹（逆序 = 顶层优先），跳过橡皮擦痕迹和已擦除笔画
        let hit = -1;
        for (let i = strokes.length - 1; i >= 0; i--) {
          if (strokes[i].eraser) continue;
          if (strokes[i].erased) continue;
          if (hitTestStroke(strokes[i], px, py, cssW, cssH, 8)) {
            hit = i;
            break;
          }
        }
        setSelectedStrokeIndex(hit >= 0 ? hit : null);
        selectedStrokeIndexRef.current = hit >= 0 ? hit : null;
        selectionBoundsRef.current = null;
        redrawRef.current();
        return;
      }

      if (t === 'text') {
        // 先提交当前正在编辑的文字
        const prev = textEditRef.current;
        if (prev?.active && prev.text.trim()) {
          const stroke: StoryboardStroke = {
            points: [{ x: prev.nx, y: prev.ny }],
            color: brushColorRef.current,
            widthFrac: penWidthFracRef.current,
            shape: 'text',
            text: prev.text.trim(),
          };
          let next: StoryboardStroke[];
          if (prev.editingIndex !== null) {
            next = [...strokesRef.current];
            next[prev.editingIndex] = stroke;
          } else {
            next = [...strokesRef.current, stroke];
          }
          strokesRef.current = next;
          commitStrokesRef.current(next);
        }
        // 检测是否点击了已有文字笔迹 → 编辑
        const cw = c.width;
        const ch = c.height;
        const px = p.x * cw;
        const py = p.y * ch;
        let editIdx: number | null = null;
        let editText = '';
        for (let i = strokesRef.current.length - 1; i >= 0; i--) {
          const s = strokesRef.current[i];
          if (s.erased) continue;
          if (s.shape === 'text' && s.text && hitTestStroke(s, px, py, cw, ch, 8)) {
            editIdx = i;
            editText = s.text ?? '';
            break;
          }
        }
        setTextInputState({
          active: true,
          nx: p.x,
          ny: p.y,
          text: editText,
          editingIndex: editIdx,
        });
        return;
      }

      drawingRef.current = true;
      capturedPointerIdRef.current = e.pointerId;
      if (t === 'rect' || t === 'arrow') {
        currentStrokeRef.current = [p, p];
      } else {
        currentStrokeRef.current = [p];
      }
      redrawRef.current();
      try {
        c.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    };

    // ---- pointermove ----
    const onPointerMove = (e: PointerEvent) => {
      if (!drawingRef.current) return;
      if (capturedPointerIdRef.current !== null && e.pointerId !== capturedPointerIdRef.current) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();

      const t = toolRef.current;
      const coalesced = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];

      if (t === 'pen' || t === 'eraser') {
        processBatch(coalesced.length > 0 ? coalesced : [e]);
        return;
      }

      if (t === 'rect' || t === 'arrow') {
        const c = fgCanvasRef.current;
        if (!c) return;
        const sample = coalesced.length > 0 ? coalesced[coalesced.length - 1] : e;
        const r = c.getBoundingClientRect();
        const cp = normPointFromClientRect(r, sample.clientX, sample.clientY, true);
        if (!cp) return;
        currentStrokeRef.current = [currentStrokeRef.current[0], cp];
        const w = c.width;
        const h = c.height;
        const ctx = fgCtxRef.current ?? c.getContext('2d', { alpha: true }) ?? c.getContext('2d');
        if (!ctx) return;
        fgCtxRef.current = ctx;
        drawForegroundStrokes(ctx, w, h, strokesRef.current);
        const lw = Math.max(1, penWidthFracRef.current * Math.min(w, h));
        drawShapePreview(ctx, w, h, currentStrokeRef.current[0], cp, t, brushColorRef.current, lw);
        return;
      }

      if (t === 'select') {
        const sd = selectionDragRef.current;
        if (!sd) return;
        const c = fgCanvasRef.current;
        if (!c) return;
        const sample = coalesced.length > 0 ? coalesced[coalesced.length - 1] : e;
        const r = c.getBoundingClientRect();
        const cp = normPointFromClientRect(r, sample.clientX, sample.clientY, true);
        if (!cp) return;
        const cssW = c.clientWidth || c.width;
        const cssH = c.clientHeight || c.height;
        const si = selectedStrokeIndexRef.current;
        if (si === null) return;
        const draft = selectionDraftStrokesRef.current;
        if (!draft || si >= draft.length) return;
        const orig = sd.originalPoints;
        const dxN = cp.x - sd.startNx;
        const dyN = cp.y - sd.startNy;

        if (selectionHandleRef.current && selectionBoundsRef.current) {
          const sb = selectionBoundsRef.current;
          const handle = selectionHandleRef.current;

          if (handle === 'rotate') {
            const centerX = (sb.minX + sb.maxX) / 2;
            const centerY = (sb.minY + sb.maxY) / 2;
            const currentAngle = Math.atan2(cp.y * cssH - centerY, cp.x * cssW - centerX);
            const deltaAngle = currentAngle - selectionRotationStartRef.current;
            draft[si] = {
              ...draft[si],
              points: rotateNormalizedPoints(orig, sd.rotateCenterNx, sd.rotateCenterNy, deltaAngle),
              rotation: undefined,
            };
          } else {
            const orig = sd.originalPoints;
            const origMinX = Math.min(...orig.map((p) => p.x));
            const origMinY = Math.min(...orig.map((p) => p.y));
            const origMaxX = Math.max(...orig.map((p) => p.x));
            const origMaxY = Math.max(...orig.map((p) => p.y));

            const movedX = sd.startNx + dxN;
            const movedY = sd.startNy + dyN;

            let newMinX = origMinX, newMinY = origMinY, newMaxX = origMaxX, newMaxY = origMaxY;
            if (handle === 'nw') { newMinX = movedX; newMinY = movedY; }
            else if (handle === 'ne') { newMaxX = movedX; newMinY = movedY; }
            else if (handle === 'sw') { newMinX = movedX; newMaxY = movedY; }
            else { newMaxX = movedX; newMaxY = movedY; }

            const newSpanX = Math.abs(newMaxX - newMinX) || 0.001;
            const newSpanY = Math.abs(newMaxY - newMinY) || 0.001;
            const origSpanX = origMaxX - origMinX || 0.001;
            const origSpanY = origMaxY - origMinY || 0.001;

            const sx = newSpanX / origSpanX;
            const sy = newSpanY / origSpanY;

            let anchorX: number, anchorY: number;
            if (handle === 'nw') { anchorX = origMaxX; anchorY = origMaxY; }      // 左上角拖拽，锚点为右下角(se)
            else if (handle === 'ne') { anchorX = origMinX; anchorY = origMaxY; }  // 右上角拖拽，锚点为左下角(sw)
            else if (handle === 'sw') { anchorX = origMaxX; anchorY = origMinY; }  // 左下角拖拽，锚点为右上角(ne)
            else { anchorX = origMinX; anchorY = origMinY; }                        // 右下角拖拽，锚点为左上角(nw)

            draft[si] = {
              ...draft[si],
              points: orig.map((pt) => ({
                x: anchorX + (pt.x - anchorX) * sx,
                y: anchorY + (pt.y - anchorY) * sy,
              })),
              rotation: undefined,
            };
          }
        } else {
          draft[si] = {
            ...draft[si],
            points: orig.map((pt) => ({ x: pt.x + dxN, y: pt.y + dyN })),
            rotation: undefined,
          };
        }
        strokesRef.current = draft;
        redrawRef.current();
      }
    };

    // ---- pointerup ----
    const onPointerEnd = (e: PointerEvent) => {
      if (capturedPointerIdRef.current !== null && e.pointerId !== capturedPointerIdRef.current) {
        return;
      }
      if (!drawingRef.current) return;

      const t = toolRef.current;

      if (t === 'pen' || t === 'eraser') {
        const coalesced =
          typeof e.getCoalescedEvents === 'function' ? (e.getCoalescedEvents() as PenClientSample[]) : [];
        processBatch(coalesced.length > 0 ? coalesced : [e]);

        drawingRef.current = false;
        capturedPointerIdRef.current = null;
        try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
        const pts = currentStrokeRef.current;
        currentStrokeRef.current = [];
        if (pts.length < 2) {
          if (t === 'eraser') {
            const wrap = wrapRef.current;
            const { w, h } = wrap ? readStoryboardPaintBox(wrap) : { w: canvas.width, h: canvas.height };
            const eraserWidth = eraserWidthFracRef.current * 1.45;
            const next = applyEraserToStrokes(strokesRef.current, pts, eraserWidth, w, h);
            commitStrokesRef.current(next);
          }
          redrawRef.current();
          return;
        }

        if (t === 'eraser') {
          const wrap = wrapRef.current;
          const { w, h } = wrap ? readStoryboardPaintBox(wrap) : { w: canvas.width, h: canvas.height };
          const eraserWidth = eraserWidthFracRef.current * 1.45;
          const next = applyEraserToStrokes(strokesRef.current, pts, eraserWidth, w, h);
          commitStrokesRef.current(next);
          return;
        }

        const stroke: StoryboardStroke = {
          points: pts,
          color: brushColorRef.current,
          widthFrac: penWidthFracRef.current,
        };
        commitStrokesRef.current([...strokesRef.current, stroke]);
        return;
      }

      if (t === 'rect' || t === 'arrow') {
        drawingRef.current = false;
        capturedPointerIdRef.current = null;
        try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
        const pts = currentStrokeRef.current;
        currentStrokeRef.current = [];
        if (pts.length < 2) { redrawRef.current(); return; }
        if (Math.abs(pts[1].x - pts[0].x) < 0.001 && Math.abs(pts[1].y - pts[0].y) < 0.001) {
          redrawRef.current();
          return;
        }
        const stroke: StoryboardStroke = {
          points: [pts[0], pts[1]],
          color: brushColorRef.current,
          widthFrac: penWidthFracRef.current,
          shape: t,
        };
        commitStrokesRef.current([...strokesRef.current, stroke]);
        return;
      }

      if (t === 'select') {
        drawingRef.current = false;
        capturedPointerIdRef.current = null;
        try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
        if (selectionDragRef.current && selectionDraftStrokesRef.current) {
          commitStrokesRef.current(cloneStrokes(selectionDraftStrokesRef.current));
          selectionDraftStrokesRef.current = null;
          selectionDragRef.current = null;
          selectionHandleRef.current = null;
          selectionBoundsRef.current = null;
        }
      }
    };

    const onLostPointerCapture = (e: Event) => {
      const ev = e as PointerEvent;
      if (!drawingRef.current) return;
      if (capturedPointerIdRef.current !== null && ev.pointerId !== capturedPointerIdRef.current) {
        return;
      }
      onPointerEnd(ev);
    };

    canvas.addEventListener('pointerdown', onPointerDown, paintOpts);
    canvas.addEventListener('pointermove', onPointerMove, paintOpts);
    canvas.addEventListener('pointerup', onPointerEnd, paintOpts);
    canvas.addEventListener('pointercancel', onPointerEnd, paintOpts);
    canvas.addEventListener('lostpointercapture', onLostPointerCapture, paintOpts);

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown, paintOpts);
      canvas.removeEventListener('pointermove', onPointerMove, paintOpts);
      canvas.removeEventListener('pointerup', onPointerEnd, paintOpts);
      canvas.removeEventListener('pointercancel', onPointerEnd, paintOpts);
      canvas.removeEventListener('lostpointercapture', onLostPointerCapture, paintOpts);
    };
  }, [id]);

  const handleUndo = useCallback(() => {
    if (undoStackRef.current.length === 0) return;
    if (exportTimerRef.current) {
      clearTimeout(exportTimerRef.current);
      exportTimerRef.current = null;
    }
    const restored = undoStackRef.current.pop()!;
    redoStackRef.current.push(cloneStrokes(strokesRef.current));
    setSelectedStrokeIndex(null);
    selectedStrokeIndexRef.current = null;
    selectionBoundsRef.current = null;
    selectionDraftStrokesRef.current = null;
    selectionDragRef.current = null;
    updateNodeData(id, { strokes: restored }, { recordUndo: false });
    scheduleExport(restored, baseImageUrl);
    bumpHistory();
  }, [baseImageUrl, bumpHistory, id, scheduleExport, updateNodeData]);

  const handleRedo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    if (exportTimerRef.current) {
      clearTimeout(exportTimerRef.current);
      exportTimerRef.current = null;
    }
    const next = redoStackRef.current.pop()!;
    undoStackRef.current.push(cloneStrokes(strokesRef.current));
    if (undoStackRef.current.length > STORYBOARD_HISTORY_MAX) {
      undoStackRef.current.shift();
    }
    setSelectedStrokeIndex(null);
    selectedStrokeIndexRef.current = null;
    selectionBoundsRef.current = null;
    selectionDraftStrokesRef.current = null;
    selectionDragRef.current = null;
    updateNodeData(id, { strokes: next }, { recordUndo: false });
    scheduleExport(next, baseImageUrl);
    bumpHistory();
  }, [baseImageUrl, bumpHistory, id, scheduleExport, updateNodeData]);

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (isNativeTextUndoTarget(e.target)) return;

      const isMac = typeof navigator !== 'undefined' && navigator.platform?.includes('Mac');
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod) return;

      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [handleRedo, handleUndo, selected]);

  const clearAll = () => {
    if (exportTimerRef.current) {
      clearTimeout(exportTimerRef.current);
      exportTimerRef.current = null;
    }
    undoStackRef.current.push(cloneStrokes(strokesRef.current));
    if (undoStackRef.current.length > STORYBOARD_HISTORY_MAX) {
      undoStackRef.current.shift();
    }
    redoStackRef.current = [];
    setSelectedStrokeIndex(null);
    selectedStrokeIndexRef.current = null;
    selectionBoundsRef.current = null;
    updateNodeData(id, { strokes: [], fileUrl: '' });
    bumpHistory();
  };

  const canUndo = undoStackRef.current.length > 0;
  const canRedo = redoStackRef.current.length > 0;

  let brushWidthPreviewPx = 0;
  if (widthPreviewActive) {
    const el = wrapRef.current;
    const rw = el ? el.clientWidth : 200;
    const rh = el ? el.clientHeight : 140;
    const wf = tool === 'eraser' ? eraserWidthFrac * 1.45 : penWidthFrac;
    brushWidthPreviewPx = Math.max(4, Math.min(520, wf * Math.min(Math.max(1, rw), Math.max(1, rh))));
  }

  const eraserCursorCss = (() => {
    const el = wrapRef.current;
    const rw = el ? el.clientWidth : 200;
    const rh = el ? el.clientHeight : 140;
    const px = eraserWidthFrac * 1.45 * Math.min(Math.max(1, rw), Math.max(1, rh));
    return makeEraserCursorDataUrl(px);
  })();

  return (
    <div className="mc-node-port-shell mc-storyboard-node relative h-full min-h-[120px] w-full min-w-[200px] overflow-visible">
      <NodeResizer
        nodeId={id}
        isVisible={selected}
        minWidth={200}
        minHeight={140}
        color="rgba(255,255,255,0.35)"
        lineClassName="!border-0 !bg-transparent opacity-0"
        handleClassName="!h-2.5 !w-2.5 !rounded-sm !border !border-white/35 !bg-[#1b2021]/90 !shadow-[0_0_10px_rgba(255,255,255,0.12)]"
        onResizeEnd={(_, p) => {
          updateStoryboardGeometry(id, { x: p.x, y: p.y, width: p.width, height: p.height });
        }}
      />

      <Handle type="target" position={Position.Left} className="mc-node-handle" />
      <Handle type="source" position={Position.Right} className="mc-node-handle" />

      <div className="flex h-full min-h-[120px] w-full flex-col overflow-hidden rounded-xl border border-white/16 bg-[#1a1c1e]/95 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
      <div className="mc-storyboard-drag flex w-full min-w-0 cursor-grab items-center gap-2 border-b border-white/10 bg-black/25 px-2.5 py-2 active:cursor-grabbing">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/18 bg-white/[0.07] text-zinc-100">
          <Pencil className="h-3.5 w-3.5" />
        </span>
        <span
          className="nodrag nopan shrink-0 select-none truncate text-xs font-medium leading-7 text-zinc-100"
          title="节点名称"
        >
          {(typeof nodeData.label === 'string' && nodeData.label.trim()) || '手绘分镜'}
        </span>
        <div className="nodrag nopan flex min-h-[28px] min-w-0 flex-1 flex-wrap items-center gap-1.5">
          <div className="nodrag nopan flex shrink-0 rounded-md border border-white/12 p-0.5">
            <button
              type="button"
              title="画笔"
              onClick={() => setTool('pen')}
              className={cn(
                'nodrag nopan rounded px-1.5 py-1 text-zinc-400 transition-colors',
                tool === 'pen' ? 'bg-white/15 text-zinc-100' : 'hover:bg-white/10 hover:text-zinc-100'
              )}
            >
              <PenLine className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title="橡皮擦"
              onClick={() => setTool('eraser')}
              className={cn(
                'nodrag nopan rounded px-1.5 py-1 transition-colors',
                tool === 'eraser' ? 'bg-white/15' : 'hover:bg-white/10'
              )}
            >
              <StoryboardEraserIcon className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="nodrag nopan flex shrink-0 rounded-md border border-white/12 p-0.5">
            <button
              type="button"
              title="矩形"
              onClick={() => setTool('rect')}
              className={cn(
                'nodrag nopan rounded px-1.5 py-1 text-zinc-400 transition-colors',
                tool === 'rect' ? 'bg-white/15 text-zinc-100' : 'hover:bg-white/10 hover:text-zinc-100'
              )}
            >
              <Square className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title="箭头"
              onClick={() => setTool('arrow')}
              className={cn(
                'nodrag nopan rounded px-1.5 py-1 text-zinc-400 transition-colors',
                tool === 'arrow' ? 'bg-white/15 text-zinc-100' : 'hover:bg-white/10 hover:text-zinc-100'
              )}
            >
              <ArrowRightIcon className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title="选择"
              onClick={() => setTool('select')}
              className={cn(
                'nodrag nopan rounded px-1.5 py-1 text-zinc-400 transition-colors',
                tool === 'select' ? 'bg-white/15 text-zinc-100' : 'hover:bg-white/10 hover:text-zinc-100'
              )}
            >
              <MousePointer2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title="文字"
              onClick={() => setTool('text')}
              className={cn(
                'nodrag nopan rounded px-1.5 py-1 text-zinc-400 transition-colors',
                tool === 'text' ? 'bg-white/15 text-zinc-100' : 'hover:bg-white/10 hover:text-zinc-100'
              )}
            >
              <Type className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="nodrag nopan flex rounded-md border border-white/12 p-0.5">
            <button
              type="button"
              title="撤回 (Ctrl+Z)"
              disabled={!canUndo}
              onClick={handleUndo}
              className={cn(
                'nodrag nopan rounded px-1.5 py-1 text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100',
                !canUndo && 'pointer-events-none opacity-35'
              )}
            >
              <Undo2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title="前进 (Ctrl+Y / Ctrl+Shift+Z)"
              disabled={!canRedo}
              onClick={handleRedo}
              className={cn(
                'nodrag nopan rounded px-1.5 py-1 text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100',
                !canRedo && 'pointer-events-none opacity-35'
              )}
            >
              <Redo2 className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="nodrag nopan flex min-h-4 min-w-[64px] flex-1 cursor-pointer items-center px-0.5">
            <input
              type="range"
              title={tool === 'eraser' ? '橡皮擦粗细' : '画笔粗细'}
              min={BRUSH_WIDTH_MIN}
              max={BRUSH_WIDTH_MAX}
              step={BRUSH_WIDTH_STEP}
              value={tool === 'eraser' ? eraserWidthFrac : penWidthFrac}
              onInput={(e) => {
                const v = Number(e.currentTarget.value);
                if (tool === 'eraser') setEraserWidthFrac(v);
                else setPenWidthFrac(v);
              }}
              onChange={(e) => {
                const v = Number(e.currentTarget.value);
                if (tool === 'eraser') setEraserWidthFrac(v);
                else setPenWidthFrac(v);
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
                setWidthPreviewActive(true);
              }}
              className="h-4 w-full cursor-pointer accent-zinc-300 [&::-moz-range-thumb]:cursor-pointer [&::-webkit-slider-runnable-track]:cursor-pointer [&::-webkit-slider-thumb]:cursor-pointer"
            />
          </div>
          <div className="flex items-center gap-1">
            <label
              style={{ cursor: 'pointer' }}
              className="nodrag nopan relative flex h-7 w-7 shrink-0 !cursor-pointer items-center justify-center overflow-hidden rounded-md border border-white/18 bg-black/30 shadow-inner shadow-black/20"
              title="选择笔色"
            >
              <input
                type="color"
                value={brushColor}
                onChange={(e) => setBrushColor(e.target.value)}
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                className="absolute inset-0 h-full w-full !cursor-pointer opacity-0"
              />
              <span
                className="pointer-events-none h-4 w-4 rounded-sm border border-white/15 shadow-sm"
                style={{ backgroundColor: brushColor }}
              />
            </label>
          </div>
          <button
            type="button"
            title="清空画板"
            onClick={clearAll}
            className="nodrag nopan flex h-7 w-7 items-center justify-center rounded-md border border-white/12 text-zinc-400 hover:border-white/22 hover:bg-white/10 hover:text-zinc-100"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div ref={wrapRef} className="relative min-h-0 flex-1 bg-zinc-100">
        <canvas
          ref={bgCanvasRef}
          className="nodrag nopan pointer-events-none absolute inset-0 z-0 block h-full w-full touch-none"
          aria-hidden
        />
        <canvas
          ref={fgCanvasRef}
          className={cn(
            'nodrag nopan absolute inset-0 z-[1] block h-full w-full touch-none',
            (tool === 'pen' || tool === 'rect' || tool === 'arrow') && 'cursor-crosshair',
            tool === 'select' && 'cursor-default',
            tool === 'text' && 'cursor-text'
          )}
          style={tool === 'eraser' ? { cursor: eraserCursorCss } : undefined}
        />
        {widthPreviewActive ? (
          <div
            className="pointer-events-none absolute inset-0 z-[2] flex items-center justify-center"
            aria-hidden
          >
            <div
              className="rounded-full shadow-[0_0_0_1px_rgba(0,0,0,0.22)]"
              style={{
                width: brushWidthPreviewPx,
                height: brushWidthPreviewPx,
                backgroundColor: brushColor,
              }}
            />
          </div>
        ) : null}
        {textInputState?.active ? (
          <input
            ref={textInputRef}
            className="nodrag nopan absolute z-0 opacity-0"
            style={{
              left: '0px',
              top: '0px',
              width: '1px',
              height: '1px',
              fontSize: '1px',
            }}
            value={textInputState.text}
            onChange={(e) =>
              setTextInputState((prev) =>
                prev ? { ...prev, text: e.target.value } : null
              )
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                const prev = textEditRef.current;
                const txt = prev?.text.trim();
                if (txt && prev) {
                  const stroke: StoryboardStroke = {
                    points: [{ x: prev.nx, y: prev.ny }],
                    color: brushColorRef.current,
                    widthFrac: penWidthFracRef.current,
                    shape: 'text',
                    text: txt,
                  };
                  let next: StoryboardStroke[];
                  if (prev.editingIndex !== null) {
                    next = [...strokesRef.current];
                    next[prev.editingIndex] = stroke;
                  } else {
                    next = [...strokesRef.current, stroke];
                  }
                  strokesRef.current = next;
                  commitStrokesRef.current(next);
                }
                setTextInputState(null);
              } else if (e.key === 'Escape') {
                setTextInputState(null);
              }
            }}
            onBlur={() => {
              setTimeout(() => {
                const prev = textEditRef.current;
                if (!prev?.active) return;
                const txt = prev.text.trim();
                if (txt) {
                  const stroke: StoryboardStroke = {
                    points: [{ x: prev.nx, y: prev.ny }],
                    color: brushColorRef.current,
                    widthFrac: penWidthFracRef.current,
                    shape: 'text',
                    text: txt,
                  };
                  let next: StoryboardStroke[];
                  if (prev.editingIndex !== null) {
                    next = [...strokesRef.current];
                    next[prev.editingIndex] = stroke;
                  } else {
                    next = [...strokesRef.current, stroke];
                  }
                  strokesRef.current = next;
                  commitStrokesRef.current(next);
                  setTextInputState(null);
                } else {
                  // 无文字时保持编辑状态，重新聚焦输入框
                  textInputRef.current?.focus();
                }
              }, 150);
            }}
          />
        ) : null}
      </div>

      <div className="mc-storyboard-footer nodrag nopan flex flex-col gap-1 border-t border-white/8 bg-black/20 px-2 py-1.5">
        <p className="text-[10px] leading-snug text-zinc-500">
          左侧可接入图片素材或图像生成节点作为底图叠画；连线至图像 / 视频节点输出参考图。
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="shrink-0 text-[10px] text-zinc-500">@ 引用名</span>
          <Input
            value={typeof nodeData.mentionSlug === 'string' ? nodeData.mentionSlug : ''}
            onChange={(e) => updateNodeData(id, { mentionSlug: sanitizeStoryboardSlugInput(e.target.value) })}
            onBlur={(e) => {
              const next = sanitizeStoryboardSlugInput(e.target.value.trim());
              updateNodeData(id, { mentionSlug: next || defaultStoryboardSlug(id) });
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="如 分镜A"
            title="提示词中 @ 引用使用的名称"
            className="mc-storyboard-mention-input nodrag nopan nowheel mc-node-frost-surface h-7 min-w-[120px] flex-1 border border-white/12 bg-black/25 px-2 text-[11px] text-zinc-200 placeholder:text-zinc-600 focus-visible:border-white/20 focus-visible:outline-none focus-visible:ring-0"
          />
        </div>
      </div>
      </div>
    </div>
  );
}

export default memo(StoryboardNode);
