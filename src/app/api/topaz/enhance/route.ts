import { NextRequest, NextResponse } from 'next/server';
import {
  createKieTopazTask,
  materializeKieInput,
  normalizeKieUpscaleFactor,
  pollKieTopazTask,
  resolveKieTopazRequestedFactors,
} from '@/lib/kie-topaz.server';
import {
  consumeWebTrialGeneration,
  trialLimitErrorBody,
} from '@/lib/web-trial-generation-limit.server';

export const runtime = 'nodejs';
export const maxDuration = 1200;

type TopazAttempt = {
  factor: number;
  inputIndex: number;
  taskId?: string;
  error?: string;
};

const TOPAZ_CLOUD_TIMEOUT_MS = 20 * 60_000;

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : fallback;
}

function isRetryableTopazTaskError(message: string): boolean {
  return /code=(500|524)|state=fail|internal error|generate task timeout|timed out|timeout|fetch failed|network|socket|terminated|ECONN|UND_ERR/i.test(
    message,
  );
}

function summarizeAttempts(attempts: TopazAttempt[]): string {
  return attempts
    .map((attempt) => {
      const target = `${attempt.factor}x/URL${attempt.inputIndex}`;
      const task = attempt.taskId ? ` ${attempt.taskId}` : '';
      const error = attempt.error ? ` ${attempt.error}` : '';
      return `${target}${task}${error}`;
    })
    .join('; ');
}

function topazLog(phase: string, data: Record<string, unknown>): void {
  console.info(`[api/topaz/enhance] ${phase} ${JSON.stringify(data)}`);
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return { message: String(error) };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'Request body must be JSON' }, { status: 400 });
  }

  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const apiUrl = typeof body.apiUrl === 'string' ? body.apiUrl.trim() : '';
  const kind = body.kind === 'video' ? 'video' : body.kind === 'image' ? 'image' : null;
  const inputUrl = typeof body.inputUrl === 'string' ? body.inputUrl.trim() : '';

  if (!apiKey) {
    return NextResponse.json({ ok: false, error: 'Missing Topaz/Kie API Key' }, { status: 400 });
  }
  if (!kind) {
    return NextResponse.json({ ok: false, error: 'kind must be image or video' }, { status: 400 });
  }
  if (!inputUrl) {
    return NextResponse.json({ ok: false, error: 'Missing input URL' }, { status: 400 });
  }

  const trialLimit = await consumeWebTrialGeneration(apiKey);
  if (!trialLimit.allowed) {
    const errorBody = trialLimitErrorBody(trialLimit);
    return NextResponse.json(errorBody, {
      status: errorBody.error === 'WEB_TRIAL_DAILY_LIMIT' ? 429 : 503,
      headers: {
        'Cache-Control': 'no-store',
        'Retry-After': String(trialLimit.retryAfterSeconds),
        'X-Magine-Trial-Limit': String(trialLimit.limit),
        'X-Magine-Trial-Remaining': String(trialLimit.remaining),
      },
    });
  }

  const attempts: TopazAttempt[] = [];
  let inputMeta: Record<string, unknown> | undefined;
  const startedAt = Date.now();

  try {
    const requestedUpscaleFactor = normalizeKieUpscaleFactor(body.upscaleFactor, kind);
    topazLog('start', { kind, requestedUpscaleFactor });
    let materialized;
    try {
      materialized = await materializeKieInput({
        apiKey,
        inputUrl,
        kind,
        requestUrl: req.url,
      });
    } catch (materializeError) {
      const materializeMessage = errorMessage(materializeError, 'Topaz input upload failed');
      topazLog('materializeFailed', {
        kind,
        reason: materializeMessage,
        elapsedMs: Date.now() - startedAt,
      });
      throw new Error(materializeMessage);
    }
    inputMeta = {
      width: materialized.width,
      height: materialized.height,
      byteLength: materialized.byteLength,
      contentType: materialized.contentType,
    };
    topazLog('materialized', {
      kind,
      width: materialized.width,
      height: materialized.height,
      byteLength: materialized.byteLength,
      contentType: materialized.contentType,
      elapsedMs: Date.now() - startedAt,
    });
    const inputUrls = [materialized.url, ...materialized.alternateUrls].filter(Boolean);
    const factors = resolveKieTopazRequestedFactors(requestedUpscaleFactor, kind, materialized);
    const cloudInputUrls = kind === 'image' ? inputUrls.slice(0, 1) : inputUrls;
    const cloudFactors = kind === 'image' ? factors.slice(0, 1) : factors;
    let lastError: unknown = null;

    for (const upscaleFactor of cloudFactors) {
      for (let inputIndex = 0; inputIndex < cloudInputUrls.length; inputIndex += 1) {
        const inputForAttempt = cloudInputUrls[inputIndex];
        const attempt: TopazAttempt = { factor: upscaleFactor, inputIndex: inputIndex + 1 };
        attempts.push(attempt);

        try {
          topazLog('createTask', {
            kind,
            factor: upscaleFactor,
            inputIndex: inputIndex + 1,
            elapsedMs: Date.now() - startedAt,
          });
          const task = await createKieTopazTask({
            apiKey,
            apiUrl,
            kind,
            inputUrl: inputForAttempt,
            upscaleFactor,
          });
          attempt.taskId = task.taskId;
          topazLog('taskCreated', {
            kind,
            factor: upscaleFactor,
            taskId: task.taskId,
            elapsedMs: Date.now() - startedAt,
          });

          const result = await pollKieTopazTask({
            apiKey,
            apiUrl,
            taskId: task.taskId,
            timeoutMs: TOPAZ_CLOUD_TIMEOUT_MS,
          });
          topazLog('completed', {
            kind,
            taskId: task.taskId,
            elapsedMs: Date.now() - startedAt,
          });

          return NextResponse.json({
            ok: true,
            outputUrl: result.outputUrl,
            taskId: task.taskId,
            progress: result.progress ?? 100,
            creditCost: result.creditsConsumed,
            inputUrl: inputForAttempt,
            requestedUpscaleFactor,
            usedUpscaleFactor: upscaleFactor,
            attempts,
            inputMeta,
            raw: result.raw,
          });
        } catch (error) {
          const message = errorMessage(error, 'Topaz enhance failed');
          attempt.error = message;
          lastError = error;
          if (!isRetryableTopazTaskError(message)) {
            throw new Error(message);
          }
        }
      }
    }

    const finalMessage = errorMessage(lastError, 'Topaz enhance failed');
    const tried = summarizeAttempts(attempts);
    const meta =
      inputMeta && (inputMeta.width || inputMeta.height || inputMeta.byteLength)
        ? `input=${inputMeta.width || '?'}x${inputMeta.height || '?'} ${inputMeta.byteLength || '?'} bytes`
        : '';
    throw new Error([finalMessage, meta, tried ? `tried ${tried}` : ''].filter(Boolean).join('; '));
  } catch (error) {
    console.error(
      `[api/topaz/enhance] failed ${JSON.stringify({
        error: serializeError(error),
        attempts,
        inputMeta,
      })}`,
    );
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Topaz enhance failed',
        attempts,
        inputMeta,
      },
      { status: 502 },
    );
  }
}
