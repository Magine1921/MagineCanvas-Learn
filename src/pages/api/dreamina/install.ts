// 即梦CLI - 自动安装
// 官方安装: curl -fsSL https://jimeng.jianying.com/cli | bash
// 脚本做的事: 从 CDN 下载 dreamina 二进制 + SKILL.md + version.json
import type { NextApiRequest, NextApiResponse } from 'next';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import https from 'https';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureDreaminaCliMetadata } from '@/lib/dreamina-cli-env.server';
import { preparePagesApiJsonBody } from '@/lib/pages-api-body.server';

const execFileAsync = promisify(execFile);
const INSTALL_SCRIPT_URL = 'https://jimeng.jianying.com/cli';

// ---- download helpers ----

function httpDownload(url: string, destPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(destPath);
    fs.mkdirSync(dir, { recursive: true });
    const file = fs.createWriteStream(destPath);
    let size = 0;
    https.get(url, { timeout: 120000 }, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        try { fs.unlinkSync(destPath); } catch {}
        httpDownload(response.headers.location, destPath).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        file.close();
        try { fs.unlinkSync(destPath); } catch {}
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      response.on('data', (chunk: Buffer) => {
        if (size === 0) {
          const head = chunk.toString('utf-8', 0, Math.min(200, chunk.length)).trimStart();
          if (head.startsWith('#!/') || head.startsWith('<!') || head.startsWith('<html')) {
            file.close();
            response.destroy();
            try { fs.unlinkSync(destPath); } catch {}
            reject(new Error('下载内容不是二进制文件（可能是脚本或网页）'));
            return;
          }
        }
        size += chunk.length;
      });
      response.pipe(file);
      file.on('finish', () => {
        if (size < 1024) {
          try { fs.unlinkSync(destPath); } catch {}
          reject(new Error(`下载文件过小 (${size} bytes)`));
        } else {
          resolve(size);
        }
      });
      file.on('error', reject);
    }).on('error', (e) => {
      file.close();
      try { fs.unlinkSync(destPath); } catch {}
      reject(e);
    });
  });
}

function httpGetText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 30000 }, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      let data = '';
      response.on('data', (chunk: Buffer) => (data += chunk.toString()));
      response.on('end', () => resolve(data));
      response.on('error', reject);
    }).on('error', reject);
  });
}

// ---- script parsing ----

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

// ---- platform mapping ----

interface PlatformInfo {
  downloadFile: string;
  targetName: string;
  installDir: string;
}

function detectPlatform(installDirHint: string): PlatformInfo {
  const platform = process.platform;
  const arch = process.arch;

  const home = os.homedir();
  const envInstallDir = process.env.DREAMINA_INSTALL_DIR || process.env.DREAMINA_CLI_INSTALL_DIR;

  if (platform === 'darwin') {
    const dir = installDirHint || envInstallDir || path.join(home, '.local', 'bin');
    if (arch === 'arm64') {
      return { downloadFile: 'dreamina_cli_darwin_arm64', targetName: 'dreamina', installDir: dir };
    }
    return { downloadFile: 'dreamina_cli_darwin_amd64', targetName: 'dreamina', installDir: dir };
  }

  if (platform === 'linux') {
    const dir = installDirHint || envInstallDir || path.join(home, '.local', 'bin');
    if (arch === 'arm64') {
      return { downloadFile: 'dreamina_cli_linux_arm64', targetName: 'dreamina', installDir: dir };
    }
    return { downloadFile: 'dreamina_cli_linux_amd64', targetName: 'dreamina', installDir: dir };
  }

  // Windows — 官方 install.sh 默认 $HOME/bin
  const dir = installDirHint || envInstallDir || path.join(home, 'bin');
  return { downloadFile: 'dreamina_cli_windows_amd64.exe', targetName: 'dreamina.exe', installDir: dir };
}

// ---- install methods ----

function shellEscape(s: string): string {
  return s.replace(/'/g, "'\\''");
}

function looksLikePath(s: string): boolean {
  return s.includes('/') || s.includes('\\');
}

interface ExecError extends Error {
  stdout?: string;
  stderr?: string;
  code?: number | string | null;
  killed?: boolean;
}

function extractExecOutput(e: unknown): { message: string; stdout: string; stderr: string } {
  const err = e as ExecError;
  return {
    message: err.message || String(e),
    stdout: (typeof err.stdout === 'string' ? err.stdout : '').trim().slice(-1000),
    stderr: (typeof err.stderr === 'string' ? err.stderr : '').trim().slice(-1000),
  };
}

async function tryBashInstall(script: string, installDir: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const env = {
      ...process.env,
      HOME: process.env.HOME || process.env.USERPROFILE || '/root',
    } as NodeJS.ProcessEnv;
    if (looksLikePath(installDir)) env.INSTALL_DIR = installDir;
    const child = spawn('bash', [], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (d: Buffer) => (output += d.toString()));
    child.stderr.on('data', (d: Buffer) => (output += d.toString()));
    child.on('close', (code: number | null) => {
      if (code === 0) resolve(output.trim());
      else reject(Object.assign(new Error(`bash 退出码 ${code}: ${output.trim().slice(-500)}`), { stdout: output, stderr: '' }));
    });
    child.on('error', reject);
    child.stdin.write(script);
    child.stdin.end();
    setTimeout(() => { child.kill(); reject(new Error('安装超时（3分钟）')); }, 180000);
  });
}

async function findGitBash(): Promise<string | null> {
  const candidates = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    path.join(os.homedir(), 'scoop', 'apps', 'git', 'current', 'bin', 'bash.exe'),
    'C:\\msys64\\usr\\bin\\bash.exe',
  ];
  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate, ['--version'], { timeout: 5000 });
      return candidate;
    } catch {}
  }
  return null;
}

async function tryGitBashInstall(gitBashPath: string, script: string, installDir: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const env = {
      ...process.env,
      HOME: process.env.HOME || process.env.USERPROFILE || '/root',
    } as NodeJS.ProcessEnv;
    if (looksLikePath(installDir)) env.INSTALL_DIR = installDir;
    const child = spawn(gitBashPath, [], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (d: Buffer) => (output += d.toString()));
    child.stderr.on('data', (d: Buffer) => (output += d.toString()));
    child.on('close', (code: number | null) => {
      if (code === 0) resolve(output.trim());
      else reject(Object.assign(new Error(`Git Bash 退出码 ${code}: ${output.trim().slice(-500)}`), { stdout: output }));
    });
    child.on('error', reject);
    child.stdin.write(script);
    child.stdin.end();
    setTimeout(() => { child.kill(); reject(new Error('安装超时（3分钟）')); }, 180000);
  });
}

async function tryWslInstall(script: string, installDir: string): Promise<boolean> {
  // Check WSL availability
  try {
    await execFileAsync('wsl', ['--version'], { timeout: 5000 });
  } catch {
    return false;
  }

  // Check if a distro is installed
  try {
    const { stdout } = await execFileAsync('wsl', ['--list', '--quiet'], { timeout: 5000 });
    if (!stdout.trim()) return false;
  } catch {
    return false;
  }

  // Write script to temp file and execute via WSL
  const tmpFile = path.join(os.tmpdir(), `dreamina-install-${Date.now()}.sh`);
  fs.writeFileSync(tmpFile, script, { mode: 0o755 });

  try {
    const wslPath = tmpFile.replace(/\\/g, '/').replace(/^([A-Z]):/, (_, d) => `/mnt/${d.toLowerCase()}`);
    const envPart = looksLikePath(installDir)
      ? `INSTALL_DIR='${shellEscape(installDir)}' `
      : '';
    const cmd = `${envPart}bash '${wslPath}'`;
    await execFileAsync('wsl', ['bash', '-c', cmd], {
      timeout: 300000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return true;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

async function nodeNativeInstall(script: string, installDirHint: string): Promise<{ message: string; binPath: string }> {
  const baseUrl = parseDownloadBase(script);
  if (!baseUrl) {
    throw new Error('无法从安装脚本中解析下载地址');
  }

  const platformInfo = detectPlatform(installDirHint);
  const downloadUrl = `${baseUrl}/${platformInfo.downloadFile}`;
  const binPath = path.join(platformInfo.installDir, platformInfo.targetName);

  // Download binary
  const bytes = await httpDownload(downloadUrl, binPath);

  // On Unix, make executable
  if (process.platform !== 'win32') {
    fs.chmodSync(binPath, 0o755);
  }

  const parts: string[] = [
    `Node.js 直接安装成功 (${(bytes / 1024).toFixed(0)} KB)`,
    `二进制: ${binPath}`,
  ];

  // Also download SKILL.md and version.json（失败则整体安装失败，避免 CLI 报版本文件缺失）
  const meta = await ensureDreaminaCliMetadata(binPath);
  if (meta.versionJson) {
    parts.push(`version.json: ${meta.versionJson}`);
  } else {
    throw new Error(meta.errors[0] || 'version.json 下载失败');
  }
  if (meta.skillMd) {
    parts.push(`SKILL.md: ${meta.skillMd}`);
  }

  if (process.platform === 'win32') {
    try {
      await ensureWindowsUserPath(platformInfo.installDir);
      parts.push(`已加入用户 PATH: ${platformInfo.installDir}`);
    } catch {
      parts.push(`请手动将 ${platformInfo.installDir} 加入 PATH`);
    }
  }

  return { message: parts.join('\n'), binPath };
}

async function ensureWindowsUserPath(installDir: string): Promise<void> {
  const escaped = installDir.replace(/'/g, "''");
  await execFileAsync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `$target='${escaped}'; $current=[Environment]::GetEnvironmentVariable('Path','User'); if ([string]::IsNullOrWhiteSpace($current)) { [Environment]::SetEnvironmentVariable('Path', $target, 'User') } elseif (-not ($current.Split(';') -contains $target)) { [Environment]::SetEnvironmentVariable('Path', $current + ';' + $target, 'User') }`,
    ],
    { timeout: 15000 },
  );
}

// ---- post-install verification ----

async function verifyBinaryAtPath(cliPath: string): Promise<{ found: boolean; actualPath?: string }> {
  try {
    await execFileAsync(cliPath, ['--version'], { timeout: 10000 });
    return { found: true, actualPath: cliPath };
  } catch (e) {
    const err = e as ExecError;
    if (err.code === 'ENOENT') {
      // Try PATH lookup for the specific binary name
      try {
        const { stdout } = await execFileAsync(
          process.platform === 'win32' ? 'where' : 'which',
          [cliPath.replace(/\.exe$/, '')],
          { timeout: 5000 },
        );
        const found = stdout.trim().split('\n')[0]?.trim();
        if (found && found.length > 0) {
          return { found: true, actualPath: found };
        }
      } catch {
        /* not in PATH */
      }
      // Final fallback: try 'dreamina' as pure command (PATH lookup by OS)
      if (cliPath !== 'dreamina') {
        try {
          await execFileAsync('dreamina', ['--version'], { timeout: 10000 });
          return { found: true, actualPath: 'dreamina' };
        } catch {
          /* not found anywhere */
        }
      }
      return { found: false };
    }
    // Non-ENOENT error — file exists but can't run (permission, arch mismatch, etc.)
    return { found: true, actualPath: cliPath };
  }
}

// ---- path helpers ----

function computeInstallPath(installDir: string): string {
  const platform = detectPlatform(installDir);
  return path.join(platform.installDir, platform.targetName);
}

// ---- main handler ----

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  if (!(await preparePagesApiJsonBody(req, res))) return;

  const body = req.body as { cliPath?: string };
  const rawPath = (typeof body.cliPath === 'string' && body.cliPath.trim()) || '';

  // Detect if user pasted a curl install command — treat as default install
  const isInstallCmd = /^curl\s.*\|\s*(bash|sh)/i.test(rawPath.trim());
  const cleanPath = isInstallCmd ? '' : rawPath;

  if (cleanPath && /[\s|&;<>$`!(){}[\]*?#~]/.test(cleanPath)) {
    return res.status(400).json({
      ok: false,
      error: `CLI 路径包含非法字符: "${cleanPath}"。请填写 dreamina 二进制路径（如 /usr/local/bin/dreamina），或留空使用默认安装。`,
      manualCmd: `curl -fsSL ${INSTALL_SCRIPT_URL} | bash`,
    });
  }

  const installDir = looksLikePath(cleanPath) ? cleanPath.replace(/\/+$/, '').replace(/\/dreamina(\.exe)?$/, '') : '';

  // Step 1: Download the install script to parse CDN URLs
  let script: string;
  try {
    script = await httpGetText(INSTALL_SCRIPT_URL);
    if (!script || script.length < 50) {
      return res.status(500).json({
        ok: false,
        error: '下载的安装脚本内容为空，请检查网络连接',
        manualCmd: `curl -fsSL ${INSTALL_SCRIPT_URL} | bash`,
      });
    }
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: `无法下载安装脚本: ${e instanceof Error ? e.message : '网络错误'}`,
      manualCmd: `curl -fsSL ${INSTALL_SCRIPT_URL} | bash`,
    });
  }

  const defaultInstallPath = computeInstallPath(installDir);
  const isWindows = process.platform === 'win32';
  const errors: string[] = [];

  // ---- Method 1 (Windows): Node.js native download first — gives exact binPath ----
  if (isWindows) {
    try {
      const result = await nodeNativeInstall(script, installDir);
      return res.json({
        ok: true,
        installPath: result.binPath,
        message: '通过 Node.js 直接下载安装成功',
        detail: result.message.slice(0, 2000),
      });
    } catch (e) {
      errors.push(`Node.js: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ---- Method 2: Direct bash (or Method 1 on Linux/macOS) ----
  try {
    const output = await tryBashInstall(script, installDir);
    // Post-install: verify binary exists at the computed path
    const verify = await verifyBinaryAtPath(defaultInstallPath);
    const verifiedNote = verify.found
      ? ''
      : '\n⚠ 二进制未在预期路径找到，已回退至 PATH 查找。请确认终端可执行 dreamina。';
    return res.json({
      ok: true,
      installPath: verify.actualPath || 'dreamina',
      message: `通过 bash 安装成功${verifiedNote ? ' (路径待验证)' : ''}`,
      detail: (output.slice(0, 2000) + verifiedNote).trim(),
    });
  } catch (e) {
    errors.push(`bash: ${extractExecOutput(e).message}`);
  }

  // ---- Method 3: Git Bash (Windows) ----
  const gitBashPath = await findGitBash();
  if (gitBashPath) {
    try {
      const output = await tryGitBashInstall(gitBashPath, script, installDir);
      const verify = await verifyBinaryAtPath(defaultInstallPath);
      const verifiedNote = verify.found
        ? ''
        : '\n⚠ 二进制未在预期路径找到，请确认 Git Bash 终端可执行 dreamina。';
      return res.json({
        ok: true,
        installPath: verify.actualPath || 'dreamina',
        message: `通过 Git Bash (${gitBashPath}) 安装成功`,
        detail: (output.slice(0, 2000) + verifiedNote).trim(),
      });
    } catch (e) {
      errors.push(`Git Bash: ${extractExecOutput(e).message}`);
    }
  }

  // ---- Method 4: WSL ----
  try {
    const wslOk = await tryWslInstall(script, installDir);
    if (wslOk) {
      // WSL binary lives in Linux filesystem — must be invoked via 'wsl'
      return res.json({
        ok: true,
        installPath: 'wsl dreamina',
        message: '通过 WSL 安装成功',
        detail: '二进制已安装至 WSL 内的 ~/.local/bin/dreamina。后续调用将使用 wsl dreamina。',
      });
    }
  } catch (e) {
    errors.push(`WSL: ${extractExecOutput(e).message}`);
  }

  // ---- Method 5 (Linux/macOS): Node.js native as fallback ----
  if (!isWindows) {
    try {
      const result = await nodeNativeInstall(script, installDir);
      return res.json({
        ok: true,
        installPath: result.binPath,
        message: '通过 Node.js 直接下载安装成功',
        detail: result.message.slice(0, 2000),
      });
    } catch (e) {
      errors.push(`Node.js: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ---- All methods failed — build diagnostic ----
  let errorMsg = '所有安装方式均失败。';
  const fixSteps: string[] = [];

  let wslInstalled = false;
  let wslHasDistro = false;
  try {
    await execFileAsync('wsl', ['--version'], { timeout: 5000 });
    wslInstalled = true;
    try {
      const { stdout } = await execFileAsync('wsl', ['--list', '--quiet'], { timeout: 5000 });
      wslHasDistro = stdout.trim().length > 0;
    } catch {}
  } catch {}

  if (wslInstalled && !wslHasDistro) {
    fixSteps.push('WSL 已启用但未安装 Linux 发行版。请在 PowerShell（管理员）执行: wsl --install -d Ubuntu');
  }
  if (!gitBashPath && !wslHasDistro) {
    fixSteps.push('安装 Git for Windows（自带 Git Bash）: https://git-scm.com/download/win');
  }

  return res.status(500).json({
    ok: false,
    error: `${errorMsg}\n${fixSteps.join('\n')}`,
    detail: errors.join('\n'),
    manualCmd: `curl -fsSL ${INSTALL_SCRIPT_URL} | bash`,
  });
}

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
  },
};
