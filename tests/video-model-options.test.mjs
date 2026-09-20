import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readSource = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Kie Veo and Gemini Omni expose only supported options', async () => {
  const source = await readSource('src/components/api/KieMarketAPI.ts');
  const storeSource = await readSource('src/components/seedance/SeedanceStore.ts');
  const labelsSource = await readSource('src/lib/model-options.ts');
  const omniSource = source.slice(
    source.indexOf('export class KieMarketVideoAPI'),
    source.indexOf('function toVeoAspectRatio'),
  );

  assert.match(source, /KIE_VEO_DURATIONS[^=]*= \[4, 6, 8\]/);
  assert.match(source, /resolutions: \['1080P', '4K'\]/);
  assert.match(source, /durations: \[4, 6, 8, 10\]/);
  assert.match(source, /slice\(0, spec\.maxReferenceAudios\)/);
  assert.doesNotMatch(source, /normalizeKieGeminiOmniResolution/);
  assert.doesNotMatch(omniSource, /resolution/);
  assert.match(storeSource, /KIE_VEO_VIDEO_MODELS = \['veo3', 'veo3_fast', 'veo3_lite'\]/);
  assert.match(storeSource, /KIE_GEMINI_OMNI_VIDEO_MODELS = \['gemini-omni-video'\]/);
  assert.match(storeSource, /'kie-veo': emptyProviderConfig\([\s\S]*?'Kie Veo'/);
  assert.match(storeSource, /'kie-gemini-omni': emptyProviderConfig\([\s\S]*?'Kie Gemini Omni'/);
  assert.match(storeSource, /const legacyVeoOmni = result\.providers\['veo-omni'\]/);
  assert.match(labelsSource, /veo3: 'Kie Veo 3\.1 Quality'/);
  assert.match(labelsSource, /veo3_fast: 'Kie Veo 3\.1 Fast'/);
  assert.match(labelsSource, /veo3_lite: 'Kie Veo 3\.1 Lite'/);
  assert.match(labelsSource, /'gemini-omni-video': 'Kie Gemini Omni Video'/);
});

test('HappyHorse request shape follows each generation mode', async () => {
  const source = await readSource('src/components/api/VideoAPI.ts');

  assert.match(source, /'happyhorse-1\.0-video-edit':[\s\S]*?supportsRatio: false,[\s\S]*?supportsDuration: false/);
  assert.match(source, /'happyhorse-1\.0-i2v':[\s\S]*?resolutions: \['480P', '720P', '1080P'\]/);
  assert.match(source, /'happyhorse-1\.0-r2v':[\s\S]*?maxReferenceImages: 9/);
  assert.match(source, /media\.push\(\{ type: 'video', url: v \}\)/);
  assert.match(source, /if \(media\.length > 0\) input\.media = media/);
  assert.match(source, /if \(spec\?\.supportsDuration !== false\) parameters\.duration = params\.duration/);
});

test('video node filters model options before submission', async () => {
  const source = await readSource('src/components/nodes/VideoNode.tsx');

  assert.match(source, /normalizeKieVeoDuration\(baseRequest\.duration\)/);
  assert.match(source, /normalizeKieGeminiOmniDuration\(baseRequest\.duration\)/);
  assert.match(source, /resolution: h3Resolution/);
  assert.match(source, /createResolutionTask\(kieResult\.task_id, veoResolution\)/);
  assert.match(source, /effectiveDurationOptions\.length > 0/);
  assert.match(source, /happyHorseSpec\.aspectRatios\.includes/);
  assert.match(source, /cachedPosterUrl = await repairVideoHistoryPoster\(/);
});

test('Hailuo video provider is removed from configuration and routing', async () => {
  const storeSource = await readSource('src/components/seedance/SeedanceStore.ts');
  const nodeSource = await readSource('src/components/nodes/VideoNode.tsx');

  assert.match(storeSource, /video: new Set\(\['hailuo', 'kie-hailuo', 'veo-omni'\]\)/);
  assert.doesNotMatch(nodeSource, /createHailuoVideoAPI|getKieHailuoModelSpec/);
});

test('Kling 3 supports flexible duration while legacy models remain fixed', async () => {
  const source = await readSource('src/components/api/KlingVideoAPI.ts');

  assert.match(source, /KLING_FLEXIBLE_DURATIONS = Array\.from\(\{ length: 13 \}/);
  assert.match(source, /'kling-v3-omni':[\s\S]*?durations: KLING_FLEXIBLE_DURATIONS/);
  assert.match(source, /'kling-v2-6':[\s\S]*?durations: \['5', '10'\]/);
});

test('Alibaba workspace endpoints are accepted by the proxy', async () => {
  const source = await readSource('src/pages/api/proxy/openai.ts');
  assert.match(source, /hostname\.endsWith\('\.maas\.aliyuncs\.com'\)/);
});
