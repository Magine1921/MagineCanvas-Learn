/**
 * 共享 helper：Dreamina CLI 命令执行。
 * 自动尝试 ~/bin、~/.local/bin、PATH；OAuth 登录见 dreamina-cli-oauth.server.ts
 */

import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { buildDreaminaExecEnv } from './dreamina-cli-env.server';

const execFileAsync = promisify(execFile);
let dreaminaCliQueue: Promise<void> = Promise.resolve();

/** 从请求 body 提取 cliPath */
export function getCliPath(body: { cliPath?: unknown }): string {
  const cliPath = typeof body.cliPath === 'string' ? body.cliPath.trim() : '';
  return cliPath || 'dreamina';
}

function sanitizeCliPath(raw: string): string {
  const trimmed = raw.trim();
  if (/^curl\s.*\|\s*(bash|sh)/i.test(trimmed)) return 'dreamina';
  return trimmed || 'dreamina';
}

function getCliCandidates(cliPathRaw: string): string[] {
  const home = os.homedir();
  const exe = process.platform === 'win32' ? 'dreamina.exe' : 'dreamina';
  const dirs =
    process.platform === 'win32'
      ? [path.join(home, 'bin'), path.join(home, '.local', 'bin')]
      : [path.join(home, '.local', 'bin'), path.join(home, 'bin')];
  const out: string[] = [];
  const push = (p: string) => {
    if (p && !out.includes(p)) out.push(p);
  };
  push(sanitizeCliPath(cliPathRaw));
  push('dreamina');
  for (const dir of dirs) push(path.join(dir, exe));
  return out;
}

export interface DreaminaCliOpts {
  timeout: number;
  maxBuffer: number;
}

async function execOne(cliPath: string, args: string[], opts: DreaminaCliOpts): Promise<{ stdout: string; stderr: string }> {
  if (cliPath.startsWith('wsl ')) {
    const wslCmd = cliPath.slice(4).trim();
    const shellArgs = [wslCmd, ...args.map((a) => (a.includes(' ') ? `"${a}"` : a))];
    return execFileAsync('wsl', ['bash', '-c', shellArgs.join(' ')], {
      timeout: opts.timeout + 10000,
      maxBuffer: opts.maxBuffer,
    });
  }
  const env = buildDreaminaExecEnv(cliPath);
  return execFileAsync(cliPath, args, { ...opts, env });
}

/**
 * 执行 dreamina CLI 命令（自动尝试 ~/bin、~/.local/bin、PATH）
 */
async function execDreaminaCliUnlocked(
  cliPath: string,
  args: string[],
  opts: DreaminaCliOpts,
): Promise<{ stdout: string; stderr: string; usedPath?: string }> {
  console.log(`[dreamina] ▶ ${cliPath} ${args.join(' ')}`);

  let lastError: unknown;
  for (const candidate of getCliCandidates(cliPath)) {
    if (candidate !== 'dreamina') {
      try {
        if (!fs.existsSync(candidate)) continue;
      } catch {
        continue;
      }
    }
    try {
      const result = await execOne(candidate, args, opts);
      console.log(`[dreamina] ✔ via ${candidate} stdout(${result.stdout.length}B): ${result.stdout.trim().slice(0, 500)}`);
      if (result.stderr) console.log(`[dreamina] ⚠ stderr: ${result.stderr.trim().slice(0, 300)}`);
      return { ...result, usedPath: candidate };
    } catch (e) {
      lastError = e;
      const err = e as { code?: string };
      if (err.code !== 'ENOENT') break;
    }
  }

  console.error(`[dreamina] ✗ ${(lastError as Error)?.message || 'CLI 未找到'}`);
  throw lastError || new Error('CLI 未找到');
}

export async function execDreaminaCli(
  cliPath: string,
  args: string[],
  opts: DreaminaCliOpts,
): Promise<{ stdout: string; stderr: string; usedPath?: string }> {
  const previous = dreaminaCliQueue.catch(() => {});
  let releaseQueue!: () => void;
  dreaminaCliQueue = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });

  await previous;
  try {
    return await execDreaminaCliUnlocked(cliPath, args, opts);
  } finally {
    releaseQueue();
  }
}

export { buildDreaminaExecEnv };
