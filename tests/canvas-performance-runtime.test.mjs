import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  canvasPerformanceProfileForLoad,
} from '../src/lib/canvas-performance-governor.ts';
import {
  canvasNodeDataPatchRecordsUndo,
} from '../src/lib/canvas-undo.ts';
import { getKieProviderTokenBucket } from '../src/lib/kie-usage-display.ts';

test('canvas performance governor selects stable load tiers', () => {
  assert.equal(canvasPerformanceProfileForLoad(20, 30), 'normal');
  assert.equal(canvasPerformanceProfileForLoad(60, 20), 'balanced');
  assert.equal(canvasPerformanceProfileForLoad(20, 120), 'balanced');
  assert.equal(canvasPerformanceProfileForLoad(180, 20), 'dense');
  assert.equal(canvasPerformanceProfileForLoad(20, 360), 'dense');
});

test('generation progress does not create whole-graph undo snapshots', () => {
  assert.equal(canvasNodeDataPatchRecordsUndo({
    isLoading: true,
    generationProgress: { status: 'processing', progress: 42 },
    statusMessage: 'processing',
  }), false);
  assert.equal(canvasNodeDataPatchRecordsUndo({ prompt: 'new durable prompt' }), true);
  assert.equal(canvasNodeDataPatchRecordsUndo({
    generationProgress: { status: 'processing', progress: 42 },
    prompt: 'new durable prompt',
  }), true);
});

test('an unconfigured provider keeps a stable empty credit snapshot', () => {
  const first = getKieProviderTokenBucket({}, 'video.missing');
  const second = getKieProviderTokenBucket({}, 'image.missing');
  assert.equal(first, second);
});

test('hot canvas resources are shared or activated on demand', async () => {
  const [visibility, eta, video, canvas, home, electron] = await Promise.all([
    readFile(new URL('../src/lib/use-media-viewport-visibility.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/canvas/GenerationEta.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/canvas/CanvasVideoPlayer.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/canvas/Canvas.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/app/HomeClient.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../electron/main.cjs', import.meta.url), 'utf8'),
  ]);

  assert.equal((visibility.match(/new IntersectionObserver/g) || []).length, 1);
  assert.equal((visibility.match(/new MutationObserver/g) || []).length, 1);
  assert.match(eta, /const clockListeners = new Set/);
  assert.equal((eta.match(/setInterval\(/g) || []).length, 1);
  assert.match(video, /mediaActivated \? <video/);
  assert.match(video, /setMediaActivated\(true\)/);
  assert.match(canvas, /data-mc-performance-profile=/);
  assert.match(home, /changedProjectIds/);
  assert.match(electron, /magine-projects-index-save/);
  assert.match(electron, /magine-project-save/);
});
