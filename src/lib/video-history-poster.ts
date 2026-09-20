import { captureVideoFrameDataUrl } from '@/lib/material-import-from-file';
import {
  materialDiskPlayableUrl,
  resolveMaterialPlayableUrl,
} from '@/lib/material-disk-playable-url';
import { persistImageToMaterialCache } from '@/lib/persist-generated-media';

const MAX_POSTER_REPAIRS = 2;

type PosterRepairTask = {
  run: () => Promise<string>;
  resolve: (value: string) => void;
  reject: (reason?: unknown) => void;
};

const repairQueue: PosterRepairTask[] = [];
const repairsInFlight = new Map<string, Promise<string>>();
let activePosterRepairs = 0;

function versionedMediaUrl(url: string): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}v=${Date.now()}`;
}

async function cacheEntryExists(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    return response.ok;
  } catch {
    return false;
  }
}

function drainPosterRepairQueue(): void {
  while (activePosterRepairs < MAX_POSTER_REPAIRS && repairQueue.length > 0) {
    const task = repairQueue.shift();
    if (!task) return;
    activePosterRepairs += 1;
    void task.run()
      .then(task.resolve, task.reject)
      .finally(() => {
        activePosterRepairs = Math.max(0, activePosterRepairs - 1);
        drainPosterRepairQueue();
      });
  }
}

function enqueuePosterRepair(run: () => Promise<string>): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    repairQueue.push({ run, resolve, reject });
    drainPosterRepairQueue();
  });
}

export interface VideoHistoryPosterRepairOptions {
  cacheKey: string;
  videoUrl: string;
  force?: boolean;
}

/**
 * Restores one durable history poster. Desktop builds use bundled FFmpeg first;
 * browsers fall back to a hidden video/canvas capture. Work is globally limited
 * so large canvases cannot start dozens of decoders at once.
 */
export function repairVideoHistoryPoster(
  options: VideoHistoryPosterRepairOptions,
): Promise<string> {
  const cacheKey = options.cacheKey.trim();
  const videoUrl = options.videoUrl.trim();
  if (!cacheKey || !videoUrl) return Promise.reject(new Error('video poster source is empty'));

  const repairKey = `${cacheKey}|${videoUrl}`;
  const existing = repairsInFlight.get(repairKey);
  if (existing) return existing;

  const promise = enqueuePosterRepair(async () => {
    const posterCacheKey = `${cacheKey}-poster`;
    const stablePosterUrl = materialDiskPlayableUrl(posterCacheKey, 'image');
    if (!options.force && await cacheEntryExists(stablePosterUrl)) {
      return stablePosterUrl;
    }

    const stableVideoUrl = materialDiskPlayableUrl(cacheKey, 'video');
    const sourceUrl = await cacheEntryExists(stableVideoUrl)
      ? stableVideoUrl
      : resolveMaterialPlayableUrl(videoUrl, 'video');

    let dataUrl = '';
    const desktopThumbnail = window.magineDesktop?.materialVideoThumbnail;
    if (desktopThumbnail) {
      try {
        const result = await desktopThumbnail({ sourceUrl, time: 0.5, maxEdge: 720 });
        dataUrl = result.dataUrl || '';
      } catch {
        dataUrl = '';
      }
    }

    if (!dataUrl) {
      const frame = await captureVideoFrameDataUrl(sourceUrl, 0.5, 720);
      dataUrl = frame.dataUrl;
    }
    if (!dataUrl) throw new Error('video poster frame is empty');

    const cached = await persistImageToMaterialCache(posterCacheKey, dataUrl);
    return cached ? versionedMediaUrl(stablePosterUrl) : dataUrl;
  });

  repairsInFlight.set(repairKey, promise);
  void promise.then(
    () => repairsInFlight.delete(repairKey),
    () => repairsInFlight.delete(repairKey),
  );
  return promise;
}
