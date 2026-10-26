import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function account(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
  await page.getByLabel('Tu nombre', { exact: true }).fill('Samantha');
  await page.getByLabel('Usuario', { exact: true }).fill('samantha');
  await page.getByLabel('Contraseña', { exact: true }).fill('password12345');
  await page.getByLabel('Confirmar contraseña').fill('password12345');
}

test('selector premium con vista previa, cambio y eliminación accesible en móvil', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 950 });
  await account(page);
  const picker = page.getByLabel('Avatar (opcional)', { exact: true });
  await picker.setInputFiles('public/icons/icon-512.png');
  await expect(page.getByAltText('Vista previa de la imagen')).toBeVisible();
  await expect(page.getByText('icon-512.png', { exact: true })).toBeVisible();
  await expect(page.getByText('Cambiar', { exact: true })).toBeVisible();
  const pickerBox = await page.locator('.premium-file-picker').boundingBox();
  const formBox = await page.locator('.auth-form-inner').boundingBox();
  expect(pickerBox!.width).toBeGreaterThan(280);
  expect(pickerBox!.height).toBeGreaterThan(75);
  expect(pickerBox!.x).toBeGreaterThanOrEqual(formBox!.x);
  expect(pickerBox!.x + pickerBox!.width).toBeLessThanOrEqual(formBox!.x + formBox!.width + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: 'test-results/registro-premium.png',
    fullPage: true,
    style: '.toast { visibility: hidden !important; }',
  });
  await page.getByRole('button', { name: 'Quitar imagen: Avatar (opcional)' }).click();
  await expect(page.getByAltText('Vista previa de la imagen')).toHaveCount(0);
  await picker.setInputFiles('public/icons/icon-192.png');
  await page.getByRole('button', { name: 'Crear mi espacio' }).click();
  await expect(page.getByRole('heading', { name: 'Hola, Samantha.' })).toBeVisible();
  await page.getByRole('button', { name: 'Ajustes', exact: true }).last().click();
  await expect(page.getByAltText('Vista previa de la imagen')).toBeVisible();
});

test('pegar enlace mantiene Favoritos y playlists visibles y ofrece descarga sin streaming', async ({
  page,
}) => {
  await account(page);
  await page.getByRole('button', { name: 'Crear mi espacio' }).click();
  await page.getByRole('button', { name: 'Añadir música', exact: true }).first().click();
  await page.getByRole('button', { name: 'URL de audio', exact: true }).click();
  await page.getByLabel('Favoritos', { exact: true }).check();
  await page
    .getByLabel('URL HTTPS del archivo de audio')
    .fill('https://youtu.be/Tx9zMFodNtA?si=UfzTwt08A33sy5_G');
  await expect(page.getByText('Enlace de YouTube reconocido', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Descargar y añadir', exact: true })).toBeVisible();
  await expect(page.getByLabel('Favoritos', { exact: true })).toBeChecked();
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Abrir reproductor online' })).toHaveCount(0);
  await page.screenshot({
    path: 'test-results/descarga-offline.png',
    fullPage: true,
    style: '.toast{visibility:hidden!important}',
  });
});

test('reintento automático tras fallo de red con servicio configurado, permiso y audio real', async ({
  page,
}) => {
  await account(page);
  await page.getByRole('button', { name: 'Crear mi espacio' }).click();
  await page.getByRole('button', { name: 'Añadir música', exact: true }).first().click();
  await page.getByRole('button', { name: 'URL de audio', exact: true }).click();
  await page.getByRole('button', { name: 'Configurar', exact: true }).click();
  const token = 'private-fixture-token';
  const audio = await readFile('e2e/fixtures/test.mp3');
  const calls: { method: string; url: string; body: unknown }[] = [];
  await page.route('https://service.test/**', async (route) => {
    const request = route.request();
    expect(request.headers().authorization).toBe(`Bearer ${token}`);
    calls.push({ method: request.method(), url: request.url(), body: request.postDataJSON() });
    if (request.url().endsWith('/health'))
      return route.fulfill({
        json: {
          status: 'ok',
          ffmpeg: true,
          capabilities: { original: true, fileOrigin: true },
          sourceHosts: ['audio.test'],
        },
      });
    if (request.method() === 'POST')
      return route.fulfill({ status: 202, json: { jobId: 'fixture-job', status: 'queued' } });
    if (request.url().endsWith('/file'))
      return route.fulfill({ contentType: 'audio/mpeg', body: audio });
    return route.fulfill({
      json: { status: request.method() === 'DELETE' ? 'cancelled' : 'completed' },
    });
  });
  await page.getByLabel('URL del servicio', { exact: true }).fill('https://service.test');
  await page.getByLabel('Token de acceso', { exact: true }).fill(token);
  await page.getByRole('button', { name: 'Guardar y comprobar conexión' }).click();
  await expect(page.getByText('Conexión verificada', { exact: true })).toBeVisible();
  await page.getByLabel('Favoritos', { exact: true }).check();
  await page.route('https://audio.test/track.mp3', (route) => route.abort('failed'));
  await page.getByLabel('URL HTTPS del archivo de audio').fill('https://audio.test/track.mp3');
  await page.getByRole('button', { name: 'Descargar y añadir', exact: true }).click();
  await expect(page.locator('.import-status')).toContainText('Guardado offline');
  expect(calls.find((call) => call.method === 'POST')?.body).toMatchObject({
    targetFormat: 'original',
    authorizationConfirmed: true,
  });
  expect(calls.some((call) => call.method === 'DELETE')).toBe(true);
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.getByRole('button', { name: 'Biblioteca', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Reproducir track', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Quitar de favoritos: track', exact: true }),
  ).toBeVisible();
});
