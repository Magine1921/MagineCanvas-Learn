/**
 * Dreamina CLI 服务端环境：用户目录解析、元数据修复、输出解析。
 * 解决打包/Electron 下 USERPROFILE 与 CLI 路径不一致、version.json 缺失等问题。
 */

import { execFileSync } from 'child_process';
import fs from 'fs';
import https from 'https';
import os from 'os';
import path from 'path';
import { getMagineCacheRoot } from './magine-cache-root.server';

export const DREAMINA_INSTALL_SCRIPT_URL = 'https://jimeng.jianying.com/cli';

export function sanitizeDreaminaCliPath(raw: string): string {
  const trimmed = raw.trim();
  if (/^curl\s.*\|\s*(bash|sh)/i.test(trimmed)) return 'dreamina';
  return trimmed || 'dreamina';
}

/** 从绝对 CLI 路径推断 Windows 用户目录（如 C:\Users\<username>） */
export function resolveProfileFromCliPath(cliPath: string): string | null {
  if (process.platform !== 'win32') return null;
  const normalized = cliPath.replace(/\//g, '\\');
  const m = normalized.match(/^([A-Za-z]:\\Users\\[^\\]+)\\/i);
  return m ? m[1] : null;
}

export function getDreaminaCliHome(profileDir?: string): string {
  return path.join(profileDir || getDreaminaProfileRoot(), '.dreamina_cli');
}

export function getVersionJsonPath(profileDir?: string): string {
  return path.join(getDreaminaCliHome(profileDir), 'version.json');
}

function mkdirQuiet(dir: string): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // CLI execution will surface the real filesystem error.
  }
}

export function getDreaminaProfileRoot(): string {
  const fromEnv = process.env.MAGINE_DREAMINA_PROFILE_ROOT?.trim();
  const root = fromEnv || path.join(getMagineCacheRoot(), 'dreamina-profile');
  mkdirQuiet(root);
  return root;
}

function normalizeProxyUrl(value: string, scheme = 'http'): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `${scheme}://${trimmed}`;
}

function readWindowsSystemProxy(): { http?: string; https?: string; all?: string } {
  if (process.platform !== 'win32') return {};
  try {
    const regExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
    const output = execFileSync(
      regExe,
      ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'],
      { encoding: 'utf8', windowsHide: true, timeout: 3000 },
    );
    if (!/ProxyEnable\s+REG_DWORD\s+0x1\b/i.test(output)) return {};
    const proxyServer = output.match(/^\s*ProxyServer\s+REG_\w+\s+(.+?)\s*$/im)?.[1]?.trim();
    if (!proxyServer) return {};

    if (!proxyServer.includes('=')) {
      const proxy = normalizeProxyUrl(proxyServer);
      return proxy ? { http: proxy, https: proxy } : {};
    }

    const entries = Object.fromEntries(
      proxyServer
        .split(';')
        .map((entry) => entry.trim().split('=', 2))
        .filter((entry): entry is [string, string] => entry.length === 2 && Boolean(entry[0] && entry[1]))
        .map(([key, value]) => [key.toLowerCase(), value.trim()]),
    );
    const socks = entries.socks ? normalizeProxyUrl(entries.socks, 'socks5') : '';
    return {
      http: normalizeProxyUrl(entries.http || entries.https || '') || socks || undefined,
      https: normalizeProxyUrl(entries.https || entries.http || '') || socks || undefined,
      all: socks || undefined,
    };
  } catch {
    return {};
  }
}

function applyWindowsSystemProxy(env: NodeJS.ProcessEnv): void {
  const proxy = readWindowsSystemProxy();
  const apply = (upper: 'HTTP_PROXY' | 'HTTPS_PROXY' | 'ALL_PROXY', value?: string) => {
    const lower = upper.toLowerCase();
    const resolved = env[upper]?.trim() || env[lower]?.trim() || value;
    if (!resolved) return;
    env[upper] = resolved;
    env[lower] = resolved;
  };
  apply('HTTP_PROXY', proxy.http);
  apply('HTTPS_PROXY', proxy.https);
  apply('ALL_PROXY', proxy.all);
}

/** CLI 进程应使用的环境变量（与二进制所属 Windows 用户一致） */
export function buildDreaminaExecEnv(cliPath: string): NodeJS.ProcessEnv {
  const env = { ...process.env } as NodeJS.ProcessEnv;
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
    applyWindowsSystemProxy(env);
  } else {
    env.XDG_CONFIG_HOME = path.join(profile, '.config');
    mkdirQuiet(env.XDG_CONFIG_HOME);
  }

  const home = env.HOME || os.homedir();
  const cliProfile = resolveProfileFromCliPath(cliPath);
  const sep = process.platform === 'win32' ? ';' : ':';
  const pathPrefix =
    process.platform === 'win32'
      ? [
          path.join(home, 'bin'),
          path.join(home, '.local', 'bin'),
          ...(cliProfile ? [path.join(cliProfile, 'bin'), path.join(cliProfile, '.local', 'bin')] : []),
        ].join(sep)
      : [path.join(home, '.local', 'bin'), path.join(home, 'bin')].join(sep);
  env.PATH = env.PATH ? `${pathPrefix}${sep}${env.PATH}` : pathPrefix;
  return env;
}

function httpGetText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 30000 }, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        httpGetText(response.headers.location).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      let data = '';
      response.on('data', (chunk: Buffer) => {
        data += chunk.toString();
      });
      response.on('end', () => resolve(data));
      response.on('error', reject);
    }).on('error', reject);
  });
}

function httpDownload(url: string, destPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const file = fs.createWriteStream(destPath);
    let size = 0;
    https.get(url, { timeout: 120000 }, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        try {
          fs.unlinkSync(destPath);
        } catch {
          /* ignore */
        }
        httpDownload(response.headers.location, destPath).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        file.close();
        try {
          fs.unlinkSync(destPath);
        } catch {
          /* ignore */
        }
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
      });
      file.on('finish', () => {
        file.close();
        if (size < 16) {
          try {
            fs.unlinkSync(destPath);
          } catch {
            /* ignore */
          }
          reject(new Error(`下载文件过小 (${size} bytes)`));
        } else {
          resolve(size);
        }
      });
      file.on('error', reject);
    }).on('error', (e) => {
      file.close();
      try {
        fs.unlinkSync(destPath);
      } catch {
        /* ignore */
      }
      reject(e);
    });
  });
}

function parseDownloadBase(script: string): string | null {
  const m = script.match(/DOWNLOAD_BASE\s*=\s*"([^"]+)"/);
  return m ? m[1] : null;
}

function parseSkillUrl(script: string, base: string): string {
  const m = script.match(/SKILL_URL\s*=\s*"\$\{DOWNLOAD_BASE\}\/([^"]+)"/);
  return m ? `${base}/${m[1]}` : `${base}/SKILL.md`;
}

function parseVersionUrl(script: string): string {
  const m = script.match(/VERSION_URL\s*=\s*"([^"]+)"/);
  return m ? m[1] : '';
}

export type DreaminaMetadataRepairResult = {
  repaired: boolean;
  versionJson?: string;
  skillMd?: string;
  errors: string[];
};

/** 补全 ~/.dreamina_cli/version.json 与 SKILL.md（应用内安装常漏掉） */
export async function ensureDreaminaCliMetadata(cliPath: string): Promise<DreaminaMetadataRepairResult> {
  const profile = getDreaminaProfileRoot();
  const versionPath = getVersionJsonPath(profile);
  const skillPath = path.join(getDreaminaCliHome(profile), 'dreamina', 'SKILL.md');
  const errors: string[] = [];
  let repaired = false;

  if (fs.existsSync(versionPath)) {
    try {
      const stat = fs.statSync(versionPath);
      if (stat.size > 16) {
        return { repaired: false, versionJson: versionPath, skillMd: fs.existsSync(skillPath) ? skillPath : undefined, errors: [] };
      }
    } catch {
      /* re-download */
    }
  }

  let script: string;
  try {
    script = await httpGetText(DREAMINA_INSTALL_SCRIPT_URL);
  } catch (e) {
    errors.push(`无法下载安装脚本: ${e instanceof Error ? e.message : String(e)}`);
    return { repaired: false, errors };
  }

  const baseUrl = parseDownloadBase(script);
  if (!baseUrl) {
    errors.push('无法解析 CLI CDN 地址');
    return { repaired: false, errors };
  }

  const versionUrl = parseVersionUrl(script);
  if (versionUrl) {
    try {
      await httpDownload(versionUrl, versionPath);
      repaired = true;
    } catch (e) {
      errors.push(`version.json: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    errors.push('安装脚本中未找到 VERSION_URL');
  }

  try {
    await httpDownload(parseSkillUrl(script, baseUrl), skillPath);
  } catch (e) {
    errors.push(`SKILL.md: ${e instanceof Error ? e.message : String(e)}`);
  }

  return {
    repaired,
    versionJson: fs.existsSync(versionPath) ? versionPath : undefined,
    skillMd: fs.existsSync(skillPath) ? skillPath : undefined,
    errors,
  };
}

export type UserCreditParseResult =
  | { ok: true; data: Record<string, unknown>; loginName: string }
  | { ok: false; error: string; needsLogin: boolean; needsRepair: boolean };

function coerceFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function pickObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeJsonOutput(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return { tasks: value };
  return pickObject(value);
}

function normalizeUserCreditPayload(data: Record<string, unknown>): Record<string, unknown> {
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

function extractJsonObjects(text: string): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
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

export function parseDreaminaJsonOutput(stdout: string, stderr: string): Record<string, unknown> {
  const out = stdout.trim();
  const err = stderr.trim();
  const combined = `${out}\n${err}`.trim();

  for (const text of [out, err, combined]) {
    if (!text) continue;
    try {
      const record = normalizeJsonOutput(JSON.parse(text));
      if (record) return record;
    } catch {
      /* try extracted JSON blocks below */
    }
  }

  const records = extractJsonObjects(combined);
  const last = records[records.length - 1];
  if (last) return last;

  throw new Error(combined.slice(0, 500) || 'CLI 无 JSON 输出');
}

export function parseUserCreditOutput(stdout: string, stderr: string): UserCreditParseResult {
  const out = stdout.trim();
  const err = stderr.trim();
  const combined = `${out}\n${err}`.trim();

  for (const record of extractJsonObjects(combined)) {
    const data = normalizeUserCreditPayload(record);
    if (isDreaminaLoggedInCredit(data)) {
      return {
        ok: true,
        data,
        loginName: String(data.user_name || data.username || ''),
      };
    }
  }

  const needsRepair = /版本文件|version\.json|version file/i.test(combined);
  const needsLogin = /未登录|未检测到有效登录|请先登录|请.*登录|not logged in|please log in/i.test(combined);

  return {
    ok: false,
    error: combined || '查询失败，请确认 CLI 已安装并登录',
    needsLogin,
    needsRepair,
  };
}

/** 仅以有效 total_credit 判定已登录（user_id:null 等不能算登录） */
export function isDreaminaLoggedInCredit(data: Record<string, unknown>): boolean {
  if (!data || typeof data !== 'object') return false;
  if (data.error != null && String(data.error).trim()) return false;
  return coerceFiniteNumber(data.total_credit) != null;
}
