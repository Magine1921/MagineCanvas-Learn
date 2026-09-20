/** 从阿里云 Tea / OpenAPI SDK 异常中提取可读信息。 */
export function formatAliyunApiError(e: unknown): string {
  if (e instanceof Error && e.message) {
    const err = e as Error & {
      code?: string;
      data?: { Code?: string; Message?: string; Recommend?: string };
    };
    const code = err.code || err.data?.Code || '';
    const msg = err.data?.Message || err.message;
    const base = code ? `${code}: ${msg}` : msg;

    if (String(code) === 'InvalidVersion' || String(msg).includes('Version is not valid')) {
      return `${base}。图像超分请使用 Endpoint「imageenhan.cn-shanghai.aliyuncs.com」，勿填 videoenhan 或其它产品域名。`;
    }
    return base;
  }
  return String(e);
}
