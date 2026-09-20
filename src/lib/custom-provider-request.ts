'use client';

import type { ProviderConfig } from '@/components/seedance/SeedanceStore';
import { buildProxyHeaders, getProxyUrl } from '@/components/api/APIFactory';

export interface CustomProviderFetchOptions {
  targetUrl: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  omitContentType?: boolean;
  extraHeaders?: Record<string, string>;
  streaming?: boolean;
  signal?: AbortSignal;
}

/** 经服务端代理转发自定义提供商请求；目标域名必须由服务端环境白名单放行。 */
export async function customProviderFetch(
  provider: ProviderConfig,
  options: CustomProviderFetchOptions,
): Promise<Response> {
  const method = options.method || 'POST';
  const proxyUrl = getProxyUrl(provider);
  const headers: Record<string, string> = {
    ...buildProxyHeaders(provider, options.targetUrl, {
      omitContentType: options.omitContentType || method === 'GET',
      streaming: options.streaming || (typeof options.body === 'object' && options.body !== null && (options.body as { stream?: boolean }).stream === true),
    }),
    ...options.extraHeaders,
  };

  return fetch(proxyUrl, {
    method,
    headers,
    body:
      options.body != null && method !== 'GET'
        ? JSON.stringify(options.body)
        : undefined,
    cache: 'no-store',
    signal: options.signal,
  });
}

export async function customProviderFetchJson(
  provider: ProviderConfig,
  options: CustomProviderFetchOptions,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown>; rawText: string }> {
  const response = await customProviderFetch(provider, options);
  const rawText = await response.text();
  let data: Record<string, unknown> = {};
  try {
    data = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
  } catch {
    data = { raw: rawText };
  }
  return { ok: response.ok, status: response.status, data, rawText };
}
