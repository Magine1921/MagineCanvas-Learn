/** 从仓库内的原创 SVG 生成 Web/Electron 图标，不依赖旧版图像转换库。 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = path.join(__dirname, '..');
const source = path.join(root, 'public', 'logo-symbol-relief.svg');
const buildPng = path.join(root, 'build', 'icon.png');
const publicPng = path.join(root, 'public', 'icon.png');
const buildIco = path.join(root, 'build', 'icon.ico');
const faviconIco = path.join(root, 'src', 'app', 'favicon.ico');

function encodeIco(images) {
  const directorySize = 6 + images.length * 16;
  const header = Buffer.alloc(directorySize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = directorySize;
  images.forEach(({ size, buffer }, index) => {
    const entry = 6 + index * 16;
    header.writeUInt8(size === 256 ? 0 : size, entry);
    header.writeUInt8(size === 256 ? 0 : size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(buffer.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += buffer.length;
  });
  return Buffer.concat([header, ...images.map(({ buffer }) => buffer)]);
}

if (!fs.existsSync(source)) {
  console.error('[generate-win-icon-ico] 缺少原创图标源:', source);
  process.exit(1);
}

(async () => {
  const sizes = [256, 128, 64, 48, 32, 16];
  const images = await Promise.all(
    sizes.map(async (size) => ({
      size,
      buffer: await sharp(source)
        .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer(),
    }))
  );
  const webIcon = await sharp(source)
    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const ico = encodeIco(images);

  fs.mkdirSync(path.dirname(buildPng), { recursive: true });
  fs.mkdirSync(path.dirname(faviconIco), { recursive: true });
  fs.writeFileSync(buildPng, webIcon);
  fs.writeFileSync(publicPng, webIcon);
  fs.writeFileSync(buildIco, ico);
  fs.writeFileSync(faviconIco, ico);
  console.log('[generate-win-icon-ico] 已生成原创 Web/Electron 图标');
})().catch((err) => {
  console.error('[generate-win-icon-ico] 失败:', err);
  process.exit(1);
});
