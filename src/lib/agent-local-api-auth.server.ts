import { hasValidDesktopApiToken } from './desktop-api-token.server.ts';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export interface AgentLocalApiAuthOptions {
  production?: boolean;
  expectedToken?: string;
}

export interface AgentLocalApiAuthResult {
  ok: boolean;
  status: number;
  error?: string;
}

export function authorizeAgentLocalApiRequest(
  req: Request,
  options: AgentLocalApiAuthOptions = {},
): AgentLocalApiAuthResult {
  if (req.method !== 'POST') {
    return { ok: false, status: 405, error: 'Agent API only accepts POST requests' };
  }
  const contentType = (req.headers.get('content-type') || '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    return { ok: false, status: 415, error: 'Agent API requires application/json' };
  }

  let requestUrl: URL;
  let origin: URL;
  try {
    requestUrl = new URL(req.url);
    const rawOrigin = req.headers.get('origin');
    if (!rawOrigin || rawOrigin === 'null') throw new Error('missing origin');
    origin = new URL(rawOrigin);
  } catch {
    return { ok: false, status: 403, error: 'Agent API requires a valid same-origin request' };
  }

  const requestHostname = requestUrl.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const hostHeader = (req.headers.get('host') || '').toLowerCase();
  if (!LOOPBACK_HOSTS.has(requestHostname) || hostHeader !== requestUrl.host.toLowerCase()) {
    return { ok: false, status: 403, error: 'Agent API only accepts loopback requests' };
  }
  if (origin.origin !== requestUrl.origin) {
    return { ok: false, status: 403, error: 'Agent API requires an exact same-origin request' };
  }
  const fetchSite = (req.headers.get('sec-fetch-site') || '').toLowerCase();
  if (fetchSite && fetchSite !== 'same-origin') {
    return { ok: false, status: 403, error: 'Agent API rejected a cross-site request' };
  }

  const production = options.production ?? process.env.NODE_ENV === 'production';
  if (production) {
    const expectedToken = (options.expectedToken ?? process.env.MAGINE_AGENT_API_TOKEN ?? '').trim();
    if (!expectedToken) {
      return { ok: false, status: 403, error: 'Local Agent API is disabled outside the desktop client' };
    }
    if (!hasValidDesktopApiToken(req.headers, expectedToken)) {
      return { ok: false, status: 403, error: 'Invalid local Agent API token' };
    }
  }

  return { ok: true, status: 200 };
}
