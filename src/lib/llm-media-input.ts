export type LlmMediaKind = 'image' | 'audio' | 'video' | 'document';

export interface LlmMediaInput {
  kind: LlmMediaKind;
  url: string;
  name?: string;
  mimeType?: string;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mpeg: 'video/mpeg',
  mpg: 'video/mpeg',
  avi: 'video/x-msvideo',
  wmv: 'video/x-ms-wmv',
  '3gp': 'video/3gpp',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export function mediaMimeType(media: LlmMediaInput): string {
  const explicit = media.mimeType?.trim();
  if (explicit) return explicit;
  const dataMatch = /^data:([^;,]+)/i.exec(media.url.trim());
  if (dataMatch?.[1]) return dataMatch[1].trim();
  const clean = media.url.split(/[?#]/, 1)[0] || '';
  const extension = clean.split('.').pop()?.toLowerCase() || '';
  if (MIME_BY_EXTENSION[extension]) return MIME_BY_EXTENSION[extension];
  if (media.kind === 'document') return 'application/octet-stream';
  return `${media.kind}/${media.kind === 'image' ? 'png' : media.kind === 'audio' ? 'mpeg' : 'mp4'}`;
}

export function mergeLlmMediaInputs(
  mediaInputs?: LlmMediaInput[],
  imageUrls?: string[],
): LlmMediaInput[] {
  const merged: LlmMediaInput[] = [];
  const seen = new Set<string>();
  for (const media of mediaInputs || []) {
    const url = media.url.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    merged.push({ ...media, url });
  }
  for (const value of imageUrls || []) {
    const url = value.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    merged.push({ kind: 'image', url });
  }
  return merged;
}
