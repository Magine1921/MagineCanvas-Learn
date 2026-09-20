'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useReactFlow, useStoreApi } from 'reactflow';
import type { MaterialRef } from '@/lib/material-mentions';
import { replaceMaterialMentionQueryAtCursor } from '@/lib/material-mention-edit';
import { cn } from '@/lib/utils';
import { FileText, Video } from 'lucide-react';
import { MaterialThumbWithHover, isDisplayableRasterUrl } from '@/components/canvas/MaterialThumbWithHover';
import { useMaterialMediaHoverPreview } from '@/components/canvas/MaterialMediaHoverPreview';
import { resolveMaterialPlayableUrl } from '@/lib/material-disk-playable-url';

export interface MentionTextareaSize {
  width: number;
  height: number;
}

type MentionPortalPos = {
  left: number;
  top: number;
  maxH: number;
  width: number;
  transform: string;
};

interface MentionTextareaProps {
  value: string;
  onChange: (next: string) => void;
  materials: MaterialRef[];
  placeholder?: string;
  className?: string;
  minHeight?: string;
  minResizeWidth?: number;
  minResizeHeight?: number;
  /** 固定最大高度（px）；超出后内部滚动，不撑开外层布局 */
  maxHeight?: number;
  fillHeight?: boolean;
  size?: MentionTextareaSize;
  onLiveSizeChange?: (size: MentionTextareaSize) => void;
  onSizeChange?: (size: MentionTextareaSize) => void;
  autoFocus?: boolean;
}

const MENTION_RE = /\[([a-zA-Z0-9_\u4e00-\u9fff\-.:]+)\]/g;

type RenderPart =
  | { type: 'text'; text: string; key: string }
  | { type: 'mention'; slug: string; material: MaterialRef; key: string };

function mentionText(slug: string) {
  return `[${slug}]`;
}

function materialVisualSignature(materials: MaterialRef[]): string {
  return materials.map((material) => [
    material.nodeId,
    material.slug,
    material.fileType || '',
    material.fileUrl || '',
    material.thumbnailUrl || '',
    material.fileName || '',
  ].join('\u001f')).join('\u001e');
}

function setMentionImageSource(
  image: HTMLImageElement,
  primaryUrl: string,
  fallbackUrl = '',
) {
  const primary = resolveMaterialPlayableUrl(primaryUrl, 'image');
  const fallback = resolveMaterialPlayableUrl(fallbackUrl, 'image');
  image.src = primary || fallback;
  if (!fallback || fallback === primary) return;
  image.onerror = () => {
    image.onerror = null;
    image.src = fallback;
  };
}

function getMentionSlug(node: Node | null): string | null {
  if (!(node instanceof HTMLElement)) return null;
  return node.dataset.mentionSlug || null;
}

function isMentionNode(node: Node | null): node is HTMLElement {
  return Boolean(getMentionSlug(node));
}

function nodePlainLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent || '').length;
  }

  if (isMentionNode(node)) {
    return mentionText(node.dataset.mentionSlug || '').length;
  }

  if (node.nodeName === 'BR') return 1;

  let length = 0;
  node.childNodes.forEach((child) => {
    length += nodePlainLength(child);
  });
  return length;
}

function serializeEditor(root: HTMLElement): string {
  let out = '';

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent || '';
      return;
    }

    if (isMentionNode(node)) {
      out += mentionText(node.dataset.mentionSlug || '');
      return;
    }

    if (node.nodeName === 'BR') {
      out += '\n';
      return;
    }

    node.childNodes.forEach(walk);
  };

  root.childNodes.forEach(walk);
  return out.replace(/\u00a0/g, ' ');
}

function nodeContains(container: Node, target: Node): boolean {
  return container === target || container.contains(target);
}

function getCaretOffset(root: HTMLElement): number {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return serializeEditor(root).length;

  const range = selection.getRangeAt(0);
  if (!nodeContains(root, range.endContainer)) return serializeEditor(root).length;

  let offset = 0;
  let found = false;

  const walk = (node: Node): void => {
    if (found) return;

    if (node === range.endContainer) {
      if (node.nodeType === Node.TEXT_NODE) {
        offset += Math.min(range.endOffset, (node.textContent || '').length);
      } else {
        const children = Array.from(node.childNodes);
        for (let index = 0; index < Math.min(range.endOffset, children.length); index += 1) {
          offset += nodePlainLength(children[index]);
        }
      }
      found = true;
      return;
    }

    if (nodeContains(node, range.endContainer)) {
      node.childNodes.forEach(walk);
      return;
    }

    offset += nodePlainLength(node);
  };

  root.childNodes.forEach(walk);
  if (!found) {
    return serializeEditor(root).length;
  }
  return offset;
}

/** IME/粘贴后 DOM 光标常滞后，根据文本 diff 估算正确位置 */
function estimateCaretAfterEdit(prev: string, next: string, reportedCursor: number): number {
  if (next === prev) {
    return Math.min(Math.max(reportedCursor, 0), next.length);
  }

  if (next.length > prev.length) {
    if (prev.length === 0 || next.startsWith(prev)) {
      return next.length;
    }

    let prefix = 0;
    while (prefix < prev.length && prefix < next.length && prev[prefix] === next[prefix]) {
      prefix += 1;
    }

    let suffix = 0;
    while (
      suffix < prev.length - prefix &&
      suffix < next.length - prefix &&
      prev[prev.length - 1 - suffix] === next[next.length - 1 - suffix]
    ) {
      suffix += 1;
    }

    return prefix + (next.length - prev.length);
  }

  return Math.min(Math.max(reportedCursor, 0), next.length);
}

/** 受控值被自动补全引用时，将旧文本光标映射到新文本的同一语义位置。 */
function mapCaretAcrossValueChange(previous: string, next: string, caret: number): number {
  const safeCaret = Math.min(Math.max(caret, 0), previous.length);
  if (previous === next) return Math.min(safeCaret, next.length);

  let prefix = 0;
  while (
    prefix < previous.length
    && prefix < next.length
    && previous[prefix] === next[prefix]
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < previous.length - prefix
    && suffix < next.length - prefix
    && previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  if (safeCaret <= prefix) return safeCaret;
  if (safeCaret >= previous.length - suffix) {
    return Math.min(next.length, next.length - (previous.length - safeCaret));
  }

  const changedLength = Math.max(0, next.length - prefix - suffix);
  return prefix + Math.min(safeCaret - prefix, changedLength);
}

/** 在纯文本偏移处构建折叠 Range（不写入 Selection），供测量光标屏幕坐标 */
function buildCollapsedRangeAtPlainOffset(root: HTMLElement, plainOffset: number): Range {
  const range = document.createRange();
  const target = Math.max(0, plainOffset);
  let seen = 0;
  let placed = false;

  const placeBefore = (node: Node) => {
    range.setStartBefore(node);
    range.collapse(true);
    placed = true;
  };

  const placeAfter = (node: Node) => {
    range.setStartAfter(node);
    range.collapse(true);
    placed = true;
  };

  const walk = (node: Node): void => {
    if (placed) return;

    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || '';
      if (target <= seen + text.length) {
        range.setStart(node, Math.max(0, target - seen));
        range.collapse(true);
        placed = true;
      } else {
        seen += text.length;
      }
      return;
    }

    if (isMentionNode(node)) {
      const length = nodePlainLength(node);
      if (target <= seen) {
        placeBefore(node);
      } else if (target <= seen + length) {
        placeAfter(node);
      } else {
        seen += length;
      }
      return;
    }

    if (node.nodeName === 'BR') {
      if (target <= seen) placeBefore(node);
      else if (target <= seen + 1) placeAfter(node);
      else seen += 1;
      return;
    }

    node.childNodes.forEach(walk);
  };

  root.childNodes.forEach(walk);

  if (!placed) {
    range.selectNodeContents(root);
    range.collapse(false);
  }

  return range;
}

function getCaretClientRectAtPlainOffset(root: HTMLElement, plainOffset: number): DOMRect | null {
  const range = buildCollapsedRangeAtPlainOffset(root, plainOffset);
  let rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    const rects = range.getClientRects();
    if (rects.length > 0) {
      rect = rects[rects.length - 1]!;
    }
  }
  if (rect.width === 0 && rect.height === 0) {
    const lh = parseFloat(getComputedStyle(root).lineHeight) || 20;
    return new DOMRect(rect.left, rect.top, 2, lh);
  }
  return rect;
}

function setCaretOffset(root: HTMLElement, plainOffset: number) {
  const selection = window.getSelection();
  if (!selection) return;
  const range = buildCollapsedRangeAtPlainOffset(root, plainOffset);
  selection.removeAllRanges();
  selection.addRange(range);
}

function replaceSelectionWithText(text: string) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;

  const range = selection.getRangeAt(0);
  range.deleteContents();
  const textNode = document.createTextNode(text);
  range.insertNode(textNode);
  range.setStart(textNode, text.length);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function parseValue(value: string, materials: MaterialRef[]): RenderPart[] {
  const materialMap = new Map(materials.map((m) => [m.slug, m]));
  const parts: RenderPart[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const re = new RegExp(MENTION_RE.source, 'g');

  while ((match = re.exec(value)) !== null) {
    const slug = match[1];
    const material = materialMap.get(slug);

    if (match.index > lastIndex) {
      parts.push({
        type: 'text',
        text: value.slice(lastIndex, match.index),
        key: `t-${lastIndex}`,
      });
    }

    if (material) {
      parts.push({
        type: 'mention',
        slug,
        material,
        key: `m-${match.index}-${slug}`,
      });
    } else {
      parts.push({
        type: 'text',
        text: match[0],
        key: `u-${match.index}-${slug}`,
      });
    }

    lastIndex = re.lastIndex;
  }

  if (lastIndex < value.length) {
    parts.push({
      type: 'text',
      text: value.slice(lastIndex),
      key: `t-${lastIndex}`,
    });
  }

  return parts;
}

function appendTextWithNewlines(container: HTMLElement, text: string) {
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    if (line) {
      container.appendChild(document.createTextNode(line));
    }
    if (index < lines.length - 1) {
      container.appendChild(document.createElement('br'));
    }
  });
}

function createMentionElement(slug: string, material: MaterialRef): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'mention-token';
  span.dataset.mentionSlug = slug;
  span.contentEditable = 'false';
  span.draggable = false;
  span.title = `@${slug}${material.fileName ? ` · ${material.fileName}` : ''}`;

  const thumb = document.createElement('span');
  thumb.className = 'mention-token-thumb relative block overflow-visible h-5 w-5';

  if (material.fileType === 'video' && material.fileUrl) {
    if (material.thumbnailUrl) {
      const img = document.createElement('img');
      setMentionImageSource(img, material.thumbnailUrl, material.fileUrl);
      img.alt = '';
      img.draggable = false;
      img.className = 'h-full w-full object-cover rounded-[3px]';
      thumb.appendChild(img);
    }
    const mark = document.createElement('span');
    mark.className = 'mention-token-video-mark pointer-events-none';
    mark.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-2.5 w-2.5 text-white/90"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
    thumb.appendChild(mark);
  } else if (material.fileUrl && (material.fileType === 'image' || !material.fileType)) {
    const img = document.createElement('img');
    setMentionImageSource(
      img,
      material.thumbnailUrl || material.fileUrl,
      material.fileUrl,
    );
    img.alt = '';
    img.draggable = false;
    img.className = 'h-full w-full object-cover rounded-[3px]';
    thumb.appendChild(img);
  } else {
    thumb.className = 'mention-token-thumb mention-token-thumb-file relative block overflow-visible h-5 w-5';
  }

  span.appendChild(thumb);

  const name = document.createElement('span');
  name.className = 'mention-token-name';
  name.textContent = slug;
  span.appendChild(name);

  return span;
}

function syncEditorFromValue(
  editor: HTMLElement,
  value: string,
  materials: MaterialRef[],
  force = false,
): boolean {
  if (!force && serializeEditor(editor) === value) return false;

  editor.innerHTML = '';
  for (const part of parseValue(value, materials)) {
    if (part.type === 'text') {
      appendTextWithNewlines(editor, part.text);
    } else if (part.type === 'mention') {
      editor.appendChild(createMentionElement(part.slug, part.material));
    }
  }
  return true;
}

function restoreEditorCaret(editor: HTMLElement, offset: number) {
  const textLen = serializeEditor(editor).length;
  const target = Math.min(Math.max(offset, 0), textLen);
  setCaretOffset(editor, target);
  return target;
}

export function MentionTextarea({
  value,
  onChange,
  materials,
  placeholder,
  className,
  minHeight = 'min-h-[80px]',
  minResizeWidth = 160,
  minResizeHeight = 64,
  maxHeight,
  fillHeight = false,
  size,
  onLiveSizeChange,
  onSizeChange,
  autoFocus = false,
}: MentionTextareaProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const pendingCursorRef = useRef<number | null>(null);
  const lastValueRef = useRef(value);
  const pendingLocalValueRef = useRef<string | null>(null);
  const boxSizeRef = useRef<MentionTextareaSize | undefined>(size);
  const resizeFrameRef = useRef<number | null>(null);
  const pendingResizeRef = useRef<MentionTextareaSize | null>(null);
  const autoFocusAppliedRef = useRef(false);
  const isComposingRef = useRef(false);
  const skipNextInputCommitRef = useRef(false);
  const imeRestoreCursorRef = useRef<number | null>(null);
  const [boxSize, setBoxSize] = useState<MentionTextareaSize | undefined>();
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [mentionAnchor, setMentionAnchor] = useState(0);
  const [mentionPortalPos, setMentionPortalPos] = useState<MentionPortalPos | null>(null);
  const [mentionLayoutNonce, setMentionLayoutNonce] = useState(0);
  const [isFocused, setIsFocused] = useState(false);
  const reactFlow = useReactFlow();
  const storeApi = useStoreApi();
  const lastViewportTransformRef = useRef<[number, number, number] | null>(null);
  const materialsVisualSignature = useMemo(
    () => materialVisualSignature(materials),
    [materials],
  );
  const lastMaterialsVisualSignatureRef = useRef('');
  const materialHoverPreview = useMaterialMediaHoverPreview();

  const filtered = useMemo(() => {
    const q = mentionFilter.toLowerCase();
    return materials.filter((m) => m.slug.toLowerCase().includes(q));
  }, [materials, mentionFilter]);

  useLayoutEffect(() => {
    if (!mentionOpen) {
      setMentionPortalPos(null);
      return;
    }
    const editor = editorRef.current;
    const container = containerRef.current;
    if (!editor || !container) {
      setMentionPortalPos(null);
      return;
    }

    const plainOffset = mentionAnchor + 1 + mentionFilter.length;
    const rect = getCaretClientRectAtPlainOffset(editor, plainOffset);
    if (!rect) {
      setMentionPortalPos(null);
      return;
    }

    const margin = 8;
    const gap = 6;
    const portW = Math.min(400, Math.max(220, window.innerWidth - margin * 2));
    let left = rect.left;
    left = Math.max(margin, Math.min(left, window.innerWidth - portW - margin));

    const containerRect = container.getBoundingClientRect();
    const spaceBelowVp = window.innerHeight - rect.bottom - margin;
    const spaceBelowContainer = containerRect.bottom - rect.bottom;
    const preferUp =
      spaceBelowVp < 170 ||
      (spaceBelowContainer < 120 && spaceBelowVp < spaceBelowContainer + 80);

    if (preferUp) {
      const maxH = Math.min(280, Math.max(96, rect.top - margin - gap));
      setMentionPortalPos({
        left,
        top: rect.top - gap,
        maxH,
        width: portW,
        transform: 'translateY(-100%)',
      });
    } else {
      const maxH = Math.min(280, Math.max(96, spaceBelowVp - gap));
      setMentionPortalPos({
        left,
        top: rect.bottom + gap,
        maxH,
        width: portW,
        transform: 'none',
      });
    }
  }, [
    mentionOpen,
    mentionAnchor,
    mentionFilter,
    value,
    mentionLayoutNonce,
  ]);

  useEffect(() => {
    if (!mentionOpen) return;
    const bump = () => setMentionLayoutNonce((n) => n + 1);
    const editor = editorRef.current;
    editor?.addEventListener('scroll', bump, { passive: true });
    window.addEventListener('resize', bump);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(bump) : null;
    const c = containerRef.current;
    if (c && ro) ro.observe(c);
    if (editor && ro) ro.observe(editor);
    return () => {
      editor?.removeEventListener('scroll', bump);
      window.removeEventListener('resize', bump);
      ro?.disconnect();
    };
  }, [mentionOpen]);

  useEffect(() => {
    if (!mentionOpen) return;
    lastViewportTransformRef.current = storeApi.getState().transform;
    const unsub = storeApi.subscribe((state) => {
      const t = state.transform;
      const prev = lastViewportTransformRef.current;
      if (!prev || t[0] !== prev[0] || t[1] !== prev[1] || t[2] !== prev[2]) {
        lastViewportTransformRef.current = t;
        setMentionLayoutNonce((n) => n + 1);
      }
    });
    return unsub;
  }, [mentionOpen, storeApi]);

  const detectMention = useCallback((text: string, cursor: number) => {
    const before = text.slice(0, cursor);
    const at = before.lastIndexOf('@');
    if (at < 0) {
      setMentionOpen(false);
      return;
    }

    const frag = before.slice(at + 1);
    if (
      frag.includes(' ') ||
      frag.includes('\n') ||
      frag.includes('[') ||
      frag.includes(']')
    ) {
      setMentionOpen(false);
      return;
    }

    setMentionAnchor(at);
    setMentionFilter(frag);
    setMentionOpen(true);
  }, []);

  const commitFromDom = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const next = serializeEditor(editor);
    const reported = getCaretOffset(editor);

    lastValueRef.current = next;
    pendingLocalValueRef.current = next;
    onChange(next);
    detectMention(next, reported);
  }, [detectMention, onChange]);

  const commitFromDomAfterIme = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const next = serializeEditor(editor);
    const prev = lastValueRef.current;
    const reported = getCaretOffset(editor);
    const cursor = estimateCaretAfterEdit(prev, next, reported);

    lastValueRef.current = next;
    pendingLocalValueRef.current = next;
    onChange(next);
    detectMention(next, cursor);
    imeRestoreCursorRef.current = cursor;
  }, [detectMention, onChange]);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const domValue = serializeEditor(editor);
    const materialsChanged =
      lastMaterialsVisualSignatureRef.current !== materialsVisualSignature;
    lastMaterialsVisualSignatureRef.current = materialsVisualSignature;
    const isFocused = document.activeElement === editor;
    const isExternalValue = value !== lastValueRef.current;
    const pendingLocalValue = pendingLocalValueRef.current;
    const isStalePropAfterLocalEdit =
      isFocused &&
      pendingLocalValue !== null &&
      domValue === pendingLocalValue &&
      value !== pendingLocalValue;

    if (pendingLocalValue !== null && value === pendingLocalValue) {
      pendingLocalValueRef.current = null;
    }

    let didSync = false;
    let caretBeforeSync: number | null = null;
    let caretAfterSync: number | null = null;
    let scrollTopBeforeSync: number | null = null;
    let scrollLeftBeforeSync: number | null = null;
    if (materialsChanged) {
      caretBeforeSync = isFocused ? getCaretOffset(editor) : null;
      const renderValue = isStalePropAfterLocalEdit ? domValue : value;
      caretAfterSync = caretBeforeSync == null
        ? null
        : mapCaretAcrossValueChange(domValue, renderValue, caretBeforeSync);
      scrollTopBeforeSync = editor.scrollTop;
      scrollLeftBeforeSync = editor.scrollLeft;
      didSync = syncEditorFromValue(editor, renderValue, materials, true);
      if (didSync && !isStalePropAfterLocalEdit) {
        lastValueRef.current = value;
      }
    } else if (domValue !== value) {
      if (!isStalePropAfterLocalEdit && !(isFocused && !isExternalValue)) {
        caretBeforeSync = isFocused ? getCaretOffset(editor) : null;
        caretAfterSync = caretBeforeSync == null
          ? null
          : mapCaretAcrossValueChange(domValue, value, caretBeforeSync);
        scrollTopBeforeSync = editor.scrollTop;
        scrollLeftBeforeSync = editor.scrollLeft;
        didSync = syncEditorFromValue(editor, value, materials);
        if (didSync) {
          lastValueRef.current = value;
        }
      }
    }

    const pending = pendingCursorRef.current;
    pendingCursorRef.current = null;
    const imeRestore = imeRestoreCursorRef.current;
    imeRestoreCursorRef.current = null;

    if (!isFocused) return;

    const textLen = serializeEditor(editor).length;
    if (didSync && scrollTopBeforeSync != null) {
      editor.scrollTop = scrollTopBeforeSync;
    }
    if (didSync && scrollLeftBeforeSync != null) {
      editor.scrollLeft = scrollLeftBeforeSync;
    }

    if (didSync && pending != null) {
      restoreEditorCaret(editor, Math.min(pending, textLen));
      return;
    }

    if (didSync && caretAfterSync != null) {
      restoreEditorCaret(editor, Math.min(caretAfterSync, textLen));
      return;
    }

    if (didSync) {
      restoreEditorCaret(editor, textLen);
      return;
    }

    if (imeRestore != null) {
      const target = Math.min(imeRestore, textLen);
      if (getCaretOffset(editor) !== target) {
        restoreEditorCaret(editor, target);
      }
    }
  }, [value, materials, materialsVisualSignature]);

  const renderMaterialThumb = (material: MaterialRef, sizeClass = 'h-5 w-5') => {
    if (material.fileType === 'video' && material.fileUrl) {
      return (
        <span className={cn('mention-token-thumb relative block overflow-visible', sizeClass)}>
          {material.thumbnailUrl ? (
            <MaterialThumbWithHover
              thumbSrc={material.thumbnailUrl}
              fullSrc={
                isDisplayableRasterUrl(material.fileUrl)
                  ? material.fileUrl
                  : material.thumbnailUrl
              }
              className="block h-full w-full overflow-hidden rounded-[3px]"
              imgClassName="h-full w-full object-cover"
              enableHover={false}
            />
          ) : null}
          <span className="mention-token-video-mark pointer-events-none">
            <Video className="h-2.5 w-2.5 text-white/90" />
          </span>
        </span>
      );
    }

    if (material.fileUrl && (material.fileType === 'image' || !material.fileType)) {
      return (
        <span className={cn('mention-token-thumb relative block overflow-visible', sizeClass)}>
          <MaterialThumbWithHover
            thumbSrc={material.thumbnailUrl || material.fileUrl}
            fullSrc={material.fileUrl || material.thumbnailUrl || ''}
            className="block h-full w-full overflow-hidden rounded-[3px]"
            imgClassName="h-full w-full object-cover"
            enableHover={false}
          />
        </span>
      );
    }

    return (
      <span className={cn('mention-token-thumb mention-token-thumb-file', sizeClass)}>
        <FileText className="h-3 w-3 text-cyan-200" />
      </span>
    );
  };

  const stopWheelPropagation = (e: React.WheelEvent) => {
    e.stopPropagation();
  };

  const handleResizePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = containerRef.current;
    if (!el) return;

    e.preventDefault();
    e.stopPropagation();
    const captureEl = e.currentTarget;
    captureEl.setPointerCapture?.(e.pointerId);

    const resizeZoom = reactFlow.getZoom() || 1;
    const rect = el.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = rect.width / resizeZoom;
    const startHeight = rect.height / resizeZoom;
    boxSizeRef.current = { width: Math.round(startWidth), height: Math.round(startHeight) };

    const applyResize = (next: MentionTextareaSize) => {
      el.style.width = `${next.width}px`;
      el.style.height = `${next.height}px`;
      el.style.minWidth = `${minResizeWidth}px`;
      el.style.minHeight = `${minResizeHeight}px`;
      boxSizeRef.current = next;
      onLiveSizeChange?.(next);
    };

    const scheduleResize = (next: MentionTextareaSize) => {
      pendingResizeRef.current = next;
      if (resizeFrameRef.current != null) return;

      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        const pending = pendingResizeRef.current;
        if (pending) applyResize(pending);
      });
    };

    const getNextSize = (event: PointerEvent): MentionTextareaSize => ({
      width: Math.max(
        minResizeWidth,
        Math.round(startWidth + (event.clientX - startX) / resizeZoom)
      ),
      height: Math.max(
        minResizeHeight,
        Math.round(startHeight + (event.clientY - startY) / resizeZoom)
      ),
    });

    const handlePointerMove = (event: PointerEvent) => {
      event.preventDefault();
      scheduleResize(getNextSize(event));
    };

    const handlePointerUp = (event: PointerEvent) => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      captureEl.releasePointerCapture?.(event.pointerId);

      if (resizeFrameRef.current != null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }

      const finalSize = getNextSize(event);
      pendingResizeRef.current = null;
      applyResize(finalSize);
      setBoxSize(finalSize);
      onSizeChange?.(finalSize);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });
  };

  const handleSelect = (m: MaterialRef) => {
    const editor = editorRef.current;
    if (!editor) return;

    const currentText = serializeEditor(editor);
    const currentCursor = getCaretOffset(editor);
    let anchor = mentionAnchor;
    if (anchor < 0 || anchor >= currentText.length || currentText[anchor] !== '@' || anchor > currentCursor) {
      anchor = currentText.slice(0, currentCursor).lastIndexOf('@');
    }
    if (anchor < 0) return;

    const insertion = replaceMaterialMentionQueryAtCursor(
      currentText,
      anchor,
      currentCursor,
      m.slug,
    );
    if (!insertion) return;
    const { value: inserted, cursor } = insertion;
    lastValueRef.current = inserted;
    pendingLocalValueRef.current = inserted;
    pendingCursorRef.current = cursor;
    syncEditorFromValue(editor, inserted, materials);
    restoreEditorCaret(editor, cursor);
    onChange(inserted);
    setMentionOpen(false);
    requestAnimationFrame(() => {
      editor.focus();
      restoreEditorCaret(editor, cursor);
    });
  };

  const findMentionAtCursor = useCallback(
    (text: string, cursor: number, direction: 'before' | 'after'): [number, number] | null => {
      const mentionRe = new RegExp(MENTION_RE.source, 'g');
      let match: RegExpExecArray | null;

      while ((match = mentionRe.exec(text)) !== null) {
        const start = match.index;
        const end = start + match[0].length;

        if (direction === 'before') {
          if (cursor === end) return [start, end];
          if (text[end] === ' ' && cursor === end + 1) return [start, end + 1];
        }

        if (direction === 'after' && cursor === start) {
          const endWithSpace = text[end] === ' ' ? end + 1 : end;
          return [start, endWithSpace];
        }
      }

      return null;
    },
    []
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (isComposingRef.current || e.nativeEvent.isComposing) return;

    if (mentionOpen) {
      if (e.key === 'Escape') {
        setMentionOpen(false);
        return;
      }
      if (e.key === ' ' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        setMentionOpen(false);
      }
      if (e.key === 'Enter' && filtered.length > 0) {
        e.preventDefault();
        handleSelect(filtered[0]);
        return;
      }
    }

    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) return;

    if (e.key === 'Enter') {
      e.preventDefault();
      replaceSelectionWithText('\n');
      commitFromDom();
      return;
    }

    if (!selection.isCollapsed) return;

    const cursor = getCaretOffset(editor);
    const currentText = serializeEditor(editor);

    if (e.key === 'Backspace' && cursor > 0) {
      const mention = findMentionAtCursor(currentText, cursor, 'before');
      if (mention) {
        e.preventDefault();
        const [start, end] = mention;
        const next = currentText.slice(0, start) + currentText.slice(end);
        pendingLocalValueRef.current = next;
        pendingCursorRef.current = start;
        onChange(next);
      }
    }

    if (e.key === 'Delete') {
      const mention = findMentionAtCursor(currentText, cursor, 'after');
      if (mention) {
        e.preventDefault();
        const [start, end] = mention;
        const next = currentText.slice(0, start) + currentText.slice(end);
        pendingLocalValueRef.current = next;
        pendingCursorRef.current = start;
        onChange(next);
      }
    }
  };

  const handleInput = () => {
    if (isComposingRef.current) return;
    if (skipNextInputCommitRef.current) {
      skipNextInputCommitRef.current = false;
      return;
    }
    commitFromDom();
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    replaceSelectionWithText(e.clipboardData.getData('text/plain'));
    commitFromDom();
  };

  const handleFocus = () => {
    setIsFocused(true);
    const editor = editorRef.current;
    if (!editor) return;
    detectMention(serializeEditor(editor), getCaretOffset(editor));
  };

  const handleBlur = () => {
    setIsFocused(false);
    setMentionOpen(false);
  };

  const handlePointerUp = () => {
    const editor = editorRef.current;
    if (!editor) return;
    detectMention(serializeEditor(editor), getCaretOffset(editor));
  };

  useEffect(() => {
    if (!autoFocus) {
      autoFocusAppliedRef.current = false;
      return;
    }
    if (autoFocusAppliedRef.current || !editorRef.current) return;

    autoFocusAppliedRef.current = true;
    const editor = editorRef.current;
    const cursorPos = value.length;

    requestAnimationFrame(() => {
      editor.focus();
      setCaretOffset(editor, cursorPos);
    });
  }, [autoFocus, value]);

  const displaySize = boxSize || size;
  const showPlaceholder = !value && !isFocused;
  const baseHeight = displaySize?.height ?? minResizeHeight;
  const resolvedHeight = maxHeight ? Math.min(baseHeight, maxHeight) : baseHeight;
  const resolvedWidth = displaySize?.width;

  return (
    <div className={cn('relative min-w-0 max-w-full', fillHeight && 'h-full')}>
      <div
        ref={containerRef}
        className={cn(
          'glass-input-surface nodrag nopan nowheel relative w-full max-w-full overflow-hidden rounded-md border',
          fillHeight && 'h-full',
          className
        )}
        onWheel={stopWheelPropagation}
        style={{
          width: resolvedWidth ? `${resolvedWidth}px` : '100%',
          maxWidth: '100%',
          height: fillHeight ? '100%' : `${resolvedHeight}px`,
          maxHeight: fillHeight ? undefined : maxHeight ? `${maxHeight}px` : undefined,
          minWidth: resolvedWidth ? minResizeWidth : undefined,
          minHeight: fillHeight ? minResizeHeight : resolvedHeight,
        }}
      >
        {showPlaceholder && (
          <div className="pointer-events-none absolute inset-0 z-[2] overflow-hidden p-2 font-sans text-sm leading-relaxed text-slate-500">
            {placeholder}
          </div>
        )}

        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          spellCheck={false}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onPointerUp={handlePointerUp}
          onMouseOver={(event) => {
            const target = event.target instanceof Element
              ? event.target.closest<HTMLElement>('[data-mention-slug]')
              : null;
            const slug = target?.dataset.mentionSlug || '';
            if (!target || !slug || !event.currentTarget.contains(target)) return;
            const material = materials.find((item) => item.slug === slug);
            if (!material) return;
            const anchor = target.querySelector<HTMLElement>('.mention-token-thumb') || target;
            materialHoverPreview.openPreview(material, anchor.getBoundingClientRect());
          }}
          onMouseOut={(event) => {
            const target = event.target instanceof Element
              ? event.target.closest<HTMLElement>('[data-mention-slug]')
              : null;
            if (!target) return;
            const relatedTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;
            if (relatedTarget && target.contains(relatedTarget)) return;
            materialHoverPreview.scheduleClose();
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onCompositionEnd={() => {
            isComposingRef.current = false;
            skipNextInputCommitRef.current = true;
            requestAnimationFrame(() => {
              commitFromDomAfterIme();
            });
          }}
          className="mention-rich-editor nodrag nopan nowheel absolute inset-0 z-[1] overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere] bg-transparent p-2 font-sans text-sm leading-relaxed tracking-normal text-slate-200 caret-cyan-200 focus:outline-none"
        />

        {onSizeChange && (
          <div
            className="nodrag nopan absolute bottom-0 right-0 z-[3] h-4 w-4 cursor-nwse-resize touch-none"
            onPointerDown={handleResizePointerDown}
            title="拖动调整大小"
          >
            <span className="absolute bottom-1 right-1 h-2.5 w-2.5 rounded-br border-b border-r border-slate-500/70" />
          </div>
        )}

        {mentionOpen &&
          mentionPortalPos &&
          createPortal(
            <div
              className="nodrag nopan nowheel fixed z-[10060] overflow-y-auto overscroll-contain rounded-lg border border-white/12 bg-[#1a1c1f]/95 py-1 shadow-2xl shadow-black/50 backdrop-blur-xl"
              style={{
                left: mentionPortalPos.left,
                top: mentionPortalPos.top,
                width: mentionPortalPos.width,
                maxHeight: mentionPortalPos.maxH,
                transform: mentionPortalPos.transform,
              }}
              onWheel={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.preventDefault()}
            >
              {filtered.length > 0 ? (
                <ul className="py-0.5">
                  {filtered.map((m) => (
                    <li key={m.nodeId}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 px-2 py-2 text-left transition-colors hover:bg-white/10"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleSelect(m);
                        }}
                      >
                        {renderMaterialThumb(m, 'h-8 w-8')}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1">
                            <span className="truncate text-xs font-medium text-zinc-100 drop-shadow-[0_0_8px_rgba(255,255,255,0.2)]">
                              [{m.slug}]
                            </span>
                            <span className="truncate text-[10px] text-slate-500">{m.fileType}</span>
                          </div>
                          <div className="mt-0.5 truncate text-[10px] text-slate-400">
                            {m.fileName || '未命名素材'}
                          </div>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : materials.length === 0 ? (
                <p className="px-2 py-1.5 text-[10px] text-zinc-200">
                  请先在画布添加素材节点并上传文件
                </p>
              ) : (
                <p className="px-2 py-1.5 text-[10px] text-slate-400">无匹配素材</p>
              )}
            </div>,
            document.body
          )}
      </div>
      {materialHoverPreview.portal}
    </div>
  );
}
