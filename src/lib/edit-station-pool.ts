import type { EditClip, InboundEditClipCandidate } from '@/lib/edit-timeline-types';
import {
  insertPoolItemAfterLast,
  insertPoolItemAt,
  insertPoolItemAtPlayhead,
} from '@/lib/edit-timeline-engine';

export function syncClipUrlsFromInbound(clips: EditClip[], inbound: InboundEditClipCandidate[]): EditClip[] {
  const map = new Map(inbound.map((i) => [i.sourceNodeId, i]));
  return clips.map((c) => {
    const inc = map.get(c.sourceNodeId);
    if (!inc) return c;
    const next = {
      ...c,
      url: inc.url,
      fileName: inc.fileName ?? c.fileName,
      thumbnailUrl: inc.thumbnailUrl ?? c.thumbnailUrl,
    };
    if (inc.mediaKind !== c.mediaKind) {
      return { ...next, mediaKind: inc.mediaKind };
    }
    return next;
  });
}

export { insertPoolItemAt, insertPoolItemAtPlayhead, insertPoolItemAfterLast };

const POOL_DRAG_MIME = 'application/x-magine-edit-pool';

/** 部分环境下 drop 时读不到 DataTransfer，用拖拽会话内的副本兜底 */
let activePoolDragItem: InboundEditClipCandidate | null = null;

export function isPoolDragTransfer(dt: DataTransfer): boolean {
  return (
    Array.from(dt.types).includes(POOL_DRAG_MIME) ||
    activePoolDragItem !== null
  );
}

export function beginPoolDrag(item: InboundEditClipCandidate): void {
  activePoolDragItem = item;
}

export function endPoolDrag(): void {
  activePoolDragItem = null;
}

export function parsePoolDragPayload(dt: DataTransfer): InboundEditClipCandidate | null {
  const raw = dt.getData(POOL_DRAG_MIME);
  if (raw) {
    try {
      const o = JSON.parse(raw) as InboundEditClipCandidate;
      if (o && typeof o.sourceNodeId === 'string' && typeof o.url === 'string') return o;
    } catch {
      /* */
    }
  }
  return activePoolDragItem;
}

export function writePoolDragPayload(dt: DataTransfer, item: InboundEditClipCandidate): void {
  const json = JSON.stringify(item);
  dt.setData(POOL_DRAG_MIME, json);
  dt.setData('text/plain', json);
  dt.effectAllowed = 'copy';
}
