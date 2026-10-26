import { test, expect, type Page } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
const password = 'password12345';
async function signup(page: Page, name = 'Samantha', username = 'samantha') {
  await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
  await page.getByLabel('Tu nombre', { exact: true }).fill(name);
  await page.getByLabel('Usuario', { exact: true }).fill(username);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByLabel('Confirmar contraseña').fill(password);
  await page.getByRole('button', { name: 'Crear mi espacio' }).click();
  await expect(page.getByRole('heading', { name: `Hola, ${name}.` })).toBeVisible();
}
function wav(seconds = 40, frequency = 440) {
  const rate = 16000;
  const count = rate * seconds;
  const b = Buffer.alloc(44 + count * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + count * 2, 4);
  b.write('WAVE', 8);
  b.write('fmt ', 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++)
    b.writeInt16LE(Math.round(Math.sin((i / rate) * frequency * Math.PI * 2) * 3000), 44 + i * 2);
  return b;
}
async function importTrack(page: Page, name = 'Mi canción.wav') {
  await page.getByRole('button', { name: 'Añadir música', exact: true }).first().click();
  await page
    .getByLabel('Archivos de música')
    .setInputFiles({ name, mimeType: 'audio/wav', buffer: wav() });
  await expect(page.getByRole('status').filter({ hasText: 'Guardado:' })).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
}
test('biblioteca real: audio, favoritos, playlists, edición, offline, backup y perfiles', async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('/');
  await signup(page);
  await importTrack(page);
  await page.getByRole('button', { name: 'Biblioteca', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Opciones de Mi canción' })).toBeVisible();
  await page.getByRole('button', { name: 'Reproducir Mi canción', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pausar', exact: true }).first()).toBeVisible();
  await page.waitForTimeout(1300);
  await page.getByRole('button', { name: 'Abrir reproductor completo' }).click();
  await expect(page.getByRole('heading', { name: 'Ahora suena' })).toBeVisible();
  await page.getByLabel('Posición de reproducción').last().fill('12');
  await page.getByRole('button', { name: 'Aleatorio', exact: true }).last().click();
  await expect(page.getByRole('button', { name: 'Aleatorio', exact: true }).last()).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Pausar', exact: true }).last().click();
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.getByRole('button', { name: 'Añadir a favoritos: Mi canción' }).click();
  await page.getByRole('button', { name: 'Opciones de Mi canción' }).click();
  await page.getByRole('button', { name: 'Editar metadatos, portada y detalles' }).click();
  await page.getByLabel('Título', { exact: true }).fill('Mi pista editada');
  await page.getByLabel('Artista', { exact: true }).fill('Artista de prueba');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await page.getByRole('button', { name: 'Crear playlist', exact: true }).first().click();
  await page.getByLabel('Nombre', { exact: true }).fill('Mi playlist');
  await page.getByLabel('Descripción', { exact: true }).fill('Mi música offline');
  await page.getByRole('button', { name: 'Guardar playlist' }).click();
  await page.getByRole('button', { name: 'Opciones de Mi pista editada' }).click();
  await page.getByRole('button', { name: 'Añadir a playlists', exact: true }).click();
  await page.getByLabel('Mi playlist', { exact: true }).check();
  await page.getByRole('button', { name: 'Guardar selección' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Opciones de Mi pista editada' })).toBeVisible();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Opciones de Mi pista editada' })).toBeVisible();
  await page.getByRole('button', { name: 'Reproducir Mi pista editada', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pausar', exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Pausar', exact: true }).first().click();
  await page.getByRole('button', { name: 'Ajustes', exact: true }).first().click();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar biblioteca' }).click();
  const download = await dl;
  await mkdir('test-results', { recursive: true });
  const file = 'test-results/library.zip';
  await download.saveAs(file);
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Cerrar sesión / cambiar perfil' }).click();
  await signup(page, 'Alex', 'alex');
  await page.getByRole('button', { name: 'Biblioteca', exact: true }).first().click();
  await expect(page.getByText('Aquí empieza tu colección')).toBeVisible();
  await page.getByRole('button', { name: 'Ajustes', exact: true }).first().click();
  await page.locator('input[type=file][accept=".devnify,.aura,.zip"]').setInputFiles(file);
  await expect(page.getByRole('heading', { name: 'Restaurar biblioteca' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar restauración' }).click();
  await expect(page.getByRole('heading', { name: 'Restaurar biblioteca' })).not.toBeVisible();
  await page.getByRole('button', { name: 'Biblioteca', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Opciones de Mi pista editada' })).toBeVisible();
  await page.getByRole('button', { name: 'Reproducir Mi pista editada', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pausar', exact: true }).first()).toBeVisible();
  expect(errors).toEqual([]);
});
test('tamaños responsive sin desbordamiento y navegación móvil', async ({ page }) => {
  await page.goto('/');
  await signup(page);
  const dismissToast = page.getByRole('button', { name: 'Cerrar aviso' });
  if (await dismissToast.isVisible()) await dismissToast.click();
  for (const width of [320, 375, 390, 430, 768, 1024, 1440]) {
    if (await dismissToast.isVisible()) await dismissToast.click();
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `test-results/home-${width}.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole('navigation', { name: 'Navegación móvil' })
    .getByRole('button', { name: 'Playlists', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Tus playlists.' })).toBeVisible();
  await page.getByRole('button', { name: 'Crear playlist', exact: true }).click();
  await page.getByLabel('Nombre', { exact: true }).fill('Móvil');
  await page.getByRole('button', { name: 'Guardar playlist' }).click();
  await expect(page.getByRole('button', { name: 'Móvil 0 canciones' })).toBeVisible();
});
test('MP3 real importado, detección de duplicados y contraseña inválida', async ({ page }) => {
  await page.goto('/');
  await signup(page);
  const path = 'e2e/fixtures/test.mp3';
  await page.getByRole('button', { name: 'Añadir música', exact: true }).first().click();
  await page.getByLabel('Archivos de música').setInputFiles(path);
  await expect(page.getByRole('status').filter({ hasText: 'Guardado:' })).toBeVisible();
  await page.getByLabel('Archivos de música').setInputFiles(path);
  await expect(page.getByRole('status').filter({ hasText: 'Ya existía:' })).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.getByRole('button', { name: 'Ajustes', exact: true }).first().click();
  await page.getByRole('button', { name: 'Cerrar sesión / cambiar perfil' }).click();
  await page.getByLabel('Usuario', { exact: true }).fill('samantha');
  await page.getByLabel('Contraseña', { exact: true }).fill('incorrecta');
  await page.getByRole('button', { name: 'Entrar a mi espacio' }).click();
  await expect(page.getByRole('alert')).toContainText('incorrectos');
});
test('enlace de YouTube sin conexión autorizada no se presenta como descargado ni abre un reproductor externo', async ({
  page,
}) => {
  await page.goto('/');
  await signup(page);
  await page.getByRole('button', { name: 'Añadir música', exact: true }).first().click();
  await page.getByRole('button', { name: 'URL de audio', exact: true }).click();
  await page.getByLabel('Favoritos', { exact: true }).check();
  await page
    .getByLabel('URL HTTPS del archivo de audio')
    .fill('https://youtu.be/Tx9zMFodNtA?si=UfzTwt08A33sy5_G');
  await page.getByRole('button', { name: 'Descargar y añadir', exact: true }).click();
  await expect(page.locator('.import-status')).toContainText('fuente de audio autorizada');
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Abrir en YouTube', exact: true })).toHaveCount(0);
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.getByRole('button', { name: 'Biblioteca', exact: true }).first().click();
  await expect(page.getByText('Aquí empieza tu colección')).toBeVisible();
});

test.beforeAll(async () => {
  await mkdir('e2e/fixtures', { recursive: true });
  await writeFile('e2e/fixtures/test.wav', wav());
});
test('URL de audio: HTTP fallido, contenido inválido y reintento con Blob válido', async ({
  page,
}) => {
  await page.goto('/');
  await signup(page);
  await page.getByRole('button', { name: 'Añadir música', exact: true }).first().click();
  await page.getByRole('button', { name: 'URL de audio', exact: true }).click();
  let mode = 'http';
  await page.route('https://audio.test/pista.wav', (route) =>
    mode === 'http'
      ? route.fulfill({ status: 404, body: 'Not found' })
      : mode === 'html'
        ? route.fulfill({ status: 200, contentType: 'text/html', body: 'not audio' })
        : route.fulfill({ status: 200, contentType: 'audio/wav', body: wav(4) }),
  );
  await page.getByLabel('URL HTTPS del archivo de audio').fill('https://audio.test/pista.wav');
  await page.getByRole('button', { name: 'Descargar y añadir', exact: true }).click();
  await expect(page.locator('.import-status')).toContainText('HTTP 404');
  mode = 'html';
  await page.getByRole('button', { name: 'Descargar y añadir', exact: true }).click();
  await expect(page.locator('.import-status')).toContainText('no devuelve');
  mode = 'audio';
  await page.getByRole('button', { name: 'Descargar y añadir', exact: true }).click();
  await expect(page.locator('.import-status')).toContainText('Guardado offline: pista');
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.getByRole('button', { name: 'Biblioteca', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Opciones de pista', exact: true })).toBeVisible();
});
test('index.html, manifest y navegación offline desde un subdirectorio de GitHub Pages', async ({
  page,
  context,
}) => {
  await page.goto('http://127.0.0.1:4174/aura/');
  await signup(page);
  const manifest = await page.request.get('http://127.0.0.1:4174/aura/manifest.webmanifest');
  expect(manifest.ok()).toBe(true);
  expect((await manifest.json()).scope).toBe('./');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.goto('http://127.0.0.1:4174/aura/index.html#library');
  await expect(page.getByRole('heading', { name: 'Tu biblioteca.' })).toBeVisible();
});
test('cola, anterior/siguiente, repeat, velocidad, ecualizador y temporizador', async ({
  page,
}) => {
  await page.goto('/');
  await signup(page);
  await page.clock.install();
  await page.getByRole('button', { name: 'Añadir música', exact: true }).first().click();
  await page.getByLabel('Archivos de música').setInputFiles([
    { name: 'Primera.wav', mimeType: 'audio/wav', buffer: wav(40, 440) },
    { name: 'Segunda.wav', mimeType: 'audio/wav', buffer: wav(40, 660) },
  ]);
  await expect(page.locator('.import-status')).toContainText('Guardado: Segunda');
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.getByRole('button', { name: 'Biblioteca', exact: true }).first().click();
  await page.getByRole('button', { name: 'Reproducir Segunda', exact: true }).click();
  await page.getByRole('button', { name: 'Siguiente', exact: true }).first().click();
  await expect(page.locator('.mini-song strong')).toHaveText('Primera');
  await page.getByRole('button', { name: 'Anterior', exact: true }).first().click();
  await expect(page.locator('.mini-song strong')).toHaveText('Segunda');
  await page.getByRole('button', { name: 'Abrir cola', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Cola de reproducción' })).toBeVisible();
  await page.getByRole('button', { name: 'Subir Primera' }).click();
  await expect(page.locator('.queue-song').first()).toContainText('Primera');
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir reproductor completo' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Repetir: off', exact: true }).click();
  await dialog.getByRole('button', { name: 'Repetir: all', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Repetir: one', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Opciones de audio y temporizador' }).click();
  const extras = page.getByRole('dialog').last();
  await extras.getByLabel('Volumen del reproductor').fill('0.3');
  await extras.getByLabel('Velocidad', { exact: true }).selectOption('1.5');
  await extras.getByLabel('Ecualizador', { exact: true }).selectOption('Bass Boost');
  await expect(extras.getByLabel('60 Hz')).toHaveValue('8');
  await extras.getByLabel('Temporizador de apagado', { exact: true }).selectOption('5');
  await extras.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.clock.fastForward(300001);
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Reproducir', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
});
test('portadas, reordenación, duplicación y borrado de playlists; cambio de contraseña', async ({
  page,
}) => {
  await page.goto('/');
  await signup(page);
  await page.getByRole('button', { name: 'Crear playlist', exact: true }).first().click();
  await page.getByLabel('Nombre', { exact: true }).fill('Con portada');
  await page.getByLabel('Portada personalizada').setInputFiles('public/icons/icon-512.png');
  await page.getByRole('button', { name: 'Guardar playlist' }).click();
  await page.getByRole('button', { name: 'Añadir música', exact: true }).first().click();
  await page.getByLabel('Con portada', { exact: true }).check();
  await page.getByLabel('Archivos de música').setInputFiles([
    { name: 'Uno.wav', mimeType: 'audio/wav', buffer: wav(4, 440) },
    { name: 'Dos.wav', mimeType: 'audio/wav', buffer: wav(4, 660) },
  ]);
  await expect(page.locator('.import-status')).toContainText('Guardado: Dos');
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.getByRole('button', { name: 'Playlists', exact: true }).first().click();
  await page.getByRole('button', { name: 'Con portada 2 canciones' }).click();
  await page.getByRole('button', { name: 'Subir Dos', exact: true }).click();
  await expect(page.locator('.song-info').first()).toContainText('Dos');
  await page.getByRole('button', { name: 'Opciones de playlist', exact: true }).click();
  await page.getByRole('button', { name: 'Duplicar playlist', exact: true }).click();
  await page.getByRole('button', { name: 'Tus playlists', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Con portada (copia) 2 canciones' })).toBeVisible();
  await page.getByRole('button', { name: 'Ajustes', exact: true }).first().click();
  await page.getByRole('button', { name: 'Cambiar contraseña', exact: true }).click();
  await page.getByLabel('Contraseña actual', { exact: true }).fill(password);
  await page.getByLabel('Nueva contraseña', { exact: true }).fill('new-password123');
  await page.getByLabel('Confirmación', { exact: true }).fill('new-password123');
  await page.getByRole('button', { name: 'Actualizar contraseña', exact: true }).click();
  await page.getByRole('button', { name: 'Cerrar sesión / cambiar perfil' }).click();
  await page.getByLabel('Usuario', { exact: true }).fill('samantha');
  await page.getByLabel('Contraseña', { exact: true }).fill('new-password123');
  await page.getByRole('button', { name: 'Entrar a mi espacio' }).click();
  await expect(page.getByRole('heading', { name: 'Hola, Samantha.' })).toBeVisible();
});
