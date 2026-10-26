import { test, expect, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { parseBuffer } from 'music-metadata';

async function signup(page: Page) {
  await page.goto(pathToFileURL(resolve('index.html')).href);
  await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
  await page.getByLabel('Tu nombre', { exact: true }).fill('Conversión');
  await page.getByLabel('Usuario', { exact: true }).fill('conversion');
  await page.getByLabel('Contraseña', { exact: true }).fill('password12345');
  await page.getByLabel('Confirmar contraseña').fill('password12345');
  await page.getByRole('button', { name: 'Crear mi espacio' }).click();
  await page.getByRole('button', { name: 'Añadir música', exact: true }).first().click();
}

async function savedAudio(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('AuraMusicDB');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const transaction = database.transaction(['songs', 'audioBlobs', 'playlists'], 'readonly');
      const all = (name: string) =>
        new Promise<unknown[]>((resolve, reject) => {
          const request = transaction.objectStore(name).getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      const [songs, records, playlists] = await Promise.all([
        all('songs'),
        all('audioBlobs'),
        all('playlists'),
      ]);
      const blob = (records[0] as { blob: Blob } | undefined)?.blob;
      return {
        songs,
        playlists,
        mime: blob?.type,
        bytes: blob ? Array.from(new Uint8Array(await blob.arrayBuffer())) : [],
      };
    } finally {
      database.close();
    }
  });
}

test('MP4 real a MP3 abriendo index sin red: guarda favoritos y playlist, persiste y reproduce', async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) requests.push(request.url());
  });
  await context.setOffline(true);
  await signup(page);
  await page.getByRole('button', { name: 'Vídeo a MP3', exact: true }).click();
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 950 });
    expect(await page.evaluate(() => {
      const dialog = document.querySelector('dialog')!;
      return document.documentElement.scrollWidth <= innerWidth && dialog.scrollWidth <= dialog.clientWidth + 1;
    })).toBe(true);
  }
  await page.getByLabel('Favoritos', { exact: true }).check();
  await page.getByLabel('Nombre de nueva playlist').fill('Sin servidor');
  await page.getByRole('dialog').getByRole('button', { name: 'Crear', exact: true }).click();
  await expect(page.getByLabel('Sin servidor', { exact: true })).toBeChecked();
  await page.getByLabel('Vídeo para convertir').setInputFiles('e2e/fixtures/local-video.mp4');
  await expect(page.locator('.import-status')).toContainText('Guardado: local-video', {
    timeout: 20000,
  });
  const saved = await savedAudio(page);
  expect(saved.mime).toBe('audio/mpeg');
  expect(saved.songs).toHaveLength(1);
  expect(saved.songs[0]).toMatchObject({
    downloaded: true,
    favorite: true,
    mimeType: 'audio/mpeg',
  });
  expect(saved.playlists[0]).toMatchObject({ name: 'Sin servidor', songIds: [expect.any(String)] });
  const metadata = await parseBuffer(new Uint8Array(saved.bytes), { mimeType: saved.mime });
  expect(metadata.format.codec).toContain('MPEG');
  expect(metadata.format.duration).toBeGreaterThan(2.9);
  expect(metadata.format.duration).toBeLessThan(3.3);
  await page.screenshot({
    path: 'test-results/conversion-local.png',
    fullPage: true,
    style: '.toast{visibility:hidden!important}',
  });
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.getByRole('button', { name: 'Biblioteca', exact: true }).first().click();
  await page.reload();
  await page.getByRole('button', { name: 'Reproducir local-video', exact: true }).click();
  await expect
    .poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime))
    .toBeGreaterThan(0.2);
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});

test('vídeo corrupto muestra error y no añade canciones', async ({ page, context }) => {
  await context.setOffline(true);
  await signup(page);
  await page.getByRole('button', { name: 'Vídeo a MP3', exact: true }).click();
  await page
    .getByLabel('Vídeo para convertir')
    .setInputFiles({
      name: 'roto.mp4',
      mimeType: 'video/mp4',
      buffer: Buffer.from('archivo corrupto'),
    });
  await expect(page.getByRole('alert')).toContainText('No se ha guardado una canción');
  expect((await savedAudio(page)).songs).toHaveLength(0);
});

test('URL directa MP4 convierte localmente sin servicio configurado', async ({ page }) => {
  await signup(page);
  const source = await readFile('e2e/fixtures/local-video.mp4');
  await page.route('https://audio.test/video.mp4', (route) =>
    route.fulfill({ contentType: 'video/mp4', body: source }),
  );
  await page.getByRole('button', { name: 'URL de audio', exact: true }).click();
  await page.getByLabel('URL HTTPS del archivo de audio').fill('https://audio.test/video.mp4');
  await page.locator('summary').filter({ hasText: 'Opciones de descarga' }).click();
  await page.getByLabel('Formato de importación').selectOption('mp3');
  await page.getByRole('button', { name: 'Descargar y añadir', exact: true }).click();
  await expect(page.locator('.import-status')).toContainText('Guardado offline: video', {
    timeout: 20000,
  });
  const saved = await savedAudio(page);
  expect(saved.mime).toBe('audio/mpeg');
  expect(
    (await parseBuffer(new Uint8Array(saved.bytes), { mimeType: saved.mime })).format.duration,
  ).toBeGreaterThan(2.9);
});
