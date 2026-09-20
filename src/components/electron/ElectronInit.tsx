'use client';

import { useEffect } from 'react';

/** 入场动画在 Electron/GPU 下 filter:blur() 会整块糊死，通过 class 让 CSS 强制关闭 */
export function ElectronInit() {
  useEffect(() => {
    if (window.magineDesktop?.isDesktop) {
      document.documentElement.classList.add('mc-electron-no-entrance-blur');
    }
  }, []);

  return null;
}
