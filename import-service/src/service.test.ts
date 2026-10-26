import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { isPublicAddress, approvedSource } from './security.js';
import { convertFile } from './jobs.js';
import { buildServer } from './server.js';
test('rechaza redes privadas, metadatos, credenciales y extracción YouTube', async () => {
  for (const ip of [
    '127.0.0.1',
    '10.0.0.2',
    '169.254.169.254',
    '192.168.0.1',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
  ])
    assert.equal(isPublicAddress(ip), false, ip);
  assert.equal(isPublicAddress('8.8.8.8'), true);
  await assert.rejects(approvedSource('http://example.com/x', ['example.com']));
  await assert.rejects(approvedSource('https://user:pass@example.com/x', ['example.com']));
  await assert.rejects(approvedSource('https://youtube.com/watch?v=123', ['youtube.com']));
  await assert.rejects(approvedSource('https://unapproved.test/audio', []));
});
test('API exige token, valida formato, orígenes y trabajos inexistentes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aura-test-'));
  process.env.IMPORT_TOKEN = 'a'.repeat(40);
  process.env.ALLOWED_ORIGINS = 'https://user.github.io';
  process.env.DATA_DIR = dir;
  process.env.ALLOWED_SOURCE_HOSTS = '';
  const app = await buildServer();
  try {
    assert.equal((await app.inject({ method: 'GET', url: '/health' })).statusCode, 401);
    const headers = { authorization: `Bearer ${'a'.repeat(40)}` };
    assert.equal(
      (
        await app.inject({
          method: 'GET',
          url: '/health',
          headers: { ...headers, origin: 'https://evil.test' },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: 'GET',
          url: '/api/imports/missing',
          headers,
        })
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/imports',
          headers,
          payload: {
            sourceUrl: 'https://test.test/audio',
            targetFormat: 'mp3',
            quality: 192,
            authorizationConfirmed: true,
          },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/imports',
          headers,
          payload: {
            sourceUrl: 'https://test.test/audio',
            targetFormat: 'mp3',
            quality: 999,
            authorizationConfirmed: true,
          },
        })
      ).statusCode,
      400,
    );
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test(
  'FFmpeg convierte un WAV físico a un MP3 real',
  { skip: !process.env.FFMPEG_PATH },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aura-convert-'));
    try {
      const output = join(dir, 'audio.mp3');
      await convertFile(resolve('../e2e/fixtures/test.wav'), output, 192);
      const data = await readFile(output);
      assert.ok(data.length > 1000);
      assert.equal(data.subarray(0, 3).toString(), 'ID3');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
test('origen de archivo local: bloqueado por defecto, habilitado explícitamente y siempre con token', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'devnify-cors-'));
  process.env.IMPORT_TOKEN = 'c'.repeat(40);
  process.env.ALLOWED_ORIGINS = 'https://user.github.io';
  process.env.ALLOWED_SOURCE_HOSTS = '';
  process.env.DATA_DIR = dir;
  process.env.ALLOW_FILE_ORIGIN = 'false';
  let app = await buildServer();
  const headers = { origin: 'null', authorization: `Bearer ${'c'.repeat(40)}` };
  try {
    assert.equal(
      (await app.inject({ method: 'GET', url: '/api/imports/missing', headers })).statusCode,
      403,
    );
    await app.close();
    process.env.ALLOW_FILE_ORIGIN = 'true';
    app = await buildServer();
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/imports',
      headers: {
        origin: 'null',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
      },
    });
    assert.equal(preflight.statusCode, 204);
    assert.equal(preflight.headers['access-control-allow-origin'], 'null');
    assert.match(String(preflight.headers['access-control-allow-headers']), /authorization/i);
    assert.equal(
      (
        await app.inject({
          method: 'GET',
          url: '/api/imports/missing',
          headers: { origin: 'null' },
        })
      ).statusCode,
      401,
    );
    const response = await app.inject({ method: 'GET', url: '/api/imports/missing', headers });
    assert.equal(response.statusCode, 404);
    assert.equal(response.headers['access-control-allow-origin'], 'null');
  } finally {
    await app.close();
    process.env.ALLOW_FILE_ORIGIN = 'false';
    await rm(dir, { recursive: true, force: true });
  }
});
test(
  'conservar original: descarga HTTPS real y entrega idéntica, sin FFmpeg',
  { skip: process.env.RUN_NETWORK_IMPORT !== '1', timeout: 90000 },
  async () => {
    const source = 'https://interactive-examples.mdn.mozilla.net/media/cc0-audio/t-rex-roar.mp3';
    const expected = Buffer.from(await (await fetch(source)).arrayBuffer());
    const dir = await mkdtemp(join(tmpdir(), 'devnify-original-'));
    process.env.IMPORT_TOKEN = 'd'.repeat(40);
    process.env.ALLOWED_ORIGINS = 'https://user.github.io';
    process.env.ALLOWED_SOURCE_HOSTS = 'interactive-examples.mdn.mozilla.net';
    process.env.DATA_DIR = dir;
    const previous = process.env.FFMPEG_PATH;
    process.env.FFMPEG_PATH = 'intentionally-missing-ffmpeg';
    const app = await buildServer();
    const headers = { authorization: `Bearer ${'d'.repeat(40)}` };
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/api/imports',
        headers,
        payload: {
          sourceUrl: source,
          targetFormat: 'original',
          quality: 192,
          authorizationConfirmed: true,
        },
      });
      assert.equal(created.statusCode, 202, created.body);
      const { jobId } = created.json();
      let status;
      for (let i = 0; i < 100; i++) {
        status = (
          await app.inject({ method: 'GET', url: `/api/imports/${jobId}`, headers })
        ).json();
        if (['completed', 'failed'].includes(status.status)) break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      assert.equal(status.status, 'completed', JSON.stringify(status));
      const file = await app.inject({ method: 'GET', url: `/api/imports/${jobId}/file`, headers });
      assert.equal(file.statusCode, 200);
      assert.equal(file.headers['content-type'], 'audio/mpeg');
      assert.deepEqual(file.rawPayload, expected);
      await app.inject({ method: 'DELETE', url: `/api/imports/${jobId}`, headers });
      assert.equal(
        (await app.inject({ method: 'GET', url: `/api/imports/${jobId}/file`, headers }))
          .statusCode,
        409,
      );
    } finally {
      await app.close();
      if (previous) process.env.FFMPEG_PATH = previous;
      else delete process.env.FFMPEG_PATH;
      await rm(dir, { recursive: true, force: true });
    }
  },
);
test(
  'importación HTTPS real de una fuente CC0: descarga, convierte y entrega MP3',
  { skip: process.env.RUN_NETWORK_IMPORT !== '1', timeout: 90000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aura-network-'));
    process.env.IMPORT_TOKEN = 'b'.repeat(40);
    process.env.ALLOWED_ORIGINS = 'https://user.github.io';
    process.env.DATA_DIR = dir;
    process.env.ALLOWED_SOURCE_HOSTS = 'interactive-examples.mdn.mozilla.net';
    const app = await buildServer();
    const headers = { authorization: `Bearer ${'b'.repeat(40)}` };
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/imports',
        headers,
        payload: {
          sourceUrl: 'https://interactive-examples.mdn.mozilla.net/media/cc0-audio/t-rex-roar.mp3',
          targetFormat: 'mp3',
          quality: 192,
          authorizationConfirmed: true,
        },
      });
      assert.equal(res.statusCode, 202, res.body);
      const { jobId } = res.json();
      let state;
      for (let i = 0; i < 80; i++) {
        state = (
          await app.inject({
            method: 'GET',
            url: `/api/imports/${jobId}`,
            headers,
          })
        ).json();
        if (['completed', 'failed'].includes(state.status)) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      assert.equal(state.status, 'completed', JSON.stringify(state));
      const file = await app.inject({
        method: 'GET',
        url: `/api/imports/${jobId}/file`,
        headers,
      });
      assert.equal(file.statusCode, 200);
      assert.equal(file.headers['content-type'], 'audio/mpeg');
      assert.ok(file.rawPayload.length > 1000);
      assert.equal(file.rawPayload.subarray(0, 3).toString(), 'ID3');
      assert.equal(
        (
          await app.inject({
            method: 'DELETE',
            url: `/api/imports/${jobId}`,
            headers,
          })
        ).statusCode,
        200,
      );
    } finally {
      await app.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
