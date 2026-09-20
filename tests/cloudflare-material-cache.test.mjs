import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cloudflareMaterialObjectKey,
  isAcceptableCloudflareMaterialMime,
  parseCloudflareMediaRange,
  putCloudflareMaterialBytes,
  putCloudflareMaterialFromUrl,
} from '../src/lib/cloudflare-material-cache.server.ts';

class MemoryR2Bucket {
  objects = new Map();

  async head(key) {
    return this.objects.get(key) || null;
  }

  async get(key) {
    return this.objects.get(key) || null;
  }

  async put(key, value, options = {}) {
    const bytes = new Uint8Array(await new Response(value).arrayBuffer());
    const object = {
      key,
      size: bytes.byteLength,
      httpEtag: '"test-etag"',
      httpMetadata: options.httpMetadata,
      customMetadata: options.customMetadata,
      body: new Blob([bytes]).stream(),
    };
    this.objects.set(key, object);
    return object;
  }

  async delete(keys) {
    for (const key of Array.isArray(keys) ? keys : [keys]) this.objects.delete(key);
  }

  async list({ prefix = '' } = {}) {
    const objects = [...this.objects.values()].filter((object) => object.key.startsWith(prefix));
    return { objects, truncated: false };
  }
}

test('Cloudflare media cache keys and byte ranges are bounded', () => {
  assert.equal(
    cloudflareMaterialObjectKey('node_video_123', 'video'),
    'project-material/v1/node_video_123/video',
  );
  assert.equal(cloudflareMaterialObjectKey('../video', 'video'), null);
  assert.deepEqual(parseCloudflareMediaRange('bytes=10-19', 100), { offset: 10, length: 10 });
  assert.deepEqual(parseCloudflareMediaRange('bytes=90-', 100), { offset: 90, length: 10 });
  assert.deepEqual(parseCloudflareMediaRange('bytes=-8', 100), { offset: 92, length: 8 });
  assert.equal(parseCloudflareMediaRange('bytes=100-101', 100), null);
});

test('Cloudflare media cache rejects a non-video response for a video object', async () => {
  const bucket = new MemoryR2Bucket();
  assert.equal(isAcceptableCloudflareMaterialMime('video', 'text/html'), false);
  const result = await putCloudflareMaterialBytes(
    bucket,
    'node_video_bad_type',
    'video',
    new Uint8Array([1, 2, 3]),
    'image/png',
  );
  assert.equal(result.ok, false);
  assert.equal(bucket.objects.size, 0);
});

test('Cloudflare media cache streams a remote video into R2 and verifies it', async () => {
  const bucket = new MemoryR2Bucket();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), {
    status: 200,
    headers: {
      'content-type': 'video/mp4',
      'content-length': '8',
    },
  });
  try {
    const result = await putCloudflareMaterialFromUrl(
      bucket,
      'node_video_remote',
      'video',
      'https://media.example.com/generated.mp4?token=temporary',
      { resolveHostname: async () => ['93.184.216.34'] },
    );
    assert.equal(result.ok, true);
    assert.equal(result.bytes, 8);
    const stored = await bucket.head('project-material/v1/node_video_remote/video');
    assert.equal(stored?.httpMetadata?.contentType, 'video/mp4');
    assert.equal(stored?.customMetadata?.sourceHost, 'media.example.com');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
