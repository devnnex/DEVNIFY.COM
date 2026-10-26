import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

test('sesión local abierta: restablece contraseña sin la anterior y conserva audio, favoritos y playlist', async ({
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
  await page.setViewportSize({ width: 390, height: 950 });
  await page.goto(pathToFileURL(resolve('index.html')).href);
  await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
  await page.getByLabel('Tu nombre', { exact: true }).fill('Juan');
  await page.getByLabel('Usuario', { exact: true }).fill('juan');
  await page.getByLabel('Contraseña', { exact: true }).fill('old-password123');
  await page.getByLabel('Confirmar contraseña').fill('old-password123');
  await page.getByLabel('Mantener mi sesión en este dispositivo').uncheck();
  await page.getByRole('button', { name: 'Crear mi espacio' }).click();
  await expect(page.getByRole('heading', { name: 'Hola, Juan.' })).toBeVisible();
  // The user reloads the same tab with an existing session after receiving the updated HTML.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Hola, Juan.' })).toBeVisible();
  await page.getByRole('button', { name: 'Añadir música', exact: true }).first().click();
  await page.getByLabel('Favoritos', { exact: true }).check();
  await page.getByLabel('Nombre de nueva playlist').fill('Mi colección');
  await page.getByRole('dialog').getByRole('button', { name: 'Crear', exact: true }).click();
  await expect(page.getByLabel('Mi colección', { exact: true })).toBeChecked();
  await page.getByLabel('Archivos de música').setInputFiles('e2e/fixtures/test.mp3');
  await expect(page.locator('.import-status')).toContainText('Guardado: test');
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.getByRole('button', { name: 'Ajustes', exact: true }).last().click();
  await page.getByRole('button', { name: 'Olvidé mi contraseña', exact: true }).click();
  await expect(page.getByLabel('Contraseña actual', { exact: true })).toHaveCount(0);
  await page.getByLabel('Confirma tu usuario').fill('juan');
  await page.getByLabel('Nueva contraseña', { exact: true }).fill('new-password123');
  await page.getByLabel('Confirmación', { exact: true }).fill('new-password123');
  await page.screenshot({ path: 'test-results/recuperar-contrasena.png', fullPage: true });
  await page.getByLabel('Confirma tu usuario').fill('equivocado');
  await page.getByRole('button', { name: 'Guardar nueva contraseña', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('usuario no coincide');
  await page.getByLabel('Confirma tu usuario').fill('juan');
  await page.getByRole('button', { name: 'Guardar nueva contraseña', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Tu espacio, tus reglas.' })).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar sesión / cambiar perfil' }).click();
  await page.getByLabel('Usuario', { exact: true }).fill('juan');
  await page.getByLabel('Contraseña', { exact: true }).fill('old-password123');
  await page.getByRole('button', { name: 'Entrar a mi espacio' }).click();
  await expect(page.getByRole('alert')).toContainText('incorrectos');
  await page.getByLabel('Contraseña', { exact: true }).fill('new-password123');
  await page.getByRole('button', { name: 'Entrar a mi espacio' }).click();
  await page.getByRole('button', { name: 'Playlists', exact: true }).last().click();
  await page.getByRole('button', { name: 'Mi colección 1 canciones' }).click();
  await expect(page.getByRole('button', { name: 'Reproducir test', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ver favoritos', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reproducir test', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reproducir test', exact: true }).click();
  await expect
    .poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime))
    .toBeGreaterThan(0.2);
  expect(errors).toEqual([]);
  expect(requests).toEqual([]);
});
