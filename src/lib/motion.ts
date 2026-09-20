/** 与 CSS `--mc-1f` 一致：UI 动画按 60Hz 对齐（每帧 1000/60 ms） */
export const MC_FPS = 60;

export function mcF(frames: number): number {
  return Math.round((frames * 1000) / MC_FPS);
}

/** 镜头后四周 UI：由较大缩回归位，统一 400ms 缓入（起始时刻由 page 的 chrome reveal 控制） */
export const MC_CHROME_ENTRANCE_TF =
  'transition-transform duration-[400ms] ease-[cubic-bezier(0.25,0.46,0.45,0.94)] will-change-transform';

/** 入场前相对终态的放大比例（与 translate 屏外组合） */
export const MC_CHROME_ENTRANCE_SCALE_START = 'scale-[1.18]';
