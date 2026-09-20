type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined;
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

export function extractKieResponsesFailure(
  payload: UnknownRecord,
  eventType = '',
): string | null {
  const response = asRecord(payload.response);
  const error = asRecord(payload.error) || asRecord(response?.error);
  const incompleteDetails = asRecord(response?.incomplete_details)
    || asRecord(payload.incomplete_details);
  const type = firstText(payload.type, eventType).toLowerCase();
  const status = firstText(payload.status, response?.status).toLowerCase();
  const failed = type === 'error'
    || type.includes('response.error')
    || type.includes('response.failed')
    || status === 'failed';
  const incomplete = type.includes('response.incomplete') || status === 'incomplete';

  if (!failed && !incomplete) return null;

  const message = firstText(
    error?.message,
    error?.detail,
    payload.error,
    payload.message,
    payload.detail,
    incompleteDetails?.reason,
    response?.status_details,
  );
  const code = firstText(error?.code, payload.code, response?.error_code);
  const prefix = incomplete ? 'Kie Responses 任务未完成' : 'Kie Responses 任务失败';
  const codeText = code ? `（${code}）` : '';
  return `${prefix}${codeText}：${message || '云端没有返回具体失败原因'}`;
}
