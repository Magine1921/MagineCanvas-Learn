const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const packageJson = JSON.parse(
  fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'),
);
const isLearnEdition = packageJson.name === 'magine-canvas-learn';
const required = process.env.MAGINE_REQUIRE_LICENSE === '1';
const defaultServerUrl = 'https://magine-license-console.magine1921.workers.dev';
const rawServerUrl = String(
  process.env.MAGINE_LICENSE_SERVER_URL || defaultServerUrl,
).trim();

function normalizeServerUrl(value) {
  if (!value) return '';
  const parsed = new URL(value);
  const local =
    parsed.protocol === 'http:' &&
    (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost');
  if (parsed.protocol !== 'https:' && !local) {
    throw new Error('MAGINE_LICENSE_SERVER_URL 必须使用 HTTPS；仅本地开发允许 HTTP localhost。');
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

const serverUrl = normalizeServerUrl(rawServerUrl);
if (required && !serverUrl) {
  throw new Error(
    '安全授权包缺少 MAGINE_LICENSE_SERVER_URL。请先部署 license-cloudflare，再设置 Worker HTTPS 地址。',
  );
}

const config = {
  version: 1,
  required,
  serverUrl,
  packageId:
    process.env.MAGINE_LICENSE_PACKAGE_ID ||
    (isLearnEdition ? 'maginecanvas-learn' : 'maginecanvas-full'),
  product:
    process.env.MAGINE_LICENSE_PRODUCT ||
    (isLearnEdition ? 'Magine Canvas 学习版' : 'Magine Canvas 完整版'),
  requestTimeoutMs: 10_000,
  offlineGraceHours: Math.min(
    720,
    Math.max(0, Number(process.env.MAGINE_OFFLINE_GRACE_HOURS) || 72),
  ),
};

const output = path.join(projectRoot, 'build', 'license-config.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
console.log(
  `[license-config] ${config.packageId}: ${required ? 'required' : 'not required'}${
    serverUrl ? ` -> ${serverUrl}` : ''
  }`,
);
