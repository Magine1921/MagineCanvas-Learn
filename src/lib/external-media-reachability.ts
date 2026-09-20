/**
 * 判断素材主机是否可能被公网云服务（如阿里云视觉）直接拉取。
 * 与「本站 staging 是否可被外网访问」同源判断，避免逻辑漂移。
 */

export function isHostLikelyUnreachableFromExternalService(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();
  if (!h) return true;
  if (h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h === '::1') return true;
  if (h.endsWith('.local')) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (/^198\.(18|19)\./.test(h)) return true;
  if (/^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./.test(h)) return true;
  if (h.includes(':')) {
    if (h.startsWith('fe80:')) return true;
    const first = h.split(':')[0] || '';
    if (first.startsWith('fc') || first.startsWith('fd')) return true;
  }
  return false;
}

export function publicOriginBlocksExternalStaging(origin: string): boolean {
  try {
    const u = new URL(origin);
    return isHostLikelyUnreachableFromExternalService(u.hostname);
  } catch {
    return true;
  }
}
