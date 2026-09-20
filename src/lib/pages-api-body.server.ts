import type { NextApiRequest, NextApiResponse } from 'next';

const DEFAULT_LIMIT_BYTES = 64 * 1024 * 1024;

export class ApiBodyError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'ApiBodyError';
    this.statusCode = statusCode;
  }
}

/**
 * Electron utility processes do not reliably support Next's Pages API body parser.
 * Read JSON directly from the IncomingMessage so packaged and development builds
 * use the same request-body path.
 */
export async function readPagesApiJsonBody<T = Record<string, unknown>>(
  req: NextApiRequest,
  limitBytes = DEFAULT_LIMIT_BYTES,
): Promise<T> {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      try {
        return JSON.parse(req.body) as T;
      } catch {
        throw new ApiBodyError('Invalid JSON body');
      }
    }
    return req.body as T;
  }

  const contentLength = Number(req.headers['content-length'] || 0);
  if (Number.isFinite(contentLength) && contentLength > limitBytes) {
    throw new ApiBodyError('Request body is too large', 413);
  }

  const raw = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    let settled = false;

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    req.on('data', (chunk: Buffer | string) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      received += buffer.length;
      if (received > limitBytes) {
        fail(new ApiBodyError('Request body is too large', 413));
        return;
      }
      chunks.push(buffer);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    req.on('error', (error) => fail(error instanceof Error ? error : new Error(String(error))));
    req.on('aborted', () => fail(new ApiBodyError('Request body was aborted')));
  });

  if (raw.length === 0) return {} as T;

  try {
    return JSON.parse(raw.toString('utf8')) as T;
  } catch {
    throw new ApiBodyError('Invalid JSON body');
  }
}

export function pagesApiBodyErrorStatus(error: unknown): number {
  return error instanceof ApiBodyError ? error.statusCode : 500;
}

export async function preparePagesApiJsonBody(
  req: NextApiRequest,
  res: NextApiResponse,
  limitBytes = DEFAULT_LIMIT_BYTES,
): Promise<boolean> {
  try {
    req.body = await readPagesApiJsonBody(req, limitBytes);
    return true;
  } catch (error) {
    res.status(pagesApiBodyErrorStatus(error)).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Invalid request body',
    });
    return false;
  }
}
