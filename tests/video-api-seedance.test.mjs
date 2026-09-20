import assert from 'node:assert/strict';
import test from 'node:test';

import {
  VideoAPI,
  normalizeVideoApiMessage,
  validateSeedance20ReferenceCounts,
} from '../src/components/api/VideoAPI.ts';

test('Seedance polling survives temporary proxy failures and retrieves the completed task', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      throw new TypeError('Failed to fetch');
    }
    if (calls === 2) {
      return new Response(JSON.stringify({ error: 'Proxy error', message: 'fetch failed' }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({
      id: 'task-recovered',
      status: 'succeeded',
      content: { video_url: 'https://cdn.example.com/result.mp4' },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const api = new VideoAPI('sk-test', 'https://ark.cn-beijing.volces.com');
    const result = await api.pollTaskUntilComplete('task-recovered', undefined, 4, 0);
    assert.equal(calls, 3);
    assert.equal(result.status, 'succeeded');
    assert.equal(result.result?.video_url, 'https://cdn.example.com/result.mp4');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Seedance polling does not retry permanent authentication failures', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({
      error: { code: 'AuthenticationError', message: 'invalid API key' },
    }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const api = new VideoAPI('sk-test', 'https://ark.cn-beijing.volces.com');
    await assert.rejects(
      api.pollTaskUntilComplete('task-auth-failed', undefined, 4, 0),
      /401/,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Seedance request forwards every reference with the documented role and no unsupported seed', async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return new Response(JSON.stringify({ id: 'task-1', status: 'queued' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const api = new VideoAPI('sk-test', 'https://ark.cn-beijing.volces.com');
    const result = await api.generateVideo({
      prompt: '按参考素材生成',
      ratio: '16:9',
      resolution: '4K',
      duration: 8,
      model: 'seedance-2.0',
      referenceImages: ['https://cdn.example.com/a.png', 'data:image/png;base64,AAAA'],
      referenceVideos: ['https://cdn.example.com/a.mp4'],
      referenceAudios: ['data:audio/wav;base64,AAAA'],
    });

    assert.equal(result.task_id, 'task-1');
    assert.equal(captured.url, '/api/proxy/volcengine');
    assert.equal(captured.init.headers['X-Target-URL'], 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks');
    const body = JSON.parse(captured.init.body);
    assert.equal(body.model, 'doubao-seedance-2-0-260128');
    assert.equal(body.resolution, '4k');
    assert.equal('seed' in body, false);
    assert.deepEqual(body.content.slice(1), [
      { type: 'image_url', image_url: { url: 'https://cdn.example.com/a.png' }, role: 'reference_image' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' }, role: 'reference_image' },
      { type: 'video_url', video_url: { url: 'https://cdn.example.com/a.mp4' }, role: 'reference_video' },
      { type: 'audio_url', audio_url: { url: 'data:audio/wav;base64,AAAA' }, role: 'reference_audio' },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Seedance relay uses the official all-reference payload on its relay task path', async () => {
  const originalFetch = globalThis.fetch;
  let targetUrl = '';
  let requestBody;
  globalThis.fetch = async (_url, init) => {
    targetUrl = init.headers['X-Target-URL'];
    requestBody = JSON.parse(init.body);
    return new Response(JSON.stringify({ id: 'relay-task' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const api = new VideoAPI('tr-test', 'https://api.tokenriver.cn');
    await api.generateVideo({
      prompt: '测试',
      ratio: '16:9',
      resolution: '720P',
      duration: 5,
      model: 'seedance-2.0',
      referenceImages: ['https://cdn.example.com/character.png', 'https://cdn.example.com/scene.png'],
      referenceVideos: ['https://cdn.example.com/motion.mp4'],
      referenceAudios: ['https://cdn.example.com/voice.mp3'],
    });
    assert.equal(targetUrl, 'https://api.tokenriver.cn/seedance/v3/contents/generations/tasks');
    assert.deepEqual(requestBody.content.slice(1), [
      { type: 'image_url', image_url: { url: 'https://cdn.example.com/character.png' }, role: 'reference_image' },
      { type: 'image_url', image_url: { url: 'https://cdn.example.com/scene.png' }, role: 'reference_image' },
      { type: 'video_url', video_url: { url: 'https://cdn.example.com/motion.mp4' }, role: 'reference_video' },
      { type: 'audio_url', audio_url: { url: 'https://cdn.example.com/voice.mp3' }, role: 'reference_audio' },
    ]);
    assert.equal(requestBody.generate_audio, true);
    assert.equal(requestBody.return_last_frame, true);
    assert.equal(requestBody.watermark, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Seedance rejects reference counts and fast resolution outside official limits', async () => {
  assert.throws(
    () => validateSeedance20ReferenceCounts(10, 0, 0),
    /图片 10\/9/,
  );
  assert.throws(
    () => validateSeedance20ReferenceCounts(0, 4, 4),
    /视频 4\/3.*音频 4\/3/,
  );

  const api = new VideoAPI('sk-test', 'https://ark.cn-beijing.volces.com');
  await assert.rejects(
    api.generateVideo({
      prompt: '测试',
      ratio: '16:9',
      resolution: '1080P',
      duration: 5,
      model: 'seedance-2.0-fast',
    }),
    /Fast 仅支持 480P 或 720P/,
  );
});

test('Seedance safety failures keep distinct user-facing causes', () => {
  assert.match(normalizeVideoApiMessage('InputImageSensitiveContentDetected.PrivacyInformation'), /真人、人脸或隐私/);
  assert.match(normalizeVideoApiMessage('Copyright infringement detected'), /版权、商标或受保护 IP/);
  assert.match(normalizeVideoApiMessage('graphic violence and blood detected'), /血腥\/暴力/);
  assert.match(normalizeVideoApiMessage('InvalidParameter: duration must be 4-15'), /接口详情：InvalidParameter/);
});
