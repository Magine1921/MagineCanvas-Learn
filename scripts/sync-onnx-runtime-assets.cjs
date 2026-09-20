/** 将已锁定、MIT 许可的 onnxruntime-web WASM 运行时同步到 Next.js public。 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const sourceDir = path.join(root, 'node_modules', 'onnxruntime-web', 'dist');
const targetDir = path.join(root, 'public', 'ort');
const assets = ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'];

for (const name of assets) {
  const source = path.join(sourceDir, name);
  if (!fs.existsSync(source)) {
    console.error(`[sync-onnx-runtime-assets] 缺少依赖文件：${source}`);
    process.exit(1);
  }
}

fs.mkdirSync(targetDir, { recursive: true });
for (const name of assets) {
  fs.copyFileSync(path.join(sourceDir, name), path.join(targetDir, name));
}
console.log('[sync-onnx-runtime-assets] 已同步 onnxruntime-web WASM 运行时');
