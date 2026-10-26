import { test as base, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

// Exercise the iOS playback branch in both engines. Visibility is simulated;
// physical lock-screen/Bluetooth behavior still requires a device check.
const mobile = {
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
};
const test = base.extend({
  context: async ({ playwright, browserName, baseURL }, use) => {
    // WebKit's ephemeral/private profiles cannot store IndexedDB Blobs:
    // https://github.com/microsoft/playwright/issues/42795
    // A short path also keeps WebKit's Windows IndexedDB paths below MAX_PATH.
    const profile = await mkdtemp(join(tmpdir(), 'devnify-pw-'));
    if (!resolve(profile).startsWith(resolve(tmpdir()) + sep + 'devnify-pw-'))
      throw new Error('Unexpected browser profile path');
    const context = await playwright[browserName].launchPersistentContext(profile, {
      baseURL,
      ...mobile,
    });
    try {
      await use(context);
    } finally {
      await context.close();
      await rm(profile, { recursive: true, force: true });
    }
  },
});

function wav(frequency: number) {
  const frames = 8000 * 20;
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
    data.writeInt16LE(
      Math.round(Math.sin((i / 8000) * frequency * Math.PI * 2) * 1000),
      44 + i * 2,
    );
  return data;
}

test('iPhone native audio: headset pause/resume, native track boundary and fast next while hidden', async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName === 'webkit' && process.platform === 'win32',
    'Windows WebKit cannot load media in this environment (standalone WAV probe stays at readyState 0). WebKit playback runs in Linux CI.',
  );
  await page.addInitScript(() => {
    const handlers = new Map<MediaSessionAction, MediaSessionActionHandler | null>();
    // Windows WebKit has no OS media session backend. Keep the command driver
    // test-only; audio loading, looping and timeline checks use the real engine.
    if (!navigator.mediaSession) {
      Object.defineProperty(navigator, 'mediaSession', {
        value: {
          setActionHandler() {},
          setPositionState() {},
          playbackState: 'none',
          metadata: null,
        },
      });
    }
    if (typeof MediaMetadata === 'undefined') {
      Object.assign(window, {
        MediaMetadata: class {
          constructor(data: MediaMetadataInit) {
            Object.assign(this, data);
          }
        },
      });
    }
    const session = navigator.mediaSession;
    const native = session.setActionHandler.bind(session);
    session.setActionHandler = (action, handler) => {
      handlers.set(action, handler);
      native(action, handler);
    };
    Object.assign(window, {
      headset: (action: MediaSessionAction, seekTime?: number) => {
        handlers.get(action)?.({ action, seekTime });
      },
    });
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
  await page.getByLabel('Tu nombre', { exact: true }).fill('iPhone');
  await page.getByLabel('Usuario', { exact: true }).fill('iphone');
  await page.getByLabel('Contraseña', { exact: true }).fill('password12345');
  await page.getByLabel('Confirmar contraseña').fill('password12345');
  await page.getByRole('button', { name: 'Crear mi espacio' }).click();
  await expect(page.getByRole('heading', { name: 'Hola, iPhone.' })).toBeVisible();
  // Seed valid offline WAVs to isolate playback from file-picker/parser behavior.
  await page.evaluate(
    async (fixtures) => {
      const connection = await new Promise<IDBDatabase>((done, reject) => {
        const request = indexedDB.open('AuraMusicDB');
        request.onsuccess = () => done(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const ownerId = await new Promise<string>((done, reject) => {
          const request = connection.transaction('users').objectStore('users').getAll();
          request.onsuccess = () => done(request.result[0].id);
          request.onerror = () => reject(request.error);
        });
        await new Promise<void>((done, reject) => {
          const transaction = connection.transaction(['songs', 'audioBlobs'], 'readwrite');
          transaction.oncomplete = () => done();
          transaction.onabort = () => reject(transaction.error);
          fixtures.forEach(({ title, base64 }, index) => {
            const blob = new Blob([Uint8Array.from(atob(base64), (byte) => byte.charCodeAt(0))], {
              type: 'audio/wav',
            });
            const id = crypto.randomUUID();
            transaction.objectStore('songs').add({
              id,
              ownerId,
              title,
              artist: 'Test',
              album: '',
              genre: '',
              duration: 20,
              mimeType: 'audio/wav',
              size: blob.size,
              downloaded: true,
              sourceType: 'file',
              createdAt: Date.now() + index,
              updatedAt: Date.now() + index,
              playCount: 0,
              checksum: id,
              favorite: false,
            });
            transaction.objectStore('audioBlobs').add({ id, ownerId, blob });
          });
        });
      } finally {
        connection.close();
      }
    },
    ['Uno', 'Dos', 'Tres'].map((title, index) => ({
      title,
      base64: wav(440 + index * 220).toString('base64'),
    })),
  );
  await page.reload();
  await page.getByRole('button', { name: 'Biblioteca', exact: true }).first().click();
  await page.getByRole('button', { name: 'Reproducir Tres', exact: true }).click();
  await expect
    .poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.loop))
    .toBe(true);
  await page.getByRole('button', { name: 'Abrir reproductor completo' }).click();
  await page.getByRole('button', { name: 'Opciones de audio y temporizador' }).click();
  await expect(page.getByLabel('Ecualizador', { exact: true })).toBeDisabled();
  await expect(
    page.getByText('En iPhone y iPad se usa audio nativo', { exact: false }),
  ).toBeVisible();
  await page
    .getByRole('dialog')
    .last()
    .getByRole('button', { name: 'Cerrar', exact: true })
    .click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar', exact: true }).click();
  await context.setOffline(true);
  const nativeElement = await page.locator('audio').elementHandle();
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });

  const command = (action: MediaSessionAction, seekTime?: number) =>
    page.evaluate(
      ({ action, seekTime }) => {
        (
          window as unknown as { headset: (action: MediaSessionAction, seekTime?: number) => void }
        ).headset(action, seekTime);
      },
      { action, seekTime },
    );
  await command('pause');
  await expect
    .poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused))
    .toBe(true);
  await command('play');
  const resumedAt = await page
    .locator('audio')
    .evaluate((audio: HTMLAudioElement) => audio.currentTime);
  await expect
    .poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime))
    .toBeGreaterThan(resumedAt + 0.4);
  await command('seekto', 19.5);
  await expect.poll(() => page.evaluate(() => navigator.mediaSession.metadata?.title)).toBe('Dos');
  await expect
    .poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.loop))
    .toBe(true);
  await command('pause');
  const start = Date.now();
  await command('nexttrack');
  await expect.poll(() => page.evaluate(() => navigator.mediaSession.metadata?.title)).toBe('Uno');
  await expect
    .poll(() =>
      page
        .locator('audio')
        .evaluate((audio: HTMLAudioElement) => !audio.paused && audio.currentTime > 0),
    )
    .toBe(true);
  expect(Date.now() - start).toBeLessThan(1500);
  expect(await nativeElement?.evaluate((audio) => audio === document.querySelector('audio'))).toBe(
    true,
  );
  await expect
    .poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.loop))
    .toBe(false);
  await command('seekto', 19.7);
  await expect
    .poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.ended))
    .toBe(true);
  expect(errors).toEqual([]);
});
