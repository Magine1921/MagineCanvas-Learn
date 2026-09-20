const fs = require('fs');
const path = require('path');

const assetsRoot = path.join(__dirname, '..', '.open-next', 'assets');
const cloudflareAssetLimit = 25 * 1024 * 1024;
const removableCloudflareAssets = [/ort-wasm.*\.wasm$/i, /ffmpeg-core\.wasm$/i];
const requiredAssets = ['logo-symbol-relief.svg'];
let removed = 0;

function prune(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      prune(filePath);
      continue;
    }

    const size = fs.statSync(filePath).size;
    if (
      size >= cloudflareAssetLimit &&
      removableCloudflareAssets.some((pattern) => pattern.test(filePath))
    ) {
      fs.rmSync(filePath, { force: true });
      removed += 1;
    }
  }
}

prune(assetsRoot);
for (const asset of requiredAssets) {
  const assetPath = path.join(assetsRoot, asset);
  if (!fs.existsSync(assetPath)) {
    throw new Error(`Missing required Cloudflare asset: ${assetPath}`);
  }
}
console.log(`[cloudflare-build] Removed ${removed} oversized desktop-only assets.`);
