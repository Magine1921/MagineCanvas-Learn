/**
 * 人脸合规 — SCRFD 检测器 (ONNX Runtime Web)
 * 模型不随开源仓库分发；用户须在确认拥有合法使用权后自行安装。
 */

import * as ort from 'onnxruntime-web/wasm';

// 随应用交付 WASM 运行时，避免打包版首次使用依赖外部 CDN。
ort.env.wasm.wasmPaths = '/ort/';
ort.env.wasm.numThreads = 1;

type OcclusionType = 'eyes' | 'mouth';

export const FACE_COMPLIANCE_VIDEO_PROMPT = '去掉人物脸上的黑条，组合人脸';

// ---------------------------------------------------------------------------
// 用户自行安装的本地模型
// ---------------------------------------------------------------------------

export const FACE_COMPLIANCE_MODEL_FILE = 'scrfd_2.5g_bnkps.onnx';
export const FACE_COMPLIANCE_MODEL_PUBLIC_PATH = `/models/face/${FACE_COMPLIANCE_MODEL_FILE}`;
export const FACE_COMPLIANCE_MODEL_INSTALL_HINT =
  `未安装人脸合规模型。请在确认拥有合法使用权后，将 ${FACE_COMPLIANCE_MODEL_FILE} 放入源码的 public/models/face/，或安装版的 resources/next-standalone/public/models/face/，然后重新启动应用。`;

const MODEL_URLS = [FACE_COMPLIANCE_MODEL_PUBLIC_PATH];

const INPUT_SIZE = 640;

// ---------------------------------------------------------------------------
// 内部类型
// ---------------------------------------------------------------------------

interface Point {
  x: number;
  y: number;
}

export interface FaceResult {
  leftEye: Point;
  rightEye: Point;
  mouth: Point;
  box: { x: number; y: number; width: number; height: number };
}

interface DetectionBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
  score: number;
  kps: number[]; // 10 floats: [lx,ly, rx,ry, nx,ny, lmx,lmy, rmx,rmy]
}

// ---------------------------------------------------------------------------
// 模型加载
// ---------------------------------------------------------------------------

let session: ort.InferenceSession | null = null;
let loadPromise: Promise<ort.InferenceSession> | null = null;

async function loadModel(url: string): Promise<ort.InferenceSession> {
  const response = await fetch(url, { cache: 'force-cache' });
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(FACE_COMPLIANCE_MODEL_INSTALL_HINT);
    }
    const text = await response.text().catch(() => '');
    throw new Error(`模型下载失败: ${response.status} ${text.slice(0, 200)}`);
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength < 1_000_000) {
    throw new Error(
      `${FACE_COMPLIANCE_MODEL_INSTALL_HINT} 当前文件不完整（${buffer.byteLength} bytes）。`,
    );
  }
  return ort.InferenceSession.create(buffer, {
    executionProviders: ['wasm'],
  });
}

async function ensureSession(): Promise<ort.InferenceSession> {
  if (session) return session;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    let lastError: Error | null = null;
    for (const url of MODEL_URLS) {
      try {
        console.log('[face] 加载 SCRFD 模型:', url);
        session = await loadModel(url);
        console.log('[face] SCRFD 模型就绪');
        return session;
      } catch (e) {
        console.warn('[face] 模型加载尝试失败:', url, (e as Error).message);
        lastError = e as Error;
      }
    }
    throw new Error(`人脸合规模型加载失败：${lastError?.message || FACE_COMPLIANCE_MODEL_INSTALL_HINT}`);
  })().catch((error) => {
    loadPromise = null;
    throw error;
  });

  return loadPromise;
}

// ---------------------------------------------------------------------------
// 图像预处理
// ---------------------------------------------------------------------------

function preprocess(
  img: HTMLImageElement,
): { tensor: ort.Tensor; scale: number; offsetX: number; offsetY: number } {
  const srcW = img.naturalWidth;
  const srcH = img.naturalHeight;

  // 等比缩放，保持长边 640
  const scale = INPUT_SIZE / Math.max(srcW, srcH);
  const scaledW = Math.round(srcW * scale);
  const scaledH = Math.round(srcH * scale);

  const offCanvas = document.createElement('canvas');
  offCanvas.width = scaledW;
  offCanvas.height = scaledH;
  const octx = offCanvas.getContext('2d')!;
  octx.drawImage(img, 0, 0, scaledW, scaledH);
  const imageData = octx.getImageData(0, 0, scaledW, scaledH);

  // NCHW float32，归一化：(pixel - 127.5) / 128.0
  const data = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
  const offsetX = (INPUT_SIZE - scaledW) >> 1;
  const offsetY = (INPUT_SIZE - scaledH) >> 1;

  for (let y = 0; y < scaledH; y++) {
    for (let x = 0; x < scaledW; x++) {
      const srcIdx = (y * scaledW + x) * 4;
      const dstY = offsetY + y;
      const dstX = offsetX + x;
      const r = imageData.data[srcIdx];
      const g = imageData.data[srcIdx + 1];
      const b = imageData.data[srcIdx + 2];
      const planeSize = INPUT_SIZE * INPUT_SIZE;
      const dstIdx = dstY * INPUT_SIZE + dstX;
      data[dstIdx] = (r - 127.5) / 128.0;
      data[planeSize + dstIdx] = (g - 127.5) / 128.0;
      data[2 * planeSize + dstIdx] = (b - 127.5) / 128.0;
    }
  }

  const tensor = new ort.Tensor('float32', data, [1, 3, INPUT_SIZE, INPUT_SIZE]);
  return { tensor, scale, offsetX, offsetY };
}

// ---------------------------------------------------------------------------
// SCRFD 后处理
// ---------------------------------------------------------------------------

interface StrideOutput {
  stride: number;
  scores: Float32Array;
  bboxes: Float32Array;
  kps: Float32Array;
  numAnchors: number;
  gridH: number;
  gridW: number;
}

function parseOutputs(
  outputs: Record<string, ort.Tensor>,
  inputH: number,
  inputW: number,
): StrideOutput[] {
  // 诊断日志 — 输出所有 tensor 名称和形状
  const entries = Object.entries(outputs);
  const dimSummary = entries
    .map(([k, t]) => `${k}:[${t.dims.join(',')}]`)
    .join(' ');
  console.warn('[face] 模型输出 (' + entries.length + ' tensors): ' + dimSummary);

  const result: StrideOutput[] = [];

  // ---- 格式 1：命名约定 score_N / bbox_N / kps_N ----
  const strideEntries: Array<{
    stride: number;
    scoreName: string;
    bboxName: string;
    kpsName: string | null;
  }> = [];

  for (const name of Object.keys(outputs)) {
    const m = name.match(/^score_(\d+)$/);
    if (!m) continue;
    const stride = parseInt(m[1], 10);
    const bboxName = `bbox_${stride}`;
    const kpsName = `kps_${stride}`;
    if (!outputs[bboxName]) continue;
    strideEntries.push({
      stride,
      scoreName: name,
      bboxName,
      kpsName: outputs[kpsName] ? kpsName : null,
    });
  }

  strideEntries.sort((a, b) => a.stride - b.stride);

  for (const entry of strideEntries) {
    const s = outputs[entry.scoreName];
    const b = outputs[entry.bboxName];
    const k = entry.kpsName ? outputs[entry.kpsName] : null;
    if (!s || !b) continue;
    const n = s.dims[1];
    const gridH = Math.round(inputH / entry.stride);
    const gridW = Math.round(inputW / entry.stride);
    const numAnchors = Math.round(n / (gridH * gridW));
    result.push({
      stride: entry.stride,
      scores: s.data as Float32Array,
      bboxes: b.data as Float32Array,
      kps: k ? (k.data as Float32Array) : new Float32Array(0),
      numAnchors,
      gridH,
      gridW,
    });
  }

  // ---- 格式 2：按 tensor 形状自动推断 ----
  if (result.length === 0) {
    // 收集所有 2D [N,C] 或 3D [1,N,C] 的 tensor，按 N 分组
    const byN = new Map<number, Array<{ name: string; channels: number; tensor: ort.Tensor }>>();

    for (const name of Object.keys(outputs)) {
      const t = outputs[name];
      let n: number;
      let channels: number;

      if (t.dims.length === 3 && t.dims[0] === 1) {
        n = t.dims[1];
        channels = t.dims[2];
      } else if (t.dims.length === 2) {
        n = t.dims[0];
        channels = t.dims[1];
      } else {
        continue;
      }

      if (!byN.has(n)) byN.set(n, []);
      byN.get(n)!.push({ name, channels, tensor: t });
    }

    // 对每个 N 值，找到 score(ch=1), bbox(ch=4), kps(ch=10) 三元组
    for (const [n, items] of byN) {
      const score = items.find((i) => i.channels === 1);
      const bbox = items.find((i) => i.channels === 4);
      const kps = items.find((i) => i.channels === 10);

      if (!score || !bbox) continue;

      const gridCells = n / 2; // assume 2 anchors per cell
      const gridSide = Math.round(Math.sqrt(gridCells));
      const stride = Math.round(INPUT_SIZE / gridSide);

      console.warn(
        `[face] 匹配到 stride=${stride} 组: N=${n} grid=${gridSide}×${gridSide} (` +
        `score=${score.name} bbox=${bbox.name} kps=${kps ? kps.name : '—'})`,
      );

      result.push({
        stride,
        scores: score.tensor.data as Float32Array,
        bboxes: bbox.tensor.data as Float32Array,
        kps: kps ? (kps.tensor.data as Float32Array) : new Float32Array(0),
        numAnchors: 2,
        gridH: gridSide,
        gridW: gridSide,
      });
    }
  }

  // 按 stride 排序
  result.sort((a, b) => a.stride - b.stride);

  // 如果所有格式都识别不了，输出完整诊断
  if (result.length === 0) {
    console.error('[face] 无法解析任何输出格式！完整结构:',
      entries.map(([k, t]) => ({
        name: k,
        dims: t.dims,
        type: t.type,
        size: t.size,
        sample: Array.from((t.data as Float32Array).slice(0, 8)).map(v => v.toFixed(4)),
      })),
    );
  }

  return result;
}

function decodeDetections(
  strides: StrideOutput[],
  scoreThresh: number,
): DetectionBox[] {
  const detections: DetectionBox[] = [];

  for (const s of strides) {
    const { stride, scores, bboxes, kps, numAnchors, gridH, gridW } = s;
    const hasKps = kps.length > 0;

    // InsightFace 排列：[H, W, anchor] → 展平为 row-major
    // idx = gy * gridW * numAnchors + gx * numAnchors + a
    for (let gy = 0; gy < gridH; gy++) {
      for (let gx = 0; gx < gridW; gx++) {
        for (let a = 0; a < numAnchors; a++) {
          const idx = gy * gridW * numAnchors + gx * numAnchors + a;
          const score = scores[idx];
          if (score < scoreThresh) continue;

          const cx = (gx + 0.5) * stride;
          const cy = (gy + 0.5) * stride;

          const bOff = idx * 4;
          const left = cx - bboxes[bOff] * stride;
          const top = cy - bboxes[bOff + 1] * stride;
          const right = cx + bboxes[bOff + 2] * stride;
          const bottom = cy + bboxes[bOff + 3] * stride;

          const det: DetectionBox = {
            left: Math.max(0, left),
            top: Math.max(0, top),
            right: Math.min(INPUT_SIZE - 1, right),
            bottom: Math.min(INPUT_SIZE - 1, bottom),
            score,
            kps: [],
          };

          if (hasKps) {
            const kOff = idx * 10;
            const points: number[] = [];
            for (let p = 0; p < 5; p++) {
              points.push(cx + kps[kOff + p * 2] * stride);
              points.push(cy + kps[kOff + p * 2 + 1] * stride);
            }
            det.kps = points;
          }

          detections.push(det);
        }
      }
    }
  }

  return detections;
}

function iou(a: DetectionBox, b: DetectionBox): number {
  const x1 = Math.max(a.left, b.left);
  const y1 = Math.max(a.top, b.top);
  const x2 = Math.min(a.right, b.right);
  const y2 = Math.min(a.bottom, b.bottom);
  if (x2 <= x1 || y2 <= y1) return 0;
  const inter = (x2 - x1) * (y2 - y1);
  const areaA = (a.right - a.left) * (a.bottom - a.top);
  const areaB = (b.right - b.left) * (b.bottom - b.top);
  return inter / Math.min(areaA, areaB);
}

function nms(
  detections: DetectionBox[],
  iouThresh: number,
): DetectionBox[] {
  if (detections.length <= 1) return detections;

  const sorted = [...detections].sort((a, b) => b.score - a.score);
  const keep: DetectionBox[] = [];

  for (const det of sorted) {
    let overlapped = false;
    for (const kept of keep) {
      if (iou(det, kept) > iouThresh) {
        overlapped = true;
        break;
      }
    }
    if (!overlapped) keep.push(det);
  }

  return keep;
}

function mapToOriginal(
  dets: DetectionBox[],
  scale: number,
  offsetX: number,
  offsetY: number,
): void {
  const invScale = 1 / scale;
  for (const d of dets) {
    d.left = (d.left - offsetX) * invScale;
    d.top = (d.top - offsetY) * invScale;
    d.right = (d.right - offsetX) * invScale;
    d.bottom = (d.bottom - offsetY) * invScale;
    for (let i = 0; i < d.kps.length; i += 2) {
      d.kps[i] = (d.kps[i] - offsetX) * invScale;
      d.kps[i + 1] = (d.kps[i + 1] - offsetY) * invScale;
    }
  }
}

// ---------------------------------------------------------------------------
// 检测 API
// ---------------------------------------------------------------------------

export async function detectFaces(img: HTMLImageElement): Promise<FaceResult[]> {
  const s = await ensureSession();
  const { tensor, scale, offsetX, offsetY } = preprocess(img);

  const feeds: Record<string, ort.Tensor> = {};
  feeds[s.inputNames[0]] = tensor;

  const start = performance.now();
  const outputs = await s.run(feeds);
  console.log('[face] SCRFD 推理耗时:', (performance.now() - start).toFixed(1), 'ms');

  const strideOutputs = parseOutputs(
    outputs as Record<string, ort.Tensor>,
    INPUT_SIZE,
    INPUT_SIZE,
  );

  if (strideOutputs.length === 0) {
    console.warn('[face] 无法解析模型的输出结构');
    return [];
  }

  const rawDets = decodeDetections(strideOutputs, 0.2);
  console.log('[face] 原始检出（阈值 0.2）:', rawDets.length, '个');
  if (rawDets.length > 0) {
    console.log(
      '[face] 最高分:',
      Math.max(...rawDets.map((d) => d.score)).toFixed(3),
      '前3:',
      rawDets.slice(0, 3).map((d) => d.score.toFixed(3)).join(', '),
    );
  }

  const filtered = nms(rawDets, 0.4);
  console.warn(`[face] NMS 后: ${filtered.length} 张`);

  if (filtered.length > 0) {
    for (let i = 0; i < Math.min(3, filtered.length); i++) {
      const d = filtered[i];
      console.warn(
        `[face] #${i}: score=${d.score.toFixed(3)} box=[${d.left.toFixed(0)},${d.top.toFixed(0)} ${d.right.toFixed(0)}x${d.bottom.toFixed(0)}] kps=[${d.kps.slice(0, 6).map(v => v.toFixed(0)).join(',')}...]`,
      );
    }
  }

  mapToOriginal(filtered, scale, offsetX, offsetY);

  if (filtered.length > 0) {
    const d0 = filtered[0];
    console.warn(
      `[face] 映射后 #0: box=[${d0.left.toFixed(0)},${d0.top.toFixed(0)} ${d0.right.toFixed(0)}x${d0.bottom.toFixed(0)}] kps=[${d0.kps.slice(0, 6).map(v => v.toFixed(0)).join(',')}...]`,
    );
  }

  const out: FaceResult[] = [];
  for (const det of filtered) {
    // SCRFD KPS 顺序: 0=右眼 1=左眼 2=鼻尖 3=右嘴角 4=左嘴角
    const k = det.kps;
    if (k.length < 10) continue;

    out.push({
      leftEye: { x: k[2], y: k[3] },
      rightEye: { x: k[0], y: k[1] },
      mouth: {
        x: (k[6] + k[8]) / 2,
        y: (k[7] + k[9]) / 2,
      },
      box: {
        x: det.left,
        y: det.top,
        width: det.right - det.left,
        height: det.bottom - det.top,
      },
    });
  }

  console.log('[face] SCRFD → %d 张人脸 (NMS后)', out.length);
  return out;
}

export function isModelReady(): boolean {
  return session !== null;
}

// ---------------------------------------------------------------------------
// 绘制
// ---------------------------------------------------------------------------

function assignOcclusions(faces: FaceResult[]): OcclusionType[] {
  if (faces.length === 0) return [];

  const types: OcclusionType[] = faces.map(() =>
    Math.random() < 0.5 ? 'eyes' : 'mouth',
  );

  // 2+ faces: ensure at least one of each type
  if (faces.length >= 2) {
    const allSame = types.every((t) => t === types[0]);
    if (allSame) {
      const flipIdx = Math.floor(Math.random() * faces.length);
      types[flipIdx] = types[flipIdx] === 'eyes' ? 'mouth' : 'eyes';
    }
  }

  return types;
}

function drawBars(
  ctx: CanvasRenderingContext2D,
  faces: FaceResult[],
  types: OcclusionType[],
): void {
  const barColor = 'rgba(0, 0, 0, 0.92)';

  for (let i = 0; i < faces.length; i++) {
    const f = faces[i];
    const barW = f.box.width * 0.86;
    const barH = Math.max(f.box.height * 0.18, 14);

    if (types[i] === 'eyes') {
      const cx = (f.leftEye.x + f.rightEye.x) / 2;
      const cy = (f.leftEye.y + f.rightEye.y) / 2;
      ctx.fillStyle = barColor;
      ctx.fillRect(cx - barW / 2, cy - barH / 2, barW, barH);
    } else {
      ctx.fillStyle = barColor;
      ctx.fillRect(f.mouth.x - barW / 2, f.mouth.y - barH / 2, barW, barH);
    }
  }
}

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (/^https?:\/\//i.test(src)) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new Error(`图片加载失败：${src.slice(0, 80)}`));
    img.src = src;
  });
}

async function materializeRemoteImage(src: string): Promise<string> {
  const response = await fetch('/api/panorama/materialize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: src }),
  });
  const payload = await response.json().catch(() => ({})) as {
    ok?: boolean;
    dataUrl?: string;
    error?: string;
  };
  if (!response.ok || payload.ok !== true || !payload.dataUrl?.startsWith('data:image/')) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return payload.dataUrl;
}

async function loadComplianceImage(src: string): Promise<HTMLImageElement> {
  try {
    return await loadImage(src);
  } catch (directError) {
    if (!/^https?:\/\//i.test(src)) throw directError;
    try {
      return await loadImage(await materializeRemoteImage(src));
    } catch (proxyError) {
      const detail = proxyError instanceof Error ? proxyError.message : String(proxyError);
      throw new Error(`图片加载失败：${src.slice(0, 80)}；远程读取失败：${detail}`);
    }
  }
}

export interface ComplianceResult {
  dataUrl: string;
  faceCount: number;
  eyesCount: number;
  mouthCount: number;
}

export async function applyFaceCompliance(
  imageSource: string,
): Promise<ComplianceResult> {
  const img = await loadComplianceImage(imageSource);

  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);

  let faces: FaceResult[] = [];

  try {
    faces = await detectFaces(img);
  } catch (e) {
    console.error('[face] 检测失败:', (e as Error).message);
    throw e;
  }

  let types: OcclusionType[] = [];
  let eyesCount = 0;
  let mouthCount = 0;

  if (faces.length > 0) {
    types = assignOcclusions(faces);
    drawBars(ctx, faces, types);
    eyesCount = types.filter((t) => t === 'eyes').length;
    mouthCount = types.filter((t) => t === 'mouth').length;
  }

  return {
    dataUrl: canvas.toDataURL('image/png'),
    faceCount: faces.length,
    eyesCount,
    mouthCount,
  };
}

export function resolveInputImageUrl(
  data: Record<string, unknown> | null,
): string {
  if (!data) return '';
  const d = data as Record<string, unknown>;
  if (typeof d.imageUrl === 'string' && d.imageUrl) return d.imageUrl;
  if (typeof d.outputImageUrl === 'string' && d.outputImageUrl)
    return d.outputImageUrl;
  if (typeof d.fileUrl === 'string' && d.fileUrl) return d.fileUrl;
  if (typeof d.thumbnailUrl === 'string' && d.thumbnailUrl)
    return d.thumbnailUrl;
  return '';
}
