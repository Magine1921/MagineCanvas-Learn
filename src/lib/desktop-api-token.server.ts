import { timingSafeEqual } from 'node:crypto';

export const DESKTOP_API_TOKEN_HEADER = 'x-magine-desktop-token';

type HeaderSource = Headers | Record<string, string | string[] | undefined>;

function readHeader(headers: HeaderSource, name: string): string {
  if (headers instanceof Headers) return headers.get(name) || '';
  const value = headers[name] ?? headers[name.toLowerCase()];
  return (Array.isArray(value) ? value[0] : value) || '';
}

export function hasValidDesktopApiToken(
  headers: HeaderSource,
  expectedToken = process.env.MAGINE_AGENT_API_TOKEN || '',
): boolean {
  const expected = expectedToken.trim();
  const received = readHeader(headers, DESKTOP_API_TOKEN_HEADER).trim();
  if (!expected || !received) return false;
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length
    && timingSafeEqual(expectedBuffer, receivedBuffer);
}
