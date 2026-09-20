import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const posterSource = fs.readFileSync('src/lib/video-history-poster.ts', 'utf8');
const videoNodeSource = fs.readFileSync('src/components/nodes/VideoNode.tsx', 'utf8');
const mainSource = fs.readFileSync('electron/main.cjs', 'utf8');
const preloadSource = fs.readFileSync('electron/preload.cjs', 'utf8');

test('video history poster repair is durable and globally rate limited', () => {
  assert.match(posterSource, /const MAX_POSTER_REPAIRS = 2/);
  assert.match(posterSource, /materialVideoThumbnail/);
  assert.match(posterSource, /captureVideoFrameDataUrl/);
  assert.match(posterSource, /persistImageToMaterialCache\(posterCacheKey, dataUrl\)/);
  assert.match(posterSource, /repairsInFlight/);
});

test('video history repairs missing and broken posters without using input references', () => {
  assert.match(videoNodeSource, /if \(!item\.posterUrl\) requestHistoryPosterRepair\(item\)/);
  assert.match(videoNodeSource, /requestHistoryPosterRepair\(item, true\)/);
  assert.match(videoNodeSource, /resolveMaterialPlayableUrl\(item\.posterUrl, 'image'\)/);
  assert.doesNotMatch(
    videoNodeSource,
    /const posterUrl = item\.posterUrl \|\| defaultReferencePreview \|\| defaultReferenceImage/,
  );
});

test('electron exposes bundled ffmpeg video thumbnail extraction', () => {
  assert.match(mainSource, /async function createMaterialVideoThumbnail/);
  assert.match(mainSource, /'-frames:v', '1'/);
  assert.match(mainSource, /magine-material-video-thumbnail/);
  assert.match(preloadSource, /materialVideoThumbnail: \(request\)/);
});
