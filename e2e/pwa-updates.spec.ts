import { test, expect } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

// Serve successive production builds without modifying the checked-in output.
let server: Server;
let origin: string;
let version = 1;
const root = resolve('dist');
test.beforeAll(async () => {
  server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url || '/', 'http://localhost').pathname;
      const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!path.startsWith(root + sep)) throw new Error('Invalid path');
      let data = await readFile(path);
      if (path.endsWith('index.html')) {
        data = Buffer.from(
          data
            .toString()
            .replace('</head>', `<meta name="test-build" content="${version}"></head>`),
        );
      } else if (path.endsWith('sw.js')) {
        data = Buffer.from(
          data
            .toString()
            .replace(
              /url:"index.html",revision:"[^"]+"/,
              `url:"index.html",revision:"test-build-${version}"`,
            ),
        );
      }
      response.writeHead(200, {
        'Content-Type':
          (
            {
              '.html': 'text/html',
              '.js': 'application/javascript',
              '.png': 'image/png',
              '.webmanifest': 'application/manifest+json',
            } as Record<string, string>
          )[extname(path)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      response.end(data);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test server');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((done, reject) =>
    server.close((error) => (error ? reject(error) : done())),
  );
});

function wav() {
  const frames = 8000 * 60;
  const data = Buffer.alloc(44 + frames * 2);
  data.write('RIFF');
  data.writeUInt32LE(36 + frames * 2, 4);
  data.write('WAVE', 8);
  data.write('fmt ', 12);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(8000, 24);
  data.writeUInt32LE(16000, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++)
    data.writeInt16LE(Math.round(Math.sin((i / 8000) * 440 * Math.PI * 2) * 1000), 44 + i * 2);
  return data;
}

test('updates the installed app without reinstalling, preserves songs and waits for playback to pause', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin);
  await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
  await page.getByLabel('Tu nombre', { exact: true }).fill('Música');
  await page.getByLabel('Usuario', { exact: true }).fill('musica');
  await page.getByLabel('Contraseña', { exact: true }).fill('password12345');
  await page.getByLabel('Confirmar contraseña').fill('password12345');
  await page.getByRole('button', { name: 'Crear mi espacio' }).click();
  await expect(page.getByRole('heading', { name: 'Hola, Música.' })).toBeVisible();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.getByRole('button', { name: 'Añadir música', exact: true }).first().click();
  await page
    .getByLabel('Archivos de música')
    .setInputFiles({ name: 'Fondo.wav', mimeType: 'audio/wav', buffer: wav() });
  await expect(page.getByRole('status').filter({ hasText: 'Guardado:' })).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();

  version = 2;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect
    .poll(() => page.locator('meta[name="test-build"]').getAttribute('content'), {
      timeout: 20_000,
    })
    .toBe('2');
  await expect(page.getByRole('heading', { name: 'Hola, Música.' })).toBeVisible();
  await page.getByRole('button', { name: 'Biblioteca', exact: true }).first().click();
  await page.getByRole('button', { name: 'Reproducir Fondo', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.mediaSession.playbackState))
    .toBe('playing');
  await page.locator('audio').evaluate((audio: HTMLAudioElement) => {
    audio.currentTime = 7;
  });
  version = 3;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('.update-banner')).toBeVisible();
  const position = await page
    .locator('audio')
    .evaluate((audio: HTMLAudioElement) => audio.currentTime);
  await expect
    .poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime), {
      timeout: 6000,
    })
    .toBeGreaterThan(position + 2.5);
  await expect(page.locator('meta[name="test-build"]')).toHaveAttribute('content', '2');
  await page.getByRole('button', { name: 'Pausar', exact: true }).first().click();
  await expect
    .poll(() => page.locator('meta[name="test-build"]').getAttribute('content'), {
      timeout: 20_000,
    })
    .toBe('3');
  await expect(page.getByRole('button', { name: 'Reproducir Fondo', exact: true })).toBeVisible();
  await expect
    .poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime))
    .toBeGreaterThan(7);
  expect(errors).toEqual([]);
});
