/**
 * 将 Next `output: "standalone"` 产物整理到 electron/out/next-standalone，供 electron-builder 打进安装包。
 * 官方要求：把 .next/static 与 public 拷入 standalone 目录。
 * @see https://nextjs.org/docs/app/api-reference/config/next-config-js/output
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { cpSync, mkdirSync, rmSync, existsSync } = require('fs');

const root = path.join(__dirname, '..');
const standaloneSrc = path.join(root, '.next', 'standalone');
const dest = path.join(root, 'electron', 'out', 'next-standalone');
const distDir = path.join(root, 'dist-installer-learn');

const logoSrc = path.join(root, 'LOGO.png');
const iconDest = path.join(root, 'build', 'icon.png');
const publicIconDest = path.join(root, 'public', 'icon.png');
const STT_MODEL_DIR_NAME = 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17';
const STT_MIN_MODEL_BYTES = 100 * 1024 * 1024;
const STT_MIN_TOKENS_BYTES = 100 * 1024;
if (existsSync(logoSrc)) {
  mkdirSync(path.dirname(iconDest), { recursive: true });
  cpSync(logoSrc, iconDest);
  cpSync(logoSrc, publicIconDest);
  console.log('[prepare-electron] 已从 LOGO.png 生成 build/icon.png 与 public/icon.png');
} else {
  console.warn('[prepare-electron] 未找到 LOGO.png，安装包将使用已有 build/icon.png');
}

// 清理上次构建的 dist-installer（可能包含 Windows 保留名文件 nul，electron-builder 无法删除）
if (existsSync(distDir)) {
  try { rmSync(distDir, { recursive: true, force: true }); } catch {
    const tmp = path.join(root, '_trash_dist');
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
    try { fs.renameSync(distDir, tmp); } catch { /* ignore */ }
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

if (!existsSync(path.join(standaloneSrc, 'server.js'))) {
  console.error('[prepare-electron] 缺少 .next/standalone/server.js，请先执行: npm run build');
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
// Windows 上 rmSync 可能无法删除 nul（保留设备名），手动清理
const nulInDest = path.join(dest, 'nul');
if (existsSync(nulInDest)) {
  try { fs.unlinkSync(nulInDest); } catch { /* ignore */ }
  try { rmSync(dest, { recursive: true, force: true }); } catch { /* ignore */ }
}
mkdirSync(path.dirname(dest), { recursive: true });
cpSync(standaloneSrc, dest, {
  recursive: true,
  dereference: true,
  filter: (src) => {
    const base = path.basename(src);
    if (base === 'nul') return false;
    // Exclude ALL dist-installer* build artifacts (may leak from prior builds)
    if (/^dist-installer/.test(base)) return false;
    // Exclude source pack output
    if (base === 'dist-source') return false;
    // Delivery archives are repository artifacts, never application runtime files.
    if (base === 'delivery-staging') return false;
    // Exclude independently maintained product variants.
    if (base === 'canvas-learn' || base === 'canvas-clean' || base === 'license-cloudflare') return false;
    // Exclude Electron directory
    if (base === 'electron') return false;
    // Exclude cache / trash / codebuddy
    if (
      base === '.magine-cache' ||
      base === 'magine-cache' ||
      base === 'MagineCanvas-UserData' ||
      base === 'upgrade-backups'
    ) return false;
    if (/^magine-(?:canvas-projects|app-settings)\.json(?:\.bak)?$/i.test(base)) return false;
    if (base === '_trash_dist') return false;
    if (base === '.codebuddy') return false;
    // Exclude temp / debug directories and files
    if (/^_tmp-/.test(base)) return false;
    if (base === '_find_lock.ps1' || base === '_tmp-seedance-recovered.json') return false;
    // Exclude vendor bundles
    if (base === 'vendor') return false;
    // Exclude Dreamina CLI literal ${HOME} directory
    if (base === '${HOME}') return false;
    // Exclude debug screenshots/snapshots/logs from standalone root
    const parent = path.basename(path.dirname(src));
    const ext = path.extname(base);
    if (parent === 'standalone' && (ext === '.png' || ext === '.yaml' || ext === '.log' || ext === '.txt' || ext === '.tsbuildinfo')) return false;
    return true;
  },
});

const staticSrc = path.join(root, '.next', 'static');
const staticDest = path.join(dest, '.next', 'static');
if (existsSync(staticSrc)) {
  mkdirSync(path.dirname(staticDest), { recursive: true });
  cpSync(staticSrc, staticDest, { recursive: true, dereference: true });
} else {
  console.warn('[prepare-electron] 未找到 .next/static，已跳过');
}

// Some App Router layouts are omitted from standalone tracing but still
// reference shared Turbopack SSR chunks at runtime.
const serverChunksSrc = path.join(root, '.next', 'server', 'chunks');
const serverChunksDest = path.join(dest, '.next', 'server', 'chunks');
if (existsSync(serverChunksSrc)) {
  mkdirSync(path.dirname(serverChunksDest), { recursive: true });
  cpSync(serverChunksSrc, serverChunksDest, { recursive: true, dereference: true });
}

// Next 16 Turbopack keeps route runtimes external to server chunks. Its standalone
// trace can omit some of them, which makes packaged API routes fail with HTTP 500.
(function copyNextServerRuntimes() {
  const runtimeSrc = path.join(root, 'node_modules', 'next', 'dist', 'compiled', 'next-server');
  const runtimeDest = path.join(dest, 'node_modules', 'next', 'dist', 'compiled', 'next-server');
  if (!existsSync(runtimeSrc)) {
    throw new Error(`[prepare-electron] 缺少 Next 服务端运行时目录: ${runtimeSrc}`);
  }
  mkdirSync(runtimeDest, { recursive: true });
  cpSync(runtimeSrc, runtimeDest, { recursive: true, dereference: true });

  const requiredRuntimes = [
    'app-route-turbo.runtime.prod.js',
    'pages-api-turbo.runtime.prod.js',
  ];
  for (const runtime of requiredRuntimes) {
    if (!existsSync(path.join(runtimeDest, runtime))) {
      throw new Error(`[prepare-electron] Next 服务端运行时复制失败: ${runtime}`);
    }
  }
  console.log('[prepare-electron] 已补齐 Next Turbopack API 运行时');
})();

const publicSrc = path.join(root, 'public');
const publicDest = path.join(dest, 'public');
if (existsSync(publicSrc)) {
  mkdirSync(path.dirname(publicDest), { recursive: true });
  cpSync(publicSrc, publicDest, {
    recursive: true,
    filter: (src) => !src.endsWith(path.sep + 'nul') && path.basename(src) !== 'nul',
  });
}

function hasUsableSttModel(modelDir) {
  try {
    const model = fs.statSync(path.join(modelDir, 'model.int8.onnx'));
    const tokens = fs.statSync(path.join(modelDir, 'tokens.txt'));
    return model.isFile() &&
      tokens.isFile() &&
      model.size >= STT_MIN_MODEL_BYTES &&
      tokens.size >= STT_MIN_TOKENS_BYTES;
  } catch {
    return false;
  }
}

function findLocalSttModelSource() {
  const candidates = [
    process.env.MAGINE_LOCAL_STT_MODEL_DIR || '',
    process.env.APPDATA
      ? path.join(process.env.APPDATA, 'MagineCanvas', 'magine-cache', 'local-stt', STT_MODEL_DIR_NAME)
      : '',
    path.join(os.homedir(), 'AppData', 'Roaming', 'MagineCanvas', 'magine-cache', 'local-stt', STT_MODEL_DIR_NAME),
    path.join(root, '.magine-cache', 'local-stt', STT_MODEL_DIR_NAME),
  ];

  for (const candidate of candidates) {
    if (candidate && hasUsableSttModel(candidate)) return candidate;
  }
  return null;
}

const sttModelSrc = findLocalSttModelSource();
const sttModelDest = path.join(dest, 'local-stt-models', STT_MODEL_DIR_NAME);
rmSync(path.join(dest, 'local-stt-models'), { recursive: true, force: true });
if (sttModelSrc) {
  mkdirSync(path.dirname(sttModelDest), { recursive: true });
  cpSync(sttModelSrc, sttModelDest, {
    recursive: true,
    dereference: true,
    filter: (src) => path.basename(src) !== 'nul',
  });
  console.log('[prepare-electron] 已内置本地 STT 模型:', sttModelSrc);
} else {
  console.warn('[prepare-electron] 未找到可内置的本地 STT 模型；安装版首次使用仍会尝试联网下载');
}

function copyStandaloneNodePackage(packageName) {
  let packageRoot;
  try {
    packageRoot = path.dirname(require.resolve(path.join(packageName, 'package.json'), { paths: [root] }));
  } catch (error) {
    console.warn(`[prepare-electron] 未找到 ${packageName}，已跳过原生包复制: ${error.message}`);
    return null;
  }

  const packageDest = path.join(dest, 'node_modules', packageName);
  rmSync(packageDest, { recursive: true, force: true });
  mkdirSync(path.dirname(packageDest), { recursive: true });
  cpSync(packageRoot, packageDest, {
    recursive: true,
    dereference: true,
    filter: (src) => path.basename(src) !== 'nul',
  });
  console.log(`[prepare-electron] 已复制 ${packageName} 到 standalone`);
  return packageDest;
}

function walkFiles(dir, visitor) {
  if (!existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, visitor);
    } else if (entry.isFile()) {
      visitor(fullPath);
    }
  }
}

function findHashedExternalAliases(packageName) {
  const aliases = new Set();
  const serverDir = path.join(dest, '.next', 'server');
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b${escaped}-[a-f0-9]{12,}\\b`, 'g');
  walkFiles(serverDir, (filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if (ext !== '.js' && ext !== '.json') return;
    let text = '';
    try {
      text = fs.readFileSync(filePath, 'utf8');
    } catch {
      return;
    }
    for (const match of text.matchAll(re)) {
      aliases.add(match[0]);
    }
  });
  return Array.from(aliases);
}

function copyHashedExternalAliases(packageName) {
  const aliases = findHashedExternalAliases(packageName);
  if (aliases.length === 0) return;

  const sourceDir = path.join(dest, 'node_modules', packageName);
  if (!existsSync(sourceDir)) {
    console.warn(`[prepare-electron] ${packageName} alias skipped: missing ${sourceDir}`);
    return;
  }

  for (const alias of aliases) {
    const aliasDir = path.join(dest, 'node_modules', alias);
    rmSync(aliasDir, { recursive: true, force: true });
    cpSync(sourceDir, aliasDir, {
      recursive: true,
      dereference: true,
      filter: (src) => path.basename(src) !== 'nul',
    });
    console.log(`[prepare-electron] 已补齐 Next 外部模块别名: ${alias} -> ${packageName}`);
  }
}

copyHashedExternalAliases('sharp');
const ffmpegStaticDest = copyStandaloneNodePackage('ffmpeg-static');
if (!ffmpegStaticDest || !existsSync(path.join(ffmpegStaticDest, 'ffmpeg.exe'))) {
  throw new Error('[prepare-electron] ffmpeg-static 缺少 ffmpeg.exe，已中止打包以避免素材剪辑功能残缺');
}

// Next standalone tracing copies only .node files and misses libvips DLLs that sharp depends on.
// Explicitly copy the full @img/sharp-win32-x64 native package.
(function copySharpNativeBinaries() {
  const sharpNativeSrc = path.join(root, 'node_modules', '@img', 'sharp-win32-x64');
  if (!existsSync(sharpNativeSrc) || !existsSync(path.join(sharpNativeSrc, 'package.json'))) {
    console.warn('[prepare-electron] 未找到 @img/sharp-win32-x64，跳过 sharp 原生 DLL 复制');
    return;
  }
  const destSharpNative = path.join(dest, 'node_modules', '@img', 'sharp-win32-x64');
  rmSync(destSharpNative, { recursive: true, force: true });
  mkdirSync(path.dirname(destSharpNative), { recursive: true });
  cpSync(sharpNativeSrc, destSharpNative, {
    recursive: true,
    dereference: true,
    filter: (src) => path.basename(src) !== 'nul',
  });
  console.log('[prepare-electron] 已复制 sharp 原生 DLL (libvips) 到 standalone');
})();

// Next standalone tracing may copy only sherpa-onnx.node and miss adjacent DLLs.
// Keep the full native runtime package next to the production Next server.
const sherpaNodeDest = copyStandaloneNodePackage('sherpa-onnx-node');
const sherpaNativeDest = copyStandaloneNodePackage('sherpa-onnx-win-x64');
if (sherpaNodeDest && sherpaNativeDest) {
  const nestedNativeDest = path.join(sherpaNodeDest, 'node_modules', 'sherpa-onnx-win-x64');
  rmSync(nestedNativeDest, { recursive: true, force: true });
  mkdirSync(path.dirname(nestedNativeDest), { recursive: true });
  cpSync(sherpaNativeDest, nestedNativeDest, { recursive: true, dereference: true });
  for (const name of fs.readdirSync(sherpaNativeDest)) {
    if (/\.(node|dll)$/i.test(name)) {
      cpSync(path.join(sherpaNativeDest, name), path.join(sherpaNodeDest, name));
    }
  }
  console.log('[prepare-electron] 已补齐 sherpa-onnx-node 原生 fallback 路径');
}

// 清理可能从上次构建残留的 nul 文件（Windows 保留设备名，electron-builder 无法删除）
const nulFile = path.join(dest, 'nul');
if (existsSync(nulFile)) {
  try { fs.unlinkSync(nulFile); } catch { /* ignore */ }
}

// electron-builder 内部强制过滤所有 **/node_modules/** 路径，
// 将 node_modules 重命名为 _standalone_vendor，由 Electron 主进程通过 NODE_PATH 指向它。
(function renameStandaloneNodeModules() {
  const nmPath = path.join(dest, 'node_modules');
  const vendorPath = path.join(dest, '_standalone_vendor');
  if (existsSync(nmPath)) {
    rmSync(vendorPath, { recursive: true, force: true });
    try {
      fs.renameSync(nmPath, vendorPath);
      console.log('[prepare-electron] 已将 standalone node_modules 重命名为 _standalone_vendor');
    } catch (e) {
      // Windows 上可能因为文件锁 rename 失败，改用 copy + remove
      cpSync(nmPath, vendorPath, { recursive: true, dereference: true });
      rmSync(nmPath, { recursive: true, force: true });
      console.log('[prepare-electron] 已将 standalone node_modules 重命名为 _standalone_vendor (copy fallback)');
    }
  }
})();

console.log('[prepare-electron] 已生成', dest);

// Electron utilityProcess does not reliably initialize NODE_PATH. Make the
// renamed standalone dependencies resolvable before server.js requires Next.
(function patchStandaloneModuleResolution() {
  const serverPath = path.join(dest, 'server.js');
  const marker = 'MAGINE_STANDALONE_VENDOR_BOOTSTRAP';
  let source = fs.readFileSync(serverPath, 'utf8');
  if (source.includes(marker)) return;

  const anchor = "const path = require('path')";
  if (!source.includes(anchor)) {
    throw new Error('[prepare-electron] standalone server.js is missing the path import');
  }

  const bootstrap = [
    anchor,
    `// ${marker}`,
    "const Module = require('module')",
    "process.env.NODE_PATH = [path.join(__dirname, '_standalone_vendor'), process.env.NODE_PATH]",
    "  .filter(Boolean)",
    "  .join(path.delimiter)",
    "Module._initPaths()",
  ].join('\n');
  source = source.replace(anchor, bootstrap);
  fs.writeFileSync(serverPath, source, 'utf8');
  console.log('[prepare-electron] Patched standalone module resolution');
})();

const coreSrc = path.join(root, 'scripts', 'dreamina-cli-core.cjs');
const coreDest = path.join(dest, 'scripts', 'dreamina-cli-core.cjs');
if (existsSync(coreSrc)) {
  mkdirSync(path.dirname(coreDest), { recursive: true });
  cpSync(coreSrc, coreDest);
}

require('child_process').execSync('node scripts/generate-win-icon-ico.cjs', {
  cwd: root,
  stdio: 'inherit',
});
