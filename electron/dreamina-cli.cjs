/**
 * Electron 主进程即梦 CLI 封装（调用 scripts/dreamina-cli-core.cjs）
 */
const { shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const core = require('../scripts/dreamina-cli-core.cjs');

function expandEnvPath(value) {
  return String(value || '')
    .replace(/%([^%]+)%/g, (_, name) => process.env[name] || '')
    .replace(/^~/, os.homedir());
}

function normalizeBrowserConfig(browserConfig) {
  const type = String(browserConfig?.type || 'system').toLowerCase();
  const allowed = new Set(['system', 'chrome', 'edge', 'firefox', 'custom']);
  return {
    type: allowed.has(type) ? type : 'system',
    path: expandEnvPath(browserConfig?.path || ''),
  };
}

function firstExisting(paths) {
  for (const p of paths) {
    const expanded = expandEnvPath(p);
    if (expanded && fs.existsSync(expanded)) return expanded;
  }
  return '';
}

function resolveBrowserLaunch(browserConfig, targetUrl) {
  const { type, path: customPath } = normalizeBrowserConfig(browserConfig);
  if (type === 'system') return null;
  if (type === 'custom') {
    return customPath && fs.existsSync(customPath)
      ? { command: customPath, args: [targetUrl] }
      : null;
  }

  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || '';
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const candidates = {
      chrome: [
        path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      ],
      edge: [
        path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(local, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      ],
      firefox: [
        path.join(programFiles, 'Mozilla Firefox', 'firefox.exe'),
        path.join(programFilesX86, 'Mozilla Firefox', 'firefox.exe'),
      ],
    };
    const exe = firstExisting(candidates[type] || []);
    return exe ? { command: exe, args: [targetUrl] } : null;
  }

  if (process.platform === 'darwin') {
    const appNames = {
      chrome: 'Google Chrome',
      edge: 'Microsoft Edge',
      firefox: 'Firefox',
    };
    return { command: 'open', args: ['-a', appNames[type], targetUrl] };
  }

  const commands = {
    chrome: ['google-chrome', 'chromium', 'chromium-browser'],
    edge: ['microsoft-edge', 'microsoft-edge-stable'],
    firefox: ['firefox'],
  };
  return { command: (commands[type] || [])[0], args: [targetUrl] };
}

async function openDreaminaUrl(url, browserConfig) {
  const targetUrl = String(url || '').trim();
  if (!targetUrl) throw new Error('empty url');
  const launch = resolveBrowserLaunch(browserConfig, targetUrl);
  if (!launch?.command) {
    await shell.openExternal(targetUrl);
    return;
  }
  await new Promise((resolve, reject) => {
    try {
      const child = spawn(launch.command, launch.args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.once('error', reject);
      child.unref();
      resolve();
    } catch (e) {
      reject(e);
    }
  }).catch(async () => {
    await shell.openExternal(targetUrl);
  });
}

async function checkUserCredit(cliPath) {
  return core.checkUserCredit(cliPath);
}

async function runLogin(cliPathRaw, webContents, forceRelogin = false, browserConfig) {
  return core.runDeviceFlowLogin(cliPathRaw, {
    openUrl: (url) => openDreaminaUrl(url, browserConfig),
    onProgress: (info) => {
      try {
        webContents?.send?.('magine-dreamina-login-progress', info);
      } catch {
        /* ignore */
      }
    },
  }, { forceRelogin });
}

module.exports = {
  ...core,
  checkUserCredit,
  openDreaminaUrl,
  runLogin,
};
