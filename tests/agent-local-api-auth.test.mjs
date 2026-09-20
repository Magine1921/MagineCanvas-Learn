import assert from 'node:assert/strict';
import test from 'node:test';

import { authorizeAgentLocalApiRequest } from '../src/lib/agent-local-api-auth.server.ts';

function request(url = 'http://127.0.0.1:3060/api/agent/file', headers = {}, method = 'POST') {
  return new Request(url, {
    method,
    headers: {
      Host: new URL(url).host,
      Origin: new URL(url).origin,
      'Content-Type': 'application/json',
      'Sec-Fetch-Site': 'same-origin',
      ...headers,
    },
    body: method === 'POST' ? '{}' : undefined,
  });
}

test('development Agent API accepts an exact loopback same-origin JSON request', () => {
  assert.deepEqual(authorizeAgentLocalApiRequest(request(), { production: false }), { ok: true, status: 200 });
  assert.deepEqual(
    authorizeAgentLocalApiRequest(request('http://[::1]:3060/api/agent/file'), { production: false }),
    { ok: true, status: 200 },
  );
});

test('Agent API rejects absent, null, malformed, cross-port and cross-site origins', () => {
  for (const headers of [
    { Origin: '' },
    { Origin: 'null' },
    { Origin: 'not a url' },
    { Origin: 'http://127.0.0.1:9999' },
    { Origin: 'https://evil.example' },
    { 'Sec-Fetch-Site': 'cross-site' },
  ]) {
    assert.equal(authorizeAgentLocalApiRequest(request(undefined, headers), { production: false }).ok, false);
  }
});

test('Agent API rejects non-loopback hosts, non-JSON bodies and non-POST methods', () => {
  assert.equal(authorizeAgentLocalApiRequest(request('http://192.168.1.20:3060/api/agent/file'), { production: false }).ok, false);
  assert.equal(authorizeAgentLocalApiRequest(request(undefined, { 'Content-Type': 'text/plain' }), { production: false }).status, 415);
  assert.equal(authorizeAgentLocalApiRequest(request(undefined, {}, 'GET'), { production: false }).status, 405);
});

test('production Agent API fails closed without the Electron token', () => {
  assert.equal(authorizeAgentLocalApiRequest(request(), { production: true, expectedToken: '' }).ok, false);
  assert.equal(authorizeAgentLocalApiRequest(request(), { production: true, expectedToken: 'expected' }).ok, false);
  assert.equal(authorizeAgentLocalApiRequest(
    request(undefined, { 'X-Magine-Desktop-Token': 'wrong' }),
    { production: true, expectedToken: 'expected' },
  ).ok, false);
  assert.deepEqual(authorizeAgentLocalApiRequest(
    request(undefined, { 'X-Magine-Desktop-Token': 'expected' }),
    { production: true, expectedToken: 'expected' },
  ), { ok: true, status: 200 });
});
