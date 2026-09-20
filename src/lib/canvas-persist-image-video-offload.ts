import type { Edge, Node } from 'reactflow';
import type { CanvasNodeData } from '@/components/canvas/CanvasStore';
import {
  materialDiskPlayableUrl,
  isLocalFilesystemMediaPath,
} from '@/lib/material-disk-playable-url';
import {
  persistImageToMaterialCache,
  persistVideoToMaterialCache,
  generatedImageCacheKey,
  generatedVideoCacheKey,
} from '@/lib/persist-generated-media';

const DISK_REF_PREFIX = 'disk://magine/material/v1/';

function isImageVideoDiskRef(url: unknown): boolean {
  return typeof url === 'string' && url.startsWith(DISK_REF_PREFIX);
}

function imageVideoDiskRefToNodeId(ref: string): string {
  return ref.slice(DISK_REF_PREFIX.length);
}

function imageVideoNodeIdToDiskRef(nodeId: string): string {
  return `${DISK_REF_PREFIX}${nodeId}`;
}

function projectCacheMaterialNodeId(url: string): string | null {
  if (!url || !url.includes('/api/project-cache/material')) return null;
  try {
    const parsed = new URL(url, 'http://magine.local');
    if (parsed.pathname !== '/api/project-cache/material') return null;
    return parsed.searchParams.get('nodeId')?.trim() || null;
  } catch {
    return null;
  }
}

function needsOffload(url: string): boolean {
  if (!url) return false;
  if (isImageVideoDiskRef(url)) return false;
  if (projectCacheMaterialNodeId(url)) return true;
  return /^https?:\/\//i.test(url) || url.startsWith('data:') || isLocalFilesystemMediaPath(url);
}

function generatedVideoItemCacheKey(nodeId: string, item: Record<string, unknown>, index: number): string {
  const videoUrl = typeof item.videoUrl === 'string' ? item.videoUrl : '';
  const videoCacheId = projectCacheMaterialNodeId(videoUrl);
  if (videoCacheId) return videoCacheId;
  if (isImageVideoDiskRef(videoUrl)) return imageVideoDiskRefToNodeId(videoUrl);
  if (typeof item.cacheKey === 'string' && item.cacheKey.trim()) return item.cacheKey.trim();
  const posterUrl = typeof item.posterUrl === 'string' ? item.posterUrl : '';
  const posterCacheId = projectCacheMaterialNodeId(posterUrl);
  if (posterCacheId?.endsWith('-poster')) return posterCacheId.slice(0, -'-poster'.length);
  if (isImageVideoDiskRef(posterUrl)) {
    const posterDiskId = imageVideoDiskRefToNodeId(posterUrl);
    if (posterDiskId.endsWith('-poster')) return posterDiskId.slice(0, -'-poster'.length);
  }
  if (typeof item.id === 'string') {
    const match = /^generated-video-(\d+)$/.exec(item.id);
    if (match) return generatedVideoCacheKey(nodeId, Number(match[1]));
  }
  return generatedVideoCacheKey(nodeId, index);
}

async function offloadUrl(nodeId: string, url: string, mediaKind: 'image' | 'video' = 'image'): Promise<string> {
  const cacheNodeId = projectCacheMaterialNodeId(url);
  if (cacheNodeId) return imageVideoNodeIdToDiskRef(cacheNodeId);
  if (!needsOffload(url)) return url;
  const tryPersist = async (): Promise<boolean> => {
    if (mediaKind === 'video' || url.startsWith('data:video') ||
        (/^https?:\/\//i.test(url) && /\.(mp4|mov|webm|m4v)(\?|$)/i.test(url)) ||
        (isLocalFilesystemMediaPath(url) && /\.(mp4|mov|webm|m4v)(\?|$)/i.test(url))) {
      return persistVideoToMaterialCache(nodeId, url);
    }
    return persistImageToMaterialCache(nodeId, url);
  };
  const ok = await tryPersist();
  return ok ? imageVideoNodeIdToDiskRef(nodeId) : url;
}

function hydrateUrl(ref: string): string | null {
  if (!isImageVideoDiskRef(ref)) return null;
  const nodeId = imageVideoDiskRefToNodeId(ref);
  return materialDiskPlayableUrl(nodeId, 'image');
}

type ImageVideoMediaKind = 'image' | 'video';

function mediaItemKey(item: Record<string, unknown>, index: number): string {
  const id = typeof item.id === 'string' ? item.id.trim() : '';
  return id || String(index);
}

async function offloadMediaField(
  record: Record<string, unknown>,
  field: string,
  cacheKey: string,
  kind: ImageVideoMediaKind,
): Promise<void> {
  const url = typeof record[field] === 'string' ? record[field] : '';
  if (needsOffload(url)) {
    record[field] = await offloadUrl(cacheKey, url, kind);
  }
}

async function offloadMediaPair(
  record: Record<string, unknown>,
  displayField: string,
  sourceField: string,
  cacheKey: string,
  kind: ImageVideoMediaKind,
): Promise<void> {
  const displayUrl = typeof record[displayField] === 'string' ? record[displayField] : '';
  const sourceUrl = typeof record[sourceField] === 'string' ? record[sourceField] : '';

  await offloadMediaField(record, displayField, cacheKey, kind);

  if (sourceUrl && sourceUrl === displayUrl && typeof record[displayField] === 'string') {
    record[sourceField] = record[displayField];
  } else if (sourceUrl && !/^https?:\/\//i.test(sourceUrl) && needsOffload(sourceUrl)) {
    record[sourceField] = await offloadUrl(`${cacheKey}-source`, sourceUrl, kind);
  }
}

async function offloadMediaVersions(
  raw: unknown,
  cachePrefix: string,
  kind: ImageVideoMediaKind,
): Promise<unknown> {
  if (!Array.isArray(raw)) return raw;
  return Promise.all(raw.map(async (item, index) => {
    if (!item || typeof item !== 'object') return item;
    const next = { ...(item as Record<string, unknown>) };
    const key = `${cachePrefix}-${mediaItemKey(next, index)}`;
    await offloadMediaPair(next, 'url', 'sourceUrl', key, kind);
    await offloadMediaPair(
      next,
      'thumbnailUrl',
      'thumbnailSourceUrl',
      `${key}-thumbnail`,
      'image',
    );
    return next;
  }));
}

async function hydrateMediaField(
  record: Record<string, unknown>,
  field: string,
  kind: ImageVideoMediaKind,
): Promise<void> {
  const ref = typeof record[field] === 'string' ? record[field] : '';
  if (!isImageVideoDiskRef(ref)) return;
  if (kind === 'video') {
    record[field] = materialDiskPlayableUrl(imageVideoDiskRefToNodeId(ref), 'video');
    return;
  }
  const restored = hydrateUrl(ref);
  if (restored) record[field] = restored;
}

async function hydrateMediaVersions(
  raw: unknown,
  kind: ImageVideoMediaKind,
): Promise<unknown> {
  if (!Array.isArray(raw)) return raw;
  return Promise.all(raw.map(async (item) => {
    if (!item || typeof item !== 'object') return item;
    const next = { ...(item as Record<string, unknown>) };
    await hydrateMediaField(next, 'url', kind);
    await hydrateMediaField(next, 'sourceUrl', kind);
    await hydrateMediaField(next, 'thumbnailUrl', 'image');
    await hydrateMediaField(next, 'thumbnailSourceUrl', 'image');
    return next;
  }));
}

export async function offloadImageVideoForPersist(workflow: {
  nodes: Node<CanvasNodeData>[];
  edges: Edge[];
}): Promise<{ nodes: Node<CanvasNodeData>[]; edges: Edge[] }> {
  const nodes = await Promise.all(
    workflow.nodes.map(async (node) => {
      if (node.type === 'image') {
        const data = { ...(node.data as Record<string, unknown>) };

        // Offload active imageUrl
        const imageUrl = typeof data.imageUrl === 'string' ? data.imageUrl : '';
        if (needsOffload(imageUrl)) {
          data.imageUrl = await offloadUrl(node.id, imageUrl, 'image');
        }

        // Offload generatedImages
        const genImages = Array.isArray(data.generatedImages) ? [...data.generatedImages] : [];
        const offloadedGenImages = await Promise.all(
          genImages.map(async (item: Record<string, unknown>, i: number) => {
            const next = { ...item };
            const url = typeof next.imageUrl === 'string' ? next.imageUrl : '';
            if (needsOffload(url)) {
              const key = generatedImageCacheKey(node.id, i);
              next.imageUrl = await offloadUrl(key, url, 'image');
            }
            const thumb = typeof next.thumbnailUrl === 'string' ? next.thumbnailUrl : '';
            if (needsOffload(thumb)) {
              const key = generatedImageCacheKey(node.id, i) + '-thumb';
              next.thumbnailUrl = await offloadUrl(key, thumb, 'image');
            }
            return next;
          })
        );
        data.generatedImages = offloadedGenImages;

        return { ...node, data: data as unknown as CanvasNodeData };
      }

      if (node.type === 'video') {
        const data = { ...(node.data as Record<string, unknown>) };

        // Offload active videoUrl
        const videoUrl = typeof data.videoUrl === 'string' ? data.videoUrl : '';
        if (needsOffload(videoUrl)) {
          data.videoUrl = await offloadUrl(node.id, videoUrl, 'video');
        }

        // Offload generatedVideos
        const genVideos = Array.isArray(data.generatedVideos) ? [...data.generatedVideos] : [];
        const offloadedGenVideos = await Promise.all(
          genVideos.map(async (item: Record<string, unknown>, i: number) => {
            const next = { ...item };
            const key = generatedVideoItemCacheKey(node.id, next, i);
            next.cacheKey = key;
            const url = typeof next.videoUrl === 'string' ? next.videoUrl : '';
            if (needsOffload(url)) {
              next.videoUrl = await offloadUrl(key, url, 'video');
            }
            const poster = typeof next.posterUrl === 'string' ? next.posterUrl : '';
            if (needsOffload(poster)) {
              next.posterUrl = await offloadUrl(`${key}-poster`, poster, 'image');
            }
            return next;
          })
        );
        data.generatedVideos = offloadedGenVideos;

        return { ...node, data: data as unknown as CanvasNodeData };
      }

      if (node.type === 'faceCompliance') {
        const data = { ...(node.data as Record<string, unknown>) };

        const outputImageUrl = typeof data.outputImageUrl === 'string' ? data.outputImageUrl : '';
        if (needsOffload(outputImageUrl)) {
          data.outputImageUrl = await offloadUrl(node.id, outputImageUrl);
        }
        const inputImageUrl = typeof data.inputImageUrl === 'string' ? data.inputImageUrl : '';
        if (needsOffload(inputImageUrl)) {
          data.inputImageUrl = await offloadUrl(node.id + '-input', inputImageUrl);
        }

        const results = Array.isArray(data.processedResults) ? [...data.processedResults] : [];
        const offloadedResults = await Promise.all(
          results.map(async (item: Record<string, unknown>, i: number) => {
            const next = { ...item };
            const outUrl = typeof next.outputUrl === 'string' ? next.outputUrl : '';
            if (needsOffload(outUrl)) {
              next.outputUrl = await offloadUrl(`${node.id}-fc-${i}`, outUrl);
            }
            const inUrl = typeof next.inputUrl === 'string' ? next.inputUrl : '';
            if (needsOffload(inUrl)) {
              next.inputUrl = await offloadUrl(`${node.id}-fc-${i}-input`, inUrl);
            }
            return next;
          })
        );
        data.processedResults = offloadedResults;

        return { ...node, data: data as unknown as CanvasNodeData };
      }

      if (node.type === 'topazEnhance') {
        const data = { ...(node.data as Record<string, unknown>) };

        const outputImageUrl = typeof data.outputImageUrl === 'string' ? data.outputImageUrl : '';
        if (needsOffload(outputImageUrl)) {
          data.outputImageUrl = await offloadUrl(node.id, outputImageUrl, 'image');
        }

        const outputVideoUrl = typeof data.outputVideoUrl === 'string' ? data.outputVideoUrl : '';
        if (needsOffload(outputVideoUrl)) {
          data.outputVideoUrl = await offloadUrl(`${node.id}-video`, outputVideoUrl, 'video');
        }

        const imageHistory = Array.isArray(data.topazImageHistory) ? [...data.topazImageHistory] : [];
        data.topazImageHistory = await Promise.all(
          imageHistory.map(async (url, index) =>
            typeof url === 'string' && needsOffload(url)
              ? await offloadUrl(`${node.id}-topaz-img-${index}`, url, 'image')
              : url,
          ),
        );

        const videoHistory = Array.isArray(data.topazVideoHistory) ? [...data.topazVideoHistory] : [];
        data.topazVideoHistory = await Promise.all(
          videoHistory.map(async (url, index) =>
            typeof url === 'string' && needsOffload(url)
              ? await offloadUrl(`${node.id}-topaz-vid-${index}`, url, 'video')
              : url,
          ),
        );

        return { ...node, data: data as unknown as CanvasNodeData };
      }

      return node;
    })
  );
  return { edges: workflow.edges, nodes };
}

export async function hydrateImageVideoDiskRefs(
  nodes: Node<CanvasNodeData>[]
): Promise<Node<CanvasNodeData>[]> {
  return Promise.all(
    nodes.map(async (node) => {
      if (node.type === 'image') {
        const data = { ...(node.data as Record<string, unknown>) };

        const imageUrl = typeof data.imageUrl === 'string' ? data.imageUrl : '';
        if (isImageVideoDiskRef(imageUrl)) {
          const restored = hydrateUrl(imageUrl);
          if (restored) data.imageUrl = restored;
        }

        const genImages = Array.isArray(data.generatedImages) ? [...data.generatedImages] : [];
        const hydratedGenImages = await Promise.all(
          genImages.map(async (item: Record<string, unknown>) => {
            const next = { ...item };
            const url = typeof next.imageUrl === 'string' ? next.imageUrl : '';
            if (isImageVideoDiskRef(url)) {
              const restored = hydrateUrl(url);
              if (restored) next.imageUrl = restored;
            }
            const thumb = typeof next.thumbnailUrl === 'string' ? next.thumbnailUrl : '';
            if (isImageVideoDiskRef(thumb)) {
              const restored = hydrateUrl(thumb);
              if (restored) next.thumbnailUrl = restored;
            }
            return next;
          })
        );
        data.generatedImages = hydratedGenImages;

        return { ...node, data: data as unknown as CanvasNodeData };
      }

      if (node.type === 'video') {
        const data = { ...(node.data as Record<string, unknown>) };

        const videoUrl = typeof data.videoUrl === 'string' ? data.videoUrl : '';
        if (isImageVideoDiskRef(videoUrl)) {
          data.videoUrl = materialDiskPlayableUrl(imageVideoDiskRefToNodeId(videoUrl), 'video');
        }

        const genVideos = Array.isArray(data.generatedVideos) ? [...data.generatedVideos] : [];
        const hydratedGenVideos = await Promise.all(
          genVideos.map(async (item: Record<string, unknown>, i: number) => {
            const next = { ...item };
            const key = generatedVideoItemCacheKey(node.id, next, i);
            next.cacheKey = key;
            const url = typeof next.videoUrl === 'string' ? next.videoUrl : '';
            if (isImageVideoDiskRef(url)) {
              next.videoUrl = materialDiskPlayableUrl(imageVideoDiskRefToNodeId(url), 'video');
            }
            const poster = typeof next.posterUrl === 'string' ? next.posterUrl : '';
            if (isImageVideoDiskRef(poster)) {
              const restored = hydrateUrl(poster);
              if (restored) next.posterUrl = restored;
            }
            return next;
          })
        );
        data.generatedVideos = hydratedGenVideos;

        return { ...node, data: data as unknown as CanvasNodeData };
      }

      if (node.type === 'faceCompliance') {
        const data = { ...(node.data as Record<string, unknown>) };

        const outputImageUrl = typeof data.outputImageUrl === 'string' ? data.outputImageUrl : '';
        if (isImageVideoDiskRef(outputImageUrl)) {
          const restored = hydrateUrl(outputImageUrl);
          if (restored) data.outputImageUrl = restored;
        }
        const inputImageUrl = typeof data.inputImageUrl === 'string' ? data.inputImageUrl : '';
        if (isImageVideoDiskRef(inputImageUrl)) {
          const restored = hydrateUrl(inputImageUrl);
          if (restored) data.inputImageUrl = restored;
        }

        const results = Array.isArray(data.processedResults) ? [...data.processedResults] : [];
        const hydratedResults = await Promise.all(
          results.map(async (item: Record<string, unknown>) => {
            const next = { ...item };
            const outUrl = typeof next.outputUrl === 'string' ? next.outputUrl : '';
            if (isImageVideoDiskRef(outUrl)) {
              const restored = hydrateUrl(outUrl);
              if (restored) next.outputUrl = restored;
            }
            const inUrl = typeof next.inputUrl === 'string' ? next.inputUrl : '';
            if (isImageVideoDiskRef(inUrl)) {
              const restored = hydrateUrl(inUrl);
              if (restored) next.inputUrl = restored;
            }
            return next;
          })
        );
        data.processedResults = hydratedResults;

        return { ...node, data: data as unknown as CanvasNodeData };
      }

      if (node.type === 'topazEnhance') {
        const data = { ...(node.data as Record<string, unknown>) };

        const outputImageUrl = typeof data.outputImageUrl === 'string' ? data.outputImageUrl : '';
        if (isImageVideoDiskRef(outputImageUrl)) {
          const restored = hydrateUrl(outputImageUrl);
          if (restored) data.outputImageUrl = restored;
        }

        const outputVideoUrl = typeof data.outputVideoUrl === 'string' ? data.outputVideoUrl : '';
        if (isImageVideoDiskRef(outputVideoUrl)) {
          data.outputVideoUrl = materialDiskPlayableUrl(imageVideoDiskRefToNodeId(outputVideoUrl), 'video');
        }

        const imageHistory = Array.isArray(data.topazImageHistory) ? [...data.topazImageHistory] : [];
        data.topazImageHistory = await Promise.all(
          imageHistory.map(async (url) => {
            if (typeof url !== 'string' || !isImageVideoDiskRef(url)) return url;
            return hydrateUrl(url) || url;
          }),
        );

        const videoHistory = Array.isArray(data.topazVideoHistory) ? [...data.topazVideoHistory] : [];
        data.topazVideoHistory = videoHistory.map((url) =>
          typeof url === 'string' && isImageVideoDiskRef(url)
            ? materialDiskPlayableUrl(imageVideoDiskRefToNodeId(url), 'video')
            : url,
        );

        return { ...node, data: data as unknown as CanvasNodeData };
      }

      return node;
    })
  );
}
