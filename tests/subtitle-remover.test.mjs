import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('去字幕使用腾讯云 MPS 与 COS，不再打包本地 VSR 运行桥接', async () => {
  const [packageSource, mainSource, preloadSource] = await Promise.all([
    fs.promises.readFile(path.resolve('package.json'), 'utf8'),
    fs.promises.readFile(path.resolve('electron/main.cjs'), 'utf8'),
    fs.promises.readFile(path.resolve('electron/preload.cjs'), 'utf8'),
  ]);
  const packageJson = JSON.parse(packageSource);
  assert.equal(packageJson.build.files.includes('electron/subtitle-remover.cjs'), false);
  assert.ok(packageJson.dependencies['tencentcloud-sdk-nodejs-mps']);
  assert.ok(packageJson.dependencies['cos-nodejs-sdk-v5']);
  assert.doesNotMatch(mainSource, /magine-subtitle-remove-media|video-subtitle-remover/);
  assert.doesNotMatch(preloadSource, /magine-subtitle-remove-media|video-subtitle-remover/);
});

test('腾讯云路由分别提交图片与视频任务并查询实时进度', async () => {
  const source = await fs.promises.readFile(
    path.resolve('src/app/api/tencent-mps/subtitle-removal/route.ts'),
    'utf8',
  );
  assert.match(source, /client\.ProcessImage\(/);
  assert.match(source, /ScheduleId: 30000/);
  assert.match(source, /client\.ProcessMedia\(/);
  assert.match(source, /SmartEraseTask:/);
  assert.match(source, /DescribeImageTaskDetail/);
  assert.match(source, /DescribeTaskDetail/);
  assert.match(source, /SmartEraseTaskResult/);
  assert.match(source, /signedCosUrl/);
});

test('图片、视频和素材节点顶部工具栏均提供去字幕按钮', async () => {
  const [imageSource, videoSource, materialSource, rendererSource] = await Promise.all([
    fs.promises.readFile(path.resolve('src/components/nodes/ImageNode.tsx'), 'utf8'),
    fs.promises.readFile(path.resolve('src/components/nodes/VideoNode.tsx'), 'utf8'),
    fs.promises.readFile(path.resolve('src/components/nodes/MaterialNode.tsx'), 'utf8'),
    fs.promises.readFile(path.resolve('src/lib/subtitle-remover.ts'), 'utf8'),
  ]);
  assert.match(imageSource, /title=\{subtitleRemovalProgress === null \? '去字幕'/);
  assert.match(videoSource, /title=\{subtitleRemovalProgress === null \? '去字幕'/);
  assert.match(materialSource, /nodeData\.fileType === 'image' \|\| nodeData\.fileType === 'video'/);
  assert.match(materialSource, /void handleRemoveSubtitles\(options\)/);
  assert.doesNotMatch(materialSource, /nodeData\.fileType === 'audio'[\s\S]{0,120}void handleRemoveSubtitles/);
  assert.match(imageSource, /sourceHandle: 'image'/);
  assert.match(videoSource, /sourceHandle: 'video'/);
  assert.match(materialSource, /sourceHandle: null/);
  assert.match(rendererSource, /sourceSubtitleRemovalNodeId/);
  assert.match(rendererSource, /connectedMediaLocked: true/);
  assert.match(rendererSource, /onConnect\(\{[\s\S]*target: materialNodeId/);
  assert.match(rendererSource, /API 配置 → 去字幕/);
});

test('API 配置包含腾讯云去字幕凭证、COS 和视频模板检测', async () => {
  const [configSource, storeSource] = await Promise.all([
    fs.promises.readFile(path.resolve('src/components/seedance/SeedanceConfig.tsx'), 'utf8'),
    fs.promises.readFile(path.resolve('src/components/seedance/SeedanceStore.ts'), 'utf8'),
  ]);
  assert.match(configSource, /id: 'erase', label: '去字幕'/);
  assert.match(configSource, /腾讯云 MPS 云端去字幕/);
  assert.match(configSource, /SecretId/);
  assert.match(configSource, /https:\/\/console\.cloud\.tencent\.com\/cam\/capi/);
  assert.match(configSource, /openTencentCloudAccessKeyPage/);
  assert.match(configSource, /获取密钥/);
  assert.match(configSource, /COS Bucket 完整名称/);
  assert.match(configSource, /https:\/\/console\.cloud\.tencent\.com\/cos5\/bucket/);
  assert.match(configSource, /openTencentCloudCosBucketPage/);
  assert.match(configSource, /打开 COS 控制台/);
  assert.match(configSource, /视频模板 ID/);
  assert.match(configSource, /action: 'test'/);
  assert.match(storeSource, /subtitleRemovalApi: TencentMpsSubtitleRemovalConfig/);
  assert.match(storeSource, /saveSubtitleRemovalApiConfig/);
});

test('去字幕素材节点锁定处理结果，不被母节点原素材覆盖', async () => {
  const materialSource = await fs.promises.readFile(
    path.resolve('src/components/nodes/MaterialNode.tsx'),
    'utf8',
  );
  assert.match(materialSource, /if \(nodeData\.connectedMediaLocked === true\) return;/);
});

test('开始擦除后立即创建母子连线素材节点，并在子节点持续显示进度', async () => {
  const [imageSource, videoSource, materialSource, removerSource] = await Promise.all([
    fs.promises.readFile(path.resolve('src/components/nodes/ImageNode.tsx'), 'utf8'),
    fs.promises.readFile(path.resolve('src/components/nodes/VideoNode.tsx'), 'utf8'),
    fs.promises.readFile(path.resolve('src/components/nodes/MaterialNode.tsx'), 'utf8'),
    fs.promises.readFile(path.resolve('src/lib/subtitle-remover.ts'), 'utf8'),
  ]);

  for (const source of [imageSource, videoSource, materialSource]) {
    const createIndex = source.indexOf('const materialNodeId = createSubtitleRemovalMaterialNode');
    const requestIndex = source.indexOf('const result = await removeSubtitlesFromMedia', createIndex);
    assert.ok(createIndex >= 0, '应先创建去字幕素材节点');
    assert.ok(requestIndex > createIndex, '素材节点必须在云端去字幕任务开始前创建');
    assert.match(source, /updateSubtitleRemovalMaterialProgress\(materialNodeId, progress\)/);
    assert.match(source, /failSubtitleRemovalMaterialNode\(materialNodeId, error\)/);
    assert.match(source, /completeSubtitleRemovalMaterialNode\(\{/);
  }

  assert.match(removerSource, /target: materialNodeId/);
  assert.match(removerSource, /subtitleRemovalStatus: options\.fileUrl \? 'complete' : 'queued'/);
  assert.match(materialSource, /isLoading=\{isSubtitleRemovalProcessing\}/);
  assert.match(materialSource, /loadingLabel="去字幕中"/);
  assert.match(materialSource, /progress=\{subtitleRemovalNodeProgress\}/);
});
