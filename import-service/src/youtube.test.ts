import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { youtubeArguments, downloadYoutubeAudio, ytDlpPath } from './youtube.js';
test('argumentos fijos: vídeo único, sin cookies, plugins ni formatos protegidos', () => {
  const args = youtubeArguments('TESTVIDEO01');
  for (const arg of [
    '--no-playlist',
    '--no-plugin-dirs',
    '--ignore-config',
    '--no-cookies',
    '--no-allow-unplayable-formats',
  ])
    assert.ok(args.includes(arg));
  assert.throws(() => youtubeArguments('id; malicious'), /válido/);
});
test('metadatos y archivo resultante de yt-dlp se validan; directos y errores no son éxitos', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'devnify-extractor-'));
  const previous = process.env.ENABLE_YOUTUBE_DOWNLOADS;
  process.env.ENABLE_YOUTUBE_DOWNLOADS = 'true';
  try {
    const calls: string[][] = [];
    const result = await downloadYoutubeAudio(
      'TESTVIDEO01',
      dir,
      new AbortController().signal,
      undefined,
      async (args) => {
        calls.push(args);
        if (args.includes('--dump-single-json'))
          return JSON.stringify({
            id: 'TESTVIDEO01',
            title: 'Audio autorizado de prueba',
            uploader: 'QA',
            duration: 4,
          });
        await copyFile(resolve('../e2e/fixtures/test.wav'), join(dir, 'youtube-source.wav'));
        return '';
      },
    );
    assert.equal(result.title, 'Audio autorizado de prueba');
    assert.equal(result.artist, 'QA');
    assert.equal(calls.length, 2);
    assert.equal(calls[1].at(-1), 'https://www.youtube.com/watch?v=TESTVIDEO01');
    await assert.rejects(
      downloadYoutubeAudio('TESTVIDEO01', dir, new AbortController().signal, undefined, async () =>
        JSON.stringify({ id: 'TESTVIDEO01', is_live: true, duration: 4 }),
      ),
      /directos/,
    );
    await assert.rejects(
      downloadYoutubeAudio(
        'TESTVIDEO01',
        dir,
        new AbortController().signal,
        undefined,
        async () => {
          throw new Error('Origen no disponible');
        },
      ),
      /no disponible/,
    );
    await writeFile(join(dir, 'youtube-source.wav'), '');
    await assert.rejects(
      downloadYoutubeAudio(
        'TESTVIDEO01',
        dir,
        new AbortController().signal,
        undefined,
        async (args) =>
          args.includes('--dump-single-json')
            ? JSON.stringify({ id: 'TESTVIDEO01', duration: 4, title: 'Vacío' })
            : '',
      ),
      /vacío/,
    );
  } finally {
    if (previous) process.env.ENABLE_YOUTUBE_DOWNLOADS = previous;
    else delete process.env.ENABLE_YOUTUBE_DOWNLOADS;
    await rm(dir, { recursive: true, force: true });
  }
});
test(
  'ejecutable real de yt-dlp acepta la configuración de argumentos',
  { skip: !process.env.YTDLP_PATH },
  async () => {
    const version = await new Promise<string>((resolveVersion, reject) => {
      const child = spawn(ytDlpPath(), [...youtubeArguments('TESTVIDEO01'), '--version'], {
        windowsHide: true,
        shell: false,
      });
      let out = '';
      let error = '';
      child.stdout.on('data', (data) => (out += String(data)));
      child.stderr.on('data', (data) => (error += String(data)));
      child.on('error', reject);
      child.on('exit', (code) =>
        code === 0 ? resolveVersion(out.trim()) : reject(new Error(error)),
      );
    });
    assert.match(version, /^\d{4}\.\d{2}\.\d{2}/);
    const validation = await new Promise<{ code: number | null; error: string }>((done, reject) => {
      const child = spawn(
        ytDlpPath(),
        [
          ...youtubeArguments('TESTVIDEO01'),
          '--skip-download',
          '--',
          'https://example.invalid/no-extractor',
        ],
        { windowsHide: true, shell: false },
      );
      let error = '';
      child.stderr.on('data', (data) => (error += String(data)));
      child.on('error', reject);
      child.on('exit', (code) => done({ code, error }));
    });
    assert.notEqual(validation.code, 0);
    assert.doesNotMatch(validation.error, /no such option|unrecognized arguments/i);
    assert.match(validation.error, /unsupported url|not a valid url|no suitable extractor/i);
  },
);
