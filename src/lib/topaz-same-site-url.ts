const LOCAL_LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

export function isLocalLoopbackHostname(hostname: string): boolean {
  return LOCAL_LOOPBACK_HOSTNAMES.has(hostname.toLowerCase());
}

/**
 * 协议与端口一致时，将 localhost / 127.0.0.1 / ::1 等视为同一站点。
 * 避免开发环境页面与接口 URL 主机名不一致导致「不同源」误判。
 */
export function isSameSiteUrlLoose(site: URL, candidate: URL): boolean {
  if (site.protocol !== candidate.protocol) return false;
  if (site.port !== candidate.port) return false;
  const a = site.hostname.toLowerCase();
  const b = candidate.hostname.toLowerCase();
  if (a === b) return true;
  if (isLocalLoopbackHostname(a) && isLocalLoopbackHostname(b)) return true;
  return false;
}
