/** contenteditable 内联附件（与纯文本同一选区） */

import {
  resolveAgentAttachmentVisual,
  type AgentAttachmentVisualTone,
} from './agent-upload-support.ts';

export const AGENT_CHAT_MEDIA_ATTR = 'data-agent-chat-media';

export type ParsedChatComposer = {
  plainText: string;
  /** 已从 blob 转为 data URL 的附件，便于持久化 */
  attachments: Array<{
    id: string;
    name: string;
    kind: 'image' | 'audio' | 'video' | 'file';
    url: string;
    mimeType?: string;
  }>;
};

type ImeKeyboardEventLike = {
  key?: string;
  isComposing?: boolean;
  keyCode?: number;
  nativeEvent?: {
    isComposing?: boolean;
    keyCode?: number;
  };
};

export function isImeComposingKeyboardEvent(event: ImeKeyboardEventLike): boolean {
  const nativeEvent = event.nativeEvent;
  return Boolean(
    event.isComposing
    || nativeEvent?.isComposing
    || event.key === 'Process'
    || event.keyCode === 229
    || nativeEvent?.keyCode === 229
  );
}

function genId() {
  return `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

const COMPOSER_THUMBNAIL_TONE_CLASSES: Record<AgentAttachmentVisualTone, string> = {
  image: 'border-sky-300/35 bg-sky-500/16 text-sky-100',
  video: 'border-violet-300/35 bg-violet-500/16 text-violet-100',
  audio: 'border-fuchsia-300/35 bg-fuchsia-500/16 text-fuchsia-100',
  pdf: 'border-rose-300/35 bg-rose-500/18 text-rose-100',
  document: 'border-blue-300/35 bg-blue-500/18 text-blue-100',
  sheet: 'border-emerald-300/35 bg-emerald-500/18 text-emerald-100',
  slides: 'border-orange-300/35 bg-orange-500/18 text-orange-100',
  archive: 'border-purple-300/35 bg-purple-500/18 text-purple-100',
  code: 'border-cyan-300/35 bg-cyan-500/18 text-cyan-100',
  text: 'border-zinc-300/30 bg-zinc-500/18 text-zinc-100',
  file: 'border-slate-300/30 bg-slate-500/18 text-slate-100',
};

function appendComposerTypeBadge(
  wrap: HTMLSpanElement,
  label: string,
  tone: AgentAttachmentVisualTone,
) {
  const badge = document.createElement('span');
  badge.className =
    `pointer-events-none flex h-full w-full items-center justify-center rounded-[5px] border text-[9px] font-bold tracking-[-0.02em] ${COMPOSER_THUMBNAIL_TONE_CLASSES[tone]}`;
  badge.textContent = label;
  wrap.appendChild(badge);
}

export function createMediaChipElement(args: {
  id: string;
  name: string;
  kind: 'image' | 'audio' | 'video' | 'file';
  displayUrl: string;
  mimeType?: string;
  /** 画布上游素材节点 id，用于同步/去重，不参与序列化 id 语义 */
  extSourceNodeId?: string;
}): HTMLSpanElement {
  const wrap = document.createElement('span');
  wrap.setAttribute(AGENT_CHAT_MEDIA_ATTR, '1');
  wrap.setAttribute('data-id', args.id);
  wrap.setAttribute('data-name', args.name);
  wrap.setAttribute('data-kind', args.kind);
  wrap.setAttribute('data-url', args.displayUrl);
  if (args.mimeType) wrap.setAttribute('data-mime', args.mimeType);
  if (args.extSourceNodeId) {
    wrap.setAttribute('data-ext-node-id', args.extSourceNodeId);
  }
  wrap.contentEditable = 'false';
  wrap.className =
    'mc-agent-chat-media-chip relative inline-block h-9 max-h-9 w-9 max-w-9 shrink-0 cursor-default align-middle select-all overflow-hidden rounded-md border border-white/20 bg-black/40 align-text-bottom';
  wrap.draggable = false;
  wrap.title = args.name;
  const visual = resolveAgentAttachmentVisual(args.name, args.kind, args.mimeType);

  if (args.kind === 'image') {
    const img = document.createElement('img');
    img.src = args.displayUrl;
    img.alt = args.name;
    img.className = 'pointer-events-none h-full w-full object-cover';
    wrap.appendChild(img);
  } else if (args.kind === 'video') {
    const v = document.createElement('video');
    v.src = args.displayUrl;
    v.className = 'pointer-events-none h-full w-full object-cover';
    v.muted = true;
    v.playsInline = true;
    v.setAttribute('preload', 'metadata');
    wrap.appendChild(v);
    const playOverlay = document.createElement('span');
    playOverlay.className = 'pointer-events-none absolute inset-0 flex items-center justify-center bg-black/28';
    const playTriangle = document.createElement('span');
    playTriangle.className = 'ml-0.5 h-0 w-0 border-y-[5px] border-l-[8px] border-y-transparent border-l-white/90';
    playOverlay.appendChild(playTriangle);
    wrap.appendChild(playOverlay);
  } else if (args.kind === 'audio') {
    appendComposerTypeBadge(wrap, visual.label, visual.tone);
  } else {
    appendComposerTypeBadge(wrap, visual.label, visual.tone);
  }

  return wrap;
}

/** 将新附件插到编辑器最左侧（仍在同一 contenteditable 内） */
export function prependMediaChip(editor: HTMLElement, chip: HTMLSpanElement) {
  const first = editor.firstChild;
  if (first) editor.insertBefore(chip, first);
  else editor.appendChild(chip);
}

export function serializeChatComposer(editor: HTMLElement): ParsedChatComposer {
  const attachments: ParsedChatComposer['attachments'] = [];
  editor.querySelectorAll<HTMLElement>(`span[${AGENT_CHAT_MEDIA_ATTR}="1"]`).forEach((el) => {
    const id = el.getAttribute('data-id') || genId();
    const name = el.getAttribute('data-name') || '附件';
    const rawKind = el.getAttribute('data-kind') || 'file';
    const kind = rawKind === 'image' || rawKind === 'audio' || rawKind === 'video' ? rawKind : 'file';
    const url = el.getAttribute('data-url') || '';
    const mimeType = el.getAttribute('data-mime') || undefined;
    if (url) attachments.push({ id, name, kind, url, mimeType });
  });

  const clone = editor.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(`span[${AGENT_CHAT_MEDIA_ATTR}="1"]`).forEach((el) => el.remove());
  clone.querySelectorAll('[data-ext-prompt-sync="1"]').forEach((el) => el.remove());
  let plainText = (clone.textContent || '').replace(/\u200b/g, '').replace(/\u00a0/g, ' ');
  plainText = plainText.replace(/\n{3,}/g, '\n\n').trim();

  return { plainText, attachments };
}

export function clearChatComposer(editor: HTMLElement) {
  editor.innerHTML = '';
}

/** 退格删除紧贴光标前的不可编辑块 */
export function handleComposerBackspace(editor: HTMLElement, e: React.KeyboardEvent<HTMLElement>): boolean {
  if (isImeComposingKeyboardEvent(e) || e.key !== 'Backspace' || e.defaultPrevented) return false;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  if (!range.collapsed) return false;

  let node: Node | null = range.startContainer;
  let offset = range.startOffset;

  if (node.nodeType === Node.TEXT_NODE && offset > 0) {
    const t = node.textContent || '';
    if (t[offset - 1] === '\u200b' && offset >= 2) return false;
    return false;
  }

  if (node === editor && offset > 0) {
    const prev = editor.childNodes[offset - 1];
    if (prev instanceof HTMLElement && prev.getAttribute(AGENT_CHAT_MEDIA_ATTR) === '1') {
      e.preventDefault();
      const zw = prev.nextSibling;
      prev.remove();
      if (zw && zw.nodeType === Node.TEXT_NODE && (zw.textContent === '\u200b' || (zw.textContent || '').trim() === '')) {
        zw.remove();
      }
      return true;
    }
  }

  if (node.nodeType === Node.TEXT_NODE && node.parentNode === editor) {
    const idx = Array.from(editor.childNodes).indexOf(node as ChildNode);
    if (offset === 0 && idx > 0) {
      const prev = editor.childNodes[idx - 1];
      if (prev instanceof HTMLElement && prev.getAttribute(AGENT_CHAT_MEDIA_ATTR) === '1') {
        e.preventDefault();
        prev.remove();
        if (node.textContent === '\u200b' || (node.textContent || '').length === 0) {
          (node as Text).remove();
        }
        return true;
      }
    }
  }

  return false;
}

export async function blobUrlToDataUrl(blobUrl: string, maxBytes = 450_000): Promise<string | null> {
  try {
    const res = await fetch(blobUrl);
    const blob = await res.blob();
    if (blob.size > maxBytes) return null;
    return await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(typeof r.result === 'string' ? r.result : null);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}
