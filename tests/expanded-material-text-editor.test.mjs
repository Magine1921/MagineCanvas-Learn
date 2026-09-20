import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('learning edition keeps the shared large text editor outside commercial-only nodes', async () => {
  const [expandableSource, imageSource, videoSource, musicSource] = await Promise.all([
    readFile(new URL('../src/components/canvas/ExpandableTextField.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/nodes/ImageNode.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/nodes/VideoNode.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/nodes/MusicNode.tsx', import.meta.url), 'utf8'),
  ]);

  assert.match(expandableSource, /<MaterialPreviewStrip/);
  assert.match(expandableSource, /showLabel=\{false\}/);
  assert.match(expandableSource, /<MentionTextarea/);
  assert.match(expandableSource, /fillHeight/);
  assert.match(expandableSource, /autoFocus/);
  for (const source of [imageSource, videoSource, musicSource]) {
    assert.match(source, /<ExpandableTextField/);
  }
});

test('learning edition material mentions support video and audio trimming', async () => {
  const [hoverSource, stripSource, mentionSource, editorSource, stylesSource] = await Promise.all([
    readFile(new URL('../src/components/canvas/MaterialMediaHoverPreview.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/canvas/MaterialPreviewStrip.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/canvas/MentionTextarea.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/nodes/MaterialMediaEditor.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/app/globals.css', import.meta.url), 'utf8'),
  ]);

  assert.match(hoverSource, /<MaterialMediaEditor/);
  assert.match(hoverSource, /materialVideoTrim/);
  assert.match(hoverSource, /materialAudioTrim/);
  assert.match(hoverSource, /updateNodeData\(editingMaterial\.nodeId/);
  assert.match(stripSource, /useMaterialMediaHoverPreview/);
  assert.match(mentionSource, /enableHover=\{false\}/);
  assert.match(editorSource, /z-\[10200\]/);
  assert.match(stylesSource, /\.mention-token[\s\S]*?color: rgba\(250, 250, 250, 0\.94\)/);
});
