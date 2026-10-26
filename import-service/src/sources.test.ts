import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveAudioSource, loadAuthorizedAudioSources, youtubeVideoId } from './sources.js';
test('resuelve solo vídeos con un archivo independiente autorizado por el administrador', () => {
  assert.equal(youtubeVideoId('https://youtu.be/TESTVIDEO01?si=abc'), 'TESTVIDEO01');
  assert.equal(youtubeVideoId('https://www.youtube.com/watch?v=TESTVIDEO01'), 'TESTVIDEO01');
  const approved = {
    TESTVIDEO01: {
      audioUrl: 'https://audio.example/owned.mp3',
      authorizationReference: 'fixture-owned-source',
    },
  };
  assert.equal(
    resolveAudioSource('https://youtu.be/TESTVIDEO01', approved),
    'https://audio.example/owned.mp3',
  );
  assert.equal(
    resolveAudioSource('https://youtu.be/TESTVIDEO01', {
      TESTVIDEO01: { extractFromYoutube: true, authorizationReference: 'fixture-permissions' },
    }),
    'https://www.youtube.com/watch?v=TESTVIDEO01',
  );
  assert.throws(
    () => resolveAudioSource('https://youtu.be/Tx9zMFodNtA', approved),
    /no tiene una fuente/,
  );
  assert.equal(
    resolveAudioSource('https://audio.example/direct.mp3', {}),
    'https://audio.example/direct.mp3',
  );
  assert.throws(() => youtubeVideoId('https://youtube.com/watch?v=bad'), /válido/);
});
test('catálogo sin referencia de autorización o con una página de YouTube no inicia el servicio', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'devnify-catalogue-'));
  const path = join(dir, 'sources.json');
  try {
    await writeFile(
      path,
      JSON.stringify({ TESTVIDEO01: { audioUrl: 'https://audio.example/song.mp3' } }),
    );
    await assert.rejects(loadAuthorizedAudioSources(path), /autorización/);
    await writeFile(
      path,
      JSON.stringify({
        TESTVIDEO01: { audioUrl: 'https://youtu.be/TESTVIDEO01', authorizationReference: 'test' },
      }),
    );
    await assert.rejects(loadAuthorizedAudioSources(path), /independiente/);
    assert.deepEqual(await loadAuthorizedAudioSources(), {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
