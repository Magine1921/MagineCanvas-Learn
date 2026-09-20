export interface SaveMediaResult {
  ok: boolean;
  canceled: boolean;
  savedPath?: string;
}

function resolveDownloadUrl(sourceUrl: string): string {
  return new URL(sourceUrl, window.location.href).toString();
}

async function fetchMedia(sourceUrl: string): Promise<Blob> {
  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.blob();
}

async function saveWithBrowser(sourceUrl: string, suggestedName: string): Promise<SaveMediaResult> {
  const blob = await fetchMedia(sourceUrl);
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = suggestedName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  return { ok: true, canceled: false };
}

export async function saveMediaToDisk(
  sourceUrl: string,
  suggestedName: string,
): Promise<SaveMediaResult> {
  const trimmedUrl = sourceUrl.trim();
  if (!trimmedUrl) throw new Error('没有可下载的媒体文件');

  const resolvedUrl = resolveDownloadUrl(trimmedUrl);
  const desktopSave = window.magineDesktop?.saveMedia;
  if (!desktopSave) return saveWithBrowser(resolvedUrl, suggestedName);

  const request: {
    sourceUrl?: string;
    bytes?: Uint8Array;
    suggestedName: string;
    mimeType?: string;
  } = { suggestedName };

  if (/^(?:blob:|data:)/i.test(resolvedUrl)) {
    const blob = await fetchMedia(resolvedUrl);
    request.bytes = new Uint8Array(await blob.arrayBuffer());
    request.mimeType = blob.type;
  } else {
    request.sourceUrl = resolvedUrl;
  }

  const result = await desktopSave(request);
  if (!result.ok && !result.canceled) {
    throw new Error(result.error || '保存媒体文件失败');
  }
  return result;
}

export function showDownloadError(error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error || '未知错误');
  console.error('下载失败:', error);
  window.alert(`下载失败：${detail}`);
}
