const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const target = path.join(root, '.cloudflare-trial-static');
const maxAssetBytes = 25 * 1024 * 1024;
const requiredPublicAssets = ['logo-symbol-relief.svg'];
let copied = 0;
let skipped = 0;

function copyTree(source, destination) {
  if (!fs.existsSync(source)) return;
  const stat = fs.statSync(source);
  if (stat.isFile()) {
    if (stat.size >= maxAssetBytes) {
      skipped += 1;
      return;
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    copied += 1;
    return;
  }

  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source)) {
    copyTree(path.join(source, entry), path.join(destination, entry));
  }
}

function copyRequired(source, destination) {
  if (!fs.existsSync(source)) throw new Error(`Missing web-trial build output: ${source}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  copied += 1;
}

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });

copyTree(path.join(root, 'public'), target);
copyTree(path.join(root, '.next', 'static'), path.join(target, '_next', 'static'));
copyRequired(path.join(root, '.next', 'server', 'app', 'index.html'), path.join(target, 'index.html'));
copyRequired(path.join(root, '.next', 'server', 'app', 'index.rsc'), path.join(target, 'index.rsc'));

const faviconBody = path.join(root, '.next', 'server', 'app', 'favicon.ico.body');
if (fs.existsSync(faviconBody)) copyRequired(faviconBody, path.join(target, 'favicon.ico'));

for (const route of ['pixi-demo', 'playcanvas-demo']) {
  const html = path.join(root, '.next', 'server', 'app', `${route}.html`);
  const rsc = path.join(root, '.next', 'server', 'app', `${route}.rsc`);
  if (fs.existsSync(html)) copyRequired(html, path.join(target, route, 'index.html'));
  if (fs.existsSync(rsc)) copyRequired(rsc, path.join(target, route, 'index.rsc'));
}

for (const asset of requiredPublicAssets) {
  const assetPath = path.join(target, asset);
  if (!fs.existsSync(assetPath)) {
    throw new Error(`Missing required Cloudflare static asset: ${assetPath}`);
  }
}

console.log(`[cloudflare-static-trial] Prepared ${copied} assets; skipped ${skipped} desktop-only oversized assets.`);
