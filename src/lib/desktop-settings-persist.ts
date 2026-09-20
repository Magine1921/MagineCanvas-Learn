import type { PersistStorage, StorageValue } from 'zustand/middleware';

function getMagineDesktop() {
  if (typeof window === 'undefined') return undefined;
  return window.magineDesktop;
}

/** localStorage + Electron userData JSON 双写，避免 LevelDB 损坏或 origin 不一致导致配置丢失 */
export function createDesktopDualStorage<T>(settingsKey: string): PersistStorage<T> {
  return {
    getItem: async (name) => {
      if (typeof window === 'undefined') return null;

      const md = getMagineDesktop();
      let fromDesktop: string | null = null;
      if (md?.settingsLoad) {
        try {
          fromDesktop = await md.settingsLoad(settingsKey);
        } catch {
          /* ignore */
        }
      }

      const fromLs = window.localStorage.getItem(name);
      if (fromLs && fromDesktop) {
        const useDesktop = countConfigKeys(fromDesktop) > countConfigKeys(fromLs);
        const chosen = useDesktop ? fromDesktop : fromLs;
        if (useDesktop) window.localStorage.setItem(name, fromDesktop);
        try {
          return JSON.parse(chosen) as StorageValue<T>;
        } catch {
          /* fall through */
        }
      }

      if (fromLs) {
        try {
          return JSON.parse(fromLs) as StorageValue<T>;
        } catch {
          /* fall through to desktop file */
        }
      }

      if (!fromDesktop) return null;
      window.localStorage.setItem(name, fromDesktop);
      try {
        return JSON.parse(fromDesktop) as StorageValue<T>;
      } catch {
        return null;
      }
    },

    setItem: async (name, value) => {
      if (typeof window === 'undefined') return;
      const raw = JSON.stringify(value);
      window.localStorage.setItem(name, raw);
      try {
        await getMagineDesktop()?.settingsSave?.(settingsKey, raw);
      } catch {
        console.warn('[MagineCanvas] 桌面端设置文件保存失败:', settingsKey);
      }
    },

    removeItem: async (name) => {
      if (typeof window === 'undefined') return;
      window.localStorage.removeItem(name);
      try {
        await getMagineDesktop()?.settingsRemove?.(settingsKey);
      } catch {
        /* ignore */
      }
    },
  };
}

function countConfigKeys(raw: string | null): number {
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw) as { state?: { config?: Record<string, unknown> } };
    const cfg = parsed?.state?.config;
    if (!cfg || typeof cfg !== 'object') return 0;
    let n = 0;
    const blocks = [
      cfg.imageApi,
      cfg.videoApi,
      cfg.multimodalApi,
      cfg.claudeApi,
      cfg.elevenLabs,
    ];
    for (const block of blocks) {
      if (block && typeof block === 'object' && 'apiKey' in block) {
        const key = String((block as { apiKey?: string }).apiKey || '').trim();
        if (key.length > 4) n++;
      }
    }
    const subtitleRemovalApi = cfg.subtitleRemovalApi;
    if (subtitleRemovalApi && typeof subtitleRemovalApi === 'object') {
      const secretId = String((subtitleRemovalApi as { secretId?: string }).secretId || '').trim();
      if (secretId.length > 4) n++;
    }
    return n;
  } catch {
    return 0;
  }
}

/** 启动时把桌面备份灌回 localStorage；若本地是空配置而磁盘有密钥则覆盖 */
export async function hydrateLocalStorageFromDesktop(settingsKey: string, storageName: string) {
  if (typeof window === 'undefined') return false;

  const md = getMagineDesktop();
  if (!md?.settingsLoad) return false;

  try {
    const fromDesktop = await md.settingsLoad(settingsKey);
    if (!fromDesktop) return false;

    const fromLs = window.localStorage.getItem(storageName);
    if (!fromLs) {
      window.localStorage.setItem(storageName, fromDesktop);
      return true;
    }

    if (countConfigKeys(fromDesktop) > countConfigKeys(fromLs)) {
      window.localStorage.setItem(storageName, fromDesktop);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
