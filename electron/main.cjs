/**
 * Electron 主进程：开发态连本地 Next dev；安装版用 ELECTRON_RUN_AS_NODE 启动 Next standalone（无需单独装 Node）。
 */

// 清除可能从外部环境泄漏的 ELECTRON_RUN_AS_NODE，确保 Electron 以正常模式启动
delete process.env.ELECTRON_RUN_AS_NODE;

const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');
const { randomBytes } = require('crypto');
const { fileURLToPath, pathToFileURL } = require('url');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  net,
  protocol,
  session,
  shell,
  utilityProcess,
} = require('electron');
const {
  DESKTOP_APP_NAME,
  getDesktopUserDataDir,
  getInstallUserDataDir,
} = require('./magine-cache-root.cjs');
const {
  migrateLegacyUserData,
  prepareUserDataForUpdate,
  protectUserDataForCurrentBuild,
  readJsonTextWithRecovery,
  recoverInterruptedUpdate,
  writeJsonTextAtomic,
} = require('./user-data-protection.cjs');
const { exportMediaGroups } = require('./media-batch-export.cjs');
let createUpdateManager;
let checkUserCredit;
let runLogin;
let openDreaminaUrl;

function loadDeferredDesktopModules() {
  ({ createUpdateManager } = require('./update-manager.cjs'));
  ({ checkUserCredit, runLogin, openDreaminaUrl } = require('./dreamina-cli.cjs'));
}

const rawConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};
const MAIN_DIAG_LIMIT = 800;
const mainDiagLog = [];

function clipDiagText(value, max = 4000) {
  const text = typeof value === 'string' ? value : String(value);
  return text.length > max ? `${text.slice(0, max)}…[truncated ${text.length - max} chars]` : text;
}

function serializeDiagArg(arg) {
  if (arg instanceof Error) {
    return {
      name: arg.name,
      message: arg.message,
      stack: arg.stack,
    };
  }
  if (typeof arg === 'string') return clipDiagText(arg);
  try {
    return JSON.parse(JSON.stringify(arg));
  } catch {
    return clipDiagText(arg);
  }
}

function pushMainDiag(level, args) {
  mainDiagLog.push({
    at: new Date().toISOString(),
    level,
    args: Array.from(args).map(serializeDiagArg),
  });
  if (mainDiagLog.length > MAIN_DIAG_LIMIT) {
    mainDiagLog.splice(0, mainDiagLog.length - MAIN_DIAG_LIMIT);
  }
}

function isBrokenPipeError(error) {
  return error && typeof error === 'object' && error.code === 'EPIPE';
}

function protectConsoleStream(stream, label) {
  if (!stream || typeof stream.on !== 'function') return;
  stream.on('error', (error) => {
    if (isBrokenPipeError(error)) return;
    pushMainDiag('error', [`${label} stream error`, error]);
  });
}

function writeRawConsole(level, args) {
  try {
    rawConsole[level](...args);
  } catch (error) {
    if (!isBrokenPipeError(error)) {
      pushMainDiag('error', [`console.${level} write failed`, error]);
    }
  }
}

protectConsoleStream(process.stdout, 'stdout');
protectConsoleStream(process.stderr, 'stderr');

console.log = (...args) => {
  pushMainDiag('log', args);
  writeRawConsole('log', args);
};
console.warn = (...args) => {
  pushMainDiag('warn', args);
  writeRawConsole('warn', args);
};
console.error = (...args) => {
  pushMainDiag('error', args);
  writeRawConsole('error', args);
};

const LEGACY_USER_DATA_DIR = getDesktopUserDataDir();
let STABLE_USER_DATA_DIR = app.isPackaged
  ? getInstallUserDataDir()
  : LEGACY_USER_DATA_DIR;

if (app.isPackaged) {
  try {
    recoverInterruptedUpdate(path.dirname(process.execPath), STABLE_USER_DATA_DIR);
  } catch (error) {
    console.error('[electron] interrupted update data recovery failed:', error);
  }
}

fs.mkdirSync(STABLE_USER_DATA_DIR, { recursive: true });
app.setName(DESKTOP_APP_NAME);
app.setPath('userData', STABLE_USER_DATA_DIR);

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'magine-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

const PROJECTS_FILE = () => path.join(app.getPath('userData'), 'magine-canvas-projects.json');
const PROJECTS_DIRECTORY = () => path.join(app.getPath('userData'), 'magine-canvas-projects');
const PROJECTS_INDEX_FILE = () => path.join(PROJECTS_DIRECTORY(), 'index.json');
const PROJECT_FILE = (projectId) => path.join(PROJECTS_DIRECTORY(), 'projects', `${projectId}.json`);

function validDesktopProjectId(value) {
  return typeof value === 'string' && /^[a-z0-9._-]{1,160}$/i.test(value);
}
const APP_SETTINGS_FILE = () => path.join(app.getPath('userData'), 'magine-app-settings.json');

let ipcSettingsRegistered = false;

async function readAppSettingsFile() {
  try {
    const raw = await readJsonTextWithRecovery(APP_SETTINGS_FILE(), app.getPath('userData'));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function writeAppSettingsFile(data) {
  await writeJsonTextAtomic(APP_SETTINGS_FILE(), JSON.stringify(data, null, 2));
}

function registerDesktopSettingsIpc() {
  if (ipcSettingsRegistered) return;
  ipcSettingsRegistered = true;

  ipcMain.handle('magine-settings-load', async (evt, key) => {
    assertTrustedIpcEvent(evt);
    if (typeof key !== 'string' || !key.trim()) return null;
    if (!/^[a-z0-9._:-]{1,120}$/i.test(key)) return null;
    const all = await readAppSettingsFile();
    const value = all[key];
    return typeof value === 'string' ? value : null;
  });

  ipcMain.handle('magine-settings-save', async (evt, key, json) => {
    assertTrustedIpcEvent(evt);
    if (typeof key !== 'string' || !key.trim() || typeof json !== 'string') return;
    if (!/^[a-z0-9._:-]{1,120}$/i.test(key) || Buffer.byteLength(json, 'utf8') > 16 * 1024 * 1024) return;
    const all = await readAppSettingsFile();
    all[key] = json;
    await writeAppSettingsFile(all);
  });

  ipcMain.handle('magine-settings-remove', async (evt, key) => {
    assertTrustedIpcEvent(evt);
    if (typeof key !== 'string' || !key.trim()) return;
    if (!/^[a-z0-9._:-]{1,120}$/i.test(key)) return;
    const all = await readAppSettingsFile();
    delete all[key];
    await writeAppSettingsFile(all);
  });
}

let ipcProjectsRegistered = false;

function registerDesktopProjectsIpc() {
  if (ipcProjectsRegistered) return;
  ipcProjectsRegistered = true;

  ipcMain.handle('magine-projects-load', async (evt) => {
    assertTrustedIpcEvent(evt);
    try {
      return await readJsonTextWithRecovery(PROJECTS_FILE(), app.getPath('userData'));
    } catch {
      return null;
    }
  });

  ipcMain.handle('magine-projects-save', async (evt, json) => {
    assertTrustedIpcEvent(evt);
    if (typeof json !== 'string') return;
    if (Buffer.byteLength(json, 'utf8') > 128 * 1024 * 1024) {
      throw new Error('项目数据超过桌面版允许的最大大小');
    }
    await writeJsonTextAtomic(PROJECTS_FILE(), json);
  });

  ipcMain.handle('magine-projects-index-load', async (evt) => {
    assertTrustedIpcEvent(evt);
    try {
      return await readJsonTextWithRecovery(PROJECTS_INDEX_FILE(), app.getPath('userData'));
    } catch {
      return null;
    }
  });

  ipcMain.handle('magine-projects-index-save', async (evt, json) => {
    assertTrustedIpcEvent(evt);
    if (typeof json !== 'string' || Buffer.byteLength(json, 'utf8') > 4 * 1024 * 1024) {
      throw new Error('Project index exceeds the desktop storage limit.');
    }
    await writeJsonTextAtomic(PROJECTS_INDEX_FILE(), json);
  });

  ipcMain.handle('magine-project-load', async (evt, projectId) => {
    assertTrustedIpcEvent(evt);
    if (!validDesktopProjectId(projectId)) return null;
    try {
      return await readJsonTextWithRecovery(PROJECT_FILE(projectId), PROJECTS_DIRECTORY());
    } catch {
      return null;
    }
  });

  ipcMain.handle('magine-project-save', async (evt, projectId, json) => {
    assertTrustedIpcEvent(evt);
    if (!validDesktopProjectId(projectId) || typeof json !== 'string') return;
    if (Buffer.byteLength(json, 'utf8') > 128 * 1024 * 1024) {
      throw new Error('Project data exceeds the desktop storage limit.');
    }
    await writeJsonTextAtomic(PROJECT_FILE(projectId), json);
  });

  ipcMain.handle('magine-project-delete', async (evt, projectId) => {
    assertTrustedIpcEvent(evt);
    if (!validDesktopProjectId(projectId)) return;
    await fs.promises.rm(PROJECT_FILE(projectId), { force: true });
  });

  ipcMain.handle('magine-select-directory', async (evt, defaultPath) => {
    assertTrustedIpcEvent(evt);
    const owner = BrowserWindow.fromWebContents(evt.sender);
    const options = {
      title: '选择工程导出位置',
      defaultPath: typeof defaultPath === 'string' && path.isAbsolute(defaultPath)
        ? defaultPath
        : undefined,
      properties: ['openDirectory', 'createDirectory'],
    };
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0] || null;
  });

  ipcMain.handle('magine-music-api-status', async (evt) => {
    assertTrustedIpcEvent(evt);
    return { running: false, available: false, removed: true };
  });

  ipcMain.handle('magine-open-external', async (evt, url) => {
    assertTrustedIpcEvent(evt);
    if (!isSafeExternalUrl(url)) return false;
    await shell.openExternal(url);
    return true;
  });

  ipcMain.handle('magine-open-purchase-url', async (evt, url) => {
    assertTrustedIpcEvent(evt);
    return openPurchaseWindow(url);
  });
}

let ipcDreaminaRegistered = false;

function registerDreaminaCliIpc() {
  if (ipcDreaminaRegistered) return;
  ipcDreaminaRegistered = true;

  ipcMain.handle('magine-dreamina-user-credit', async (evt, cliPath) => {
    assertTrustedIpcEvent(evt);
    try {
      return await checkUserCredit(cliPath);
    } catch (e) {
      return { ok: false, loggedIn: false, error: e.message || '检测失败' };
    }
  });

  ipcMain.handle('magine-dreamina-login', async (event, cliPath, forceRelogin, browser) => {
    assertTrustedIpcEvent(event);
    try {
      return await runLogin(cliPath, event.sender, Boolean(forceRelogin), browser);
    } catch (e) {
      return { ok: false, error: e.message || '登录启动失败' };
    }
  });

  ipcMain.handle('magine-dreamina-open-login-url', async (event, url, browser) => {
    assertTrustedIpcEvent(event);
    try {
      await openDreaminaUrl(url, browser);
      return true;
    } catch (e) {
      console.error('[dreamina-cli] open login url failed:', e);
      return false;
    }
  });
}

const isDev = process.env.ELECTRON_DEV === '1';

function resolveAppIcon() {
  const candidates = [
    path.join(__dirname, '..', 'build', 'icon.png'),
    path.join(__dirname, '..', 'LOGO.png'),
    path.join(process.resourcesPath, 'next-standalone', 'public', 'icon.png'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

const APP_ICON = resolveAppIcon();
/** 与安装版一致用 127.0.0.1，避免 localhost / 127.0.0.1 两套 localStorage */
const DEV_RENDERER_URL = process.env.ELECTRON_DEV_URL || 'http://127.0.0.1:3000/';
/** 安装版内嵌 Next standalone 监听端口；默认 3000 与开发服务器一致，可用 ELECTRON_NEXT_PORT 覆盖 */
const PORT = process.env.ELECTRON_NEXT_PORT || '3000';
const AGENT_API_TOKEN = randomBytes(32).toString('base64url');
const STARTUP_WINDOW_MIN_VISIBLE_MS = 1000;

let mainWindow = null;
let splashWindow = null;
let splashShownAt = 0;
let startupState = {
  progress: 6,
  status: '正在初始化客户端...',
  detail: '首次启动或版本更新后可能需要更长时间',
  edition: '学习源码版',
};

async function createStartupWindow() {
  splashWindow = new BrowserWindow({
    width: 520,
    height: 270,
    show: false,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    center: true,
    alwaysOnTop: true,
    backgroundColor: '#090b0e',
    ...(APP_ICON ? { icon: APP_ICON } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: 'magine-startup',
    },
  });
  splashWindow.on('closed', () => {
    splashWindow = null;
    splashShownAt = 0;
  });
  const splashPath = path.join(__dirname, 'splash.html');
  const splashIcon = APP_ICON && fs.existsSync(APP_ICON)
    ? `data:image/png;base64,${fs.readFileSync(APP_ICON).toString('base64')}`
    : '';
  const splashHtml = fs.readFileSync(splashPath, 'utf8')
    .replace('__MAGINE_SPLASH_ICON__', splashIcon);
  await splashWindow.loadURL(`data:text/html;base64,${Buffer.from(splashHtml).toString('base64')}`);
  if (!splashWindow.isDestroyed()) {
    splashShownAt = Date.now();
    splashWindow.show();
    await updateStartupState(startupState);
  }
}

async function updateStartupState(next) {
  startupState = { ...startupState, ...next };
  if (!splashWindow || splashWindow.isDestroyed() || splashWindow.webContents.isDestroyed()) return;
  const serialized = JSON.stringify(startupState);
  await splashWindow.webContents
    .executeJavaScript(`window.setStartupState(${serialized})`, true)
    .catch(() => {});
}

async function revealMainWindow(win) {
  if (!win || win.isDestroyed()) return;
  await updateStartupState({ progress: 100, status: '启动完成', detail: '' });
  const visibleFor = splashShownAt > 0 ? Date.now() - splashShownAt : STARTUP_WINDOW_MIN_VISIBLE_MS;
  const remaining = Math.max(0, STARTUP_WINDOW_MIN_VISIBLE_MS - visibleFor);
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
  if (win.isDestroyed()) return;
  win.show();
  win.focus();
  if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
}

async function runStartupDataProtection(channel) {
  if (!app.isPackaged) {
    await updateStartupState({ progress: 28, status: '正在准备开发环境...', detail: '' });
    return;
  }

  await updateStartupState({
    progress: 16,
    status: '正在检查本地项目数据...',
    detail: '更新过程不会覆盖项目、素材和本地配置',
  });
  await new Promise((resolve) => setTimeout(resolve, 60));
  try {
    const migrated = migrateLegacyUserData(STABLE_USER_DATA_DIR, [LEGACY_USER_DATA_DIR]);
    await updateStartupState({
      progress: migrated ? 30 : 24,
      status: migrated ? '正在迁移原有本地数据...' : '本地数据检查完成',
    });
  } catch (error) {
    console.error('[electron] install user data migration failed:', error);
  }

  await updateStartupState({ progress: 34, status: '正在保护项目数据...' });
  try {
    const backupDir = protectUserDataForCurrentBuild({
      userDataDir: STABLE_USER_DATA_DIR,
      version: app.getVersion(),
      executablePath: process.execPath,
      isPackaged: app.isPackaged,
      channel,
    });
    if (backupDir) console.log('[electron] upgrade user data snapshot:', backupDir);
  } catch (error) {
    console.error('[electron] upgrade user data snapshot failed:', error);
  }
  await updateStartupState({ progress: 43, status: '项目数据保护完成', detail: '' });
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      if (splashWindow && !splashWindow.isDestroyed()) splashWindow.focus();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}
let purchaseWindow = null;
let serverChild = null;
let musicApiServer = null;
let musicApiProcess = null;
let musicApiAvailable = false;
let applicationLoaded = false;
let applicationStarting = null;
let updateManager = null;
let browserIpcRegistered = false;
let browserMediaProtocolRegistered = false;
const browserGuestNodeIds = new Map();
const browserDownloadSessions = new WeakSet();

const BROWSER_MEDIA_DIR = () => path.join(magineCacheRoot(), 'browser-downloads');
let ipcMediaSaveRegistered = false;

function sanitizeDownloadFileName(value) {
  const baseName = path.basename(String(value || 'magine-media'));
  return baseName
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/[.\s]+$/g, '')
    .slice(0, 180) || 'magine-media';
}

function bufferFromIpcBytes(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value && value.type === 'Buffer' && Array.isArray(value.data)) {
    return Buffer.from(value.data);
  }
  return null;
}

async function writeDownloadSource(event, request, destination) {
  const bytes = bufferFromIpcBytes(request?.bytes);
  if (bytes) {
    await fs.promises.writeFile(destination, bytes);
    return;
  }

  const sourceUrl = typeof request?.sourceUrl === 'string' ? request.sourceUrl.trim() : '';
  if (!sourceUrl || sourceUrl.length > 16 * 1024) throw new Error('Invalid media download URL');

  if (path.isAbsolute(sourceUrl)) {
    if (path.resolve(sourceUrl) === path.resolve(destination)) return;
    await fs.promises.copyFile(sourceUrl, destination);
    return;
  }

  let parsed;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    throw new Error('Invalid media download URL');
  }

  if (parsed.protocol === 'file:') {
    const sourcePath = fileURLToPath(parsed);
    if (path.resolve(sourcePath) === path.resolve(destination)) return;
    await fs.promises.copyFile(sourcePath, destination);
    return;
  }
  if (!['http:', 'https:', 'data:', 'magine-media:'].includes(parsed.protocol)) {
    throw new Error(`Unsupported media URL protocol: ${parsed.protocol}`);
  }
  const response = await event.sender.session.fetch(sourceUrl, { credentials: 'include' });
  if (!response.ok) throw new Error(`Media download failed: HTTP ${response.status}`);
  if (!response.body) throw new Error('Media download returned an empty response');
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(destination));
}

function registerMediaSaveIpc() {
  if (ipcMediaSaveRegistered) return;
  ipcMediaSaveRegistered = true;
  ipcMain.handle('magine-save-media', async (event, request) => {
    assertTrustedIpcEvent(event);
    const suggestedName = sanitizeDownloadFileName(request?.suggestedName);
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: '保存媒体文件',
      defaultPath: path.join(app.getPath('downloads'), suggestedName),
    };
    const selection = owner
      ? await dialog.showSaveDialog(owner, options)
      : await dialog.showSaveDialog(options);
    if (selection.canceled || !selection.filePath) return { ok: false, canceled: true };

    const destination = selection.filePath;
    const tempPath = path.join(
      path.dirname(destination),
      `.${path.basename(destination)}.${process.pid}.${Date.now()}.download`,
    );
    try {
      await writeDownloadSource(event, request, tempPath);
      await fs.promises.rm(destination, { force: true });
      await fs.promises.rename(tempPath, destination);
      return { ok: true, canceled: false, savedPath: destination };
    } catch (error) {
      await fs.promises.rm(tempPath, { force: true }).catch(() => {});
      const message = error instanceof Error ? error.message : String(error);
      console.error('[electron] media save failed:', message);
      return { ok: false, canceled: false, error: message };
    }
  });

  ipcMain.handle('magine-save-media-batch', async (event, request) => {
    assertTrustedIpcEvent(event);
    const requestId = typeof request?.requestId === 'string' && /^[a-z0-9:_-]{1,120}$/i.test(request.requestId)
      ? request.requestId
      : '';
    const rawGroups = Array.isArray(request?.groups) ? request.groups : [];
    if (rawGroups.length === 0 || rawGroups.length > 200) {
      return { ok: false, canceled: false, savedCount: 0, failedCount: 0, error: '批量保存请求无效' };
    }

    const groups = rawGroups.map((group) => ({
      nodeId: typeof group?.nodeId === 'string' ? group.nodeId.slice(0, 240) : '',
      folderName: typeof group?.folderName === 'string' ? group.folderName : '节点素材',
      items: Array.isArray(group?.items) ? group.items : [],
    }));
    if (groups.some((group) => group.items.length === 0 || group.items.length > 200)) {
      return { ok: false, canceled: false, savedCount: 0, failedCount: 0, error: '单个节点的素材数量无效' };
    }

    const owner = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: typeof request?.title === 'string' && request.title.trim()
        ? request.title.trim().slice(0, 80)
        : '选择批量保存位置',
      defaultPath: app.getPath('downloads'),
      properties: ['openDirectory', 'createDirectory'],
    };
    const selection = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    if (selection.canceled || !selection.filePaths[0]) {
      return { ok: false, canceled: true, savedCount: 0, failedCount: 0 };
    }

    const directory = selection.filePaths[0];
    try {
      const result = await exportMediaGroups({
        baseDirectory: directory,
        groups,
        sanitizeFileName: sanitizeDownloadFileName,
        writeSource: (item, destination) => writeDownloadSource(event, item, destination),
        onProgress: (progress) => {
          if (!requestId || event.sender.isDestroyed()) return;
          event.sender.send('magine-save-media-batch-progress', { requestId, ...progress });
        },
      });
      return {
        ok: result.savedCount > 0,
        canceled: false,
        directory,
        ...result,
        error: result.savedCount > 0 ? undefined : '没有素材成功写入',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[electron] batch media save failed:', message);
      return {
        ok: false,
        canceled: false,
        directory,
        savedCount: 0,
        failedCount: groups.reduce((total, group) => total + group.items.length, 0),
        error: message,
      };
    }
  });
}

function browserMediaType(fileName, mimeType) {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  const ext = path.extname(String(fileName || '')).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.bmp'].includes(ext)) return 'image';
  if (['.mp4', '.webm', '.mov', '.m4v', '.avi', '.mkv'].includes(ext)) return 'video';
  if (['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.opus'].includes(ext)) return 'audio';
  return '';
}

function uniqueBrowserMediaName(fileName) {
  const raw = path.basename(String(fileName || 'browser-media'));
  const ext = path.extname(raw).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 12);
  const stem = path.basename(raw, path.extname(raw))
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72) || 'browser-media';
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${stem}${ext}`;
}

function browserMediaUrl(fileName) {
  return `magine-media://browser/${encodeURIComponent(fileName)}`;
}

function resolveDesktopFfmpegPath() {
  let modulePath = '';
  try {
    modulePath = require('ffmpeg-static') || '';
  } catch {
    modulePath = '';
  }
  const executableName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const candidates = [
    modulePath && modulePath.replace('app.asar', 'app.asar.unpacked'),
    path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', executableName),
    path.join(__dirname, '..', 'node_modules', 'ffmpeg-static', executableName),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || 'ffmpeg';
}

function runDesktopFfmpeg(args, timeoutMs = 20 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveDesktopFfmpegPath(), args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 64 * 1024) stderr += chunk.toString();
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('FFmpeg 素材裁剪超时'));
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `FFmpeg 素材裁剪失败 (${code ?? 'unknown'})`));
    });
  });
}

function localBrowserMediaPath(sourceUrl) {
  try {
    const parsed = new URL(sourceUrl);
    if (parsed.protocol !== 'magine-media:' || parsed.hostname !== 'browser') return '';
    const requestedName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
    const safeName = path.basename(requestedName);
    if (!safeName || safeName !== requestedName) return '';
    const resolved = path.resolve(BROWSER_MEDIA_DIR(), safeName);
    const root = `${path.resolve(BROWSER_MEDIA_DIR())}${path.sep}`;
    return resolved.startsWith(root) && fs.existsSync(resolved) ? resolved : '';
  } catch {
    return '';
  }
}

async function materializeMediaEditInput(event, sourceUrl, fileName, fallbackExtension, mediaLabel) {
  const localPath = localBrowserMediaPath(sourceUrl);
  if (localPath) return { filePath: localPath, temporary: false };

  const extension = path.extname(String(fileName || '')) || fallbackExtension;
  const safeExtension = /^\.[a-zA-Z0-9]{1,8}$/.test(extension) ? extension : fallbackExtension;
  const inputPath = path.join(
    BROWSER_MEDIA_DIR(),
    `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-trim-input${safeExtension}`,
  );

  if (sourceUrl.startsWith('data:')) {
    const match = /^data:([^;,]*)(;base64)?,([\s\S]*)$/i.exec(sourceUrl);
    if (!match) throw new Error(`待裁剪${mediaLabel}的 data URL 无效`);
    let bytes;
    try {
      bytes = match[2]
        ? Buffer.from(match[3].replace(/\s/g, ''), 'base64')
        : Buffer.from(decodeURIComponent(match[3]), 'utf8');
    } catch {
      throw new Error(`无法解码待裁剪${mediaLabel}`);
    }
    if (!bytes.length) throw new Error(`待裁剪${mediaLabel}内容为空`);
    fs.mkdirSync(path.dirname(inputPath), { recursive: true });
    await fs.promises.writeFile(inputPath, bytes);
    return { filePath: inputPath, temporary: true };
  }

  if (sourceUrl.startsWith('file:')) {
    const filePath = fileURLToPath(sourceUrl);
    if (!fs.existsSync(filePath)) throw new Error(`待裁剪${mediaLabel}文件不存在`);
    return { filePath, temporary: false };
  }

  if (path.isAbsolute(sourceUrl)) {
    if (!fs.existsSync(sourceUrl)) throw new Error(`待裁剪${mediaLabel}文件不存在`);
    return { filePath: sourceUrl, temporary: false };
  }

  let fetchUrl = sourceUrl;
  if (/^\//.test(fetchUrl)) fetchUrl = new URL(fetchUrl, event.sender.getURL()).toString();
  const response = await event.sender.session.fetch(fetchUrl, { credentials: 'include' });
  if (!response.ok || !response.body) {
    throw new Error(`无法读取待裁剪${mediaLabel} (HTTP ${response.status})`);
  }
  fs.mkdirSync(path.dirname(inputPath), { recursive: true });
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(inputPath));
  return { filePath: inputPath, temporary: true };
}

async function trimMaterialVideo(event, request) {
  const sourceUrl = typeof request?.sourceUrl === 'string' ? request.sourceUrl.trim() : '';
  const start = Number(request?.start);
  const end = Number(request?.end);
  if (!sourceUrl || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
    throw new Error('视频裁剪参数无效');
  }
  const input = await materializeMediaEditInput(event, sourceUrl, request?.fileName, '.mp4', '视频');
  const stem = path.basename(String(request?.fileName || 'material-video'), path.extname(String(request?.fileName || '')))
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72) || 'material-video';
  const outputName = uniqueBrowserMediaName(`${stem}-trimmed.mp4`);
  const outputPath = path.join(BROWSER_MEDIA_DIR(), outputName);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  try {
    await runDesktopFfmpeg([
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-i', input.filePath,
      '-ss', start.toFixed(3),
      '-t', (end - start).toFixed(3),
      '-map', '0:v:0',
      '-map', '0:a?',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '20',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-movflags', '+faststart',
      outputPath,
    ]);
    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size <= 0) {
      throw new Error('视频裁剪未生成有效文件');
    }
    return {
      url: browserMediaUrl(outputName),
      fileName: `${stem}-trimmed.mp4`,
      duration: end - start,
    };
  } catch (error) {
    await fs.promises.rm(outputPath, { force: true }).catch(() => {});
    throw error;
  } finally {
    if (input.temporary) {
      await fs.promises.rm(input.filePath, { force: true }).catch(() => {});
    }
  }
}

async function trimMaterialAudio(event, request) {
  const sourceUrl = typeof request?.sourceUrl === 'string' ? request.sourceUrl.trim() : '';
  const start = Number(request?.start);
  const end = Number(request?.end);
  if (!sourceUrl || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
    throw new Error('音频裁剪参数无效');
  }
  const input = await materializeMediaEditInput(event, sourceUrl, request?.fileName, '.mp3', '音频');
  const stem = path.basename(String(request?.fileName || 'material-audio'), path.extname(String(request?.fileName || '')))
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72) || 'material-audio';
  const outputName = uniqueBrowserMediaName(`${stem}-trimmed.mp3`);
  const outputPath = path.join(BROWSER_MEDIA_DIR(), outputName);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  try {
    await runDesktopFfmpeg([
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-i', input.filePath,
      '-ss', start.toFixed(3),
      '-t', (end - start).toFixed(3),
      '-map', '0:a:0',
      '-vn',
      '-c:a', 'libmp3lame',
      '-b:a', '192k',
      outputPath,
    ]);
    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size <= 0) {
      throw new Error('音频裁剪未生成有效文件');
    }
    return {
      url: browserMediaUrl(outputName),
      fileName: `${stem}-trimmed.mp3`,
      duration: end - start,
    };
  } catch (error) {
    await fs.promises.rm(outputPath, { force: true }).catch(() => {});
    throw error;
  } finally {
    if (input.temporary) {
      await fs.promises.rm(input.filePath, { force: true }).catch(() => {});
    }
  }
}

async function createMaterialVideoThumbnail(event, request) {
  const sourceUrl = typeof request?.sourceUrl === 'string' ? request.sourceUrl.trim() : '';
  if (!sourceUrl) throw new Error('视频缩略图来源为空');

  const requestedTime = Number(request?.time);
  const time = Number.isFinite(requestedTime) ? Math.max(0, Math.min(3600, requestedTime)) : 0.5;
  const requestedMaxEdge = Number(request?.maxEdge);
  const maxEdge = Number.isFinite(requestedMaxEdge)
    ? Math.max(160, Math.min(1920, Math.round(requestedMaxEdge)))
    : 720;
  const input = await materializeMediaEditInput(event, sourceUrl, '', '.mp4', '视频');
  const outputPath = path.join(
    BROWSER_MEDIA_DIR(),
    `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-poster.jpg`,
  );
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  try {
    await runDesktopFfmpeg([
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-ss', time.toFixed(3),
      '-i', input.filePath,
      '-frames:v', '1',
      '-vf', `scale=${maxEdge}:-2:force_original_aspect_ratio=decrease`,
      '-q:v', '3',
      outputPath,
    ], 60_000);
    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size <= 0) {
      throw new Error('FFmpeg 未生成有效的视频缩略图');
    }
    const bytes = await fs.promises.readFile(outputPath);
    return { dataUrl: `data:image/jpeg;base64,${bytes.toString('base64')}` };
  } finally {
    await fs.promises.rm(outputPath, { force: true }).catch(() => {});
    if (input.temporary) {
      await fs.promises.rm(input.filePath, { force: true }).catch(() => {});
    }
  }
}

function attachBrowserDownloadHandler(browserSession) {
  if (!browserSession || browserDownloadSessions.has(browserSession)) return;
  browserDownloadSessions.add(browserSession);
  browserSession.on('will-download', (_event, item, sourceWebContents) => {
    const originalName = item.getFilename();
    const mimeType = item.getMimeType();
    const fileType = browserMediaType(originalName, mimeType);
    if (!fileType) return;

    const storedName = uniqueBrowserMediaName(originalName);
    const storedPath = path.join(BROWSER_MEDIA_DIR(), storedName);
    fs.mkdirSync(path.dirname(storedPath), { recursive: true });
    item.setSavePath(storedPath);

    item.once('done', (_doneEvent, state) => {
      if (state !== 'completed' || !fs.existsSync(storedPath)) return;
      const nodeId = browserGuestNodeIds.get(sourceWebContents?.id);
      if (!nodeId || !mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send('magine-browser-media-downloaded', {
        id: `browser-media-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        nodeId,
        fileName: originalName || storedName,
        fileType,
        mimeType,
        url: browserMediaUrl(storedName),
        createdAt: Date.now(),
      });
    });
  });
}

function registerBrowserIpc() {
  if (browserIpcRegistered) return;
  browserIpcRegistered = true;
  ipcMain.handle('magine-browser-register-guest', (event, nodeId, guestId) => {
    assertTrustedIpcEvent(event);
    if (typeof nodeId !== 'string' || !/^node_[a-z0-9_]+$/i.test(nodeId)) return false;
    const numericGuestId = Number(guestId);
    if (!Number.isInteger(numericGuestId) || numericGuestId <= 0) return false;
    browserGuestNodeIds.set(numericGuestId, nodeId);
    return true;
  });
  ipcMain.handle('magine-material-video-trim', async (event, request) => {
    assertTrustedIpcEvent(event);
    return trimMaterialVideo(event, request);
  });
  ipcMain.handle('magine-material-audio-trim', async (event, request) => {
    assertTrustedIpcEvent(event);
    return trimMaterialAudio(event, request);
  });
  ipcMain.handle('magine-material-video-thumbnail', async (event, request) => {
    assertTrustedIpcEvent(event);
    return createMaterialVideoThumbnail(event, request);
  });
}

async function registerBrowserMediaProtocol() {
  if (browserMediaProtocolRegistered) return;
  browserMediaProtocolRegistered = true;
  protocol.handle('magine-media', async (request) => {
    try {
      const parsed = new URL(request.url);
      if (parsed.hostname !== 'browser') return new Response('Not found', { status: 404 });
      const requestedName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
      const safeName = path.basename(requestedName);
      if (!safeName || safeName !== requestedName) return new Response('Forbidden', { status: 403 });
      const filePath = path.resolve(BROWSER_MEDIA_DIR(), safeName);
      const root = `${path.resolve(BROWSER_MEDIA_DIR())}${path.sep}`;
      if (!filePath.startsWith(root) || !fs.existsSync(filePath)) {
        return new Response('Not found', { status: 404 });
      }
      return net.fetch(pathToFileURL(filePath).toString(), {
        headers: request.headers,
      });
    } catch {
      return new Response('Invalid media URL', { status: 400 });
    }
  });
}

function isLocalAppUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    const configured = new URL(DEV_RENDERER_URL);
    const localHost = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
    const configuredHost =
      configured.hostname === '127.0.0.1' || configured.hostname === 'localhost';
    return (
      parsed.protocol === 'http:' &&
      localHost &&
      configuredHost &&
      parsed.port === (isDev ? configured.port : String(PORT))
    );
  } catch {
    return false;
  }
}

function assertTrustedIpcEvent(event) {
  const senderUrl = event.senderFrame?.url || event.sender?.getURL?.() || '';
  if (!isLocalAppUrl(senderUrl)) {
    throw new Error('Rejected IPC request from an untrusted renderer');
  }
}

function isSafeExternalUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    if (parsed.protocol === 'https:') return true;
    return (
      parsed.protocol === 'http:' &&
      (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost')
    );
  } catch {
    return false;
  }
}

function isSafeBrowserUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function isHttpUrl(url) {
  return isSafeExternalUrl(url);
}

async function openPurchaseWindow(url) {
  if (!isHttpUrl(url)) return false;

  if (!purchaseWindow || purchaseWindow.isDestroyed()) {
    purchaseWindow = new BrowserWindow({
      width: 1180,
      height: 820,
      minWidth: 900,
      minHeight: 640,
      show: false,
      title: '购买额度',
      autoHideMenuBar: true,
      webPreferences: {
        partition: 'persist:magine-purchase',
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    });

    purchaseWindow.once('ready-to-show', () => {
      if (purchaseWindow && !purchaseWindow.isDestroyed()) purchaseWindow.show();
    });
    purchaseWindow.on('closed', () => {
      purchaseWindow = null;
    });
    purchaseWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
      if (isHttpUrl(targetUrl)) {
        purchaseWindow?.loadURL(targetUrl).catch((err) => {
          console.error('[electron] purchase window popup navigation failed:', err);
        });
      } else if (isSafeExternalUrl(targetUrl)) {
        shell.openExternal(targetUrl).catch((err) => {
          console.error('[electron] purchase external protocol failed:', err);
        });
      }
      return { action: 'deny' };
    });
    purchaseWindow.webContents.on('will-navigate', (event, targetUrl) => {
      if (isHttpUrl(targetUrl)) return;
      event.preventDefault();
      if (isSafeExternalUrl(targetUrl)) {
        shell.openExternal(targetUrl).catch((err) => {
          console.error('[electron] purchase external navigation failed:', err);
        });
      }
    });
  }

  if (purchaseWindow.isMinimized()) purchaseWindow.restore();
  purchaseWindow.show();
  purchaseWindow.focus();
  await purchaseWindow.loadURL(url);
  return true;
}

function standaloneRoot() {
  if (isDev) {
    return path.join(__dirname, '..', '.next', 'standalone');
  }
  return path.join(process.resourcesPath, 'next-standalone');
}

function packagedInstallCacheRoot() {
  if (isDev) return null;
  const execPath = process.execPath || '';
  if (!execPath) return null;
  return path.join(path.dirname(execPath), 'magine-cache');
}

function isWritableCacheRoot(root) {
  if (!root) return false;
  try {
    fs.mkdirSync(root, { recursive: true });
    const probe = path.join(root, '.write-test');
    fs.writeFileSync(probe, String(Date.now()), 'utf8');
    fs.unlinkSync(probe);
    return true;
  } catch (e) {
    console.warn('[electron] cache root is not writable:', root, e?.message || e);
    return false;
  }
}

function magineCacheRoot() {
  const userDataCacheRoot = path.join(STABLE_USER_DATA_DIR, 'magine-cache');
  if (!isWritableCacheRoot(userDataCacheRoot)) {
    console.error('[electron] stable user cache root is not writable:', userDataCacheRoot);
  }
  return userDataCacheRoot;
}

function configureMagineRuntimeEnv() {
  const cacheRoot = magineCacheRoot();
  process.env.MAGINE_CACHE_ROOT = cacheRoot;
  process.env.MAGINE_INSTALL_CACHE_ROOT = packagedInstallCacheRoot() || '';
  try {
    process.env.MAGINE_DESKTOP_DIR = app.getPath('desktop') || '';
  } catch {
    process.env.MAGINE_DESKTOP_DIR = '';
  }
  return cacheRoot;
}

function startEmbeddedNext() {
  if (serverChild?.pid) return serverChild;

  const root = standaloneRoot();
  const serverJs = path.join(root, 'server.js');
  if (!fs.existsSync(serverJs)) {
    console.error('[electron] 未找到 Next standalone:', serverJs);
    console.error('[electron] 请先执行: npm run build:electron');
    return null;
  }

  const cacheRoot = configureMagineRuntimeEnv();
  try {
    fs.mkdirSync(cacheRoot, { recursive: true });
  } catch (e) {
    console.error('[electron] 无法创建缓存目录:', cacheRoot, e.message);
  }

  const env = {
    ...process.env,
    PORT,
    HOSTNAME: '127.0.0.1',
    HOST: '127.0.0.1',
    NODE_ENV: 'production',
    NODE_PATH: path.join(root, '_standalone_vendor'),
    MAGINE_CACHE_ROOT: cacheRoot,
    MAGINE_INSTALL_CACHE_ROOT: packagedInstallCacheRoot() || '',
    MAGINE_DESKTOP_DIR: process.env.MAGINE_DESKTOP_DIR || '',
    MAGINE_AGENT_API_TOKEN: AGENT_API_TOKEN,
  };

  console.log('[electron] MAGINE_CACHE_ROOT:', cacheRoot);

  serverChild = utilityProcess.fork(serverJs, [], {
    cwd: root,
    env,
    stdio: 'pipe',
    serviceName: 'Magine Canvas Local Server',
  });

  serverChild.stdout?.on('data', (data) => {
    console.log('[electron:next]', data.toString().trimEnd());
  });
  serverChild.stderr?.on('data', (data) => {
    console.error('[electron:next:err]', data.toString().trimEnd());
  });

  serverChild.on('error', (err) => console.error('[electron] Next 子进程错误:', err));
  serverChild.on('exit', (code, signal) => {
    console.error('[electron] Next 子进程退出, code:', code, 'signal:', signal);
    serverChild = null;
  });
  return serverChild;
}

function installAgentApiTokenInterceptor() {
  let rendererOrigin = '';
  try {
    rendererOrigin = new URL(isDev ? DEV_RENDERER_URL : `http://127.0.0.1:${PORT}/`).origin;
  } catch {
    return;
  }

  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, callback) => {
    let shouldAuthorize = false;
    try {
      const url = new URL(details.url);
      const isProtectedDesktopApi =
        url.pathname === '/api/agent/file'
        || url.pathname === '/api/agent/terminal'
        || url.pathname === '/api/provider/test'
        || /^\/api\/proxy\/(?:openai|gemini|volcengine|model|upload)$/.test(url.pathname);
      shouldAuthorize = Boolean(
        url.origin === rendererOrigin
        && isProtectedDesktopApi
        && mainWindow
        && !mainWindow.isDestroyed()
        && details.webContentsId === mainWindow.webContents.id
      );
    } catch {
      shouldAuthorize = false;
    }

    const requestHeaders = { ...details.requestHeaders };
    if (shouldAuthorize) requestHeaders['X-Magine-Desktop-Token'] = AGENT_API_TOKEN;
    callback({ requestHeaders });
  });
}

async function startMusicApi() {
  if (musicApiServer) return musicApiServer;

  console.log('[electron] ====== 开始启动音乐 API ======');
  console.log('[electron] isDev:', isDev);
  console.log('[electron] __dirname:', __dirname);
  console.log('[electron] process.resourcesPath:', process.resourcesPath);

  try {
    const anonymousTokenPath = path.join(os.tmpdir(), 'anonymous_token');
    if (!fs.existsSync(anonymousTokenPath)) {
      try {
        fs.writeFileSync(anonymousTokenPath, '', { encoding: 'utf8', flag: 'wx' });
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
      }
    }
    let serveNcmApi = null;
    let loadedFrom = '';

    // 方式1：标准 require（开发模式或模块在 node_modules 路径中）
    try {
      const mod = require('NeteaseCloudMusicApi/server');
      serveNcmApi = mod.serveNcmApi;
      loadedFrom = '方式1: require("NeteaseCloudMusicApi/server")';
      console.log('[electron] ✓', loadedFrom);
    } catch (e) {
      console.log('[electron] ✗ 方式1失败:', e.message);
    }

    // 方式2：从 app.asar.unpacked 加载（打包后标准路径）
    if (!serveNcmApi) {
      try {
        const ncmaPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'NeteaseCloudMusicApi');
        console.log('[electron] 尝试方式2: require("' + ncmaPath + '")');
        const mod = require(ncmaPath);
        serveNcmApi = mod.serveNcmApi;
        loadedFrom = '方式2: ' + ncmaPath;
        console.log('[electron] ✓', loadedFrom);
      } catch (e) {
        console.log('[electron] ✗ 方式2失败:', e.message);
      }
    }

    // 方式3：从 __dirname 相对路径加载（开发模式）
    if (!serveNcmApi) {
      try {
        const ncmaPath = path.join(__dirname, '../node_modules', 'NeteaseCloudMusicApi');
        console.log('[electron] 尝试方式3: require("' + ncmaPath + '")');
        const mod = require(ncmaPath);
        serveNcmApi = mod.serveNcmApi;
        loadedFrom = '方式3: ' + ncmaPath;
        console.log('[electron] ✓', loadedFrom);
      } catch (e) {
        console.log('[electron] ✗ 方式3失败:', e.message);
      }
    }

    // 方式4：从可执行文件同级目录搜索（便携版/解压版）
    if (!serveNcmApi) {
      try {
        const exeDir = path.dirname(process.execPath);
        const ncmaPath = path.join(exeDir, 'resources', 'app.asar.unpacked', 'node_modules', 'NeteaseCloudMusicApi');
        console.log('[electron] 尝试方式4: require("' + ncmaPath + '")');
        const mod = require(ncmaPath);
        serveNcmApi = mod.serveNcmApi;
        loadedFrom = '方式4: ' + ncmaPath;
        console.log('[electron] ✓', loadedFrom);
      } catch (e) {
        console.log('[electron] ✗ 方式4失败:', e.message);
      }
    }

    // 方式5：递归搜索 node_modules 查找 NeteaseCloudMusicApi（终极后备）
    if (!serveNcmApi) {
      try {
        const searchDirs = [
          process.resourcesPath,
          path.dirname(process.execPath),
          path.join(process.resourcesPath, '..'),
          __dirname,
          path.join(__dirname, '..'),
        ];
        for (const base of searchDirs) {
          const found = findModuleRecursive(base, 'NeteaseCloudMusicApi');
          if (found) {
            try {
              const mod = require(found);
              serveNcmApi = mod.serveNcmApi;
              loadedFrom = '方式5(递归): ' + found;
              console.log('[electron] ✓', loadedFrom);
              break;
            } catch (e) {
              console.log('[electron] 方式5找到但加载失败:', found, e.message);
            }
          }
        }
      } catch (e) {
        console.log('[electron] ✗ 方式5失败:', e.message);
      }
    }

    if (!serveNcmApi) {
      console.error('[electron] ✗ 无法加载 NeteaseCloudMusicApi 模块！');
      console.error('[electron] 请确保 node_modules/NeteaseCloudMusicApi 存在且已安装依赖');
      musicApiAvailable = false;
      return null;
    }

    console.log('[electron] ✓ 模块加载成功 (' + loadedFrom + ')，开始启动服务...');

    try {
      const appExt = await serveNcmApi({ port: 3370, checkVersion: false });
      musicApiServer = appExt.server;
      console.log('[electron] ✓ 网易云音乐 API 服务已启动，端口: 3370');
      musicApiAvailable = true;
    } catch (e) {
      console.error('[electron] ✗ 启动服务失败:', e.message, e.stack);
      musicApiAvailable = false;
      return null;
    }

    console.log('[electron] ====== 音乐 API 启动完成 ======');
    return musicApiServer;
  } catch (e) {
    console.error('[electron] ✗ NeteaseCloudMusicApi 启动失败:', e.message, e.stack);
    musicApiAvailable = false;
    return null;
  }
}

function waitForMusicApi(maxMs = 15000) {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const probe = () => {
      if (Date.now() - startedAt > maxMs) {
        resolve(false);
        return;
      }
      const req = http.get('http://127.0.0.1:3370/', (res) => {
        res.resume();
        resolve(true);
      });
      req.on('error', () => {
        req.destroy();
        setTimeout(probe, 250);
      });
      req.setTimeout(1500, () => {
        req.destroy();
        setTimeout(probe, 250);
      });
    };
    probe();
  });
}

async function startMusicApiIsolated() {
  if (musicApiProcess?.pid) return musicApiProcess;

  const entry = path.join(__dirname, 'start-music-api.cjs');
  if (!fs.existsSync(entry)) {
    console.error('[electron] Music API entry not found:', entry);
    musicApiAvailable = false;
    return null;
  }

  musicApiProcess = utilityProcess.fork(entry, [], {
    cwd: app.getAppPath(),
    env: {
      ...process.env,
      NODE_ENV: 'production',
    },
    stdio: 'pipe',
    serviceName: 'Magine Canvas Music API',
  });
  musicApiProcess.stdout?.on('data', (data) => {
    console.log('[electron:music]', data.toString().trimEnd());
  });
  musicApiProcess.stderr?.on('data', (data) => {
    console.error('[electron:music:err]', data.toString().trimEnd());
  });
  musicApiProcess.on('error', (error) => {
    console.error('[electron] Music API process error:', error);
    musicApiAvailable = false;
  });
  musicApiProcess.on('exit', (code) => {
    console.warn('[electron] Music API process exited:', code);
    musicApiProcess = null;
    musicApiAvailable = false;
  });

  musicApiAvailable = await waitForMusicApi();
  if (!musicApiAvailable) {
    console.error('[electron] Music API did not become ready in time.');
  }
  return musicApiProcess;
}

function findModuleRecursive(dir, moduleName) {
  const fs = require('fs');
  const path = require('path');
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const fullPath = path.join(dir, entry.name);
        if (entry.name === moduleName) return fullPath;
        if (entry.name === 'node_modules') {
          const nested = path.join(fullPath, moduleName);
          try { fs.accessSync(nested); return nested; } catch {}
        }
        if (!entry.name.startsWith('.') && entry.name !== 'dist-installer') {
          const found = findModuleRecursive(fullPath, moduleName);
          if (found) return found;
        }
      }
    }
  } catch {}
  return null;
}

function killMusicApi() {
  if (musicApiProcess) {
    try {
      musicApiProcess.kill();
      console.log('[electron] Isolated music API process stopped.');
    } catch (e) {
      console.log('[electron] Failed to stop isolated music API process:', e.message);
    }
    musicApiProcess = null;
  }
  if (musicApiServer) {
    try { 
      musicApiServer.close(); 
      console.log('[electron] 音乐 API 服务已停止');
    } catch (e) { 
      console.log('[electron] 停止音乐 API 服务时出错:', e.message);
    }
    musicApiServer = null;
  }
  musicApiAvailable = false;
}

function killServer() {
  if (serverChild) {
    try {
      serverChild.kill();
    } catch {
      /* ignore */
    }
    serverChild = null;
  }
}

function waitForServer(maxMs = 45000) {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      if (Date.now() - start > maxMs) {
        resolve(false);
        return;
      }
      const req = http.get(`http://127.0.0.1:${PORT}/`, (res) => {
        res.resume();
        resolve(true);
      });
      req.on('error', () => {
        req.destroy();
        setTimeout(tick, 300);
      });
      req.setTimeout(2000, () => {
        req.destroy();
        setTimeout(tick, 300);
      });
    };
    tick();
  });
}

/**
 * 在窗口上注册开发者工具快捷键并可选自动打开。
 * F12 或 Ctrl+Shift+I 切换 DevTools。
 * 设置环境变量 ELECTRON_DEVTOOLS=1 强制自动打开（任何模式）。
 */
function setupDevTools(win, autoOpen) {
  if (!win || !isDev) return;

  const openDevTools = () => {
    try {
      win.webContents.openDevTools({ mode: 'bottom' });
      console.log('[electron] DevTools 已打开');
    } catch (e) {
      console.error('[electron] DevTools 打开失败:', e.message);
    }
  };

  // 快捷键
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12') {
      win.webContents.toggleDevTools();
      return;
    }
    if (input.key === 'I' && input.control && input.shift) {
      win.webContents.toggleDevTools();
    }
  });

  // 自动打开：页面加载完成后
  if (autoOpen || process.env.ELECTRON_DEVTOOLS === '1') {
    win.webContents.once('did-finish-load', () => {
      openDevTools();
    });
  }
}

function setupDevRendererReadyWatchdog(win) {
  if (!isDev || !win) return;

  let reloadAttempts = 0;
  let readinessTimer = null;

  const scheduleReadinessCheck = () => {
    if (readinessTimer) clearTimeout(readinessTimer);
    readinessTimer = setTimeout(async () => {
      if (win.isDestroyed() || win.webContents.isDestroyed()) return;
      try {
        const rendererReady = await win.webContents.executeJavaScript(
          "document.documentElement.dataset.magineRendererReady === 'true'",
          true
        );
        if (rendererReady || reloadAttempts >= 2) return;
        reloadAttempts += 1;
        console.warn(
          `[electron] Renderer did not finish mounting; reloading (${reloadAttempts}/2).`
        );
        win.webContents.reloadIgnoringCache();
      } catch (error) {
        console.warn('[electron] Renderer readiness check failed:', error?.message || error);
      }
    }, 8000);
  };

  win.webContents.on('did-finish-load', scheduleReadinessCheck);
  win.once('closed', () => {
    if (readinessTimer) clearTimeout(readinessTimer);
  });
}

async function createLegacyWindow() {
  const preloadPath = path.join(__dirname, 'preload.cjs');

  if (isDev) {
    mainWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 1200,
      minHeight: 700,
      show: false,
      resizable: true,
      backgroundColor: '#0a0a10',
      ...(APP_ICON ? { icon: APP_ICON } : {}),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: true,
        preload: preloadPath,
        webgl: true,
        offscreen: false,
        devTools: true,
      },
    });
    mainWindow.once('ready-to-show', () => mainWindow?.show());
    setupDevTools(mainWindow, true);  // 开发模式自动打开 DevTools
    try {
      await mainWindow.loadURL(DEV_RENDERER_URL);
    } catch (e) {
      console.error(
        `[electron] 无法连接 ${DEV_RENDERER_URL} — 请先在 Cursor 终端运行: npm run dev`
      );
      console.error(e);
    }
    return;
  }

  startEmbeddedNext();
  const ok = await waitForServer();
  if (!ok) {
    console.error('[electron] Next standalone 未在预期时间内监听', PORT);
  }

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    show: false,
    resizable: true,
    backgroundColor: '#0a0a10',
    ...(APP_ICON ? { icon: APP_ICON } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      preload: preloadPath,
      webgl: true,
      offscreen: false,
      devTools: true,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  setupDevTools(mainWindow, false);  // 生产模式按 F12 打开
  await mainWindow.loadURL(`http://127.0.0.1:${PORT}/`);
}

function installMainWindowSecurity(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, targetUrl) => {
    if (isLocalAppUrl(targetUrl) || isLicenseLockUrl(targetUrl)) return;
    event.preventDefault();
    if (isSafeExternalUrl(targetUrl)) {
      void shell.openExternal(targetUrl);
    }
  });

  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    const partition = String(params.partition || '');
    const sourceUrl = String(params.src || '');
    if (!partition.startsWith('persist:magine-browser-') || !isSafeBrowserUrl(sourceUrl)) {
      event.preventDefault();
      return;
    }
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
    webPreferences.allowRunningInsecureContent = false;
  });

  win.webContents.on('did-attach-webview', (_event, guest) => {
    attachBrowserDownloadHandler(guest.session);
    guest.once('destroyed', () => {
      browserGuestNodeIds.delete(guest.id);
    });
    guest.setWindowOpenHandler(({ url }) => {
      if (isSafeBrowserUrl(url)) {
        setImmediate(() => {
          if (!guest.isDestroyed()) {
            void guest.loadURL(url).catch((error) => {
              console.warn('[browser] 页面跳转失败:', error?.message || error);
            });
          }
        });
      }
      return { action: 'deny' };
    });
    guest.on('will-navigate', (event, targetUrl) => {
      if (isSafeBrowserUrl(targetUrl)) return;
      event.preventDefault();
    });
  });
}

function createBaseWindow() {
  const preloadPath = path.join(__dirname, 'preload.cjs');
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    show: false,
    resizable: true,
    backgroundColor: '#0a0a10',
    ...(APP_ICON ? { icon: APP_ICON } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      preload: preloadPath,
      webgl: true,
      offscreen: false,
      devTools: isDev,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });
  installMainWindowSecurity(win);
  setupDevRendererReadyWatchdog(win);
  win.once('ready-to-show', () => {
    void revealMainWindow(win);
  });
  setupDevTools(win, true);
  return win;
}

async function loadApplication() {
  if (applicationLoaded) return;
  if (applicationStarting) return applicationStarting;

  applicationStarting = (async () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error('主窗口不可用。');
    }

    if (isDev) {
      await updateStartupState({ progress: 58, status: '正在连接开发服务...' });
      await mainWindow.loadURL(DEV_RENDERER_URL);
      applicationLoaded = true;
      return;
    }

    await updateStartupState({ progress: 52, status: '正在启动画布服务...' });
    startEmbeddedNext();
    const serverReady = await waitForServer();
    if (!serverReady) {
      throw new Error(`内嵌画布服务未能在端口 ${PORT} 启动。`);
    }
    await updateStartupState({ progress: 76, status: '正在加载画布...' });
    await mainWindow.loadURL(`http://127.0.0.1:${PORT}/`);
    await updateStartupState({ progress: 94, status: '正在准备工作区...' });
    applicationLoaded = true;
  })();

  try {
    await applicationStarting;
  } finally {
    applicationStarting = null;
  }
}

async function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  applicationLoaded = false;
  mainWindow = createBaseWindow();
  mainWindow.on('closed', () => {
    mainWindow = null;
    applicationLoaded = false;
  });

  try {
    await loadApplication();
  } catch (error) {
    console.error('[electron] application startup failed:', error);
    await updateStartupState({
      progress: 100,
      status: '客户端启动失败',
      detail: error?.message || '请重新启动客户端',
    });
  }
}

// 强制 GPU 加速（WebGL/PixiJS 依赖）。核显机器上 Chromium 可能误判为软件渲染。
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

if (hasSingleInstanceLock) app.whenReady().then(async () => {
  console.log('[electron] ====== Electron 启动 ======');
  console.log('[electron] isDev:', isDev);
  console.log('[electron] userData:', app.getPath('userData'));
  Menu.setApplicationMenu(null);
  try {
    await createStartupWindow();
  } catch (error) {
    console.error('[electron] startup window failed:', error);
  }
  await updateStartupState({ progress: 8, status: '正在加载本地功能...' });
  loadDeferredDesktopModules();
  await runStartupDataProtection('learn');
  configureMagineRuntimeEnv();
  await updateStartupState({ progress: 47, status: '正在初始化本地功能...' });

  registerDesktopProjectsIpc();
  registerDesktopSettingsIpc();
  registerMediaSaveIpc();
  registerDreaminaCliIpc();
  registerBrowserIpc();
  await registerBrowserMediaProtocol();
  await updateStartupState({ progress: 50, status: '本地功能初始化完成' });
  updateManager = createUpdateManager({
    app,
    ipcMain,
    edition: 'learn',
    feedBaseUrl: process.env.MAGINE_UPDATE_URL || 'https://maginecanvas-update.magine1921.workers.dev/learn/stable',
    userDataDir: STABLE_USER_DATA_DIR,
    prepareUserDataForUpdate,
    getMainWindow: () => mainWindow,
    beforeInstall: async () => {
      killMusicApi();
      killServer();
    },
  });
  updateManager.register();

  // 允许麦克风访问（语音助手需要）
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === 'media' && isLocalAppUrl(webContents.getURL()));
  });
  installAgentApiTokenInterceptor();
  
  await createWindow();
  updateManager.scheduleCheck();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  killServer();
  killMusicApi();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  killServer();
  killMusicApi();
});
