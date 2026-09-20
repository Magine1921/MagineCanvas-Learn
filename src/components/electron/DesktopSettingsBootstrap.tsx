'use client';

import { useEffect } from 'react';
import { hydrateLocalStorageFromDesktop } from '@/lib/desktop-settings-persist';
import { useSeedanceStore } from '@/components/seedance/SeedanceStore';

const SEEDANCE_STORAGE_NAME = 'seedance-storage';
const SEEDANCE_SETTINGS_KEY = 'seedance-storage';

/** 桌面端：从 userData 恢复 API 配置，并同步即梦 CLI 登录态 */
export function DesktopSettingsBootstrap() {
  useEffect(() => {
    if (!window.magineDesktop?.isDesktop) return;

    void (async () => {
      const restored = await hydrateLocalStorageFromDesktop(
        SEEDANCE_SETTINGS_KEY,
        SEEDANCE_STORAGE_NAME
      );
      if (restored) {
        await useSeedanceStore.persist.rehydrate();
      }

      try {
        const state = useSeedanceStore.getState();
        const cliPath = state.config.dreaminaCli.cliPath || 'dreamina';
        const res = await fetch('/api/dreamina/user-credit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cliPath }),
        });
        const json = (await res.json()) as {
          ok?: boolean;
          loggedIn?: boolean;
          loginName?: string;
        };
        if (json.ok && json.loggedIn) {
          if (!state.config.dreaminaCli.loggedIn) {
            useSeedanceStore.getState().saveDreaminaCliConfig({
              loggedIn: true,
              loginName: String(json.loginName || ''),
              cliPath,
            });
          }
        }
      } catch {
        /* CLI 未安装或未登录时忽略 */
      }
    })();
  }, []);

  return null;
}
