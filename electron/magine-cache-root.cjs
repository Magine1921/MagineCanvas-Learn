/**
 * 桌面端 userData / 媒体缓存路径（与 electron/main.cjs 一致）。
 * 开发态 dev:desktop 的 Next 进程通过 MAGINE_CACHE_ROOT 使用同一路径，与安装版行为一致。
 */
const path = require('path');
const os = require('os');

/** 与 package.json build.productName 一致，保证 dev / 安装版 userData 目录相同 */
const DESKTOP_APP_NAME = 'MagineCanvas';

function getInstallDir() {
  const execPath = process.execPath || '';
  const execName = path.basename(execPath).toLowerCase();
  if (
    execPath &&
    execName &&
    execName !== 'node.exe' &&
    execName !== 'node' &&
    execName !== 'electron.exe' &&
    execName !== 'electron'
  ) {
    return path.dirname(execPath);
  }

  const resourcesPath = process.resourcesPath || '';
  if (resourcesPath && process.env.ELECTRON_RUN_AS_NODE === '1') {
    return path.dirname(resourcesPath);
  }

  return null;
}

function getDesktopUserDataDir() {
  if (process.platform === 'win32') {
    const appData =
      process.env.APPDATA ||
      (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'AppData', 'Roaming') : '') ||
      path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, DESKTOP_APP_NAME);
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', DESKTOP_APP_NAME);
  }
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(xdg, DESKTOP_APP_NAME);
}

function getInstallUserDataDir() {
  const installDir = getInstallDir();
  return installDir
    ? path.join(installDir, `${DESKTOP_APP_NAME}-UserData`)
    : getDesktopUserDataDir();
}

function getMagineCacheRoot() {
  // Development fallback. Packaged Electron sets MAGINE_CACHE_ROOT to the
  // user-data folder inside the selected installation directory.
  return path.join(getDesktopUserDataDir(), 'magine-cache');
}

module.exports = {
  DESKTOP_APP_NAME,
  getDesktopUserDataDir,
  getInstallUserDataDir,
  getMagineCacheRoot,
};
