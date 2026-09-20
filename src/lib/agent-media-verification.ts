import type { CanvasAgentNodeOutput } from './canvas-agent-capabilities.ts';

export interface AgentMediaProbeResult {
  ok: boolean;
  reason: string;
}

const MEDIA_TIMEOUT_MS = 10_000;

function structurallyValidUri(uri: string): boolean {
  const value = uri.trim();
  if (!value) return false;
  if (/^data:/i.test(value)) return value.includes(',') && value.length > 32;
  if (/^(blob:|https?:|asset:|file:|magine:)/i.test(value)) return true;
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value);
}

function waitForMediaMetadata(
  element: HTMLMediaElement,
  uri: string,
  timeoutMs: number,
): Promise<AgentMediaProbeResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: AgentMediaProbeResult) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      element.removeAttribute('src');
      element.load();
      resolve(result);
    };
    const timeoutId = window.setTimeout(
      () => finish({ ok: false, reason: 'Media metadata load timed out.' }),
      timeoutMs,
    );
    element.preload = 'metadata';
    element.muted = true;
    element.onloadedmetadata = () => {
      const duration = element.duration;
      const durationValid = !Number.isFinite(duration) || duration > 0;
      finish(durationValid
        ? { ok: true, reason: 'Media metadata loaded.' }
        : { ok: false, reason: 'Media duration is invalid.' });
    };
    element.onerror = () => finish({ ok: false, reason: 'Media could not be decoded.' });
    element.src = uri;
    element.load();
  });
}

function waitForImage(uri: string, timeoutMs: number): Promise<AgentMediaProbeResult> {
  return new Promise((resolve) => {
    const image = new Image();
    let settled = false;
    const finish = (result: AgentMediaProbeResult) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      image.src = '';
      resolve(result);
    };
    const timeoutId = window.setTimeout(
      () => finish({ ok: false, reason: 'Image load timed out.' }),
      timeoutMs,
    );
    image.onload = () => finish(
      image.naturalWidth > 0 && image.naturalHeight > 0
        ? { ok: true, reason: 'Image decoded.' }
        : { ok: false, reason: 'Image dimensions are invalid.' },
    );
    image.onerror = () => finish({ ok: false, reason: 'Image could not be decoded.' });
    image.src = uri;
  });
}

export async function probeAgentMediaOutput(
  output: CanvasAgentNodeOutput,
  timeoutMs = MEDIA_TIMEOUT_MS,
): Promise<AgentMediaProbeResult> {
  if (!structurallyValidUri(output.uri)) {
    return { ok: false, reason: 'Output URI is empty or unsupported.' };
  }
  if (typeof window === 'undefined') {
    return { ok: true, reason: 'Output URI is structurally valid.' };
  }
  if (output.kind === 'image') return waitForImage(output.uri, timeoutMs);
  if (output.kind === 'video') {
    return waitForMediaMetadata(document.createElement('video'), output.uri, timeoutMs);
  }
  if (output.kind === 'audio') {
    return waitForMediaMetadata(document.createElement('audio'), output.uri, timeoutMs);
  }
  return { ok: true, reason: 'File output URI is structurally valid.' };
}
