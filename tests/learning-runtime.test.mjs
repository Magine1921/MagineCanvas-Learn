import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  interpretKieCreditResponse,
  kieCreditHttpStatus,
  normalizeKieApiKey,
} from '../src/lib/kie-credit.ts';
import {
  buildAgentRequestGuidance,
  isExplicitWebSearchRequest,
} from '../src/components/agent/agent-intent.ts';
import { resolveConnectedMaterialMedia } from '../src/lib/connected-material-media.ts';
import { getAgentForwardPromptText } from '../src/lib/prompt-flow.ts';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('physically excludes commercial director and 3D camera sources', () => {
  const forbiddenPaths = [
    'src/components/nodes/DirectorNode.tsx',
    'src/components/nodes/Camera3DNode.tsx',
    'src/components/camera3d',
    'src/components/canvas/DirectorSequenceImportButton.tsx',
    'src/app/api/director',
    'src/app/api/camera3d',
    'src/app/playcanvas-demo',
    'src/lib/director-workflow-template.ts',
    'public/models/camera3d',
    'public/tutorial-audio/zh-CN/camera3d',
    'public/tutorial-audio/zh-CN/director-workflow',
  ];

  for (const relativePath of forbiddenPaths) {
    assert.equal(existsSync(resolve(projectRoot, relativePath)), false, relativePath);
  }

  const canvasSource = readFileSync(resolve(projectRoot, 'src/components/canvas/Canvas.tsx'), 'utf8');
  assert.doesNotMatch(canvasSource, /DirectorNode|Camera3DNode|director-workflow-template/);

  const electronTypes = readFileSync(resolve(projectRoot, 'src/types/electron.d.ts'), 'utf8');
  assert.doesNotMatch(electronTypes, /camera3d|MagineArdy|ardyEngine/i);
});

test('normalizes pasted Kie API keys', () => {
  assert.equal(normalizeKieApiKey('  Bearer "abc123"\u200b  '), 'abc123');
});

test('uses the Kie response code even when HTTP status is 200', () => {
  const result = interpretKieCreditResponse(200, { code: 401, msg: 'unauthorized' });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, 401);
  assert.equal(kieCreditHttpStatus(result), 401);
});

test('accepts a successful Kie credits response', () => {
  assert.deepEqual(
    interpretKieCreditResponse(200, { code: 200, data: 123.5 }),
    { ok: true, credits: 123.5 },
  );
});

test('routes explicit web search requests to web tools', () => {
  const request = '请联网搜索 Kie 官方最新文档';
  assert.equal(isExplicitWebSearchRequest(request), true);
  assert.match(buildAgentRequestGuidance(request), /web_search/);
});

test('material nodes follow the imported media aspect ratio', () => {
  const nodeSource = readFileSync(resolve(projectRoot, 'src/components/nodes/MaterialNode.tsx'), 'utf8');
  const canvasSource = readFileSync(resolve(projectRoot, 'src/components/canvas/Canvas.tsx'), 'utf8');
  assert.match(nodeSource, /frameAspectRatio=\{compactFrameAspect\}/);
  assert.match(nodeSource, /updateMaterialGeometry\(id,/);
  assert.match(canvasSource, /materialNodeDisplaySize\(/);
  assert.match(canvasSource, /materialAspectW: hasMediaAspect \? mediaWidth : undefined/);
});

test('material nodes load the displayed media from incoming image and video nodes', () => {
  const material = { id: 'material-1', type: 'material', position: { x: 0, y: 0 }, data: { label: '素材', type: 'material' } };
  const image = {
    id: 'image-1',
    type: 'image',
    position: { x: 0, y: 0 },
    data: {
      label: '图像',
      type: 'image',
      imageUrl: 'old.png',
      activeGeneratedImageId: 'active',
      generatedImages: [{ id: 'active', imageUrl: 'active.png', size: '1:1' }],
    },
  };
  assert.deepEqual(
    resolveConnectedMaterialMedia('material-1', [image, material], [
      { id: 'edge-1', source: 'image-1', target: 'material-1' },
    ]),
    {
      sourceNodeId: 'image-1',
      fileUrl: 'active.png',
      thumbnailUrl: 'active.png',
      fileName: '图像.png',
      fileType: 'image',
      aspectW: 1,
      aspectH: 1,
    },
  );
});

test('welcome recent projects render the uploaded project cover', () => {
  const homeSource = readFileSync(resolve(projectRoot, 'src/app/HomeClient.tsx'), 'utf8');
  const welcomeSource = readFileSync(resolve(projectRoot, 'src/components/canvas/WelcomePage.tsx'), 'utf8');
  assert.match(homeSource, /projects\.map\(\(\{ id, title, coverImage, createdAt, updatedAt \}\)/);
  assert.match(welcomeSource, /src=\{project\.coverImage\}/);
  assert.match(welcomeSource, /className="absolute inset-0 h-full w-full object-cover"/);
});

test('clicking the canvas pane keeps an expanded Agent node open', () => {
  const canvasSource = readFileSync(resolve(projectRoot, 'src/components/canvas/Canvas.tsx'), 'utf8');
  assert.match(canvasSource, /const keepExpandedAgent = selectedNode\?\.type === 'agent' \|\| selectedNode\?\.data\.type === 'agent';/);
  assert.match(canvasSource, /if \(!keepExpandedAgent\) setSelectedNode\(null\);/);
});

test('Agent forwards its latest assistant message into downstream text fields', () => {
  assert.equal(
    getAgentForwardPromptText({
      label: 'Agent',
      type: 'agent',
      agentChatHistory: [
        { role: 'assistant', content: 'first reply' },
        { role: 'user', content: 'next request' },
        { role: 'assistant', content: 'latest reply' },
      ],
    }, null),
    'latest reply',
  );

  const source = readFileSync(resolve(projectRoot, 'src/components/nodes/AgentNode.tsx'), 'utf8');
  assert.match(source, /downstreamNodeIdsBySource\[id\]/);
  assert.match(source, /updateNodeData\(targetNode\.id, \{ text: forwardedText \}\)/);
  assert.match(source, /updateNodeData\(targetNode\.id, \{ prompt: forwardedText \}\)/);
});

test('image generation nodes open their generated image in a large preview', () => {
  const imageSource = readFileSync(resolve(projectRoot, 'src/components/nodes/ImageNode.tsx'), 'utf8');
  const frameSource = readFileSync(resolve(projectRoot, 'src/components/canvas/CompactNodeFrame.tsx'), 'utf8');
  assert.match(imageSource, /const \[largeImagePreviewUrl, setLargeImagePreviewUrl\] = useState\(''\);/);
  assert.match(imageSource, /onImageLargePreview=\{hasGeneratedImagePreview \? openActiveImagePreview : undefined\}/);
  assert.match(imageSource, /createPortal\(/);
  assert.match(imageSource, /if \(event\.key === 'Escape'\) setLargeImagePreviewUrl\(''\);/);
  assert.match(frameSource, /title="查看大图"/);
});

test('canvas nodes use neutral opaque surfaces without backdrop blur', () => {
  const source = readFileSync(resolve(projectRoot, 'src/app/globals.css'), 'utf8');
  const finalOverride = source.slice(source.lastIndexOf('/* Canvas nodes use neutral opaque shells'));
  assert.match(finalOverride, /\.mc-canvas-shell \.mc-react-flow \.react-flow__node \*/);
  assert.match(finalOverride, /> div:not\(\.mc-node-edit-anchor\)/);
  assert.match(finalOverride, /backdrop-filter: none !important;/);
  assert.match(finalOverride, /background: rgb\(28, 28, 28\) !important;/);
  assert.match(finalOverride, /background: rgb\(22, 22, 22\) !important;/);
  assert.match(finalOverride, /mc-canvas-performance:not\(\.is-flow-moving-pan\)/);
  assert.match(finalOverride, /opacity: 1 !important;/);
  assert.doesNotMatch(finalOverride, /backdrop-filter: blur\(/);
});

test('canvas media sleeps on covers, unloads offscreen, and previews image thumbnails', () => {
  const playerSource = readFileSync(resolve(projectRoot, 'src/components/canvas/CanvasVideoPlayer.tsx'), 'utf8');
  const frameSource = readFileSync(resolve(projectRoot, 'src/components/canvas/CompactNodeFrame.tsx'), 'utf8');
  const imageSource = readFileSync(resolve(projectRoot, 'src/components/nodes/ImageNode.tsx'), 'utf8');
  const materialSource = readFileSync(resolve(projectRoot, 'src/components/nodes/MaterialNode.tsx'), 'utf8');
  const visibilitySource = readFileSync(resolve(projectRoot, 'src/lib/use-media-viewport-visibility.ts'), 'utf8');

  assert.match(playerSource, /const VIDEO_LOAD_RETRY_DELAYS_MS = \[1_200, 3_000, 6_000\]/);
  assert.match(playerSource, /preload=\{isLarge \? 'auto' : 'metadata'\}/);
  assert.match(playerSource, /video\.removeAttribute\('src'\)/);
  assert.match(frameSource, /!isMediaVisible && \(isVideo \|\| isAudio \|\| isImage\)/);
  assert.match(frameSource, /resolvedThumbnailUrl = compactPlayableUrl\(imageThumbnailUrl, 'image'\)/);
  assert.match(frameSource, /displayImageUrl = resolvedThumbnailUrl \|\| resolvedMediaUrl/);
  assert.match(visibilitySource, /new IntersectionObserver/);
  assert.match(imageSource, /activeImagePreviewUrl = activeGeneratedImage\?\.thumbnailUrl \|\| activeImageUrl/);
  assert.match(materialSource, /imageThumbnailUrl=\{nodeData\.fileType === 'image' \? nodeData\.thumbnailUrl : undefined\}/);
});
