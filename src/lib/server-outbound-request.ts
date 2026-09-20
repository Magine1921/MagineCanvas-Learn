import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const LOCAL_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home', '.home.arpa'];

export interface OutboundRequestOptions {
  allowedProtocols?: readonly string[];
  isAllowedUrl?: (url: URL) => boolean;
  maxRedirects?: number;
  resolveHostname?: (hostname: string) => Promise<readonly string[]>;
  fetchImpl?: typeof fetch;
}

function normalizedHostname(hostname: string): string {
  return hostname.trim().replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
}

function isNonPublicIpv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b, c] = octets;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224;
}

function expandIpv6(address: string): number[] | null {
  let value = address.toLowerCase().split('%')[0];
  if (value.includes('.')) {
    const lastColon = value.lastIndexOf(':');
    const ipv4 = value.slice(lastColon + 1);
    if (isIP(ipv4) !== 4) return null;
    const parts = ipv4.split('.').map(Number);
    value = `${value.slice(0, lastColon)}:${((parts[0] << 8) | parts[1]).toString(16)}:${((parts[2] << 8) | parts[3]).toString(16)}`;
  }

  const halves = value.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const words = [...left, ...Array(missing).fill('0'), ...right].map((word) => Number.parseInt(word || '0', 16));
  return words.length === 8 && words.every((word) => Number.isInteger(word) && word >= 0 && word <= 0xffff)
    ? words
    : null;
}

function isNonPublicIpv6(address: string): boolean {
  const words = expandIpv6(address);
  if (!words) return true;
  const [first, second] = words;
  const unspecifiedOrLoopback = words.slice(0, 7).every((word) => word === 0) && (words[7] === 0 || words[7] === 1);
  return unspecifiedOrLoopback
    || first === 0
    || (first & 0xfe00) === 0xfc00
    || (first & 0xffc0) === 0xfe80
    || (first & 0xff00) === 0xff00
    || (first === 0x0064 && second === 0xff9b)
    || first === 0x2002
    || (first === 0x2001 && second === 0x0db8)
    || (first === 0x2001 && second === 0x0002);
}

export function isNonPublicIpAddress(address: string): boolean {
  const version = isIP(address.split('%')[0]);
  if (version === 4) return isNonPublicIpv4(address);
  if (version === 6) return isNonPublicIpv6(address);
  return true;
}

export function assertSafeOutboundUrl(
  rawUrl: string | URL,
  options: Pick<OutboundRequestOptions, 'allowedProtocols' | 'isAllowedUrl'> = {},
  baseUrl?: string | URL,
): URL {
  let url: URL;
  try {
    url = rawUrl instanceof URL
      ? new URL(rawUrl.toString())
      : baseUrl
        ? new URL(rawUrl, baseUrl)
        : new URL(rawUrl);
  } catch {
    throw new Error('Invalid outbound URL.');
  }

  const allowedProtocols = options.allowedProtocols || ['https:'];
  if (!allowedProtocols.includes(url.protocol)) {
    throw new Error(`Outbound protocol is not allowed: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new Error('Credential-bearing outbound URLs are not allowed.');
  }

  const hostname = normalizedHostname(url.hostname);
  if (
    !hostname
    || hostname === 'localhost'
    || hostname === 'metadata'
    || hostname === 'metadata.google.internal'
    || hostname === 'instance-data'
    || LOCAL_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    throw new Error('Local or private outbound hosts are not allowed.');
  }
  // URL canonicalization also turns legacy numeric IPv4 forms into an IP literal.
  // Reject every literal, including public IPs, so allowlists remain hostname based.
  if (isIP(hostname) !== 0) {
    throw new Error('IP-literal outbound URLs are not allowed.');
  }
  if (options.isAllowedUrl && !options.isAllowedUrl(url)) {
    throw new Error(`Outbound host is not allowlisted: ${hostname}`);
  }
  return url;
}

async function defaultResolveHostname(hostname: string): Promise<readonly string[]> {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

export async function assertPublicDnsResolution(
  url: URL,
  resolveHostname: OutboundRequestOptions['resolveHostname'] = defaultResolveHostname,
): Promise<void> {
  const addresses = await resolveHostname(url.hostname);
  if (addresses.length === 0) throw new Error(`Outbound host did not resolve: ${url.hostname}`);
  const unsafeAddress = addresses.find(isNonPublicIpAddress);
  if (unsafeAddress) {
    throw new Error(`Outbound host resolved to a non-public address: ${url.hostname}`);
  }
}

function redirectRequestInit(init: RequestInit, status: number, from: URL, to: URL): RequestInit {
  const next: RequestInit = { ...init };
  const method = (next.method || 'GET').toUpperCase();
  if (status === 303 || ((status === 301 || status === 302) && method === 'POST')) {
    next.method = 'GET';
    delete next.body;
  }
  if (from.origin !== to.origin && next.headers) {
    const headers = new Headers(next.headers);
    for (const name of ['authorization', 'proxy-authorization', 'cookie', 'x-api-key', 'x-goog-api-key', 'x-elevenlabs-api-key']) {
      headers.delete(name);
    }
    next.headers = headers;
  }
  return next;
}

export async function fetchSafeOutboundUrl(
  rawUrl: string | URL,
  init: RequestInit = {},
  options: OutboundRequestOptions = {},
): Promise<Response> {
  const maxRedirects = options.maxRedirects ?? 3;
  const fetchImpl = options.fetchImpl || fetch;
  let url = assertSafeOutboundUrl(rawUrl, options);
  let requestInit: RequestInit = { ...init };

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    await assertPublicDnsResolution(url, options.resolveHostname);
    const response = await fetchImpl(url, { ...requestInit, redirect: 'manual' });
    if (!REDIRECT_STATUSES.has(response.status)) return response;
    const location = response.headers.get('location');
    if (!location) throw new Error('Redirect response did not include a location.');
    const nextUrl = assertSafeOutboundUrl(location, options, url);
    requestInit = redirectRequestInit(requestInit, response.status, url, nextUrl);
    url = nextUrl;
  }
  throw new Error('Too many outbound redirects.');
}

export function parseServerHostAllowlist(raw: string | undefined): Set<string> {
  const hosts = new Set<string>();
  for (const entry of (raw || '').split(/[,;\s]+/)) {
    const value = entry.trim().toLowerCase();
    if (!value) continue;
    try {
      const hostname = normalizedHostname(value.includes('://') ? new URL(value).hostname : value.split('/')[0].split(':')[0]);
      if (hostname && isIP(hostname) === 0) hosts.add(hostname);
    } catch {
      // Invalid server configuration is ignored instead of widening access.
    }
  }
  return hosts;
}
