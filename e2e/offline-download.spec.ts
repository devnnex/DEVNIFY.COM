import { test, expect, type Page } from '@playwright/test';
function audio(frequency = 440) {
  const frames = 8000 * 20;
  const bytes = Buffer.alloc(44 + frames * 2);
  bytes.write('RIFF');
  bytes.writeUInt32LE(36 + frames * 2, 4);
  bytes.write('WAVE', 8);
  bytes.write('fmt ', 12);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24);
  bytes.writeUInt32LE(16000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++)
    bytes.writeInt16LE(
      Math.round(Math.sin((i / 8000) * frequency * 2 * Math.PI) * 1000),
      44 + i * 2,
    );
  return bytes;
}
async function signup(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
  await page.getByLabel('Tu nombre', { exact: true }).fill('Offline');
  await page.getByLabel('Usuario', { exact: true }).fill('offline');
  await page.getByLabel('Contraseña', { exact: true }).fill('password12345');
  await page.getByLabel('Confirmar contraseña').fill('password12345');
  await page.getByRole('button', { name: 'Crear mi espacio' }).click();
  await expect(page.getByRole('heading', { name: 'Hola, Offline.' })).toBeVisible();
}
test('pegar URL, descargar y añadir a playlist y Favoritos; recargar y seguir offline con controles multimedia', async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    const handlers = new Map<MediaSessionAction, MediaSessionActionHandler | null>();
    (window as unknown as { testMediaHandlers: typeof handlers }).testMediaHandlers = handlers;
    const native = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
    navigator.mediaSession.setActionHandler = (action, handler) => {
      handlers.set(action, handler);
      native(action, handler);
    };
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await signup(page);
  await page.getByRole('button', { name: 'Crear playlist', exact: true }).first().click();
  await page.getByLabel('Nombre', { exact: true }).fill('Para mi viaje');
  await page.getByRole('button', { name: 'Guardar playlist', exact: true }).click();
  await page.getByRole('button', { name: 'Añadir música', exact: true }).first().click();
  await page.getByRole('button', { name: 'URL de audio', exact: true }).click();
  await page.getByLabel('Para mi viaje', { exact: true }).check();
  await page.getByLabel('Favoritos', { exact: true }).check();
  await page.route('https://audio.test/**', (route) =>
    route.fulfill({
      contentType: 'audio/wav',
      body: audio(route.request().url().includes('segunda') ? 660 : 440),
    }),
  );
  for (const name of ['primera', 'segunda']) {
    await page.getByLabel('URL HTTPS del archivo de audio').fill(`https://audio.test/${name}.wav`);
    await page.getByRole('button', { name: 'Descargar y añadir', exact: true }).click();
    await expect(page.locator('.import-status')).toContainText(
      `Guardado offline: ${name} · Favoritos, Para mi viaje`,
    );
  }
  await page.screenshot({
    path: 'test-results/descargado-en-playlist.png',
    fullPage: true,
    style: '.toast{visibility:hidden!important}',
  });
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: 'Playlists', exact: true }).first().click();
  await page.getByRole('button', { name: 'Para mi viaje 2 canciones' }).click();
  await page.getByRole('button', { name: 'Reproducir', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Pausar', exact: true }).first()).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => navigator.mediaSession.metadata?.title))
    .toBe('primera');
  const before = await page
    .locator('audio')
    .evaluate((element: HTMLAudioElement) => element.currentTime);
  // The application must never pause simply because visibility changes.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect
    .poll(() => page.locator('audio').evaluate((element: HTMLAudioElement) => element.currentTime))
    .toBeGreaterThan(before + 0.4);
  await page.evaluate(() => {
    const handler = (
      window as unknown as { testMediaHandlers: Map<MediaSessionAction, MediaSessionActionHandler> }
    ).testMediaHandlers.get('seekto');
    handler?.({ action: 'seekto', seekTime: 10 });
  });
  await expect
    .poll(() => page.locator('audio').evaluate((element: HTMLAudioElement) => element.currentTime))
    .toBeGreaterThanOrEqual(10);
  await page.evaluate(() => {
    (
      window as unknown as { testMediaHandlers: Map<MediaSessionAction, MediaSessionActionHandler> }
    ).testMediaHandlers.get('pause')?.({ action: 'pause' });
  });
  await expect.poll(() => page.evaluate(() => navigator.mediaSession.playbackState)).toBe('paused');
  await page.evaluate(() => {
    (
      window as unknown as { testMediaHandlers: Map<MediaSessionAction, MediaSessionActionHandler> }
    ).testMediaHandlers.get('play')?.({ action: 'play' });
  });
  await expect
    .poll(() => page.evaluate(() => navigator.mediaSession.playbackState))
    .toBe('playing');
  await page
    .locator('audio')
    .evaluate((element: HTMLAudioElement) => (element.currentTime = element.duration - 0.15));
  await expect
    .poll(() => page.evaluate(() => navigator.mediaSession.metadata?.title))
    .toBe('segunda');
  await page.getByRole('button', { name: 'Pausar', exact: true }).first().click();
  expect(errors).toEqual([]);
});
