import { createWriteStream, existsSync, statSync } from 'node:fs';
import { copyFile, link, mkdir, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fetchSafeOutboundUrl } from '@/lib/server-outbound-request';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getMagineCacheRoot } from '@/lib/magine-cache-root.server';

const execFileAsync = promisify(execFile);

const MODEL_DIR_NAME = 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17';
const MODEL_ARCHIVE = `${MODEL_DIR_NAME}.tar.bz2`;
const MODEL_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${MODEL_ARCHIVE}`;
const BUNDLED_MODEL_ROOT_NAME = 'local-stt-models';
const MIN_MODEL_BYTES = 100 * 1024 * 1024;
const MIN_TOKENS_BYTES = 100 * 1024;

type WaveObject = {
  samples: Float32Array;
  sampleRate: number;
};

type OfflineStream = {
  acceptWaveform(input: { sampleRate: number; samples: Float32Array }): void;
};

type OfflineRecognizer = {
  createStream(): OfflineStream;
  decodeAsync(stream: OfflineStream): Promise<{ text?: string }>;
};

type OfflineRecognizerCtor = {
  createAsync(config: unknown): Promise<OfflineRecognizer>;
};

type SherpaOnnxNode = {
  OfflineRecognizer: OfflineRecognizerCtor;
  readWave(filename: string): WaveObject;
};

let modelReadyPromise: Promise<{ modelPath: string; tokensPath: string }> | null = null;
let recognizerPromise: Promise<OfflineRecognizer> | null = null;
let sherpaModule: SherpaOnnxNode | null = null;
let lastRecognizerError: string | null = null;

function getCacheRoot(): string {
  return getMagineCacheRoot();
}

function getModelPaths() {
  const root = path.join(getCacheRoot(), 'local-stt');
  const modelDir = path.join(root, MODEL_DIR_NAME);
  return {
    root,
    modelDir,
    archivePath: path.join(root, MODEL_ARCHIVE),
    modelPath: path.join(modelDir, 'model.int8.onnx'),
    tokensPath: path.join(modelDir, 'tokens.txt'),
  };
}

function getModelPathsForDir(modelDir: string) {
  return {
    modelDir,
    modelPath: path.join(modelDir, 'model.int8.onnx'),
    tokensPath: path.join(modelDir, 'tokens.txt'),
  };
}

function hasNonAsciiPath(filePath: string): boolean {
  return /[^\x20-\x7e]/.test(filePath);
}

function getAsciiRuntimeModelDirs(sourceModelDir: string): string[] {
  const sourceVolumeRoot = path.parse(sourceModelDir).root;
  const systemDrive = process.env.SystemDrive || 'C:';
  const programData = process.env.ProgramData || path.join(systemDrive, 'ProgramData');
  const candidates = [
    path.join(sourceVolumeRoot, 'MagineCanvasRuntime', 'local-stt', MODEL_DIR_NAME),
    path.join(programData, 'MagineCanvas', 'runtime', 'local-stt', MODEL_DIR_NAME),
  ];

  return Array.from(new Set(candidates))
    .filter((candidate) => !hasNonAsciiPath(candidate));
}

function matchingFileSize(sourcePath: string, targetPath: string): boolean {
  try {
    const source = statSync(sourcePath);
    const target = statSync(targetPath);
    return source.isFile() && target.isFile() && source.size === target.size;
  } catch {
    return false;
  }
}

async function materializeAsciiRuntimeFile(
  sourcePath: string,
  targetPath: string,
  force: boolean
) {
  if (!force && matchingFileSize(sourcePath, targetPath)) return;

  await mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  await rm(tempPath, { force: true });

  try {
    await link(sourcePath, tempPath);
  } catch {
    await copyFile(sourcePath, tempPath);
  }

  if (!matchingFileSize(sourcePath, tempPath)) {
    await rm(tempPath, { force: true });
    throw new Error(`STT runtime mirror validation failed: ${targetPath}`);
  }

  try {
    await rename(tempPath, targetPath);
  } catch {
    if (!force && matchingFileSize(sourcePath, targetPath)) {
      await rm(tempPath, { force: true });
      return;
    }
    await rm(targetPath, { force: true });
    await rename(tempPath, targetPath);
  }
}

async function getSherpaCompatibleModelPaths(
  paths: { modelDir?: string; modelPath: string; tokensPath: string },
  force = false
) {
  if (
    process.platform !== 'win32' ||
    (!hasNonAsciiPath(paths.modelPath) && !hasNonAsciiPath(paths.tokensPath))
  ) {
    return paths;
  }

  const sourceModelDir = paths.modelDir || path.dirname(paths.modelPath);
  const errors: string[] = [];
  for (const modelDir of getAsciiRuntimeModelDirs(sourceModelDir)) {
    const target = getModelPathsForDir(modelDir);
    try {
      await materializeAsciiRuntimeFile(paths.modelPath, target.modelPath, force);
      await materializeAsciiRuntimeFile(paths.tokensPath, target.tokensPath, force);
      if (
        !hasNonAsciiPath(target.modelPath) &&
        !hasNonAsciiPath(target.tokensPath) &&
        matchingFileSize(paths.modelPath, target.modelPath) &&
        matchingFileSize(paths.tokensPath, target.tokensPath)
      ) {
        return target;
      }
    } catch (error) {
      errors.push(`${modelDir}: ${describeError(error)}`);
    }
  }

  throw new Error(
    `本地 STT 原生模型不支持当前安装路径中的非英文字符，且无法创建兼容运行镜像：` +
    `${errors.join(' | ') || '没有可用的纯英文运行目录'}`
  );
}

function hasModelFiles(paths: ReturnType<typeof getModelPaths>): boolean {
  return getModelFileStatus(paths).ready;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function checkFile(filePath: string, minBytes: number) {
  try {
    const stat = statSync(filePath);
    const bytes = stat.isFile() ? stat.size : 0;
    return {
      path: filePath,
      exists: stat.isFile(),
      bytes,
      minBytes,
      ok: stat.isFile() && bytes >= minBytes,
    };
  } catch (error) {
    return {
      path: filePath,
      exists: false,
      bytes: 0,
      minBytes,
      ok: false,
      error: describeError(error),
    };
  }
}

function getModelFileStatus(paths: ReturnType<typeof getModelPaths>) {
  const model = checkFile(paths.modelPath, MIN_MODEL_BYTES);
  const tokens = checkFile(paths.tokensPath, MIN_TOKENS_BYTES);
  return {
    model,
    tokens,
    ready: model.ok && tokens.ok,
  };
}

function formatModelStatus(status: ReturnType<typeof getModelFileStatus>): string {
  return [
    `model.int8.onnx=${status.model.exists ? `${status.model.bytes} bytes` : 'missing'}`,
    `tokens.txt=${status.tokens.exists ? `${status.tokens.bytes} bytes` : 'missing'}`,
  ].join(', ');
}

async function resetSenseVoiceModelCache() {
  const paths = getModelPaths();
  modelReadyPromise = null;
  await rm(paths.modelDir, { recursive: true, force: true });
  await rm(paths.archivePath, { force: true });
}

async function downloadFile(url: string, destination: string) {
  let res: Response;
  try {
    res = await fetchSafeOutboundUrl(url, {}, {
      allowedProtocols: ['https:'],
      isAllowedUrl: (target) => target.hostname === 'github.com' || target.hostname.endsWith('.githubusercontent.com'),
    });
  } catch (error) {
    throw new Error(`下载本地 STT 模型失败：${describeError(error)}。请检查网络是否可访问 GitHub，或使用内置模型安装包。`);
  }
  if (!res.ok || !res.body) {
    throw new Error(`下载本地 STT 模型失败：HTTP ${res.status}`);
  }
  await pipeline(
    Readable.fromWeb(res.body as unknown as NodeReadableStream<Uint8Array>),
    createWriteStream(destination)
  );
}

async function ensureSenseVoiceModel() {
  const paths = getModelPaths();
  if (hasModelFiles(paths)) {
    return { modelPath: paths.modelPath, tokensPath: paths.tokensPath };
  }

  const bundled = getBundledModelCandidateStatuses().find((candidate) => candidate.files.ready);
  if (bundled) {
    return { modelPath: bundled.paths.modelPath, tokensPath: bundled.paths.tokensPath };
  }

  await mkdir(paths.root, { recursive: true });
  await rm(paths.modelDir, { recursive: true, force: true });
  await rm(paths.archivePath, { force: true });
  await downloadFile(MODEL_URL, paths.archivePath);

  try {
    await execFileAsync('tar', ['-xjf', paths.archivePath, '-C', paths.root], { windowsHide: true });
  } catch (error) {
    throw new Error(
      `解压本地 STT 模型失败，请确认系统可用 tar 命令：${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    await rm(paths.archivePath, { force: true });
  }

  const status = getModelFileStatus(paths);
  if (!status.ready) {
    throw new Error(`本地 STT 模型文件不完整：${formatModelStatus(status)}`);
  }

  return { modelPath: paths.modelPath, tokensPath: paths.tokensPath };
}

async function getModelReady() {
  if (!modelReadyPromise) {
    modelReadyPromise = ensureSenseVoiceModel();
  }

  try {
    return await modelReadyPromise;
  } catch (error) {
    modelReadyPromise = null;
    throw error;
  }
}

function platformNativePackageName(): string {
  const platform = os.platform() === 'win32' ? 'win' : os.platform();
  return `sherpa-onnx-${platform}-${os.arch()}`;
}

function uniqExisting(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const p of paths) {
    if (!p || seen.has(p)) continue;
    seen.add(p);
    if (existsSync(p)) result.push(p);
  }
  return result;
}

function prependDllSearchPaths(paths: string[]) {
  if (process.platform !== 'win32') return;
  const existing = process.env.PATH || '';
  const existingSet = new Set(existing.split(path.delimiter).map((p) => p.toLowerCase()));
  const additions = uniqExisting(paths).filter((p) => !existingSet.has(p.toLowerCase()));
  if (additions.length > 0) {
    process.env.PATH = `${additions.join(path.delimiter)}${existing ? path.delimiter + existing : ''}`;
  }
}

function getStandaloneRootCandidates(): string[] {
  const processWithResources = process as NodeJS.Process & { resourcesPath?: string };
  const resourcesPath = processWithResources.resourcesPath;
  return uniqExisting([
    process.cwd(),
    process.env.MAGINE_NEXT_STANDALONE_ROOT || '',
    resourcesPath ? path.join(resourcesPath, 'next-standalone') : '',
    resourcesPath ? path.join(resourcesPath, 'app.asar.unpacked', 'next-standalone') : '',
  ]);
}

function getSherpaEntryCandidates(): string[] {
  const packageName = ['sherpa', 'onnx', 'node'].join('-');
  return uniqExisting(getStandaloneRootCandidates().map((root) =>
    path.join(root, 'node_modules', packageName, 'sherpa-onnx.js')
  ));
}

function getBundledModelDirCandidates(): string[] {
  const processWithResources = process as NodeJS.Process & { resourcesPath?: string };
  const resourcesPath = processWithResources.resourcesPath;
  return uniqExisting([
    path.join(process.cwd(), BUNDLED_MODEL_ROOT_NAME, MODEL_DIR_NAME),
    process.env.MAGINE_NEXT_STANDALONE_ROOT
      ? path.join(process.env.MAGINE_NEXT_STANDALONE_ROOT, BUNDLED_MODEL_ROOT_NAME, MODEL_DIR_NAME)
      : '',
    resourcesPath ? path.join(resourcesPath, 'next-standalone', BUNDLED_MODEL_ROOT_NAME, MODEL_DIR_NAME) : '',
    resourcesPath ? path.join(resourcesPath, 'app.asar.unpacked', 'next-standalone', BUNDLED_MODEL_ROOT_NAME, MODEL_DIR_NAME) : '',
  ]);
}

function getBundledModelCandidateStatuses() {
  return getBundledModelDirCandidates().map((modelDir) => {
    const paths = getModelPathsForDir(modelDir);
    return {
      modelDir,
      paths,
      files: getModelFileStatus({
        root: path.dirname(modelDir),
        modelDir,
        archivePath: path.join(path.dirname(modelDir), MODEL_ARCHIVE),
        modelPath: paths.modelPath,
        tokensPath: paths.tokensPath,
      }),
    };
  });
}

function prepareSherpaNativeSearchPath(entries: string[]) {
  const nativePackage = platformNativePackageName();
  const packageRoots = entries.map((entry) => path.dirname(entry));
  const nativeDirs = packageRoots.flatMap((packageRoot) => [
    packageRoot,
    path.join(packageRoot, 'node_modules', nativePackage),
    path.join(path.dirname(packageRoot), nativePackage),
  ]);
  prependDllSearchPaths(nativeDirs);
}

function isSherpaOnnxNode(value: unknown): value is SherpaOnnxNode {
  const mod = value as Partial<SherpaOnnxNode> | null;
  return Boolean(
    mod &&
    typeof mod.readWave === 'function' &&
    typeof mod.OfflineRecognizer?.createAsync === 'function'
  );
}

function nativeRequire(id: string): unknown {
  const req = eval('require') as NodeRequire;
  return req(id);
}

function loadSherpaOnnx(): SherpaOnnxNode {
  if (sherpaModule) return sherpaModule;

  const entries = getSherpaEntryCandidates();
  prepareSherpaNativeSearchPath(entries);

  const errors: string[] = [];
  for (const entry of entries) {
    try {
      const loaded = nativeRequire(entry);
      if (isSherpaOnnxNode(loaded)) {
        sherpaModule = loaded;
        return sherpaModule;
      }
      errors.push(`${entry}: 缺少 OfflineRecognizer/readWave 导出`);
    } catch (error) {
      errors.push(`${entry}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const packageName = ['sherpa', 'onnx', 'node'].join('-');
  try {
    const loaded = nativeRequire(packageName);
    if (isSherpaOnnxNode(loaded)) {
      sherpaModule = loaded;
      return sherpaModule;
    }
    errors.push(`${packageName}: 缺少 OfflineRecognizer/readWave 导出`);
  } catch (error) {
    errors.push(`${packageName}: ${error instanceof Error ? error.message : String(error)}`);
  }

  throw new Error(`本地 STT 原生模块加载失败。已尝试：${errors.join(' | ') || '无可用路径'}`);
}

async function getRecognizer() {
  if (recognizerPromise) return recognizerPromise;

  const promise = (async () => {
    const sherpa = loadSherpaOnnx();
    const threads = Math.max(1, Math.min(4, Number(process.env.MAGINE_LOCAL_STT_THREADS) || 2));

    let paths = await getSherpaCompatibleModelPaths(await getModelReady());
    try {
      const recognizer = await createOfflineRecognizer(sherpa, paths, threads);
      lastRecognizerError = null;
      return recognizer;
    } catch (firstError) {
      const firstMessage = describeError(firstError);
      lastRecognizerError = firstMessage;

      await resetSenseVoiceModelCache();
      paths = await getSherpaCompatibleModelPaths(await getModelReady(), true);

      try {
        const recognizer = await createOfflineRecognizer(sherpa, paths, threads);
        lastRecognizerError = null;
        return recognizer;
      } catch (secondError) {
        const secondMessage = describeError(secondError);
        lastRecognizerError = secondMessage;
        throw new Error(
          `创建本地 STT 识别器失败：${secondMessage}。已自动重建模型缓存后仍失败；` +
          `模型=${paths.modelPath}；tokens=${paths.tokensPath}；首次错误=${firstMessage}`
        );
      }
    }
  })();

  recognizerPromise = promise;
  try {
    return await promise;
  } catch (error) {
    if (recognizerPromise === promise) recognizerPromise = null;
    throw error;
  }
}

function createOfflineRecognizer(
  sherpa: SherpaOnnxNode,
  paths: { modelPath: string; tokensPath: string },
  threads: number
) {
  return sherpa.OfflineRecognizer.createAsync({
    featConfig: {
      sampleRate: 16000,
      featureDim: 80,
    },
    modelConfig: {
      senseVoice: {
        model: paths.modelPath,
        language: 'auto',
        useInverseTextNormalization: 1,
      },
      tokens: paths.tokensPath,
      numThreads: threads,
      provider: 'cpu',
      debug: 0,
    },
  });
}

function readAscii(view: DataView, offset: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += String.fromCharCode(view.getUint8(offset + i));
  }
  return out;
}

function decodeWavBytes(wavBytes: Uint8Array): WaveObject {
  const view = new DataView(wavBytes.buffer, wavBytes.byteOffset, wavBytes.byteLength);
  if (view.byteLength < 44 || readAscii(view, 0, 4) !== 'RIFF' || readAscii(view, 8, 4) !== 'WAVE') {
    throw new Error('本地 STT 音频格式错误：不是有效 WAV 文件');
  }

  let offset = 12;
  let audioFormat = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataBytes = 0;

  while (offset + 8 <= view.byteLength) {
    const chunkId = readAscii(view, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkDataOffset = offset + 8;
    if (chunkDataOffset + chunkSize > view.byteLength) break;

    if (chunkId === 'fmt ') {
      if (chunkSize < 16) throw new Error('本地 STT 音频格式错误：fmt chunk 不完整');
      audioFormat = view.getUint16(chunkDataOffset, true);
      channels = view.getUint16(chunkDataOffset + 2, true);
      sampleRate = view.getUint32(chunkDataOffset + 4, true);
      bitsPerSample = view.getUint16(chunkDataOffset + 14, true);
    } else if (chunkId === 'data') {
      dataOffset = chunkDataOffset;
      dataBytes = chunkSize;
      break;
    }

    offset = chunkDataOffset + chunkSize + (chunkSize % 2);
  }

  if (!sampleRate || !channels || dataOffset < 0 || dataBytes <= 0) {
    throw new Error('本地 STT 音频格式错误：缺少采样率、声道或音频数据');
  }

  const bytesPerSample = bitsPerSample / 8;
  if (!Number.isInteger(bytesPerSample) || bytesPerSample <= 0) {
    throw new Error(`本地 STT 暂不支持的 WAV 位深：${bitsPerSample}`);
  }

  const frameCount = Math.floor(dataBytes / (bytesPerSample * channels));
  const samples = new Float32Array(frameCount);

  for (let frame = 0; frame < frameCount; frame += 1) {
    let mixed = 0;
    for (let ch = 0; ch < channels; ch += 1) {
      const p = dataOffset + (frame * channels + ch) * bytesPerSample;
      let value: number;
      if (audioFormat === 1 && bitsPerSample === 16) {
        value = view.getInt16(p, true) / 32768;
      } else if (audioFormat === 1 && bitsPerSample === 8) {
        value = (view.getUint8(p) - 128) / 128;
      } else if (audioFormat === 1 && bitsPerSample === 24) {
        const raw = view.getUint8(p) | (view.getUint8(p + 1) << 8) | (view.getUint8(p + 2) << 16);
        const signed = raw & 0x800000 ? raw | 0xff000000 : raw;
        value = signed / 8388608;
      } else if (audioFormat === 1 && bitsPerSample === 32) {
        value = view.getInt32(p, true) / 2147483648;
      } else if (audioFormat === 3 && bitsPerSample === 32) {
        value = view.getFloat32(p, true);
      } else {
        throw new Error(`本地 STT 暂不支持的 WAV 编码：format=${audioFormat}, bits=${bitsPerSample}`);
      }
      mixed += Math.max(-1, Math.min(1, value));
    }
    samples[frame] = mixed / channels;
  }

  return { samples, sampleRate };
}

export async function transcribeLocalStt(wavBytes: Uint8Array) {
  const startedAt = performance.now();
  const recognizer = await getRecognizer();
  const wave = decodeWavBytes(wavBytes);

  const stream = recognizer.createStream();

  stream.acceptWaveform({
    sampleRate: wave.sampleRate,
    samples: wave.samples,
  });

  const result = await recognizer.decodeAsync(stream);
  return {
    text: (result.text || '').trim(),
    elapsedMs: Math.round(performance.now() - startedAt),
    model: 'SenseVoice Small int8',
  };
}

export function getLocalSttModelInfo() {
  const diagnostics = getLocalSttDiagnostics();
  return {
    provider: diagnostics.provider,
    model: diagnostics.model,
    modelDir: diagnostics.cache.modelDir,
    ready: diagnostics.ready,
    files: diagnostics.files,
  };
}

export function getLocalSttDiagnostics(error?: unknown) {
  const paths = getModelPaths();
  const files = getModelFileStatus(paths);
  const bundledModels = getBundledModelCandidateStatuses();
  const processWithResources = process as NodeJS.Process & { resourcesPath?: string };
  const standaloneRoots = getStandaloneRootCandidates();
  const sherpaEntries = getSherpaEntryCandidates();
  const nativePackage = platformNativePackageName();
  const bundledReady = bundledModels.some((candidate) => candidate.files.ready);

  return {
    provider: 'sherpa-onnx',
    model: 'SenseVoice Small int8',
    modelDir: paths.modelDir,
    ready: files.ready || bundledReady,
    source: files.ready ? 'cache' : bundledReady ? 'bundled' : 'missing',
    error: error ? describeError(error) : lastRecognizerError,
    cache: {
      root: paths.root,
      modelDir: paths.modelDir,
      archivePath: paths.archivePath,
      modelUrl: MODEL_URL,
    },
    files,
    bundledModels,
    runtime: {
      cwd: process.cwd(),
      execPath: process.execPath,
      resourcesPath: processWithResources.resourcesPath || null,
      standaloneRoots,
      sherpaEntries,
      nativePackage,
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      versions: {
        node: process.versions.node,
        electron: process.versions.electron || null,
        modules: process.versions.modules,
        napi: process.versions.napi,
        v8: process.versions.v8,
      },
      env: {
        MAGINE_CACHE_ROOT: process.env.MAGINE_CACHE_ROOT || null,
        MAGINE_NEXT_STANDALONE_ROOT: process.env.MAGINE_NEXT_STANDALONE_ROOT || null,
        ELECTRON_RUN_AS_NODE: process.env.ELECTRON_RUN_AS_NODE || null,
      },
    },
  };
}
