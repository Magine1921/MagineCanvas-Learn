/**
 * 预加载脚本：与渲染进程隔离；后续可在此用 contextBridge 暴露安全 API（打开文件等）。
 */
const { contextBridge, ipcRenderer } = require('electron');

/** 尽早关闭 Electron 入场 filter:blur()，避免首帧整页糊死（须早于 React hydration） */
function disableElectronEntranceBlur() {
  try {
    document.documentElement.classList.add('mc-electron-no-entrance-blur');
  } catch {
    /* ignore */
  }
}
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', disableElectronEntranceBlur, { once: true });
} else {
  disableElectronEntranceBlur();
}

contextBridge.exposeInMainWorld('magineDesktop', {
  isDesktop: true,
  /** 与浏览器 localStorage 分离时，用 userData 下的 JSON 持久化项目列表 */
  projectsLoad: () => ipcRenderer.invoke('magine-projects-load'),
  projectsSave: (json) => ipcRenderer.invoke('magine-projects-save', json),
  projectsIndexLoad: () => ipcRenderer.invoke('magine-projects-index-load'),
  projectsIndexSave: (json) => ipcRenderer.invoke('magine-projects-index-save', json),
  projectLoad: (projectId) => ipcRenderer.invoke('magine-project-load', projectId),
  projectSave: (projectId, json) => ipcRenderer.invoke('magine-project-save', projectId, json),
  projectDelete: (projectId) => ipcRenderer.invoke('magine-project-delete', projectId),
  selectDirectory: (defaultPath) => ipcRenderer.invoke('magine-select-directory', defaultPath),
  saveMedia: (request) => ipcRenderer.invoke('magine-save-media', request),
  saveMediaBatch: (request) => ipcRenderer.invoke('magine-save-media-batch', request),
  onMediaBatchProgress: (cb) => {
    const handler = (_evt, progress) => cb(progress);
    ipcRenderer.on('magine-save-media-batch-progress', handler);
    return () => ipcRenderer.removeListener('magine-save-media-batch-progress', handler);
  },
  /** API 配置等 zustand 持久化备份（键名如 seedance-storage） */
  settingsLoad: (key) => ipcRenderer.invoke('magine-settings-load', key),
  settingsSave: (key, json) => ipcRenderer.invoke('magine-settings-save', key, json),
  settingsRemove: (key) => ipcRenderer.invoke('magine-settings-remove', key),
  updateGetStatus: () => ipcRenderer.invoke('magine-update-status-get'),
  updateCheck: () => ipcRenderer.invoke('magine-update-check'),
  updateDownload: () => ipcRenderer.invoke('magine-update-download'),
  updateInstall: () => ipcRenderer.invoke('magine-update-install'),
  updatePrepared: () => ipcRenderer.send('magine-update-prepared'),
  onUpdateStatus: (cb) => {
    const handler = (_evt, status) => cb(status);
    ipcRenderer.on('magine-update-status', handler);
    return () => ipcRenderer.removeListener('magine-update-status', handler);
  },
  onUpdatePrepareInstall: (cb) => {
    const handler = (_evt, payload) => cb(payload);
    ipcRenderer.on('magine-update-prepare-install', handler);
    return () => ipcRenderer.removeListener('magine-update-prepare-install', handler);
  },
  /** 在系统默认浏览器打开 URL（OAuth 登录等） */
  openExternal: (url) => ipcRenderer.invoke('magine-open-external', url),
  openPurchaseUrl: (url) => ipcRenderer.invoke('magine-open-purchase-url', url),
  browserRegisterGuest: (nodeId, guestId) => ipcRenderer.invoke(
    'magine-browser-register-guest',
    nodeId,
    guestId,
  ),
  materialVideoTrim: (request) => ipcRenderer.invoke('magine-material-video-trim', request),
  materialAudioTrim: (request) => ipcRenderer.invoke('magine-material-audio-trim', request),
  materialVideoThumbnail: (request) => ipcRenderer.invoke('magine-material-video-thumbnail', request),
  onBrowserMediaDownloaded: (cb) => {
    const handler = (_evt, media) => cb(media);
    ipcRenderer.on('magine-browser-media-downloaded', handler);
    return () => ipcRenderer.removeListener('magine-browser-media-downloaded', handler);
  },
  /** 安全安装包授权。所有状态判断和令牌持久化均在主进程完成。 */
  /** 桌面版：主进程检测 dreamina user_credit */
  dreaminaUserCredit: (cliPath) => ipcRenderer.invoke('magine-dreamina-user-credit', cliPath),
  /** 桌面版：主进程 OAuth Device Flow 登录 */
  dreaminaLogin: (cliPath, forceRelogin, browser) => ipcRenderer.invoke('magine-dreamina-login', cliPath, Boolean(forceRelogin), browser),
  dreaminaOpenLoginUrl: (url, browser) => ipcRenderer.invoke('magine-dreamina-open-login-url', url, browser),
  onDreaminaLoginProgress: (cb) => {
    const handler = (_evt, info) => cb(info);
    ipcRenderer.on('magine-dreamina-login-progress', handler);
    return () => ipcRenderer.removeListener('magine-dreamina-login-progress', handler);
  },
});
