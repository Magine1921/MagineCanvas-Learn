/** dev:desktop 专用：Next dev 与 Electron 安装版共用 userData/magine-cache */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { getMagineCacheRoot } = require('./magine-cache-root.cjs');

const cacheRoot = getMagineCacheRoot();
fs.mkdirSync(cacheRoot, { recursive: true });
console.log('[dev:desktop] MAGINE_CACHE_ROOT:', cacheRoot);

const root = path.join(__dirname, '..');
const port = String(process.env.ELECTRON_NEXT_PORT || process.env.PORT || '3100');
const env = {
  ...process.env,
  PORT: port,
  MAGINE_CACHE_ROOT: cacheRoot,
};

const child = spawn('npx', ['next', 'dev', '--webpack', '-H', '127.0.0.1', '-p', port], {
  cwd: root,
  env,
  stdio: 'inherit',
  shell: true,
});

child.on('close', (code) => process.exit(code ?? 0));
