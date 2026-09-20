import { playProceduralUiSound } from '@/lib/proceduralUiSound';

/** 语音助手主按钮的程序化点击反馈，不依赖外部音频素材。 */

export function playVoiceAssistantClickSound(): void {
  if (typeof window === 'undefined') return;
  try {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  } catch {
    /* noop */
  }

  playProceduralUiSound('voice-click');
}
