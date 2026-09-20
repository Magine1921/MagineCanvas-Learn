import {
  assertSafeOutboundUrl,
  fetchSafeOutboundUrl,
} from './server-outbound-request.ts';

export function assertSafeAgentWebUrl(rawUrl: string, baseUrl?: string): URL {
  return assertSafeOutboundUrl(rawUrl, {
    allowedProtocols: ['http:', 'https:'],
  }, baseUrl);
}

export async function fetchSafeAgentWebUrl(
  rawUrl: string,
  init: RequestInit = {},
  maxRedirects = 3,
): Promise<Response> {
  return fetchSafeOutboundUrl(rawUrl, init, {
    allowedProtocols: ['http:', 'https:'],
    maxRedirects,
  });
}

export async function readAgentWebResponseText(
  response: Response,
  maxBytes = 2_000_000,
): Promise<string> {
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (contentType && !/(text|json|xml|html|javascript)/.test(contentType)) {
    throw new Error(`Unsupported response content type: ${contentType}`);
  }
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > maxBytes) throw new Error('Response is too large.');
  if (!response.body) return '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new Error('Response exceeded the allowed size.');
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}
