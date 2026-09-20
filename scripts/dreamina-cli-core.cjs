/**
 * 即梦 CLI 核心逻辑（官方 OAuth Device Flow）
 * @see https://jimeng.jianying.com/cli
 * @see SKILL.md — dreamina login 打印 verification_uri / user_code / device_code 并等待授权
 *
 * 无头流程（桌面/服务端）：
 *   1. dreamina login --headless  → 获取 device_code + verification_uri
 *   2. 用户打开 verification_uri 完成授权
 *   3. dreamina login checklogin --device_code=... --poll=30
 */
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function sanitizeCliPath(raw) {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (/^curl\s.*\|\s*(bash|sh)/i.test(trimmed)) return 'dreamina';
  return trimmed || 'dreamina';
}

function getCliCandidates(cliPathRaw) {
  const home = os.homedir();
  const exe = process.platform === 'win32' ? 'dreamina.exe' : 'dreamina';
  const dirs =
    process.platform === 'win32'
      ? [path.join(home, 'bin'), path.join(home, '.local', 'bin')]
      : [path.join(home, '.local', 'bin'), path.join(home, 'bin')];
  const out = [];
  const push = (p) => {
    if (p && !out.includes(p)) out.push(p);
  };
  push(sanitizeCliPath(cliPathRaw));
  push('dreamina');
  for (const dir of dirs) push(path.join(dir, exe));
  return out;
}

function resolveExistingCli(cliPathRaw) {
  for (const c of getCliCandidates(cliPathRaw)) {
    if (c === 'dreamina') continue;
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return 'dreamina';
}

function buildEnv(cliPath) {
  const env = { ...process.env };
  const profile = getDreaminaProfileRoot();
  env.HOME = profile;

  if (process.platform === 'win32') {
    const appData = path.join(profile, 'AppData', 'Roaming');
    const localAppData = path.join(profile, 'AppData', 'Local');
    const tempDir = path.join(localAppData, 'Temp');
    mkdirQuiet(appData);
    mkdirQuiet(localAppData);
    mkdirQuiet(tempDir);

    const parsed = path.parse(profile);
    const drive = parsed.root.replace(/[\\/]+$/g, '');
    env.USERPROFILE = profile;
    env.HOMEDRIVE = drive || env.HOMEDRIVE;
    env.HOMEPATH = drive && profile.startsWith(drive) ? profile.slice(drive.length) || '\\' : profile;
    env.APPDATA = appData;
    env.LOCALAPPDATA = localAppData;
    env.TEMP = tempDir;
    env.TMP = tempDir;
  } else {
    env.XDG_CONFIG_HOME = path.join(profile, '.config');
    mkdirQuiet(env.XDG_CONFIG_HOME);
  }

  const home = env.HOME || os.homedir();
  const cliProfile = resolveProfileFromCliPath(cliPath);
  const pathDirs =
    process.platform === 'win32'
      ? [
          path.join(home, 'bin'),
          path.join(home, '.local', 'bin'),
          ...(cliProfile ? [path.join(cliProfile, 'bin'), path.join(cliProfile, '.local', 'bin')] : []),
        ]
      : [path.join(home, '.local', 'bin'), path.join(home, 'bin')];
  const sep = process.platform === 'win32' ? ';' : ':';
  const extra = pathDirs.join(sep);
  env.PATH = env.PATH ? `${extra}${sep}${env.PATH}` : extra;
  return env;
}

function mkdirQuiet(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* CLI execution will surface the real filesystem error. */
  }
}

function getMagineCacheRoot() {
  const fromEnv = String(process.env.MAGINE_CACHE_ROOT || '').trim();
  if (fromEnv) return fromEnv;

  const installRoot = String(process.env.MAGINE_INSTALL_CACHE_ROOT || '').trim();
  if (installRoot) return installRoot;

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || (process.env.USERPROFILE
      ? path.join(process.env.USERPROFILE, 'AppData', 'Roaming')
      : '');
    if (appData) return path.join(appData, 'MagineCanvas', 'magine-cache');
  }

  return path.join(process.cwd(), '.magine-cache');
}

function getDreaminaProfileRoot() {
  const fromEnv = String(process.env.MAGINE_DREAMINA_PROFILE_ROOT || '').trim();
  const root = fromEnv || path.join(getMagineCacheRoot(), 'dreamina-profile');
  mkdirQuiet(root);
  return root;
}

function resolveProfileFromCliPath(cliPath) {
  if (process.platform !== 'win32') return null;
  const normalized = String(cliPath || '').replace(/\//g, '\\');
  const m = normalized.match(/^([A-Za-z]:\\Users\\[^\\]+)\\/i);
  return m ? m[1] : null;
}

function coerceFiniteNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function pickObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function normalizeUserCreditPayload(data) {
  const nested =
    pickObject(data.data) ||
    pickObject(data.user_credit) ||
    pickObject(data.credit) ||
    pickObject(data.result) ||
    data;
  const totalCredit =
    coerceFiniteNumber(nested.total_credit) ??
    coerceFiniteNumber(nested.totalCredit) ??
    coerceFiniteNumber(nested.available_credit) ??
    coerceFiniteNumber(nested.availableCredit) ??
    coerceFiniteNumber(nested.credit_balance) ??
    coerceFiniteNumber(nested.creditBalance) ??
    coerceFiniteNumber(nested.credits) ??
    coerceFiniteNumber(nested.balance);

  return {
    ...nested,
    ...(totalCredit == null ? {} : { total_credit: totalCredit }),
  };
}

function extractJsonObjects(text) {
  const records = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaping) escaping = false;
      else if (ch === '\\') escaping = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (ch !== '}' || depth === 0) continue;
    depth -= 1;
    if (depth !== 0 || start < 0) continue;
    try {
      const record = pickObject(JSON.parse(text.slice(start, i + 1)));
      if (record) records.push(record);
    } catch {
      /* ignore malformed log fragment */
    }
    start = -1;
  }

  return records;
}

function isLoggedInCredit(data) {
  if (!data || typeof data !== 'object') return false;
  if (data.error != null && String(data.error).trim()) return false;
  return coerceFiniteNumber(data.total_credit) != null;
}

function parseUserCredit(stdout, stderr) {
  const combined = `${stdout || ''}\n${stderr || ''}`.trim();
  for (const record of extractJsonObjects(combined)) {
    const data = normalizeUserCreditPayload(record);
    if (isLoggedInCredit(data)) {
      return { ok: true, data, loginName: String(data.user_name || data.username || '') };
    }
  }
  const needsRepair = /版本文件|version\.json|version file/i.test(combined);
  const needsLogin = /未登录|未检测到有效登录|请先登录|not logged in|please log in/i.test(combined);
  return { ok: false, error: combined || '查询失败', needsLogin, needsRepair };
}

function isLoginSuccessOutput(text) {
  return /\[DREAMINA:LOGIN_SUCCESS\]|\[DREAMINA:LOGIN_REUSED\]|已复用.*OAuth|OAuth 登录态/i.test(
    String(text || ''),
  );
}

/** 解析 OAuth Device Flow 输出（JSON 或 key=value 行） */
function parseDeviceFlowOutput(text) {
  const combined = String(text || '');

  const jsonBlocks = combined.match(/\{[\s\S]*?\}/g) || [];
  for (const block of jsonBlocks) {
    try {
      const j = JSON.parse(block);
      if (j.verification_uri || j.device_code) {
        return {
          verificationUri: j.verification_uri ? String(j.verification_uri) : undefined,
          userCode: j.user_code != null ? String(j.user_code) : undefined,
          deviceCode: j.device_code != null ? String(j.device_code) : undefined,
        };
      }
    } catch {
      /* ignore */
    }
  }

  const verificationUri =
    combined.match(/verification_uri[=:\s"]+(https?:\/\/[^\s"']+)/i)?.[1] ||
    combined.match(/https?:\/\/[^\s"'<>]+/i)?.[0];
  const userCode = combined.match(/user_code[=:\s"]+([A-Za-z0-9-]+)/i)?.[1];
  const deviceCode = combined.match(/device_code[=:\s"]+([A-Za-z0-9_-]+)/i)?.[1];

  if (verificationUri || deviceCode) {
    return { verificationUri, userCode, deviceCode };
  }
  return null;
}

function execDreaminaCapture(cliPath, args, timeoutMs, env) {
  return new Promise((resolve) => {
    execFile(cliPath, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, env }, (err, stdout, stderr) => {
      resolve({
        stdout: stdout || '',
        stderr: stderr || '',
        combined: `${stdout || ''}\n${stderr || ''}`.trim(),
        error: err,
      });
    });
  });
}

async function execDreamina(cliPathRaw, args, timeoutMs) {
  let lastError;
  for (const candidate of getCliCandidates(cliPathRaw)) {
    if (candidate !== 'dreamina') {
      try {
        if (!fs.existsSync(candidate)) continue;
      } catch {
        continue;
      }
    }
    const env = buildEnv(candidate);
    try {
      if (candidate.startsWith('wsl ')) {
        const wslCmd = candidate.slice(4).trim();
        const shellArgs = [wslCmd, ...args.map((a) => (a.includes(' ') ? `"${a}"` : a))];
        const r = await execDreaminaCapture('wsl', ['bash', '-c', shellArgs.join(' ')], timeoutMs + 10000, env);
        if (!r.error || r.combined) return { ...r, usedPath: candidate };
        lastError = r.error;
        continue;
      }
      const r = await execDreaminaCapture(candidate, args, timeoutMs, env);
      if (!r.error || r.combined) return { ...r, usedPath: candidate };
      lastError = r.error;
      if (r.error && r.error.code !== 'ENOENT') break;
    } catch (e) {
      lastError = e;
      if (e.code !== 'ENOENT') break;
    }
  }
  throw lastError || new Error('CLI 未找到');
}

async function checkUserCredit(cliPathRaw) {
  try {
    const r = await execDreamina(cliPathRaw, ['user_credit'], 25000);
    const parsed = parseUserCredit(r.stdout, r.stderr);
    if (parsed.ok) {
      return {
        ok: true,
        loggedIn: true,
        loginName: parsed.loginName,
        data: parsed.data,
        usedPath: r.usedPath,
        cliPath: sanitizeCliPath(cliPathRaw),
      };
    }
    return {
      ok: false,
      loggedIn: false,
      error: parsed.error,
      needsLogin: parsed.needsLogin,
      needsRepair: parsed.needsRepair,
      usedPath: r.usedPath,
      cliPath: sanitizeCliPath(cliPathRaw),
    };
  } catch (e) {
    if (e.code === 'ENOENT') {
      return {
        ok: false,
        loggedIn: false,
        error: `CLI 未找到，请先安装（curl -fsSL https://jimeng.jianying.com/cli | bash）`,
        needsLogin: false,
        needsRepair: false,
        cliPath: sanitizeCliPath(cliPathRaw),
      };
    }
    if (e.killed) {
      return { ok: false, loggedIn: false, error: 'user_credit 执行超时', cliPath: sanitizeCliPath(cliPathRaw) };
    }
    const parsed = parseUserCredit(e.stdout || '', e.stderr || e.message || '');
    if (parsed.ok) {
      return {
        ok: true,
        loggedIn: true,
        loginName: parsed.loginName,
        data: parsed.data,
        cliPath: sanitizeCliPath(cliPathRaw),
      };
    }
    return {
      ok: false,
      loggedIn: false,
      error: parsed.error,
      needsLogin: parsed.needsLogin,
      needsRepair: parsed.needsRepair,
      cliPath: sanitizeCliPath(cliPathRaw),
    };
  }
}

/**
 * 官方 OAuth Device Flow 登录
 * @param {string} cliPathRaw
 * @param {{ openUrl?: (url: string) => Promise<void>, onProgress?: (info: object) => void }} hooks
 */
async function runDeviceFlowLogin(cliPathRaw, hooks = {}, options = {}) {
  const forceRelogin = Boolean(options.forceRelogin);
  const credit = forceRelogin ? null : await checkUserCredit(cliPathRaw);
  if (credit?.ok && credit.loggedIn) {
    return {
      ok: true,
      alreadyLoggedIn: true,
      message: 'CLI 已登录',
      loginName: credit.loginName,
      data: credit.data,
      usedPath: credit.usedPath,
    };
  }

  const target = resolveExistingCli(cliPathRaw);
  const env = buildEnv(target);

  hooks.onProgress?.({ phase: 'headless', message: '正在获取 OAuth 设备码...' });

  let headless;
  try {
    headless = await execDreamina(cliPathRaw, [forceRelogin ? 'relogin' : 'login', '--headless'], 45000);
  } catch (e) {
    return { ok: false, error: e.message || `dreamina ${forceRelogin ? 'relogin' : 'login'} --headless 失败` };
  }

  if (isLoginSuccessOutput(headless.combined)) {
    const again = await checkUserCredit(cliPathRaw);
    if (again.ok) {
      return {
        ok: true,
        alreadyLoggedIn: true,
        message: headless.combined.trim() || '已复用本地 OAuth 登录态',
        loginName: again.loginName,
        data: again.data,
        usedPath: again.usedPath,
      };
    }
  }

  const device = parseDeviceFlowOutput(headless.combined);
  if (!device?.deviceCode) {
    return {
      ok: false,
      error:
        headless.combined ||
        '未获取到 device_code。请确认 CLI 已安装并在终端执行: dreamina login --headless',
      raw: headless.combined,
    };
  }

  hooks.onProgress?.({
    phase: 'authorize',
    verificationUri: device.verificationUri,
    userCode: device.userCode,
    deviceCode: device.deviceCode,
    message: device.userCode
      ? `请在浏览器打开授权页，并输入设备码：${device.userCode}`
      : '请在浏览器完成 OAuth 授权',
  });

  if (device.verificationUri && hooks.openUrl) {
    try {
      await hooks.openUrl(device.verificationUri);
    } catch {
      /* 用户可手动打开 */
    }
  }

  hooks.onProgress?.({ phase: 'polling', message: '等待授权完成（checklogin 轮询中）...' });

  let check;
  try {
    check = await execDreamina(
      cliPathRaw,
      ['login', 'checklogin', `--device_code=${device.deviceCode}`, '--poll=30'],
      360000,
    );
  } catch (e) {
    return {
      ok: false,
      error: e.stderr || e.message || 'checklogin 失败',
      verificationUri: device.verificationUri,
      userCode: device.userCode,
    };
  }

  if (!isLoginSuccessOutput(check.combined)) {
    return {
      ok: false,
      error: check.combined || '授权未完成或超时',
      verificationUri: device.verificationUri,
      userCode: device.userCode,
    };
  }

  const final = await checkUserCredit(cliPathRaw);
  if (final.ok) {
    return {
      ok: true,
      alreadyLoggedIn: true,
      message: check.combined.trim() || '登录成功',
      loginName: final.loginName,
      data: final.data,
      usedPath: final.usedPath,
      verificationUri: device.verificationUri,
      userCode: device.userCode,
    };
  }

  return {
    ok: false,
    error: final.error || '授权完成但 user_credit 仍失败',
    verificationUri: device.verificationUri,
    userCode: device.userCode,
  };
}

function openExternalUrl(url) {
  return new Promise((resolve, reject) => {
    const target = String(url || '').trim();
    if (!target) {
      reject(new Error('empty url'));
      return;
    }
    if (process.platform === 'win32') {
      const escaped = target.replace(/'/g, "''");
      execFile(
        'powershell.exe',
        ['-NoProfile', '-Command', `Start-Process '${escaped}'`],
        { windowsHide: true },
        (err) => (err ? reject(err) : resolve()),
      );
      return;
    }
    if (process.platform === 'darwin') {
      execFile('open', [target], (err) => (err ? reject(err) : resolve()));
      return;
    }
    execFile('xdg-open', [target], (err) => (err ? reject(err) : resolve()));
  });
}

function defaultCliPath() {
  const exe = process.platform === 'win32' ? 'dreamina.exe' : 'dreamina';
  const dirs =
    process.platform === 'win32'
      ? [path.join(os.homedir(), 'bin'), path.join(os.homedir(), '.local', 'bin')]
      : [path.join(os.homedir(), '.local', 'bin'), path.join(os.homedir(), 'bin')];
  for (const dir of dirs) {
    const p = path.join(dir, exe);
    if (fs.existsSync(p)) return p;
  }
  return path.join(dirs[0], exe);
}

module.exports = {
  sanitizeCliPath,
  getCliCandidates,
  resolveExistingCli,
  defaultCliPath,
  buildEnv,
  execDreamina,
  checkUserCredit,
  runDeviceFlowLogin,
  parseDeviceFlowOutput,
  isLoginSuccessOutput,
  isLoggedInCredit,
  openExternalUrl,
};
