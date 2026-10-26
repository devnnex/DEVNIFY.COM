import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

for (const entry of ['index.html', 'dist/index.html']) {
  test(`doble clic: ${entry} abre, guarda y reproduce sin servidor ni conexión`, async ({
    page,
    context,
  }) => {
    const errors: string[] = [];
    const network: string[] = [];
    const fileRequests: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('request', (request) => {
      if (/^https?:/.test(request.url())) network.push(request.url());
      if (request.url().startsWith('file:')) fileRequests.push(request.url());
    });
    await context.setOffline(true);
    await page.goto(pathToFileURL(resolve(entry)).href);
    await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
    await page.getByLabel('Tu nombre', { exact: true }).fill('Local');
    await page.getByLabel('Usuario', { exact: true }).fill('local');
    await page.getByLabel('Contraseña', { exact: true }).fill('password12345');
    await page.getByLabel('Confirmar contraseña').fill('password12345');
    await page.getByRole('button', { name: 'Crear mi espacio' }).click();
    await expect(page.getByRole('heading', { name: 'Hola, Local.' })).toBeVisible();
    await page.getByRole('button', { name: 'Añadir música', exact: true }).first().click();
    await page.getByLabel('Archivos de música').setInputFiles('e2e/fixtures/test.mp3');
    await expect(page.locator('.import-status')).toContainText('Guardado: test');
    await page.getByRole('dialog').getByRole('button', { name: 'Cerrar', exact: true }).click();
    await page.getByRole('button', { name: 'Biblioteca', exact: true }).first().click();
    await page.getByRole('button', { name: 'Reproducir test', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Pausar', exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Pausar', exact: true }).first().click();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Opciones de test', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Reproducir test', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Pausar', exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Pausar', exact: true }).first().click();
    await page.getByRole('button', { name: 'Ajustes', exact: true }).first().click();
    await expect(page.getByRole('heading', { name: 'Almacenamiento', exact: true })).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Exportar biblioteca', exact: true }).click();
    expect((await download).suggestedFilename()).toMatch(/^devnify-backup-.*\.zip$/);
    expect(network).toEqual([]);
    expect(
      fileRequests.every((url) => url.split('#')[0] === pathToFileURL(resolve(entry)).href),
    ).toBe(true);
    expect(errors).toEqual([]);
  });
}
