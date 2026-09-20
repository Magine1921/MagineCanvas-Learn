import { playProceduralUiSound } from '@/lib/proceduralUiSound';

/** 无限画布编辑页的程序化入场音效，不依赖外部音频素材。 */

export function playCanvasEntranceSound(): void {
  if (typeof window === 'undefined') return;
  try {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  } catch {
    /* noop */
  }

  playProceduralUiSound('canvas');
}
