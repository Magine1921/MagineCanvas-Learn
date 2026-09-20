/** Dreamina CLI JSON 响应解析（客户端/服务端共用，无 'use client'） */

const VIDEO_URL_KEYS = [
  'video_url',
  'play_url',
  'media_url',
  'download_url',
  'output_url',
  'result_url',
  'url',
  'video',
  'data_url',
];
const LOCAL_VIDEO_PATH_KEYS = [
  'local_path',
  'file_path',
  'local_file',
  'download_path',
  'output_path',
  'save_path',
  'path',
  'video_path',
];
const LOCAL_IMAGE_PATH_KEYS = [
  'image_path',
  'local_path',
  'file_path',
  'local_file',
  'download_path',
  'output_path',
  'save_path',
  'path',
];
const COVER_URL_KEYS = ['cover_url', 'poster_url', 'thumbnail_url', 'thumb_url', 'cover', 'poster', 'thumbnail'];
const IMAGE_URL_KEYS = [
  'image_url',
  'image',
  'media_url',
  'download_url',
  'output_url',
  'result_url',
  'url',
  'data_url',
];
const NESTED_RESULT_KEYS = ['data', 'result', 'result_json', 'response', 'output', 'outputs', 'payload'];
const IMAGE_ARRAY_KEYS = ['images', 'items', 'files'];
const VIDEO_ARRAY_KEYS = ['videos', 'items', 'files'];
const MEDIA_ARRAY_KEYS = ['images', 'videos', 'items', 'files'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function collectCandidateRecords(
  value: unknown,
  records: Record<string, unknown>[] = [],
  seen = new Set<object>(),
  depth = 0,
  arrayKeys: readonly string[] = MEDIA_ARRAY_KEYS,
): Record<string, unknown>[] {
  if (depth > 6 || value == null) return records;

  if (Array.isArray(value)) {
    for (const item of value) collectCandidateRecords(item, records, seen, depth + 1, arrayKeys);
    return records;
  }

  if (!isRecord(value)) return records;
  if (seen.has(value)) return records;
  seen.add(value);
  records.push(value);

  for (const key of NESTED_RESULT_KEYS) {
    collectCandidateRecords(value[key], records, seen, depth + 1, arrayKeys);
  }
  for (const key of arrayKeys) {
    collectCandidateRecords(value[key], records, seen, depth + 1, arrayKeys);
  }

  return records;
}

function pickUrlFromRecord(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const v = record[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function normalizeImageItem(item: unknown): { image_url: string; size?: string } | null {
  if (!item || typeof item !== 'object') return null;
  const record = item as Record<string, unknown>;
  const url = pickUrlFromRecord(record, IMAGE_URL_KEYS) || pickUrlFromRecord(record, LOCAL_IMAGE_PATH_KEYS);
  if (!url) return null;
  return {
    image_url: url,
    size: typeof record.size === 'string' ? record.size : undefined,
  };
}

export function extractImagesFromResult(
  result: Record<string, unknown>,
): Array<{ image_url: string; size?: string }> {
  const items: Array<{ image_url: string; size?: string }> = [];
  const pushUnique = (item: { image_url: string; size?: string }) => {
    if (!items.some((existing) => existing.image_url === item.image_url)) {
      items.push(item);
    }
  };

  for (const record of collectCandidateRecords(result, [], new Set<object>(), 0, IMAGE_ARRAY_KEYS)) {
    if (Array.isArray(record.images)) {
      for (const item of record.images) {
        const normalized = normalizeImageItem(item);
        if (normalized) pushUnique(normalized);
      }
    }
  }

  if (items.length > 0) return items;

  for (const record of collectCandidateRecords(result, [], new Set<object>(), 0, IMAGE_ARRAY_KEYS)) {
    const single = pickUrlFromRecord(record, IMAGE_URL_KEYS) || pickUrlFromRecord(record, LOCAL_IMAGE_PATH_KEYS);
    if (single) return [{ image_url: single }];
  }

  return [];
}

export function extractVideoUrl(result: Record<string, unknown>): string | undefined {
  for (const record of collectCandidateRecords(result, [], new Set<object>(), 0, VIDEO_ARRAY_KEYS)) {
    const url = pickUrlFromRecord(record, VIDEO_URL_KEYS);
    if (url) return url;
  }

  return extractLocalVideoPath(result);
}

export function extractLocalVideoPath(result: Record<string, unknown>): string | undefined {
  for (const record of collectCandidateRecords(result, [], new Set<object>(), 0, VIDEO_ARRAY_KEYS)) {
    const path = pickUrlFromRecord(record, LOCAL_VIDEO_PATH_KEYS);
    if (path) return path;
  }

  return undefined;
}

export function extractLocalImagePath(result: Record<string, unknown>): string | undefined {
  for (const record of collectCandidateRecords(result, [], new Set<object>(), 0, IMAGE_ARRAY_KEYS)) {
    const path = pickUrlFromRecord(record, LOCAL_IMAGE_PATH_KEYS);
    if (path) return path;
  }

  return undefined;
}

export function extractCoverUrl(result: Record<string, unknown>): string | undefined {
  for (const record of collectCandidateRecords(result, [], new Set<object>(), 0, VIDEO_ARRAY_KEYS)) {
    const url = pickUrlFromRecord(record, COVER_URL_KEYS);
    if (url) return url;
  }
  return undefined;
}

export function extractImageUrl(result: Record<string, unknown>): string | undefined {
  return extractImagesFromResult(result)[0]?.image_url;
}

export function extractTaskId(result: Record<string, unknown>): string | undefined {
  for (const record of collectCandidateRecords(result)) {
    const id = record['submit_id'] || record['task_id'] || record['taskId'] || record['id'];
    if (typeof id === 'string' && id.trim()) return id.trim();
  }
  return undefined;
}
