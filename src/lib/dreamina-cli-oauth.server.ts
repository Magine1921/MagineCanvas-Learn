/**
 * 即梦 CLI 官方 OAuth Device Flow（服务端 / Web API）
 * @see https://jimeng.jianying.com/cli
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { execDreaminaCli } from './dreamina-cli-exec';
import { isDreaminaLoggedInCredit, parseUserCreditOutput } from './dreamina-cli-env.server';

const execFileAsync = promisify(execFile);

export type DeviceFlowInfo = {
  verificationUri?: string;
  userCode?: string;
  deviceCode?: string;
};

export type DeviceFlowProgress = {
  phase?: 'headless' | 'authorize' | 'polling';
  message?: string;
  verificationUri?: string;
  userCode?: string;
  deviceCode?: string;
};

function isLoginSuccessOutput(text: string): boolean {
  return /\[DREAMINA:LOGIN_SUCCESS\]|\[DREAMINA:LOGIN_REUSED\]|已复用.*OAuth|OAuth 登录态/i.test(text);
}

export function parseDeviceFlowOutput(text: string): DeviceFlowInfo | null {
  const combined = String(text || '');

  const jsonBlocks = combined.match(/\{[\s\S]*?\}/g) || [];
  for (const block of jsonBlocks) {
    try {
      const j = JSON.parse(block) as Record<string, unknown>;
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

export async function openDreaminaExternalUrl(url: string): Promise<void> {
  const target = String(url || '').trim();
  if (!target) throw new Error('empty url');

  if (process.platform === 'win32') {
    const escaped = target.replace(/'/g, "''");
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-Command', `Start-Process '${escaped}'`],
      { windowsHide: true },
    );
    return;
  }
  if (process.platform === 'darwin') {
    await execFileAsync('open', [target]);
    return;
  }
  await execFileAsync('xdg-open', [target]);
}

async function checkUserCreditViaCli(cliPath: string) {
  const { stdout, stderr, usedPath } = await execDreaminaCli(cliPath, ['user_credit'], {
    timeout: 25000,
    maxBuffer: 1024 * 1024,
  });
  const parsed = parseUserCreditOutput(stdout, stderr);
  if (parsed.ok) {
    return {
      ok: true as const,
      loggedIn: true,
      loginName: parsed.loginName,
      data: parsed.data,
      usedPath,
    };
  }
  return {
    ok: false as const,
    loggedIn: false,
    error: parsed.error,
    needsLogin: parsed.needsLogin,
    needsRepair: parsed.needsRepair,
  };
}

export async function runDreaminaDeviceFlowLogin(
  cliPath: string,
  hooks: { openUrl?: (url: string) => Promise<void>; onProgress?: (info: DeviceFlowProgress) => void } = {},
  options: { forceRelogin?: boolean } = {},
): Promise<Record<string, unknown>> {
  const forceRelogin = Boolean(options.forceRelogin);
  const credit = forceRelogin ? null : await checkUserCreditViaCli(cliPath);
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

  hooks.onProgress?.({ phase: 'headless', message: '正在获取 OAuth 设备码...' });

  let headless: { stdout: string; stderr: string; combined?: string };
  try {
    const r = await execDreaminaCli(cliPath, [forceRelogin ? 'relogin' : 'login', '--headless'], {
      timeout: 45000,
      maxBuffer: 4 * 1024 * 1024,
    });
    headless = { ...r, combined: `${r.stdout}\n${r.stderr}`.trim() };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, error: err.stderr || err.message || `dreamina ${forceRelogin ? 'relogin' : 'login'} --headless 失败` };
  }

  const combined = headless.combined || '';

  if (isLoginSuccessOutput(combined)) {
    const again = await checkUserCreditViaCli(cliPath);
    if (again.ok) {
      return {
        ok: true,
        alreadyLoggedIn: true,
        message: combined.trim() || '已复用本地 OAuth 登录态',
        loginName: again.loginName,
        data: again.data,
        usedPath: again.usedPath,
      };
    }
  }

  const device = parseDeviceFlowOutput(combined);
  if (!device?.deviceCode) {
    return {
      ok: false,
      error: combined || '未获取到 device_code。请确认 CLI 已安装并在终端执行: dreamina login --headless',
      raw: combined,
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

  let check: { stdout: string; stderr: string };
  try {
    check = await execDreaminaCli(
      cliPath,
      ['login', 'checklogin', `--device_code=${device.deviceCode}`, '--poll=30'],
      { timeout: 360000, maxBuffer: 4 * 1024 * 1024 },
    );
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    return {
      ok: false,
      error: err.stderr || err.message || 'checklogin 失败',
      verificationUri: device.verificationUri,
      userCode: device.userCode,
    };
  }

  const checkCombined = `${check.stdout}\n${check.stderr}`.trim();
  if (!isLoginSuccessOutput(checkCombined)) {
    return {
      ok: false,
      error: checkCombined || '授权未完成或超时',
      verificationUri: device.verificationUri,
      userCode: device.userCode,
    };
  }

  const final = await checkUserCreditViaCli(cliPath);
  if (final.ok && isDreaminaLoggedInCredit(final.data)) {
    return {
      ok: true,
      alreadyLoggedIn: true,
      message: checkCombined.trim() || '登录成功',
      loginName: final.loginName,
      data: final.data,
      usedPath: final.usedPath,
      verificationUri: device.verificationUri,
      userCode: device.userCode,
    };
  }

  return {
    ok: false,
    error: final.ok ? '授权完成但 user_credit 仍失败' : final.error || '授权完成但 user_credit 仍失败',
    verificationUri: device.verificationUri,
    userCode: device.userCode,
  };
}
