import type { SeedreamAspectRatio } from '@/components/api/ImageAPI';

/** 与内置 2:1 equirectangular 引导图一致；智能体生图 API 的 ratio 固定为此值，与节点内「预览框比例」选项解耦 */
export const PANORAMA_AGENT_IMAGE_GEN_ASPECT_RATIO = '2:1' as SeedreamAspectRatio;

export const PANORAMA_EQUIRECTANGULAR_GUIDE_PUBLIC_PATH = '/panorama-equirectangular-guide.svg';

let cachedGuideDataUrl: string | null = null;

/**
 * 720° 智能体生图：将原创 SVG 引导网格光栅化为 PNG data URL，供图像 API 引用。
 * 使用 data URL 而非 http 本地地址，避免方舟侧无法拉取 localhost/127.0.0.1。
 */
export async function getPanoramaEquirectangularGuideDataUrl(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  if (cachedGuideDataUrl) return cachedGuideDataUrl;
  try {
    const res = await fetch(`${window.location.origin}${PANORAMA_EQUIRECTANGULAR_GUIDE_PUBLIC_PATH}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const svgBlob = await res.blob();
    const svgUrl = URL.createObjectURL(svgBlob);
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error('全景引导图解码失败'));
        element.src = svgUrl;
      });
      const canvas = document.createElement('canvas');
      canvas.width = 2048;
      canvas.height = 1024;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('浏览器不支持 Canvas 2D');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      cachedGuideDataUrl = canvas.toDataURL('image/png');
    } finally {
      URL.revokeObjectURL(svgUrl);
    }
    return cachedGuideDataUrl;
  } catch (e) {
    console.warn('[panorama] 内置全景引导线图加载失败', e);
    return null;
  }
}
