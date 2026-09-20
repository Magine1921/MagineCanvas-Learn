/**
 * Maginecancas将静图放在独立 pi.Image 轨；要落在主视频轨（与 MP4 同轨）需以 video/* 容器导入。
 * 使用 Canvas + MediaRecorder 生成短时 VP8 WebM（无音频），时长取 min(素材期望时长, 上限) 以控制编码耗时。
 */

const MAX_RECORD_MS = 4000;
const MIN_RECORD_MS = 700;
const MAX_EDGE = 1920;

function clampRecordDurationMs(requested: number | undefined): number {
  const base = typeof requested === 'number' && requested > 0 ? requested : 3000;
  return Math.min(Math.max(Math.round(base), MIN_RECORD_MS), MAX_RECORD_MS);
}

function even(n: number): number {
  const x = Math.max(2, Math.floor(n));
  return x % 2 === 0 ? x : x - 1;
}

function fitBox(nw: number, nh: number, maxEdge: number): { w: number; h: number } {
  if (!nw || !nh) return { w: 1280, h: 720 };
  const scale = Math.min(1, maxEdge / Math.max(nw, nh));
  return { w: even(nw * scale), h: even(nh * scale) };
}

function pickWebmMimeType(): string {
  const candidates = ['video/webm;codecs=vp8', 'video/webm'];
  if (typeof MediaRecorder === 'undefined') return '';
  for (const m of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      /* ignore */
    }
  }
  return '';
}

async function decodeToDrawable(imageBytes: ArrayBuffer, mime: string): Promise<{
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  close: () => void;
  naturalW: number;
  naturalH: number;
}> {
  const type = mime.split(';')[0]?.trim() || 'image/png';
  const blob = new Blob([imageBytes], { type });

  if (typeof createImageBitmap === 'function') {
    const bmp = await createImageBitmap(blob);
    return {
      naturalW: bmp.width,
      naturalH: bmp.height,
      draw(ctx, w, h) {
        ctx.drawImage(bmp, 0, 0, w, h);
      },
      close() {
        bmp.close();
      },
    };
  }

  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.crossOrigin = 'anonymous';
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('图片解码失败'));
      i.src = url;
    });
    return {
      naturalW: img.naturalWidth || 1,
      naturalH: img.naturalHeight || 1,
      draw(ctx, w, h) {
        ctx.drawImage(img, 0, 0, w, h);
      },
      close() {
        URL.revokeObjectURL(url);
      },
    };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

/**
 * 将已识别的图片字节编码为 WebM（VP8），供Maginecancas按视频素材走主轨逻辑。
 */
export async function stillImageToWebmForMaginecanvasMainTrack(
  imageBytes: ArrayBuffer,
  imageMime: string,
  durationMs: number | undefined
): Promise<ArrayBuffer> {
  if (typeof document === 'undefined') {
    throw new Error('静图转视频仅能在浏览器中执行');
  }
  const mimeType = pickWebmMimeType();
  if (!mimeType) {
    throw new Error('当前浏览器不支持 WebM 编码（MediaRecorder），无法将图片导入主视频轨');
  }

  const recordMs = clampRecordDurationMs(durationMs);
  const drawable = await decodeToDrawable(imageBytes, imageMime);
  try {
    const { w, h } = fitBox(drawable.naturalW, drawable.naturalH, MAX_EDGE);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建 2D 画布');

    drawable.draw(ctx, w, h);
    const stream = canvas.captureStream(30);
    const recorder = new MediaRecorder(stream, {
      mimeType: mimeType,
      videoBitsPerSecond: 2_500_000,
    });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) chunks.push(ev.data);
    };

    const done = new Promise<void>((resolve, reject) => {
      recorder.onstop = () => resolve();
      recorder.onerror = () => reject(new Error('静图编码为视频失败'));
    });

    const t0 = performance.now();
    let raf = 0;
    const tick = () => {
      drawable.draw(ctx, w, h);
      if (performance.now() - t0 >= recordMs) {
        cancelAnimationFrame(raf);
        recorder.stop();
        for (const t of stream.getTracks()) t.stop();
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    recorder.start(150);
    raf = requestAnimationFrame(tick);
    await done;

    const out = new Blob(chunks, { type: 'video/webm' });
    if (out.size < 32) {
      throw new Error('生成的 WebM 过小，编码可能未产出有效帧');
    }
    return await out.arrayBuffer();
  } finally {
    drawable.close();
  }
}
