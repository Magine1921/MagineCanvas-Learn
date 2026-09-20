export const GENERATED_IMAGE_DND_TYPE = 'application/x-magine-generated-image';
export const GENERATED_VIDEO_DND_TYPE = 'application/x-magine-generated-video';
export const GENERATED_AUDIO_DND_TYPE = 'application/x-magine-generated-audio';

export interface GeneratedImageDragPayload {
  imageUrl: string;
  thumbnailUrl?: string;
  fileName: string;
  prompt?: string;
  mediaWidth?: number;
  mediaHeight?: number;
}

export interface GeneratedVideoDragPayload {
  videoUrl: string;
  fileName: string;
  prompt?: string;
  posterUrl?: string;
}

export interface GeneratedAudioDragPayload {
  audioUrl: string;
  fileName: string;
  prompt?: string;
}

export function makeGeneratedImageFileName(createdAt = Date.now()): string {
  const stamp = new Date(createdAt)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, '');
  return `generated-image-${stamp}.png`;
}

export function makeGeneratedVideoFileName(createdAt = Date.now()): string {
  const stamp = new Date(createdAt)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, '');
  return `generated-video-${stamp}.mp4`;
}

export function makeGeneratedAudioFileName(createdAt = Date.now()): string {
  const stamp = new Date(createdAt)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, '');
  return `generated-audio-${stamp}.mp3`;
}

export function makeGeneratedImageSlug(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '');
  return (
    base
      .replace(/[^\w\u4e00-\u9fff-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 30) || '生成图'
  );
}

export function makeGeneratedVideoSlug(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '');
  return (
    base
      .replace(/[^\w\u4e00-\u9fff-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 30) || '生成视频'
  );
}

export function makeGeneratedAudioSlug(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '');
  return (
    base
      .replace(/[^\w\u4e00-\u9fff-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 30) || '生成音频'
  );
}
