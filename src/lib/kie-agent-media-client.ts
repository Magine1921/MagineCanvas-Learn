'use client';

import type { LlmMediaInput } from '@/lib/llm-media-input';

function isPublicRemoteUrl(value: string): boolean {
  try {
    const url = new URL(value, window.location.href);
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return (
      /^https?:$/i.test(url.protocol) &&
      url.origin !== window.location.origin &&
      host !== 'localhost' &&
      host !== '127.0.0.1' &&
      host !== '::1'
    );
  } catch {
    return false;
  }
}

async function uploadLocalMedia(
  apiKey: string,
  item: LlmMediaInput,
  signal?: AbortSignal,
): Promise<LlmMediaInput> {
  const source = await fetch(item.url, { cache: 'no-store', signal });
  if (!source.ok) {
    throw new Error(`无法读取素材“${item.name || item.kind}”（HTTP ${source.status}）`);
  }

  const blob = await source.blob();
  const form = new FormData();
  form.append('apiKey', apiKey);
  form.append('kind', item.kind);
  form.append('name', item.name || '');
  form.append('mimeType', item.mimeType || blob.type || 'application/octet-stream');
  form.append('file', blob, item.name || `${item.kind}-input`);

  const response = await fetch('/api/kie/agent-media', {
    method: 'POST',
    body: form,
    cache: 'no-store',
    signal,
  });
  const payload = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    media?: LlmMediaInput[];
    error?: string;
  };
  const uploaded = payload.media?.[0];
  if (!response.ok || !payload.ok || !uploaded?.url) {
    throw new Error(payload.error || `Kie 素材上传失败（HTTP ${response.status}）`);
  }
  return uploaded;
}

export async function materializeKieAgentMedia(params: {
  apiKey: string;
  media: LlmMediaInput[];
  signal?: AbortSignal;
}): Promise<LlmMediaInput[]> {
  const result: LlmMediaInput[] = [];
  for (const item of params.media.slice(0, 8)) {
    if (params.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (isPublicRemoteUrl(item.url)) {
      result.push(item);
      continue;
    }
    result.push(await uploadLocalMedia(params.apiKey, item, params.signal));
  }
  return result;
}
