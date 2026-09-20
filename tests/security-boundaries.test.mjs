import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readSource = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('model proxies never trust a client-declared provider host', async () => {
  const files = [
    'src/pages/api/proxy/openai.ts',
    'src/pages/api/proxy/gemini.ts',
    'src/pages/api/proxy/volcengine.ts',
    'src/lib/custom-provider-request.ts',
  ];
  for (const file of files) {
    const source = await readSource(file);
    assert.doesNotMatch(source, /X-Custom-Provider-Host|x-custom-provider-host|isCustomProviderHostAllowed/, file);
    assert.match(source, /fetchSafeOutboundUrl|服务端(?:环境)?(?:代理)?白名单/, file);
  }
});

test('all proxy fetches use redirect-safe outbound validation', async () => {
  for (const file of [
    'src/pages/api/proxy/openai.ts',
    'src/pages/api/proxy/gemini.ts',
    'src/pages/api/proxy/volcengine.ts',
    'src/pages/api/proxy/upload.ts',
    'src/pages/api/proxy/model.ts',
  ]) {
    const source = await readSource(file);
    assert.match(source, /fetchSafeOutboundUrl/, file);
    assert.doesNotMatch(source, /await fetch\(/, file);
  }
});

test('custom public provider hosts require the Electron desktop token', async () => {
  for (const file of [
    'src/pages/api/proxy/openai.ts',
    'src/pages/api/proxy/gemini.ts',
    'src/pages/api/proxy/volcengine.ts',
    'src/pages/api/proxy/upload.ts',
    'src/pages/api/proxy/model.ts',
    'src/app/api/provider/test/route.ts',
  ]) {
    const source = await readSource(file);
    assert.match(source, /hasValidDesktopApiToken\(/, file);
    assert.match(source, /desktopAuthorized/, file);
    assert.match(source, /allowedProtocols:\s*\['https:'\]/, file);
  }
});

test('desktop Agent APIs require shared authorization and Electron injects a per-launch token', async () => {
  const fileRoute = await readSource('src/app/api/agent/file/route.ts');
  const terminalRoute = await readSource('src/app/api/agent/terminal/route.ts');
  const electron = await readSource('electron/main.cjs');

  assert.match(fileRoute, /authorizeAgentLocalApiRequest\(req\)/);
  assert.match(terminalRoute, /authorizeAgentLocalApiRequest\(req\)/);
  assert.match(electron, /randomBytes\(32\)\.toString\('base64url'\)/);
  assert.match(electron, /MAGINE_AGENT_API_TOKEN: AGENT_API_TOKEN/);
  assert.match(electron, /details\.webContentsId === mainWindow\.webContents\.id/);
  assert.match(electron, /url\.pathname === '\/api\/agent\/file'/);
  assert.match(electron, /url\.pathname === '\/api\/provider\/test'/);
  assert.match(electron, /openai\|gemini\|volcengine\|model\|upload/);
  assert.match(electron, /X-Magine-Desktop-Token/);
  assert.doesNotMatch(electron, /console\.(?:log|error|warn)\([^\n]*AGENT_API_TOKEN/);
});

test('desktop dev server binds to loopback', async () => {
  const source = await readSource('electron/run-dev-next.cjs');
  assert.match(source, /'-H', '127\.0\.0\.1'/);
});

test('music API creates its anonymous token before requiring the service', async () => {
  const source = await readSource('electron/main.cjs');
  const createIndex = source.indexOf("path.join(os.tmpdir(), 'anonymous_token')");
  const requireIndex = source.indexOf("require('NeteaseCloudMusicApi/server')");
  assert.ok(createIndex >= 0 && requireIndex > createIndex);
  assert.match(source.slice(createIndex, requireIndex), /writeFileSync\(anonymousTokenPath, ''/);
});
