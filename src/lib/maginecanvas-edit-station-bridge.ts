import type { InboundEditClipCandidate } from '@/lib/edit-timeline-types';

export const MAGINECANVAS_EMBED_PATH = '';

export type MaginecanvasTimelineClipSnapshot = {
  uuid?: string;
  name?: string;
  mediaId?: string;
  type?: string;
  time?: {
    start?: number;
    end?: number;
    startCut?: number;
    endCut?: number;
    overIn?: number;
    overOut?: number;
  };
  media?: {
    volume?: number;
    fadeIn?: number;
    fadeOut?: number;
  };
  transform?: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    scaleX?: number;
    scaleY?: number;
    rotation?: number;
  };
  file?: {
    mediaId?: string;
    label?: string;
    fileBaseName?: string;
    path?: string;
    type?: string;
    duration?: number;
    durationStr?: string;
    thumbnail?: string;
    sourceWidth?: number;
    sourceHeight?: number;
  } | null;
};

export type MaginecanvasTimelineTrackSnapshot = {
  uuid?: string;
  type?: string;
  isMain?: boolean;
  isMute?: boolean;
  isHide?: boolean;
  index?: number;
  clips: MaginecanvasTimelineClipSnapshot[];
};

export type MaginecanvasTimelineSnapshot = {
  durationMs?: number;
  exportedAt?: number;
  tracks: MaginecanvasTimelineTrackSnapshot[];
  error?: string;
};

/** 父页已拉取的二进制（解决 blob: / 部分 URL 在 iframe 内无法 fetch） */
export type MaginecanvasImportItem = Pick<
  InboundEditClipCandidate,
  'url' | 'fileName' | 'mediaKind' | 'sourceNodeId'
> & {
  arrayBuffer?: ArrayBuffer;
  /** 父页 fetch 得到的 Content-Type（不含 charset） */
  fetchedContentType?: string;
};

export type MaginecanvasBridgeMessage =
  | { type: 'magine:maginecanvas-ready' }
  | { type: 'magine:maginecanvas-ready-error'; error?: string }
  | { type: 'magine:maginecanvas-import'; requestId: string; items: MaginecanvasImportItem[] }
  | { type: 'magine:maginecanvas-timeline-request'; requestId: string }
  | {
      type: 'magine:maginecanvas-timeline-result';
      requestId: string;
      snapshot?: MaginecanvasTimelineSnapshot;
      error?: string;
    }
  | { type: 'magine:maginecanvas-toggle-playback' }
  | { type: 'magine:maginecanvas-undo-redo'; redo?: boolean }
  | {
      type: 'magine:maginecanvas-import-result';
      requestId: string;
      imported: number;
      errors: string[];
    };

export function isMaginecanvasBridgeMessage(data: unknown): data is MaginecanvasBridgeMessage {
  if (!data || typeof data !== 'object') return false;
  const t = (data as { type?: string }).type;
  return (
    t === 'magine:maginecanvas-ready' ||
    t === 'magine:maginecanvas-ready-error' ||
    t === 'magine:maginecanvas-import' ||
    t === 'magine:maginecanvas-timeline-request' ||
    t === 'magine:maginecanvas-timeline-result' ||
    t === 'magine:maginecanvas-toggle-playback' ||
    t === 'magine:maginecanvas-undo-redo' ||
    t === 'magine:maginecanvas-import-result'
  );
}

/**
 * 将素材送入 Maginecancas 嵌入页。若 item 含 `arrayBuffer`，会通过 transfer 传入子 frame（父页侧该 buffer 随后不可用）。
 */
export function postMaginecanvasImport(
  iframe: HTMLIFrameElement | null,
  items: MaginecanvasImportItem[]
): string | null {
  const win = iframe?.contentWindow;
  if (!win) return null;
  const requestId = `imp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const msg: MaginecanvasBridgeMessage = {
    type: 'magine:maginecanvas-import',
    requestId,
    items,
  };
  const transfer = items.flatMap((i) => (i.arrayBuffer ? [i.arrayBuffer] : []));
  if (transfer.length > 0) {
    win.postMessage(msg, window.location.origin, transfer);
  } else {
    win.postMessage(msg, window.location.origin);
  }
  return requestId;
}

export function postMaginecanvasTimelineRequest(iframe: HTMLIFrameElement | null): string | null {
  const win = iframe?.contentWindow;
  if (!win) return null;
  const requestId = `timeline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const msg: MaginecanvasBridgeMessage = { type: 'magine:maginecanvas-timeline-request', requestId };
  win.postMessage(msg, window.location.origin);
  return requestId;
}

export function postMaginecanvasTogglePlayback(iframe: HTMLIFrameElement | null): boolean {
  const win = iframe?.contentWindow;
  if (!win) return false;
  const msg: MaginecanvasBridgeMessage = { type: 'magine:maginecanvas-toggle-playback' };
  win.postMessage(msg, window.location.origin);
  return true;
}

export function postMaginecanvasUndoRedo(
  iframe: HTMLIFrameElement | null,
  redo = false
): boolean {
  const win = iframe?.contentWindow;
  if (!win) return false;
  const msg: MaginecanvasBridgeMessage = { type: 'magine:maginecanvas-undo-redo', redo };
  win.postMessage(msg, window.location.origin);
  return true;
}
