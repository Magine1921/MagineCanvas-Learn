import type { NextApiResponse } from 'next';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ensureDreaminaCliMetadata, parseDreaminaJsonOutput, sanitizeDreaminaCliPath } from '@/lib/dreamina-cli-env.server';
import { getCliPath } from '@/lib/dreamina-cli-exec';
import { extractImagesFromResult, extractTaskId, extractVideoUrl } from '@/lib/dreamina-cli-result';
import { getMagineCacheRoot } from '@/lib/magine-cache-root.server';
import { isMaterialDiskRef, materialDiskRefToNodeId } from '@/lib/material-disk-playable-url';
import { fetchSafeOutboundUrl } from '@/lib/server-outbound-request';
import { readMaterialFromDiskCache } from '@/lib/project-material-disk-cache.server';

export async function prepareDreaminaCliRoute(body: { cliPath?: unknown }): Promise<{
  cliPath: string;
  repairNote: string;
}> {
  const cliPath = sanitizeDreaminaCliPath(getCliPath(body));
  let repairNote = '';
  try {
    const repair = await ensureDreaminaCliMetadata(cliPath);
    if (repair.repaired) repairNote = '已自动补全 CLI 版本文件';
    else if (repair.errors.length > 0 && !repair.versionJson) {
      repairNote = `版本文件补全失败: ${repair.errors[0]}`;
    }
  } catch (e) {
    repairNote = `元数据修复异常: ${e instanceof Error ? e.message : String(e)}`;
  }
  return { cliPath, repairNote };
}

export type DreaminaCliResponseExpectation = 'any' | 'image-generation' | 'video-generation';

type DreaminaCliBusinessError = Error & {
  stdout?: string;
  stderr?: string;
  dreaminaCliBusinessData?: Record<string, unknown>;
  statusCode?: number;
};

export type DreaminaCliTraceContext = {
  route?: string;
  cliPath?: string;
  cmd?: string;
  args?: string[];
  body?: Record<string, unknown>;
  stdout?: string;
  stderr?: string;
  data?: unknown;
  error?: unknown;
  elapsedMs?: number;
  note?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function collectDreaminaPayloads(data: Record<string, unknown>): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  const seen = new Set<Record<string, unknown>>();
  const add = (record: Record<string, unknown> | null) => {
    if (!record || seen.has(record)) return;
    seen.add(record);
    records.push(record);
  };

  add(data);
  for (const key of ['data', 'result', 'result_json', 'response']) {
    add(asRecord(data[key]));
  }
  return records;
}

function fieldAsString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function isNonZeroNumericLike(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0 && value !== 200;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed !== 0 && parsed !== 200;
  }
  return false;
}

function makeDreaminaBusinessError(
  message: string,
  data: Record<string, unknown>,
  stdout: string,
  stderr: string,
): DreaminaCliBusinessError {
  const error = new Error(message) as DreaminaCliBusinessError;
  error.stdout = stdout;
  error.stderr = stderr;
  error.dreaminaCliBusinessData = data;
  error.statusCode = 502;
  return error;
}

function buildDreaminaBusinessErrorMessage(data: Record<string, unknown>): string | null {
  for (const record of collectDreaminaPayloads(data)) {
    const ret = record.ret;
    const errorCode = record.error_code ?? record.err_code ?? record.status_code;
    const code = record.code;
    const status = fieldAsString(record, ['gen_status', 'status']).toLowerCase();
    const message = fieldAsString(record, ['message', 'msg', 'error_msg', 'err_msg', 'fail_reason', 'error']);
    const logid = fieldAsString(record, ['logid', 'log_id', 'request_id', 'trace_id']);

    if (isNonZeroNumericLike(ret)) {
      return [
        `api error: ret=${String(ret).trim()}`,
        message ? `message=${message}` : '',
        logid ? `logid=${logid}` : '',
      ].filter(Boolean).join(', ');
    }

    if (isNonZeroNumericLike(errorCode)) {
      return [
        `api error: error_code=${String(errorCode).trim()}`,
        message ? `message=${message}` : '',
        logid ? `logid=${logid}` : '',
      ].filter(Boolean).join(', ');
    }

    if (
      code != null &&
      isNonZeroNumericLike(code) &&
      message &&
      !extractTaskId(record) &&
      !extractVideoUrl(record) &&
      extractImagesFromResult(record).length === 0
    ) {
      return [
        `api error: code=${String(code).trim()}`,
        `message=${message}`,
        logid ? `logid=${logid}` : '',
      ].filter(Boolean).join(', ');
    }

    if (record.ok === false || record.success === false) {
      return message || 'Dreamina API returned ok=false';
    }

    if (['fail', 'failed', 'error', 'cancelled', 'canceled'].includes(status)) {
      return message || `Dreamina task status=${status}`;
    }

    if (
      message &&
      (record.error != null || record.fail_reason != null) &&
      !extractTaskId(record) &&
      !extractVideoUrl(record) &&
      extractImagesFromResult(record).length === 0
    ) {
      return message;
    }
  }
  return null;
}

function hasExpectedDreaminaGenerationResult(
  data: Record<string, unknown>,
  expectation: DreaminaCliResponseExpectation,
): boolean {
  if (expectation === 'any') return true;

  for (const record of collectDreaminaPayloads(data)) {
    if (extractTaskId(record)) return true;
    if (expectation === 'image-generation' && extractImagesFromResult(record).length > 0) return true;
    if (expectation === 'video-generation' && extractVideoUrl(record)) return true;
  }
  return false;
}

function assertDreaminaCliResponseOk(
  data: Record<string, unknown>,
  stdout: string,
  stderr: string,
  expectation: DreaminaCliResponseExpectation,
): void {
  const businessError = buildDreaminaBusinessErrorMessage(data);
  if (businessError) {
    throw makeDreaminaBusinessError(businessError, data, stdout, stderr);
  }

  if (!hasExpectedDreaminaGenerationResult(data, expectation)) {
    const keys = collectDreaminaPayloads(data)
      .map((record) => Object.keys(record).join(','))
      .filter(Boolean)
      .join(' | ');
    throw makeDreaminaBusinessError(
      `Dreamina CLI returned no ${expectation === 'image-generation' ? 'image' : 'video'} result or submit_id. keys=${keys || 'none'}`,
      data,
      stdout,
      stderr,
    );
  }
}

export function parseDreaminaCliStdout(
  stdout: string,
  stderr: string,
  options: { expectation?: DreaminaCliResponseExpectation } = {},
): Record<string, unknown> {
  try {
    const data = parseDreaminaJsonOutput(stdout, stderr);
    assertDreaminaCliResponseOk(data, stdout, stderr, options.expectation || 'any');
    return data;
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    Object.assign(err, { stdout, stderr });
    throw err;
  }
}

export type DreaminaCliErrorReportContext = {
  route?: string;
  cliPath?: string;
  args?: string[];
  body?: Record<string, unknown>;
  note?: string;
};

function clipText(value: unknown, max = 12000): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}\n...[truncated ${text.length - max} chars]` : text;
}

function redactDreaminaReportValue(value: unknown): unknown {
  if (typeof value === 'string') {
    if (/^data:(image|video|audio)\//i.test(value)) {
      const meta = value.slice(0, Math.min(80, value.indexOf(',') > 0 ? value.indexOf(',') : 80));
      return `${meta},...[data-url ${value.length} chars]`;
    }
    if (value.length > 1600) return `${value.slice(0, 1600)}...[truncated ${value.length - 1600} chars]`;
    return value;
  }
  if (Array.isArray(value)) return value.map(redactDreaminaReportValue);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = /key|token|secret|authorization/i.test(key)
        ? '[redacted]'
        : redactDreaminaReportValue(child);
    }
    return out;
  }
  return value;
}

async function dreaminaReportDir(): Promise<string> {
  const desktop = process.env.MAGINE_DESKTOP_DIR?.trim() || path.join(os.homedir(), 'Desktop');
  try {
    await fs.mkdir(desktop, { recursive: true });
    return desktop;
  } catch {
    const fallback = path.join(getMagineCacheRoot(), 'dreamina-reports');
    await fs.mkdir(fallback, { recursive: true });
    return fallback;
  }
}

function dreaminaTraceDate(): string {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

const DREAMINA_TRACE_ENABLED = false;

export async function appendDreaminaCliTrace(
  event: string,
  context: DreaminaCliTraceContext = {},
): Promise<string> {
  if (!DREAMINA_TRACE_ENABLED) return '';
  const dir = await dreaminaReportDir();
  const tracePath = path.join(dir, `MagineCanvas-dreamina-trace-${dreaminaTraceDate()}.txt`);
  const proc = process as NodeJS.Process & { resourcesPath?: string };
  const err = context.error as { message?: string; stack?: string; code?: string } | undefined;
  const entry = [
    '',
    '============================================================',
    `[${new Date().toISOString()}] ${event}`,
    `Route: ${context.route || ''}`,
    `ElapsedMs: ${context.elapsedMs ?? ''}`,
    `Command: ${context.cmd || ''}`,
    `CLI Path: ${context.cliPath || ''}`,
    `Args: ${JSON.stringify(context.args || [])}`,
    `Note: ${context.note || ''}`,
    '',
    '--- Body (redacted) ---',
    clipText(redactDreaminaReportValue(context.body || {}), 6000),
    '',
    '--- Data (redacted) ---',
    clipText(redactDreaminaReportValue(context.data || {}), 10000),
    '',
    '--- Error ---',
    clipText(context.error ? {
      message: err?.message || String(context.error),
      code: err?.code,
      stack: err?.stack,
    } : '', 6000),
    '',
    '--- stdout ---',
    clipText(context.stdout || '', 8000),
    '',
    '--- stderr ---',
    clipText(context.stderr || '', 8000),
    '',
    '--- Runtime ---',
    JSON.stringify({
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      cwd: process.cwd(),
      execPath: process.execPath,
      resourcesPath: proc.resourcesPath || '',
      home: os.homedir(),
      cacheRoot: getMagineCacheRoot(),
    }, null, 2),
    '',
  ].join('\n');
  await fs.appendFile(tracePath, entry, 'utf8');
  return tracePath;
}

function dataUrlExt(mime: string): string {
  const lower = mime.toLowerCase();
  if (lower.includes('png')) return 'png';
  if (lower.includes('webp')) return 'webp';
  if (lower.includes('jpeg') || lower.includes('jpg')) return 'jpg';
  if (lower.includes('mp4')) return 'mp4';
  if (lower.includes('quicktime')) return 'mov';
  if (lower.includes('mpeg')) return 'mp3';
  if (lower.includes('wav')) return 'wav';
  return 'bin';
}

function parseMediaDataUrl(dataUrl: string, kind: 'image' | 'video' | 'audio'): { ext: string; buffer: Buffer } | null {
  const trimmed = dataUrl.trim();
  if (!trimmed.startsWith('data:')) return null;
  const commaIndex = trimmed.indexOf(',');
  if (commaIndex <= 5) return null;

  const metadata = trimmed.slice(5, commaIndex).split(';');
  const mime = (metadata.shift() || '').toLowerCase();
  const allowed = kind === 'image'
    ? new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp'])
    : kind === 'video'
      ? new Set(['video/mp4', 'video/quicktime'])
      : new Set(['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/mp4', 'audio/x-m4a']);
  if (!allowed.has(mime) || !metadata.some((value) => value.toLowerCase() === 'base64')) {
    return null;
  }

  const payload = trimmed.slice(commaIndex + 1);
  if (!payload) return null;
  try {
    return { ext: dataUrlExt(mime), buffer: Buffer.from(payload, 'base64') };
  } catch {
    return null;
  }
}

function materialNodeIdFromProjectCacheUrl(input: string): string | null {
  if (!input.includes('/api/project-cache/material')) return null;
  try {
    const parsed = new URL(input, 'http://magine.local');
    if (parsed.pathname !== '/api/project-cache/material') return null;
    return parsed.searchParams.get('nodeId')?.trim() || null;
  } catch {
    return null;
  }
}

const REMOTE_MEDIA_LIMIT_BYTES = {
  image: 64 * 1024 * 1024,
  video: 256 * 1024 * 1024,
  audio: 128 * 1024 * 1024,
} as const;

const REMOTE_MEDIA_LABEL = {
  image: '参考图',
  video: '参考视频',
  audio: '参考音频',
} as const;

function normalizeMediaExt(ext: string): string {
  const lower = ext.toLowerCase().replace(/^\./, '');
  return lower === 'jpeg' ? 'jpg' : lower;
}

function remoteMediaExt(input: string, contentType: string, kind: 'image' | 'video' | 'audio'): string {
  const allowed = kind === 'image'
    ? new Set(['jpg', 'png', 'webp'])
    : kind === 'video'
      ? new Set(['mp4', 'mov'])
      : new Set(['mp3', 'wav', 'm4a', 'mp4']);
  const mimeExt = normalizeMediaExt(dataUrlExt(contentType));
  if (allowed.has(mimeExt)) return mimeExt;

  try {
    const urlExt = normalizeMediaExt(path.extname(new URL(input).pathname));
    if (allowed.has(urlExt)) return urlExt;
  } catch {
    // The caller reports invalid or unsupported remote inputs uniformly below.
  }
  throw new Error(`即梦 CLI ${REMOTE_MEDIA_LABEL[kind]}格式无法识别`);
}

async function downloadRemoteMediaInput(
  input: string,
  kind: 'image' | 'video' | 'audio',
): Promise<{ buffer: Buffer; ext: string }> {
  const sourceHost = new URL(input).host;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  let response: Response;
  try {
    response = await fetchSafeOutboundUrl(input, {
      signal: controller.signal,
      headers: { 'User-Agent': 'MagineCanvas/0.2 DreaminaMediaLoader' },
    }, { allowedProtocols: ['http:', 'https:'] });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError';
    const temporarySource = /(^|\.)tempfile\./i.test(sourceHost);
    throw new Error(
      temporarySource
        ? `即梦 CLI ${REMOTE_MEDIA_LABEL[kind]}的云端临时链接已失效（${sourceHost}），请重新生成或重新上传该素材`
        : `即梦 CLI ${REMOTE_MEDIA_LABEL[kind]}下载${timedOut ? '超时' : '失败'}（${sourceHost}）`,
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const temporarySource = /(^|\.)tempfile\./i.test(sourceHost);
    throw new Error(
      temporarySource
        ? `即梦 CLI ${REMOTE_MEDIA_LABEL[kind]}的云端临时链接已失效（${sourceHost}，HTTP ${response.status}），请重新生成或重新上传该素材`
        : `即梦 CLI ${REMOTE_MEDIA_LABEL[kind]}下载失败（${sourceHost}，HTTP ${response.status}）`,
    );
  }

  const maxBytes = REMOTE_MEDIA_LIMIT_BYTES[kind];
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`即梦 CLI ${REMOTE_MEDIA_LABEL[kind]}超过大小限制（${sourceHost}）`);
  }

  const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const isGenericBinary = !contentType || contentType === 'application/octet-stream';
  const typeMatches = contentType.startsWith(`${kind}/`)
    || (kind === 'audio' && contentType === 'video/mp4');
  if (!isGenericBinary && !typeMatches) {
    throw new Error(`即梦 CLI ${REMOTE_MEDIA_LABEL[kind]}返回了不支持的类型 ${contentType}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) {
    throw new Error(`即梦 CLI ${REMOTE_MEDIA_LABEL[kind]}下载结果为空（${sourceHost}）`);
  }
  if (buffer.length > maxBytes) {
    throw new Error(`即梦 CLI ${REMOTE_MEDIA_LABEL[kind]}超过大小限制（${sourceHost}）`);
  }
  return { buffer, ext: remoteMediaExt(input, contentType, kind) };
}

export async function materializeDreaminaMediaInputs(
  inputs: string[],
  kind: 'image' | 'video' | 'audio' = 'image',
): Promise<{ values: string[]; tempFiles: string[] }> {
  const values: string[] = [];
  const tempFiles: string[] = [];
  let tempDir = '';

  const ensureTempDir = async () => {
    if (!tempDir) {
      tempDir = path.join(getMagineCacheRoot(), 'dreamina-inputs');
      await fs.mkdir(tempDir, { recursive: true });
    }
    return tempDir;
  };

  const writeTempInput = async (buffer: Buffer, ext: string) => {
    const dir = await ensureTempDir();
    const name = `${kind}-${Date.now()}-${crypto.randomUUID()}.${ext}`;
    const filePath = path.join(dir, name);
    await fs.writeFile(filePath, buffer);
    tempFiles.push(filePath);
    return filePath;
  };

  try {
    for (const input of inputs) {
      const trimmed = input.trim();
      if (kind === 'image') {
        const materialNodeId = isMaterialDiskRef(trimmed)
          ? materialDiskRefToNodeId(trimmed)
          : materialNodeIdFromProjectCacheUrl(trimmed);
        if (materialNodeId) {
          const cached = await readMaterialFromDiskCache(materialNodeId);
          if (cached) {
            values.push(await writeTempInput(cached.buffer, dataUrlExt(cached.mime)));
            continue;
          }
        }
      }

      const parsed = parseMediaDataUrl(trimmed, kind);
      if (parsed) {
        values.push(await writeTempInput(parsed.buffer, parsed.ext));
        continue;
      }

      if (/^https?:\/\//i.test(trimmed)) {
        const remote = await downloadRemoteMediaInput(trimmed, kind);
        values.push(await writeTempInput(remote.buffer, remote.ext));
        continue;
      }

      values.push(trimmed);
    }
  } catch (error) {
    await Promise.all(tempFiles.map((file) => fs.unlink(file).catch(() => {})));
    throw error;
  }

  return { values, tempFiles };
}

export function materializeDreaminaImageInputs(inputs: string[]) {
  return materializeDreaminaMediaInputs(inputs, 'image');
}

export async function cleanupDreaminaTempFiles(files: string[]): Promise<void> {
  await Promise.all(
    files.map((file) =>
      fs.unlink(file).catch(() => {
        // Best-effort cleanup. Failed temp deletion should not hide generation results.
      }),
    ),
  );
}

export async function respondDreaminaCliExecError(
  res: NextApiResponse,
  e: unknown,
  cmd: string,
  context: DreaminaCliErrorReportContext = {},
): Promise<void> {
  const err = e as {
    code?: string;
    stderr?: string;
    stdout?: string;
    killed?: boolean;
    message?: string;
    dreaminaCliBusinessData?: Record<string, unknown>;
    statusCode?: number;
  };
  try {
    await appendDreaminaCliTrace('server-error', {
      route: context.route,
      cliPath: context.cliPath,
      cmd,
      args: context.args,
      body: context.body,
      stdout: err.stdout,
      stderr: err.stderr,
      data: err.dreaminaCliBusinessData,
      error: e,
      note: context.note,
    });
  } catch (traceError) {
    console.error('[dreamina] trace write failed:', traceError);
  }

  if (err.code === 'ENOENT') {
    res.status(500).json({ ok: false, error: `CLI 未找到: ${cmd.split(' ')[0]}` });
    return;
  }
  if (err.killed) {
    res.status(504).json({ ok: false, error: '命令执行超时' });
    return;
  }

  if (err.dreaminaCliBusinessData) {
    res.status(err.statusCode || 502).json({
      ok: false,
      error: err.message || 'Dreamina CLI business error',
      data: err.dreaminaCliBusinessData,
      detail: {
        cmd,
        stderr: (err.stderr || '').slice(0, 500),
        stdout: (err.stdout || '').slice(0, 500),
      },
    });
    return;
  }

  const out = (err.stdout?.trim() || err.stderr?.trim() || err.message || '').slice(0, 2000);
  try {
    const data = parseDreaminaJsonOutput(err.stdout || '', err.stderr || err.message || '');
    res.json({ ok: true, data });
    return;
  } catch {
    res.status(500).json({
      ok: false,
      error: out || `生成失败（CLI 无输出，exit code: ${err.code || '?'}）`,
      detail: {
        cmd,
        exitCode: err.code,
        stderr: (err.stderr || '').slice(0, 500),
        stdout: (err.stdout || '').slice(0, 500),
      },
    });
  }
}
