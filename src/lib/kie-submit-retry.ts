export interface KieSubmissionResponse {
  ok: boolean;
  status: number;
  rawText: string;
}

const DEFAULT_KIE_SUBMISSION_RETRY_DELAYS_MS = [750, 1500, 3000] as const;

export function isRetryableKieSubmissionResponse(
  status: number,
  rawText = '',
): boolean {
  if (status === 408 || status === 502 || status === 503 || status === 504) return true;
  return status === 0 && /fetch failed|failed to fetch|network|timeout|timed out|ECONN|ETIMEDOUT|UND_ERR/i.test(rawText);
}

export function isRetryableKieSubmissionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /HTTP 408|HTTP 502|HTTP 503|HTTP 504|fetch failed|failed to fetch|network|timeout|timed out|ECONN|ETIMEDOUT|UND_ERR/i.test(message);
}

export async function retryKieSubmission<T extends KieSubmissionResponse>(
  request: () => Promise<T>,
  options: {
    delaysMs?: readonly number[];
    wait?: (delayMs: number) => Promise<void>;
  } = {},
): Promise<T> {
  const delaysMs = options.delaysMs || DEFAULT_KIE_SUBMISSION_RETRY_DELAYS_MS;
  const wait = options.wait || ((delayMs: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  }));

  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await request();
      if (
        response.ok
        || !isRetryableKieSubmissionResponse(response.status, response.rawText)
        || attempt >= delaysMs.length
      ) {
        return response;
      }
    } catch (error) {
      if (!isRetryableKieSubmissionError(error) || attempt >= delaysMs.length) throw error;
    }
    await wait(delaysMs[attempt]);
  }
}
