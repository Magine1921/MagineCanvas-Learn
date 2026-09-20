import type { CanvasNodeData } from '@/components/canvas/CanvasStore';

/** 将文件名转为合法的 @ 引用 slug（与 MaterialNode 规则一致） */
export function fileNameToMentionSlug(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  return (
    base
      .replace(/[^\w\u4e00-\u9fff-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 30) || '素材'
  );
}

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'avif', 'heic']);
const VIDEO_EXT = new Set(['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v', 'ogv']);
const AUDIO_EXT = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus', 'wma', 'aiff', 'caf']);

/** 素材节点预览区基准宽度（px）；高度由 materialAspectW/H 决定 */
export const MATERIAL_NODE_BASE_WIDTH = 360;
export const MATERIAL_NODE_DEFAULT_HEIGHT = 203;

/** 限制极端比例，避免节点过高或过扁 */
export const MATERIAL_ASPECT_MIN = 0.35;
export const MATERIAL_ASPECT_MAX = 3;

export function clampMaterialAspectPair(w: number, h: number): { w: number; h: number } {
  if (!w || !h || !Number.isFinite(w) || !Number.isFinite(h)) {
    return { w: 16, h: 9 };
  }
  const rw = w;
  let rh = h;
  const ratio = rh / rw;
  if (ratio < MATERIAL_ASPECT_MIN) {
    rh = rw * MATERIAL_ASPECT_MIN;
  } else if (ratio > MATERIAL_ASPECT_MAX) {
    rh = rw * MATERIAL_ASPECT_MAX;
  }
  return { w: Math.round(rw), h: Math.round(rh) };
}

export function materialPreviewAspectStyle(
  aspectW?: number,
  aspectH?: number
): { aspectRatio: `${number} / ${number}` } | undefined {
  const w = Number(aspectW);
  const h = Number(aspectH);
  if (!w || !h) return undefined;
  const clamped = clampMaterialAspectPair(w, h);
  return { aspectRatio: `${clamped.w} / ${clamped.h}` };
}

export function materialNodeDisplaySize(
  fileType?: unknown,
  aspectW?: unknown,
  aspectH?: unknown,
): { width: number; height: number } {
  const type = typeof fileType === 'string' ? fileType.toLowerCase() : '';
  const w = Number(aspectW);
  const h = Number(aspectH);
  if ((type === 'image' || type === 'video') && w > 0 && h > 0) {
    const clamped = clampMaterialAspectPair(w, h);
    return {
      width: MATERIAL_NODE_BASE_WIDTH,
      height: Math.round(MATERIAL_NODE_BASE_WIDTH * clamped.h / clamped.w),
    };
  }
  return { width: MATERIAL_NODE_BASE_WIDTH, height: MATERIAL_NODE_DEFAULT_HEIGHT };
}

async function getImageNaturalSize(url: string): Promise<{ w: number; h: number } | null> {
  if (!url.trim()) return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      resolve(w && h ? { w, h } : null);
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

async function getVideoNaturalSize(url: string): Promise<{ w: number; h: number } | null> {
  if (!url.trim() || typeof document === 'undefined') return null;
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'metadata';
    if (url.startsWith('http://') || url.startsWith('https://')) {
      v.crossOrigin = 'anonymous';
    }
    const timer = window.setTimeout(() => cleanup(null), 12_000);
    const cleanup = (out: { w: number; h: number } | null) => {
      window.clearTimeout(timer);
      try {
        v.pause();
        v.removeAttribute('src');
        v.load();
      } catch {
        /* noop */
      }
      resolve(out);
    };
    v.onloadedmetadata = () => {
      const w = v.videoWidth;
      const h = v.videoHeight;
      cleanup(w && h ? { w, h } : null);
    };
    v.onerror = () => cleanup(null);
    v.src = url;
  });
}

/** 解析图片/视频素材的展示宽高比，写入素材节点 data */
export async function resolveMaterialMediaAspect(
  fileType: string | undefined,
  url: string,
  thumbnailUrl?: string
): Promise<{ materialAspectW: number; materialAspectH: number } | null> {
  const src = url.trim();
  if (!src) return null;
  const type = (fileType || '').toLowerCase();
  let size: { w: number; h: number } | null = null;
  if (type === 'image') {
    size = await getImageNaturalSize(src);
  } else if (type === 'video') {
    const thumb = thumbnailUrl?.trim();
    if (thumb) size = await getImageNaturalSize(thumb);
    if (!size) size = await getVideoNaturalSize(src);
  }
  if (!size) return null;
  const clamped = clampMaterialAspectPair(size.w, size.h);
  return { materialAspectW: clamped.w, materialAspectH: clamped.h };
}

export function getMaterialKindFromFileName(fileName: string): 'image' | 'video' | 'audio' | null {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  if (AUDIO_EXT.has(ext)) return 'audio';
  return null;
}

/** 结合 MIME 与扩展名判断；无法识别则返回 null（批量导入时跳过） */
export function getMaterialKindFromFile(file: File): 'image' | 'video' | 'audio' | null {
  const mime = (file.type || '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return getMaterialKindFromFileName(file.name);
}

/** 从视频（data URL / blob / https）截取一帧为 JPEG data URL，供素材与其它节点预览 */
export async function makeVideoThumbnailDataUrl(videoSrc: string, maxEdge = 720): Promise<string> {
  if (typeof document === 'undefined' || !videoSrc.trim()) return '';

  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.muted = true;
    v.defaultMuted = true;
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.preload = 'auto';
    if (videoSrc.startsWith('http://') || videoSrc.startsWith('https://')) {
      v.crossOrigin = 'anonymous';
    }

    let deadline: number | undefined;
    const cleanup = (out: string) => {
      if (deadline !== undefined) {
        window.clearTimeout(deadline);
        deadline = undefined;
      }
      try {
        v.pause();
        v.removeAttribute('src');
        v.load();
      } catch {
        /* noop */
      }
      resolve(out);
    };
    deadline = window.setTimeout(() => cleanup(''), 18_000);

    let drew = false;
    const draw = () => {
      if (drew) return;
      try {
        const w = v.videoWidth;
        const h = v.videoHeight;
        if (!w || !h) {
          cleanup('');
          return;
        }
        drew = true;
        const scale = Math.min(1, maxEdge / Math.max(w, h));
        const cw = Math.max(1, Math.round(w * scale));
        const ch = Math.max(1, Math.round(h * scale));
        const canvas = document.createElement('canvas');
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          drew = false;
          cleanup('');
          return;
        }
        ctx.drawImage(v, 0, 0, cw, ch);
        cleanup(canvas.toDataURL('image/jpeg', 0.82));
      } catch {
        cleanup('');
      }
    };

    v.onerror = () => cleanup('');

    const seekAndDraw = () => {
      const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 1;
      const t = Math.min(0.28, Math.max(0.04, dur * 0.03));
      const onceSeeked = () => {
        v.removeEventListener('seeked', onceSeeked);
        requestAnimationFrame(() => draw());
      };
      v.addEventListener('seeked', onceSeeked);
      try {
        v.currentTime = t;
      } catch {
        v.removeEventListener('seeked', onceSeeked);
        requestAnimationFrame(() => draw());
      }
      window.setTimeout(() => {
        if (!drew) {
          v.removeEventListener('seeked', onceSeeked);
          draw();
        }
      }, 800);
    };

    v.onloadedmetadata = () => seekAndDraw();
    v.src = videoSrc;
  });
}

export type VideoFrameCaptureResult = {
  dataUrl: string;
  width: number;
  height: number;
  time: number;
  duration: number;
};

/** 从视频指定时间点截取一帧；传入 Infinity 时截取尾帧附近的最后可解码画面。 */
export async function captureVideoFrameDataUrl(
  videoSrc: string,
  targetTimeSeconds: number,
  maxEdge = 1920
): Promise<VideoFrameCaptureResult> {
  if (typeof document === 'undefined' || !videoSrc.trim()) {
    throw new Error('视频不可用');
  }

  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.muted = true;
    v.defaultMuted = true;
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.preload = 'auto';
    if (videoSrc.startsWith('http://') || videoSrc.startsWith('https://')) {
      v.crossOrigin = 'anonymous';
    }

    let settled = false;
    let targetTime = 0;
    let seekFallback: number | undefined;
    const deadline = window.setTimeout(() => fail('截帧超时'), 20_000);

    const cleanup = () => {
      window.clearTimeout(deadline);
      if (seekFallback !== undefined) {
        window.clearTimeout(seekFallback);
        seekFallback = undefined;
      }
      try {
        v.pause();
        v.removeAttribute('src');
        v.load();
      } catch {
        /* noop */
      }
    };

    const done = (result: VideoFrameCaptureResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(message));
    };

    const draw = () => {
      try {
        const w = v.videoWidth;
        const h = v.videoHeight;
        if (!w || !h) {
          fail('视频帧尺寸无效');
          return;
        }
        const scale = maxEdge > 0 ? Math.min(1, maxEdge / Math.max(w, h)) : 1;
        const cw = Math.max(1, Math.round(w * scale));
        const ch = Math.max(1, Math.round(h * scale));
        const canvas = document.createElement('canvas');
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          fail('无法创建截帧画布');
          return;
        }
        ctx.drawImage(v, 0, 0, cw, ch);
        done({
          dataUrl: canvas.toDataURL('image/jpeg', 0.9),
          width: cw,
          height: ch,
          time: targetTime,
          duration: Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0,
        });
      } catch {
        fail('截帧失败，视频可能不允许跨域读取');
      }
    };

    let seekStarted = false;
    const seekAndDraw = () => {
      if (seekStarted) return;
      seekStarted = true;
      const duration = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
      const safeEnd = duration > 0 ? Math.max(0, duration - 0.08) : 0;
      if (targetTimeSeconds === Number.POSITIVE_INFINITY) {
        targetTime = safeEnd;
      } else {
        targetTime = Number.isFinite(targetTimeSeconds) ? Math.max(0, targetTimeSeconds) : 0;
        if (duration > 0) targetTime = Math.min(targetTime, safeEnd);
      }

      if (Math.abs(v.currentTime - targetTime) < 0.01 && v.readyState >= 2) {
        requestAnimationFrame(draw);
        return;
      }

      const onSeeked = () => {
        if (seekFallback !== undefined) {
          window.clearTimeout(seekFallback);
          seekFallback = undefined;
        }
        requestAnimationFrame(draw);
      };
      v.addEventListener('seeked', onSeeked, { once: true });
      seekFallback = window.setTimeout(() => {
        v.removeEventListener('seeked', onSeeked);
        draw();
      }, 1500);
      try {
        v.currentTime = targetTime;
      } catch {
        v.removeEventListener('seeked', onSeeked);
        requestAnimationFrame(draw);
      }
    };

    v.onerror = () => fail('视频加载失败');
    v.onloadedmetadata = () => {
      if (v.readyState >= 2) {
        seekAndDraw();
      } else {
        v.addEventListener('loadeddata', seekAndDraw, { once: true });
        window.setTimeout(seekAndDraw, 700);
      }
    };
    v.src = videoSrc;
  });
}

export async function makeImageThumbnailDataUrl(
  sourceUrl: string,
  maxSize = 960,
  minSide = 300
): Promise<string> {
  if (!sourceUrl) return '';

  return new Promise((resolve) => {
    const img = new Image();

    img.onload = () => {
      try {
        const longestSide = Math.max(img.width, img.height);
        const shortestSide = Math.max(1, Math.min(img.width, img.height));
        const scaleDown = maxSize / longestSide;
        const scaleUp = minSide / shortestSide;
        const scale = Math.max(scaleUp, Math.min(1, scaleDown));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(sourceUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      } catch {
        resolve(sourceUrl);
      }
    };

    img.onerror = () => resolve(sourceUrl);
    img.src = sourceUrl;
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

/** 将本地文件转为素材节点 data（data URL + 缩略图等） */
export async function fileToMaterialNodeData(file: File): Promise<Partial<CanvasNodeData>> {
  const kind = getMaterialKindFromFile(file);
  if (!kind) {
    throw new Error('unsupported file type');
  }

  const dataUrl = await readFileAsDataUrl(file);
  let thumbnailUrl = '';
  if (kind === 'image') {
    thumbnailUrl = await makeImageThumbnailDataUrl(dataUrl, 420, 160);
  } else if (kind === 'video') {
    thumbnailUrl = await makeVideoThumbnailDataUrl(dataUrl, 720);
  }

  const aspect = await resolveMaterialMediaAspect(kind, dataUrl, thumbnailUrl);
  const displaySize = materialNodeDisplaySize(
    kind,
    aspect?.materialAspectW,
    aspect?.materialAspectH,
  );

  return {
    label: '素材',
    type: 'material',
    fileUrl: dataUrl,
    thumbnailUrl,
    fileName: file.name,
    fileType: kind,
    mentionSlug: fileNameToMentionSlug(file.name),
    seedanceAssetId: '',
    seedanceAssetUri: '',
    seedanceAssetGroupId: '',
    virtualHumanCardId: '',
    ...(aspect || {}),
    materialWidth: displaySize.width,
    materialHeight: displaySize.height,
  };
}
