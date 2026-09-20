import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertSafeOutboundUrl,
  fetchSafeOutboundUrl,
  isNonPublicIpAddress,
  parseServerHostAllowlist,
} from '../src/lib/server-outbound-request.ts';

const publicDns = async () => ['93.184.216.34'];

test('outbound URL validation rejects local names, credentials and every IP literal', () => {
  for (const url of [
    'https://localhost/admin',
    'https://service.internal/admin',
    'https://metadata.google.internal/computeMetadata/v1/',
    'https://127.0.0.1/admin',
    'https://2130706433/admin',
    'https://[::1]/admin',
    'https://8.8.8.8/',
    'https://user:password@example.com/',
  ]) {
    assert.throws(() => assertSafeOutboundUrl(url), /not allowed|IP-literal|Credential-bearing/);
  }
});

test('resolved private, loopback and link-local addresses are rejected', async () => {
  for (const address of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1', '192.168.1.2', '::1', 'fd00::1', 'fe80::1']) {
    assert.equal(isNonPublicIpAddress(address), true, address);
    await assert.rejects(
      fetchSafeOutboundUrl('https://example.com/data', {}, {
        resolveHostname: async () => [address],
        fetchImpl: async () => new Response('must not run'),
      }),
      /non-public address/,
    );
  }
  assert.equal(isNonPublicIpAddress('93.184.216.34'), false);
  assert.equal(isNonPublicIpAddress('2606:2800:220:1:248:1893:25c8:1946'), false);
});

test('redirect targets are revalidated before a second request', async () => {
  const requested = [];
  await assert.rejects(
    fetchSafeOutboundUrl('https://allowed.example/start', {}, {
      isAllowedUrl: (url) => url.hostname === 'allowed.example',
      resolveHostname: publicDns,
      fetchImpl: async (url) => {
        requested.push(url.toString());
        return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/private' } });
      },
    }),
    /IP-literal/,
  );
  assert.deepEqual(requested, ['https://allowed.example/start']);
});

test('redirects cannot escape a server allowlist', async () => {
  await assert.rejects(
    fetchSafeOutboundUrl('https://allowed.example/start', {}, {
      isAllowedUrl: (url) => url.hostname === 'allowed.example',
      resolveHostname: publicDns,
      fetchImpl: async () => new Response(null, {
        status: 307,
        headers: { location: 'https://attacker.example/steal' },
      }),
    }),
    /not allowlisted/,
  );
});

test('cross-origin redirects strip credentials and same-origin redirects preserve them', async () => {
  const requests = [];
  const response = await fetchSafeOutboundUrl('https://one.example/start', {
    method: 'GET',
    headers: { Authorization: 'Bearer secret', 'X-API-Key': 'secret' },
  }, {
    isAllowedUrl: (url) => url.hostname === 'one.example' || url.hostname === 'two.example',
    resolveHostname: publicDns,
    fetchImpl: async (url, init) => {
      requests.push({ url: url.toString(), headers: new Headers(init?.headers) });
      if (requests.length === 1) {
        return new Response(null, { status: 302, headers: { location: '/next' } });
      }
      if (requests.length === 2) {
        return new Response(null, { status: 302, headers: { location: 'https://two.example/final' } });
      }
      return new Response('ok');
    },
  });
  assert.equal(await response.text(), 'ok');
  assert.equal(requests[1].headers.get('authorization'), 'Bearer secret');
  assert.equal(requests[2].headers.get('authorization'), null);
  assert.equal(requests[2].headers.get('x-api-key'), null);
});

test('server allowlist parser accepts hostnames but drops IP literals and malformed entries', () => {
  assert.deepEqual(
    [...parseServerHostAllowlist('api.example.com, https://gateway.example.net/v1 127.0.0.1 :::')],
    ['api.example.com', 'gateway.example.net'],
  );
});
