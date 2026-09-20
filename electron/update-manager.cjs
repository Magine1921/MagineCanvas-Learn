const fs = require('fs');
const path = require('path');
const { autoUpdater } = require('electron-updater');

function createUpdateManager({
  app,
  ipcMain,
  edition,
  feedBaseUrl,
  userDataDir,
  prepareUserDataForUpdate,
  getMainWindow,
  beforeInstall,
}) {
  let registered = false;
  let manualCheck = false;
  let prepareResolve = null;
  let state = { status: 'idle', currentVersion: app.getVersion(), edition, progress: 0 };
  const executableDir = path.dirname(process.execPath);
  const installed = app.isPackaged && fs.readdirSync(executableDir, { withFileTypes: true })
    .some((entry) => entry.isFile() && /^uninstall .*\.exe$/i.test(entry.name));

  function publicState() { return { ...state, installed }; }
  function broadcast(next) {
    state = { ...state, ...next };
    const win = getMainWindow();
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('magine-update-status', publicState());
    }
    return publicState();
  }
  async function checkForUpdates({ manual = false } = {}) {
    manualCheck = manual;
    if (!installed) {
      return broadcast({
        status: 'disabled',
        message: app.isPackaged
          ? '免安装版不会自动覆盖程序目录，请下载安装版后使用自动更新。'
          : '开发环境不执行客户端更新。',
      });
    }
    broadcast({ status: 'checking', message: manual ? '正在检查更新...' : '' });
    try { await autoUpdater.checkForUpdates(); }
    catch (error) {
      broadcast({ status: manual ? 'error' : 'idle', message: manual ? `检查更新失败：${error?.message || error}` : '' });
    }
    return publicState();
  }
  async function prepareAndInstall() {
    if (state.status !== 'downloaded' || !state.version) return publicState();
    broadcast({ status: 'preparing', message: '正在保存工程并保护本地数据...' });
    const win = getMainWindow();
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('magine-update-prepare-install', { version: state.version });
      await Promise.race([
        new Promise((resolve) => { prepareResolve = resolve; }),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
      prepareResolve = null;
    }
    try {
      const backupDir = prepareUserDataForUpdate(userDataDir, state.version);
      console.log('[update] pre-install user data snapshot:', backupDir);
    } catch (error) {
      return broadcast({ status: 'error', message: `无法保护本地数据，更新已中止：${error?.message || error}` });
    }
    broadcast({ status: 'installing', message: '本地数据保护完成，正在重启安装...' });
    await beforeInstall?.();
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return publicState();
  }
  function register() {
    if (registered) return;
    registered = true;
    ipcMain.handle('magine-update-status-get', () => publicState());
    ipcMain.handle('magine-update-check', () => checkForUpdates({ manual: true }));
    ipcMain.handle('magine-update-download', async () => {
      if (state.status !== 'available') return publicState();
      broadcast({ status: 'downloading', progress: 0, message: '正在下载更新...' });
      try { await autoUpdater.downloadUpdate(); }
      catch (error) { broadcast({ status: 'error', message: `更新下载失败：${error?.message || error}` }); }
      return publicState();
    });
    ipcMain.handle('magine-update-install', prepareAndInstall);
    ipcMain.on('magine-update-prepared', () => { if (prepareResolve) prepareResolve(); });
    if (!installed) return;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = /\/beta(?:\/|$)/i.test(feedBaseUrl);
    autoUpdater.setFeedURL({ provider: 'generic', url: feedBaseUrl });
    autoUpdater.on('checking-for-update', () => broadcast({ status: 'checking', message: manualCheck ? '正在检查更新...' : '' }));
    autoUpdater.on('update-available', (info) => broadcast({
      status: 'available', version: info.version, releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes || '', message: `发现新版本 ${info.version}`,
    }));
    autoUpdater.on('update-not-available', () => {
      broadcast({ status: manualCheck ? 'current' : 'idle', message: manualCheck ? '当前已是最新版本' : '' });
      manualCheck = false;
    });
    autoUpdater.on('download-progress', (progress) => broadcast({
      status: 'downloading', progress: Math.max(0, Math.min(100, Number(progress.percent) || 0)),
      bytesPerSecond: Number(progress.bytesPerSecond) || 0, transferred: Number(progress.transferred) || 0,
      total: Number(progress.total) || 0, message: '正在下载更新...',
    }));
    autoUpdater.on('update-downloaded', (info) => broadcast({
      status: 'downloaded', version: info.version || state.version, progress: 100,
      message: '更新已下载，重启后安装',
    }));
    autoUpdater.on('error', (error) => {
      broadcast({
        status: manualCheck || ['downloading', 'preparing', 'installing'].includes(state.status) ? 'error' : 'idle',
        message: manualCheck ? `更新失败：${error?.message || error}` : '',
      });
      manualCheck = false;
    });
  }
  function scheduleCheck(delayMs = 6000) {
    if (installed) setTimeout(() => void checkForUpdates(), delayMs);
  }
  return { register, scheduleCheck, getState: publicState };
}

module.exports = { createUpdateManager };
