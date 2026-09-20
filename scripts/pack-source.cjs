/**
 * 打包项目源码 zip（排除 node_modules、构建产物、临时文件）。
 * 输出：dist-source/MagineCanvas-{version}-source.zip
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const { version } = require('../package.json');
const outDir = path.join(root, 'dist-source');
const outFile = path.join(outDir, `MagineCanvas-Learn-${version}-source.zip`);

/** 目录名命中则整棵子树跳过 */
const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.git',
  '.agents',
  '.claude',
  '.cursor',
  '.magine-cache',
  'magine-cache',
  '.codex-logs',
  '.codex-run',
  '.codex-runtime',
  '.runtime',
  '.vscode',
  '.workbuddy',
  '.wrangler',
  '.open-next',
  '.cloudflare-trial-static',
  '.playwright-cli',
  '.vercel',
  '.codebuddy',
  '${HOME}',
  'coverage',
  'dist-source',
  'delivery-staging',
  'dist-installer',
  'dist-installer-2',
  'dist-installer-6',
  'canvas-learn',
  'canvas-clean',
  'license-cloudflare',
  '_tmp-chrome-ls',
  '_tmp-edge-ls',
  '_tmp-edge-ls-copy',
  '_tmp-electron-ls',
  '_trash_dist',
  '--help',
]);

/** 相对路径前缀跳过 */
const SKIP_PREFIXES = ['electron/out', 'electron\\out'];

/** 单文件跳过（basename 或相对路径） */
const SKIP_FILES = new Set([
  '_find_lock.ps1',
  '_tmp-seedance-recovered.json',
  'nul',
  '.DS_Store',
]);

function shouldSkip(relPosix) {
  if (!relPosix) return false;
  for (const prefix of SKIP_PREFIXES) {
    if (relPosix === prefix || relPosix.startsWith(`${prefix}/`)) return true;
  }
  const base = path.posix.basename(relPosix);
  if (SKIP_FILES.has(base)) return true;
  if (/^(debug-|dev-).*\.(log|txt)$/i.test(base)) return true;
  if (/^(tmp_|tmp-|temp-)/i.test(base)) return true;
  if (/snapshot\.ya?ml$/i.test(base)) return true;
  if (base.toLowerCase().endsWith('.log')) return true;
  if (base.toLowerCase().endsWith('.zip')) return true;
  if (base.toLowerCase().startsWith('dist-installer')) return true;
  if (base.startsWith('.env')) return true;
  if (base.endsWith('.tsbuildinfo')) return true;
  if (
    relPosix === 'public/jianshen' ||
    relPosix.startsWith('public/jianshen/') ||
    relPosix === 'public/maginecanvas' ||
    relPosix.startsWith('public/maginecanvas/') ||
    relPosix === 'vendor/JianshenVideoEditorWeb' ||
    relPosix.startsWith('vendor/JianshenVideoEditorWeb/')
  ) {
    return true;
  }
  const parts = relPosix.split('/');
  if (parts.some((part) => /^(?:\.runtime-smoke-|\.package-smoke-|\.chrome-.*-smoke$)/.test(part))) {
    return true;
  }
  return parts.some((part) => SKIP_DIRS.has(part));
}

/** LOGO / 图标：gitignore 排除了 *.png，但源码包需保留 */
function forceInclude(relPosix) {
  return (
    relPosix === 'LOGO.png' ||
    relPosix === 'build/icon.png' ||
    relPosix === 'build/icon.ico' ||
    relPosix === 'public/icon.png'
  );
}

function walk(dir, base = dir, files = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const ent of entries) {
    const abs = path.join(dir, ent.name);
    const rel = path.relative(base, abs).split(path.sep).join('/');
    if (shouldSkip(rel) && !forceInclude(rel)) continue;
    if (ent.isDirectory()) {
      walk(abs, base, files);
    } else if (ent.isFile()) {
      if (SKIP_FILES.has(ent.name) && !forceInclude(rel)) continue;
      if (ent.name.startsWith('.env')) continue;
      files.push({ abs, rel });
    }
  }
  return files;
}

function main() {
  fs.mkdirSync(outDir, { recursive: true });
  if (fs.existsSync(outFile)) fs.unlinkSync(outFile);

  const files = walk(root);

  void (async () => {
    const { ZipArchive } = await import('archiver');
    const output = fs.createWriteStream(outFile);
    const archive = new ZipArchive({ zlib: { level: 9 } });

    output.on('close', () => {
      const mb = (archive.pointer() / (1024 * 1024)).toFixed(2);
      console.log(`[pack-source] 已生成 ${outFile} (${mb} MB, ${files.length} 个文件)`);
    });

    archive.on('error', (err) => {
      console.error('[pack-source] 失败:', err);
      process.exit(1);
    });

    archive.pipe(output);
    for (const { abs, rel } of files) {
      archive.file(abs, { name: `MagineCanvas-Learn-${version}/${rel}` });
    }
    await archive.finalize();
  })();
}

main();
