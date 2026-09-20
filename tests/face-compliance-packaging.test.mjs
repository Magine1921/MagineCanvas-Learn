import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

function fileSize(relativePath) {
  return fs.statSync(path.join(root, relativePath)).size;
}

test('face compliance ships its ONNX wasm runtime without requiring model weights', () => {
  assert.ok(fileSize('public/ort/ort-wasm-simd-threaded.mjs') > 20_000);
  assert.ok(fileSize('public/ort/ort-wasm-simd-threaded.wasm') > 10_000_000);
  assert.ok(fileSize('public/models/face/README.md') > 200);
});

test('face compliance supports a user-supplied model and keeps retry possible', () => {
  const source = fs.readFileSync(path.join(root, 'src/lib/face-compliance.ts'), 'utf8');

  assert.match(source, /from ['"]onnxruntime-web\/wasm['"]/);
  assert.match(source, /ort\.env\.wasm\.wasmPaths\s*=\s*['"]\/ort\/['"]/);
  assert.match(source, /FACE_COMPLIANCE_MODEL_FILE\s*=\s*['"]scrfd_2\.5g_bnkps\.onnx['"]/);
  assert.match(source, /未安装人脸合规模型/);
  assert.match(source, /确认拥有合法使用权/);
  assert.match(source, /fetch\(url, \{ cache: ['"]force-cache['"] \}\)/);
  assert.match(source, /loadPromise\s*=\s*null/);
  assert.doesNotMatch(source, /api\/proxy\/model/);
  assert.doesNotMatch(source, /hf-mirror|huggingface\.co/);
  assert.doesNotMatch(source, /wasmPaths\s*=\s*['"]https:\/\//);
});

test('electron standalone preparation copies public runtime assets', () => {
  const source = fs.readFileSync(path.join(root, 'scripts/prepare-electron-standalone.cjs'), 'utf8');
  assert.match(source, /const publicSrc = path\.join\(root, ['"]public['"]\)/);
  assert.match(source, /cpSync\(publicSrc, publicDest/);
});

test('standalone tracing excludes every installer output directory', () => {
  const source = fs.readFileSync(path.join(root, 'next.config.ts'), 'utf8');
  assert.match(source, /['"]dist-installer\*\/\*\*['"]/);
});
