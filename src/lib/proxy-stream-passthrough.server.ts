import type { NextApiResponse } from 'next';

export function requestWantsStream(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false;
  return (body as { stream?: boolean }).stream === true;
}

export function responseIsEventStream(response: Response): boolean {
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  return (
    contentType.includes('text/event-stream') ||
    contentType.includes('application/stream+json') ||
    contentType.includes('text/plain') && contentType.includes('stream')
  );
}

export function applyProxyCorsHeaders(res: NextApiResponse, allowHeaders: string): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', allowHeaders);
}

export async function pipeFetchResponseToClient(
  response: Response,
  res: NextApiResponse
): Promise<void> {
  res.status(response.status);

  const contentType = response.headers.get('content-type');
  if (contentType) {
    res.setHeader('Content-Type', contentType);
  } else {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  }

  const cacheControl = response.headers.get('cache-control');
  res.setHeader('Cache-Control', cacheControl || 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof (res as NodeJS.WritableStream & { flushHeaders?: () => void }).flushHeaders === 'function') {
    (res as NodeJS.WritableStream & { flushHeaders: () => void }).flushHeaders();
  }

  const body = response.body;
  if (!body) {
    res.end();
    return;
  }

  const reader = body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      if (!res.write(chunk)) {
        await new Promise<void>((resolve) => res.once('drain', resolve));
      }
      const flushable = res as NodeJS.WritableStream & { flush?: () => void };
      if (typeof flushable.flush === 'function') {
        flushable.flush();
      }
    }
  } finally {
    reader.releaseLock();
  }
  res.end();
}

export async function maybePipeStreamingResponse(
  response: Response,
  res: NextApiResponse,
  opts: { wantsStream: boolean; allowHeaders: string }
): Promise<boolean> {
  const shouldPipe =
    (opts.wantsStream && response.ok && response.body) || responseIsEventStream(response);

  if (!shouldPipe) return false;

  applyProxyCorsHeaders(res, opts.allowHeaders);
  await pipeFetchResponseToClient(response, res);
  return true;
}
