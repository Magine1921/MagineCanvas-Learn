'use client';

export interface AudioWaveformData {
  duration: number;
  peaks: number[];
}

export const MIN_VOICE_REFERENCE_SECONDS = 2;

async function decodeAudioUrl(url: string): Promise<AudioBuffer> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`音频读取失败（HTTP ${response.status}）`);
  const encoded = await response.arrayBuffer();
  const context = new AudioContext();
  try {
    return await context.decodeAudioData(encoded.slice(0));
  } finally {
    void context.close();
  }
}

export async function readAudioWaveform(
  url: string,
  sampleCount = 96,
): Promise<AudioWaveformData> {
  const audio = await decodeAudioUrl(url);
  const count = Math.max(24, Math.floor(sampleCount));
  const framesPerSample = Math.max(1, Math.floor(audio.length / count));
  const peaks = Array.from({ length: count }, (_, sampleIndex) => {
    const start = sampleIndex * framesPerSample;
    const end = Math.min(audio.length, start + framesPerSample);
    let peak = 0;
    for (let channelIndex = 0; channelIndex < audio.numberOfChannels; channelIndex += 1) {
      const channel = audio.getChannelData(channelIndex);
      for (let frame = start; frame < end; frame += 1) {
        peak = Math.max(peak, Math.abs(channel[frame] || 0));
      }
    }
    return peak;
  });
  const maxPeak = Math.max(0.001, ...peaks);
  return {
    duration: audio.duration,
    peaks: peaks.map((peak) => peak / maxPeak),
  };
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function audioBufferSegmentToWav(
  audio: AudioBuffer,
  startSeconds: number,
  endSeconds: number,
): Blob {
  const startFrame = Math.max(0, Math.floor(startSeconds * audio.sampleRate));
  const endFrame = Math.min(audio.length, Math.ceil(endSeconds * audio.sampleRate));
  const frameCount = Math.max(1, endFrame - startFrame);
  const channelCount = Math.min(2, Math.max(1, audio.numberOfChannels));
  const bytesPerSample = 2;
  const dataSize = frameCount * channelCount * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, audio.sampleRate, true);
  view.setUint32(28, audio.sampleRate * channelCount * bytesPerSample, true);
  view.setUint16(32, channelCount * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let writeOffset = 44;
  for (let frame = startFrame; frame < endFrame; frame += 1) {
    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      const sample = Math.max(-1, Math.min(1, audio.getChannelData(channelIndex)[frame] || 0));
      view.setInt16(
        writeOffset,
        sample < 0 ? sample * 0x8000 : sample * 0x7fff,
        true,
      );
      writeOffset += bytesPerSample;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('裁剪音频读取失败'));
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.readAsDataURL(blob);
  });
}

export async function trimAudioUrlToWavDataUrl(
  url: string,
  startSeconds: number,
  endSeconds: number,
): Promise<string> {
  const audio = await decodeAudioUrl(url);
  const start = Math.max(0, Math.min(startSeconds, audio.duration));
  const end = Math.max(start, Math.min(endSeconds, audio.duration));
  if (end - start < MIN_VOICE_REFERENCE_SECONDS) {
    throw new Error(`音色参考选区不能短于 ${MIN_VOICE_REFERENCE_SECONDS} 秒`);
  }
  return blobToDataUrl(audioBufferSegmentToWav(audio, start, end));
}
