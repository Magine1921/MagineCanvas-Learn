import { playProceduralUiSound } from '@/lib/proceduralUiSound';

/** 欢迎页的程序化入场音效，不依赖外部音频素材。 */

export function playWelcomeEntranceSound(): void {
  if (typeof window === 'undefined') return;
  try {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  } catch {
    /* noop */
  }

  playProceduralUiSound('welcome');
}
