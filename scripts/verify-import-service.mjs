// Optional integration QA: actual browser + actual API + HTTPS source + FFmpeg.
import { chromium } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const directory = await mkdtemp(join(tmpdir(), 'devnify-live-qa-'));
const token = randomBytes(32).toString('hex');
process.env.IMPORT_TOKEN = token;
process.env.ALLOWED_ORIGINS = 'https://devnify-qa.invalid';
process.env.ALLOW_FILE_ORIGIN = 'true';
process.env.ALLOWED_SOURCE_HOSTS = 'interactive-examples.mdn.mozilla.net';
process.env.DATA_DIR = directory;
// A synthetic video ID resolves to the independently licensed CC0 fixture, not a YouTube extraction.
const catalogue = join(directory, 'authorized-sources.json');
await writeFile(
  catalogue,
  JSON.stringify({
    TESTVIDEO01: {
      audioUrl: 'https://interactive-examples.mdn.mozilla.net/media/cc0-audio/t-rex-roar.mp3',
      authorizationReference: 'MDN CC0 integration fixture',
    },
  }),
);
process.env.AUTHORIZED_YOUTUBE_AUDIO_FILE = catalogue;
if (process.argv[2]) process.env.FFMPEG_PATH = resolve(process.argv[2]);
const { buildServer } = await import('../import-service/dist/server.js');
const app = await buildServer();
app.log.level = 'silent';
let browser;
try {
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(pathToFileURL(resolve('index.html')).href);
  await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
  await page.getByLabel('Tu nombre', { exact: true }).fill('Conexión real');
  await page.getByLabel('Usuario', { exact: true }).fill('live_qa');
  await page.getByLabel('Contraseña', { exact: true }).fill('qa-local-password123');
  await page.getByLabel('Confirmar contraseña').fill('qa-local-password123');
  await page.getByRole('button', { name: 'Crear mi espacio' }).click();
  await page.getByRole('button', { name: 'Añadir música', exact: true }).first().click();
  await page.getByRole('button', { name: 'URL de audio', exact: true }).click();
  await page.getByLabel('Nombre de nueva playlist').fill('Descargas QA');
  await page.getByRole('button', { name: 'Crear', exact: true }).click();
  await page.getByLabel('Favoritos', { exact: true }).check();
  await page.getByRole('button', { name: 'Configurar', exact: true }).click();
  await page.getByLabel('URL del servicio', { exact: true }).fill(address);
  await page.getByLabel('Token de acceso', { exact: true }).fill(token);
  await page.getByRole('button', { name: 'Guardar y comprobar conexión' }).click();
  await page.getByText('Conexión verificada', { exact: true }).waitFor();
  await page.getByLabel('URL HTTPS del archivo de audio').fill('https://youtu.be/TESTVIDEO01');
  await page.getByText('Opciones de descarga y conexión', { exact: true }).click();
  await page.getByLabel('Formato de importación', { exact: true }).selectOption('mp3');
  await page.getByRole('button', { name: 'Descargar y añadir', exact: true }).click();
  await page
    .locator('.import-status')
    .filter({ hasText: 'Guardado offline' })
    .waitFor({ timeout: 90000 });
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar', exact: true }).click();
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Biblioteca', exact: true }).first().click();
  await page.getByRole('button', { name: /Reproducir Audio TESTVIDEO01/ }).click();
  await page.getByRole('button', { name: 'Pausar', exact: true }).first().waitFor();
  await page.getByRole('button', { name: 'Pausar', exact: true }).first().click();
  await page.getByRole('button', { name: 'Playlists', exact: true }).first().click();
  await page.getByRole('button', { name: 'Descargas QA 1 canciones' }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    'PASS: index.html file:// → URL resuelta a fuente CC0 autorizada → descarga HTTPS real → FFmpeg → IndexedDB y playlist/Favoritos → reproducción offline. No se extrajo audio de YouTube.',
  );
} finally {
  await browser?.close();
  await app.close();
  // directory is an absolute, fresh mkdtemp path inside the OS temp directory.
  assert.ok(directory.startsWith(join(tmpdir(), 'devnify-live-qa-')));
  await rm(directory, { recursive: true, force: true });
}
