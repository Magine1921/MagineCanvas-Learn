import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  normalizeSubtitleRemovalRegion,
  subtitleRemovalRegionToTencentArea,
} from '../src/lib/subtitle-removal-region.ts';

test('去字幕框选区域统一转换为腾讯云百分比坐标', () => {
  const normalized = normalizeSubtitleRemovalRegion({
    left: 0.8,
    top: 0.7,
    right: 0.2,
    bottom: 0.4,
  });
  assert.deepEqual(normalized, {
    left: 0.2,
    top: 0.4,
    right: 0.8,
    bottom: 0.7,
  });
  assert.deepEqual(subtitleRemovalRegionToTencentArea(normalized), {
    LeftTopX: 0.2,
    LeftTopY: 0.4,
    RightBottomX: 0.8,
    RightBottomY: 0.7,
    Unit: 1,
  });
  assert.equal(normalizeSubtitleRemovalRegion({ left: 0.1, top: 0.1, right: 0.101, bottom: 0.101 }), null);
});

test('图片、视频和素材节点点击去字幕后均打开统一操作窗口', async () => {
  const files = [
    'src/components/nodes/ImageNode.tsx',
    'src/components/nodes/VideoNode.tsx',
    'src/components/nodes/MaterialNode.tsx',
  ];
  const sources = await Promise.all(files.map((file) => fs.promises.readFile(path.resolve(file), 'utf8')));
  for (const source of sources) {
    assert.match(source, /setSubtitleRemovalDialogOpen\(true\)/);
    assert.match(source, /<SubtitleRemovalDialog/);
    assert.match(source, /void handleRemoveSubtitles\(options\)/);
  }
});

test('指定区域会分别进入腾讯云视频和图片擦除参数', async () => {
  const [dialogSource, clientSource, routeSource] = await Promise.all([
    fs.promises.readFile(path.resolve('src/components/nodes/SubtitleRemovalDialog.tsx'), 'utf8'),
    fs.promises.readFile(path.resolve('src/lib/subtitle-remover.ts'), 'utf8'),
    fs.promises.readFile(path.resolve('src/app/api/tencent-mps/subtitle-removal/route.ts'), 'utf8'),
  ]);
  assert.match(dialogSource, /自动识别擦除/);
  assert.match(dialogSource, /指定区域擦除/);
  assert.match(dialogSource, /getMaterialBlob\(materialRefToNodeId\(sourceUrl\)\)/);
  assert.match(dialogSource, /按住鼠标拖拽框选字幕区域/);
  assert.match(clientSource, /form\.set\('mode', mode\)/);
  assert.match(clientSource, /form\.set\('region', JSON\.stringify\(region\)\)/);
  assert.match(routeSource, /OverrideParameter:/);
  assert.match(routeSource, /SubtitleEraseMethod: 'custom'/);
  assert.match(routeSource, /CustomAreas: \[\{ BeginMs: 0, EndMs: 0, Areas: \[area\] \}\]/);
  assert.match(routeSource, /ImageAreaBoxes:/);
  assert.match(routeSource, /BoundingBoxUnitType: 1/);
});
