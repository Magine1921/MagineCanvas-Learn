import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('runtime uses the project-owned SVG replacements', () => {
  for (const relativePath of [
    'public/backgrounds/bg.svg',
    'public/logo-symbol-relief.svg',
    'public/panorama-equirectangular-guide.svg',
  ]) {
    const svg = read(relativePath);
    assert.match(svg, /^<svg\b/);
    assert.match(svg, /viewBox=/);
    assert.doesNotMatch(svg, /<script\b|(?:href|src)=["']https?:\/\//i);
  }

  assert.match(read('src/components/canvas/WaterBackground.tsx'), /\/backgrounds\/bg\.svg/);
  assert.match(read('src/components/canvas/CompactNodeFrame.tsx'), /\/logo-symbol-relief\.svg/);
  assert.match(read('src/lib/panorama-equirectangular-guide-data-url.ts'), /\/panorama-equirectangular-guide\.svg/);
});

test('UI sounds are generated with Web Audio instead of bundled recordings', () => {
  const proceduralSound = read('src/lib/proceduralUiSound.ts');
  assert.match(proceduralSound, /createOscillator\(\)/);
  assert.match(proceduralSound, /createGain\(\)/);

  for (const relativePath of [
    'src/lib/canvasEntranceSound.ts',
    'src/lib/welcomeEntranceSound.ts',
    'src/lib/voiceAssistantClickSound.ts',
  ]) {
    const source = read(relativePath);
    assert.match(source, /playProceduralUiSound/);
    assert.doesNotMatch(source, /new Audio|\/sounds\//);
  }
});
