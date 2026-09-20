export const DEFAULT_IMAGEENHAN_HOST = 'imageenhan.cn-shanghai.aliyuncs.com';
export const DEFAULT_VIDEOENHAN_HOST = 'videoenhan.cn-shanghai.aliyuncs.com';

export type ViapiEnhanProduct = 'imageenhan' | 'videoenhan';

/** 去掉协议、路径，只保留 host（VIAPI SDK 的 endpoint 须为纯域名）。 */
export function stripViapiEndpointHost(raw: string): string {
  let s = raw.trim();
  if (!s) return '';
  try {
    if (/^https?:\/\//i.test(s)) {
      s = new URL(s).host;
    } else if (s.includes('/')) {
      s = new URL(`https://${s}`).host;
    }
  } catch {
    s = s.replace(/^https?:\/\//i, '').split('/')[0] ?? s;
  }
  return s.trim();
}

/**
 * 校正 imageenhan / videoenhan 域名，避免误填另一产品线或带协议导致 InvalidVersion。
 */
export function sanitizeViapiEnhanEndpoint(
  raw: string | undefined,
  product: ViapiEnhanProduct,
  fallbackHost?: string
): string {
  const fallback =
    fallbackHost ||
    (product === 'imageenhan' ? DEFAULT_IMAGEENHAN_HOST : DEFAULT_VIDEOENHAN_HOST);
  const host = stripViapiEndpointHost(String(raw ?? ''));
  if (!host) return fallback;

  const lower = host.toLowerCase();
  if (product === 'imageenhan') {
    if (lower.includes('videoenhan')) return fallback;
    if (!lower.includes('imageenhan')) return fallback;
    return host;
  }
  if (lower.includes('imageenhan')) return fallback;
  if (!lower.includes('videoenhan')) return fallback;
  return host;
}
