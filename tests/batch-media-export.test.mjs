import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const rendererModule = await import(pathToFileURL(path.resolve('src/lib/batch-media-export.ts')).href);
const { exportMediaGroups } = require('../electron/media-batch-export.cjs');

test('桌面安装包包含批量导出主进程模块', async () => {
  const packageJson = JSON.parse(await fs.promises.readFile(path.resolve('package.json'), 'utf8'));
  assert.ok(packageJson.build.files.includes('electron/media-batch-export.cjs'));
});

test('批量保存进度事件贯通主进程、预加载桥和画布顶部进度条', async () => {
  const [mainSource, preloadSource, canvasSource] = await Promise.all([
    fs.promises.readFile(path.resolve('electron/main.cjs'), 'utf8'),
    fs.promises.readFile(path.resolve('electron/preload.cjs'), 'utf8'),
    fs.promises.readFile(path.resolve('src/components/canvas/Canvas.tsx'), 'utf8'),
  ]);
  assert.match(mainSource, /magine-save-media-batch-progress/);
  assert.match(preloadSource, /onMediaBatchProgress/);
  assert.match(canvasSource, /批量保存中/);
  assert.match(canvasSource, /role="progressbar"/);
});

test('主进程版本未更新时返回可执行的中文提示', () => {
  const message = rendererModule.batchMediaExportErrorMessage(
    new Error("Error invoking remote method 'magine-save-media-batch': Error: No handler registered for 'magine-save-media-batch'"),
  );
  assert.match(message, /完全退出并重新打开 MagineCanvas/);
  assert.doesNotMatch(message, /No handler registered/);
});

test('图片节点批量导出收集全部历史素材，并去重当前素材', () => {
  const group = rendererModule.collectNodeMediaExportGroup({
    id: 'image-node-1',
    type: 'image',
    data: {
      type: 'image',
      label: '图像生成',
      imageUrl: 'https://example.com/current.png',
      generatedImages: [
        { imageUrl: 'https://example.com/current.png', fileName: '当前图.png', createdAt: 20 },
        { imageUrl: 'disk://magine/material/v1/cache-image-2', createdAt: 10 },
      ],
    },
  });

  assert.ok(group);
  assert.equal(group.folderName, '图像生成-素材');
  assert.equal(group.items.length, 2);
  assert.equal(group.items[0].suggestedName, '当前图.png');
  assert.equal(
    group.items[1].sourceUrl,
    '/api/project-cache/material?nodeId=cache-image-2',
  );
});

test('框选批量保存只收集图片和视频节点', () => {
  const groups = rendererModule.collectNodeMediaExportGroups([
    { id: 'prompt-1', type: 'prompt', data: { type: 'prompt', label: '提示词' } },
    {
      id: 'video-1',
      type: 'video',
      data: {
        type: 'video',
        label: '视频生成',
        videoUrl: 'https://example.com/video.mp4',
        generatedVideos: [],
      },
    },
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].nodeId, 'video-1');
  assert.equal(groups[0].items[0].suggestedName, 'video-01.mp4');
});

test('桌面端按节点创建独立文件夹并自动处理重名文件', async () => {
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'magine-batch-export-'));
  try {
    const result = await exportMediaGroups({
      baseDirectory: tempRoot,
      groups: [
        {
          nodeId: 'image-1',
          folderName: '图像生成-素材',
          items: [
            { suggestedName: '画面.png', payload: 'a' },
            { suggestedName: '画面.png', payload: 'b' },
          ],
        },
        {
          nodeId: 'image-2',
          folderName: '图像生成-素材',
          items: [{ suggestedName: '画面.png', payload: 'c' }],
        },
      ],
      sanitizeFileName: (value) => path.basename(String(value || '素材')),
      writeSource: (item, destination) => fs.promises.writeFile(destination, item.payload),
    });

    assert.equal(result.savedCount, 3);
    assert.equal(result.failedCount, 0);
    const firstFiles = await fs.promises.readdir(path.join(tempRoot, '图像生成-素材'));
    const secondFiles = await fs.promises.readdir(path.join(tempRoot, '图像生成-素材 (2)'));
    assert.deepEqual(firstFiles.sort(), ['画面 (2).png', '画面.png']);
    assert.deepEqual(secondFiles, ['画面.png']);
  } finally {
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});

test('单个素材写入失败不会阻断同批次其他素材', async () => {
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'magine-batch-partial-'));
  try {
    const progress = [];
    const result = await exportMediaGroups({
      baseDirectory: tempRoot,
      groups: [{
        nodeId: 'video-1',
        folderName: '视频生成-素材',
        items: [
          { suggestedName: '失败.mp4', payload: 'fail' },
          { suggestedName: '成功.mp4', payload: 'ok' },
        ],
      }],
      sanitizeFileName: (value) => path.basename(String(value || '素材')),
      writeSource: (item, destination) => item.payload === 'fail'
        ? Promise.reject(new Error('source unavailable'))
        : fs.promises.writeFile(destination, item.payload),
      onProgress: (value) => progress.push(value),
    });

    assert.equal(result.savedCount, 1);
    assert.equal(result.failedCount, 1);
    assert.deepEqual(progress.map((item) => item.completedCount), [0, 1, 2]);
    assert.deepEqual(
      progress.map((item) => [item.savedCount, item.failedCount]),
      [[0, 0], [0, 1], [1, 1]],
    );
    assert.deepEqual(await fs.promises.readdir(path.join(tempRoot, '视频生成-素材')), ['成功.mp4']);
  } finally {
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});

test('渲染端只接收当前批量保存任务的实时进度并在完成后解绑', async () => {
  let progressListener;
  let unsubscribed = false;
  globalThis.window = {
    location: { href: 'http://127.0.0.1:3000/' },
    magineDesktop: {
      onMediaBatchProgress: (listener) => {
        progressListener = listener;
        return () => { unsubscribed = true; };
      },
      saveMediaBatch: async (request) => {
        progressListener({
          requestId: 'another-task',
          completedCount: 1,
          totalCount: 1,
          savedCount: 1,
          failedCount: 0,
        });
        progressListener({
          requestId: request.requestId,
          completedCount: 1,
          totalCount: 1,
          savedCount: 1,
          failedCount: 0,
        });
        return { ok: true, canceled: false, savedCount: 1, failedCount: 0 };
      },
    },
  };

  const updates = [];
  try {
    await rendererModule.exportNodeMediaGroups([
      {
        nodeId: 'image-1',
        folderName: '图像生成-素材',
        items: [{ sourceUrl: 'https://example.com/image.png', suggestedName: 'image.png' }],
      },
    ], '选择位置', (progress) => updates.push(progress));
  } finally {
    delete globalThis.window;
  }

  assert.deepEqual(updates.map((item) => item.completedCount), [0, 1]);
  assert.equal(unsubscribed, true);
});
