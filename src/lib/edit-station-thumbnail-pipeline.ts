/**
 * 缩略图 / 解码管线扩展点（非阻塞主线程）：
 * - 首选：Web Worker + WebCodecs VideoDecoder 抽首帧 → OffscreenCanvas → Blob URL
 * - 回退：ffmpeg.wasm（MEMFS）或主线程隐藏 video + canvas（小批量）
 * - 音频：OfflineAudioContext + RMS 波形（分块）
 *
 * 当前实现：剪辑台内 `MaginecanvasEditStationSurface` 用隐藏 `<video metadata>` 触发时长探测；首帧位图生成待接入 Worker。
 */
export type ThumbnailJob = {
  id: string;
  url: string;
  mediaKind: 'video' | 'image' | 'audio';
};

export function enqueueThumbnailJob(_job: ThumbnailJob): void {
  /* 预留：推入 Worker 队列 */
}
