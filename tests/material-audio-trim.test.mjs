import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readSource = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('material video and audio share the waveform-style range editor', async () => {
  const editorSource = await readSource('src/components/nodes/MaterialMediaEditor.tsx');
  const nodeSource = await readSource('src/components/nodes/MaterialNode.tsx');

  assert.match(editorSource, /fileType: 'image' \| 'video' \| 'audio'/);
  assert.match(editorSource, /onTrimAudio: \(start: number, end: number\)/);
  assert.match(editorSource, /readAudioWaveform\(sourceUrl, 120\)/);
  assert.match(editorSource, /data-material-trim-editor=\{fileType\}/);
  assert.match(editorSource, /data-material-trim-timeline=\{fileType\}/);
  assert.match(editorSource, /data-trim-handle=\{edge\}/);
  assert.match(editorSource, /handleTrimHandleKeyDown/);
  assert.match(editorSource, /posterUrl \?/);
  assert.doesNotMatch(editorSource, /type="range"/);
  assert.match(editorSource, /await onTrimAudio\(trimStart, trimEnd\)/);
  assert.match(editorSource, /function handleTimedMediaTimeUpdate|const handleTimedMediaTimeUpdate/);
  assert.match(editorSource, /time >= trimEnd - 0\.01/);
  assert.match(editorSource, /title=\{playing \? '暂停' : '播放所选片段'\}/);
  assert.match(nodeSource, /window\.magineDesktop\?\.materialAudioTrim/);
  assert.match(nodeSource, /<span>音频剪辑<\/span>/);
  assert.match(nodeSource, /posterUrl=\{nodeData\.fileType === 'video' \? nodeData\.thumbnailUrl : undefined\}/);
  assert.match(nodeSource, /onTrimAudio=\{handleTrimAudio\}/);
});

test('Electron trims material audio into an MP3 output', async () => {
  const mainSource = await readSource('electron/main.cjs');
  const preloadSource = await readSource('electron/preload.cjs');
  const typesSource = await readSource('src/types/electron.d.ts');

  assert.match(mainSource, /async function trimMaterialAudio/);
  assert.match(mainSource, /'-map', '0:a:0'/);
  assert.match(mainSource, /'-c:a', 'libmp3lame'/);
  assert.equal((mainSource.match(/'-i', input\.filePath,\s*'-ss', start\.toFixed\(3\),\s*'-t'/g) || []).length, 2);
  assert.match(mainSource, /ipcMain\.handle\('magine-material-audio-trim'/);
  assert.match(preloadSource, /materialAudioTrim: \(request\) => ipcRenderer\.invoke\('magine-material-audio-trim', request\)/);
  assert.match(typesSource, /materialAudioTrim\?: \(request:/);
});

test('material trimming decodes inline and local media without Electron net.fetch', async () => {
  const mainSource = await readSource('electron/main.cjs');
  const nodeSource = await readSource('src/components/nodes/MaterialNode.tsx');

  assert.match(mainSource, /if \(sourceUrl\.startsWith\('data:'\)\)/);
  assert.match(mainSource, /Buffer\.from\(match\[3\]\.replace\(\/\\s\/g, ''\), 'base64'\)/);
  assert.match(mainSource, /if \(sourceUrl\.startsWith\('file:'\)\)/);
  assert.match(mainSource, /if \(path\.isAbsolute\(sourceUrl\)\)/);
  assert.match(nodeSource, /async function resolveMaterialEditSourceUrl/);
  assert.match(nodeSource, /getMaterialBlob\(materialRefToNodeId\(sourceUrl\)\)/);
  assert.match(nodeSource, /await resolveMaterialEditSourceUrl\(storedSourceUrl\)/);
});
