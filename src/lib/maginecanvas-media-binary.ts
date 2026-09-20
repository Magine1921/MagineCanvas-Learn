/**
 * 剪辑台 → Maginecancas：对拉取到的字节做魔数检测，并规范化 MIME / 文件名。
 * Maginecancas内部 getFileType 依赖 File.type 以 image/、video/、audio/ 开头（及少数扩展名），
 * application/octet-stream 或未带扩展名的文件名会导致图片素材被丢弃。
 */

import type { InboundEditClipCandidate } from '@/lib/edit-timeline-types';

export type BinarySniffKind = 'image' | 'video' | 'audio' | 'unknown';

export type BinarySniff = {
  kind: BinarySniffKind;
  mime: string;
  /** 含点，如 ".png" */
  ext: string;
};

function readAscii(u8: Uint8Array, start: number, len: number): string {
  let s = '';
  for (let i = 0; i < len && start + i < u8.length; i++) {
    s += String.fromCharCode(u8[start + i]!);
  }
  return s;
}

/** 识别常见图片 / 音视频容器魔数（不要求读完整文件） */
export function sniffBinaryMedia(bytes: Uint8Array): BinarySniff {
  if (!bytes || bytes.length < 12) {
    return { kind: 'unknown', mime: 'application/octet-stream', ext: '.bin' };
  }

  const b0 = bytes[0]!;
  const b1 = bytes[1]!;
  const b2 = bytes[2]!;
  const b3 = bytes[3]!;

  // JPEG
  if (b0 === 0xff && b1 === 0xd8 && b2 === 0xff) {
    return { kind: 'image', mime: 'image/jpeg', ext: '.jpg' };
  }

  // PNG
  if (b0 === 0x89 && b1 === 0x50 && b2 === 0x4e && b3 === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a) {
    return { kind: 'image', mime: 'image/png', ext: '.png' };
  }

  // GIF
  if (b0 === 0x47 && b1 === 0x49 && b2 === 0x46 && b3 === 0x38) {
    return { kind: 'image', mime: 'image/gif', ext: '.gif' };
  }

  // BMP
  if (b0 === 0x42 && b1 === 0x4d) {
    return { kind: 'image', mime: 'image/bmp', ext: '.bmp' };
  }

  // TIFF
  if ((b0 === 0x49 && b1 === 0x49 && b2 === 0x2a && b3 === 0x00) || (b0 === 0x4d && b1 === 0x4d && b2 === 0x00 && b3 === 0x2a)) {
    return { kind: 'image', mime: 'image/tiff', ext: '.tiff' };
  }

  // WebP (RIFF....WEBP)
  if (b0 === 0x52 && b1 === 0x49 && b2 === 0x46 && b3 === 0x46 && bytes.length >= 12) {
    const tag = readAscii(bytes, 8, 4);
    if (tag === 'WEBP') {
      return { kind: 'image', mime: 'image/webp', ext: '.webp' };
    }
  }

  // ICO
  if (b0 === 0x00 && b1 === 0x00 && b2 === 0x01 && b3 === 0x00) {
    return { kind: 'image', mime: 'image/x-icon', ext: '.ico' };
  }

  // ISO BMFF (ftyp at offset 4): AVIF / HEIC / HEIF / MP4 / MOV
  if (bytes.length >= 16 && readAscii(bytes, 4, 4) === 'ftyp') {
    const brand = readAscii(bytes, 8, 4);
    const compat = bytes.length >= 12 ? readAscii(bytes, 12, 4) : '';

    if (brand === 'avif' || brand === 'avis' || compat === 'avif' || compat === 'avis') {
      return { kind: 'image', mime: 'image/avif', ext: '.avif' };
    }
    if (
      brand === 'heic' ||
      brand === 'heix' ||
      brand === 'heim' ||
      brand === 'heis' ||
      brand === 'mif1' ||
      brand === 'msf1'
    ) {
      return { kind: 'image', mime: 'image/heic', ext: '.heic' };
    }

    if (brand === 'qt  ' || compat === 'qt  ') {
      return { kind: 'video', mime: 'video/quicktime', ext: '.mov' };
    }
    if (brand === 'isom' || brand === 'mp41' || brand === 'mp42' || brand === 'dash' || brand === 'iso6') {
      return { kind: 'video', mime: 'video/mp4', ext: '.mp4' };
    }
    if (brand === 'M4V ' || brand === 'M4A ' || brand === 'mp71') {
      return { kind: 'video', mime: 'video/mp4', ext: '.mp4' };
    }
  }

  // WebM / Matroska (EBML 1A 45 DF A3)
  if (b0 === 0x1a && b1 === 0x45 && b2 === 0xdf && b3 === 0xa3) {
    return { kind: 'video', mime: 'video/webm', ext: '.webm' };
  }

  // ID3 or MPEG frame sync
  if (b0 === 0x49 && b1 === 0x44 && b2 === 0x33) {
    return { kind: 'audio', mime: 'audio/mpeg', ext: '.mp3' };
  }
  if (b0 === 0xff && (b1 & 0xe0) === 0xe0) {
    return { kind: 'audio', mime: 'audio/mpeg', ext: '.mp3' };
  }

  // WAV "RIFF" + "WAVE"
  if (b0 === 0x52 && b1 === 0x49 && b2 === 0x46 && b3 === 0x46 && bytes.length >= 12) {
    const wave = readAscii(bytes, 8, 4);
    if (wave === 'WAVE') {
      return { kind: 'audio', mime: 'audio/wav', ext: '.wav' };
    }
  }

  // OGG
  if (b0 === 0x4f && b1 === 0x67 && b2 === 0x67 && b3 === 0x53) {
    return { kind: 'audio', mime: 'audio/ogg', ext: '.ogg' };
  }

  // FLAC "fLaC"
  if (b0 === 0x66 && b1 === 0x4c && b2 === 0x61 && b3 === 0x43) {
    return { kind: 'audio', mime: 'audio/flac', ext: '.flac' };
  }

  // SVG (文本头)
  if (looksLikeSvgPrefix(bytes)) {
    return { kind: 'image', mime: 'image/svg+xml', ext: '.svg' };
  }

  return { kind: 'unknown', mime: 'application/octet-stream', ext: '.bin' };
}

function looksLikeSvgPrefix(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 512);
  let s = '';
  for (let i = 0; i < n; i++) {
    const c = bytes[i]!;
    if (c === 0) return false;
    s += String.fromCharCode(c);
  }
  const t = s.trimStart().replace(/^\uFEFF/, '');
  if (t.startsWith('<svg')) return true;
  if (t.startsWith('<?xml') && t.includes('<svg')) return true;
  return false;
}

function extFromMime(mime: string): string | null {
  const m = mime.toLowerCase();
  const table: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/bmp': '.bmp',
    'image/tiff': '.tiff',
    'image/svg+xml': '.svg',
    'image/avif': '.avif',
    'image/heic': '.heic',
    'image/heif': '.heif',
    'video/mp4': '.mp4',
    'video/quicktime': '.mov',
    'video/webm': '.webm',
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'audio/ogg': '.ogg',
    'audio/flac': '.flac',
  };
  return table[m] ?? null;
}

/** 将文件名改为以 ext 结尾（ext 含点） */
export function ensureFileNameExtension(fileName: string, extWithDot: string): string {
  const e = extWithDot.startsWith('.') ? extWithDot : `.${extWithDot}`;
  const m = /\.[a-z0-9]+$/i.exec(fileName.trim() || 'file');
  const base = m ? fileName.trim().slice(0, m.index) : (fileName.trim() || 'file');
  return base + e;
}

/**
 * Maginecancas `getFileType` 对扩展名用 `name.indexOf('.lrc')` 等子串判断（非仅末尾），
 * basename 中若含 `.lrc` / `.vtt` / `.krc` / `.jrc` 会把图片误判为字幕轨。
 * 程序化导入必须使用无歧义、仅末尾一点扩展名的稳定文件名。
 */
export function maginecanvasImportFileLabel(sourceNodeId: string, extWithDot: string): string {
  const e = extWithDot.startsWith('.') ? extWithDot : `.${extWithDot}`;
  const raw = String(sourceNodeId || 'asset').trim() || 'asset';
  let safe = raw.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  if (!safe) safe = 'asset';
  const short = safe.length > 120 ? safe.slice(0, 120) : safe;
  return `magine-${short}${e}`;
}

function isUselessContentType(ct: string): boolean {
  const t = ct.trim().toLowerCase();
  return !t || t === 'application/octet-stream' || t === 'binary/octet-stream' || t === 'application/x-www-form-urlencoded';
}

/**
 * 父页 fetch 后调用：根据魔数 + 声明的 mediaKind 生成Maginecancas可识别的 Content-Type 与文件名。
 */
export function normalizeInboundBytesForMaginecanvas(
  inbound: InboundEditClipCandidate,
  arrayBuffer: ArrayBuffer,
  httpContentType: string
): { effectiveContentType: string; effectiveFileName: string } {
  const bytes = new Uint8Array(arrayBuffer);
  const sniff = sniffBinaryMedia(bytes);
  const header = httpContentType.trim();

  if (inbound.mediaKind === 'image') {
    if (sniff.kind === 'image') {
      return {
        effectiveContentType: sniff.mime,
        effectiveFileName: maginecanvasImportFileLabel(inbound.sourceNodeId, sniff.ext),
      };
    }
    if (!isUselessContentType(header) && header.toLowerCase().startsWith('image/')) {
      const ext = extFromMime(header) ?? '.png';
      return {
        effectiveContentType: header,
        effectiveFileName: maginecanvasImportFileLabel(inbound.sourceNodeId, ext),
      };
    }
    throw new Error(
      `图片素材「${inbound.fileName || inbound.sourceNodeId}」无法识别为受支持格式（请确认文件为 JPEG/PNG/WebP/GIF 等）`
    );
  }

  if (inbound.mediaKind === 'video') {
    if (sniff.kind === 'video') {
      return {
        effectiveContentType: sniff.mime,
        effectiveFileName: maginecanvasImportFileLabel(inbound.sourceNodeId, sniff.ext),
      };
    }
    if (!isUselessContentType(header) && header.toLowerCase().startsWith('video/')) {
      const ext = extFromMime(header) ?? '.mp4';
      return { effectiveContentType: header, effectiveFileName: maginecanvasImportFileLabel(inbound.sourceNodeId, ext) };
    }
    throw new Error(`视频素材「${inbound.fileName || inbound.sourceNodeId}」无法识别为受支持容器格式`);
  }

  if (inbound.mediaKind === 'audio') {
    if (sniff.kind === 'audio') {
      return {
        effectiveContentType: sniff.mime,
        effectiveFileName: maginecanvasImportFileLabel(inbound.sourceNodeId, sniff.ext),
      };
    }
    if (!isUselessContentType(header) && header.toLowerCase().startsWith('audio/')) {
      const ext = extFromMime(header) ?? '.mp3';
      return { effectiveContentType: header, effectiveFileName: maginecanvasImportFileLabel(inbound.sourceNodeId, ext) };
    }
    throw new Error(`音频素材「${inbound.fileName || inbound.sourceNodeId}」无法识别为受支持格式`);
  }

  return {
    effectiveContentType: !isUselessContentType(header) ? header : sniff.mime,
    effectiveFileName: maginecanvasImportFileLabel(inbound.sourceNodeId, sniff.ext),
  };
}
