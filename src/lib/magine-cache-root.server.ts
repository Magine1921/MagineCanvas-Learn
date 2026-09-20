import fs from 'node:fs';
import path from 'node:path';

/** 本地媒体/工程磁盘缓存根目录名（相对 MAGINE_CACHE_ROOT 或 cwd） */
export const MATERIAL_DISK_CACHE_SEGMENT = '.magine-cache' as const;

/**
 * 画布磁盘缓存根目录。
 * - 开发（npm run dev）：`<项目根>/.magine-cache`
 * - Electron 安装版：由主进程设置 `MAGINE_CACHE_ROOT` → `%APPDATA%/magine-canvas/magine-cache`
 */
function getWindowsAppDataCacheRoot(): string | null {
  if (process.platform !== 'win32') return null;
  const appData = process.env.APPDATA?.trim();
  if (appData) return path.join(appData, 'MagineCanvas', 'magine-cache');

  const userProfile = process.env.USERPROFILE?.trim();
  if (userProfile) return path.join(userProfile, 'AppData', 'Roaming', 'MagineCanvas', 'magine-cache');

  return null;
}

function getPackagedInstallCacheRoot(): string | null {
  const fromEnv = process.env.MAGINE_INSTALL_CACHE_ROOT?.trim();
  if (fromEnv) return fromEnv;

  const execPath = process.execPath?.trim();
  const execName = execPath ? path.basename(execPath).toLowerCase() : '';
  if (
    execPath &&
    execName &&
    execName !== 'node.exe' &&
    execName !== 'node' &&
    execName !== 'electron.exe' &&
    execName !== 'electron'
  ) {
    return path.join(path.dirname(execPath), 'magine-cache');
  }

  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath?.trim();
  if (resourcesPath && process.env.ELECTRON_RUN_AS_NODE === '1') {
    return path.join(path.dirname(resourcesPath), 'magine-cache');
  }

  return null;
}

function usesMissingWindowsUserProfile(root: string): boolean {
  if (process.platform !== 'win32') return false;
  const normalized = root.replace(/\//g, '\\');
  const match = normalized.match(/^([A-Za-z]:\\Users\\[^\\]+)\\/i);
  if (!match) return false;
  try {
    return !fs.existsSync(match[1]);
  } catch {
    return false;
  }
}

export function getMagineCacheRoot(): string {
  const fromEnv = process.env.MAGINE_CACHE_ROOT?.trim();
  const installRoot = getPackagedInstallCacheRoot();
  const windowsAppDataRoot = getWindowsAppDataCacheRoot();

  if (fromEnv && !usesMissingWindowsUserProfile(fromEnv)) return fromEnv;

  if (windowsAppDataRoot) return windowsAppDataRoot;
  if (installRoot) return installRoot;
  return path.join(process.cwd(), MATERIAL_DISK_CACHE_SEGMENT);
}
