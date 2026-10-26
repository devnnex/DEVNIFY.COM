import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../services/db';
import { fetchImportAudio, serviceBase } from '../services/import-service';

afterEach(() => vi.restoreAllMocks());
function options(authorized = true) {
  return {
    settings: {
      ...defaultSettings('test'),
      serviceUrl: 'https://private.test',
      serviceToken: 'private-token',
    },
    signal: new AbortController().signal,
    format: 'original' as const,
    quality: 192,
    authorized,
    onStatus: vi.fn(),
    onProgress: vi.fn(),
    onJob: vi.fn(),
  };
}
describe('importación con conexión alternativa', () => {
  it('mantiene descarga directa sin enviar el enlace ni el token al servicio', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response('audio bytes', { headers: { 'Content-Type': 'audio/mpeg' } }),
      );
    const result = await fetchImportAudio('https://source.test/file.mp3', options(false));
    expect(result.viaService).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1]?.headers).toBeUndefined();
  });
  it('reintenta desde el servicio únicamente con autorización y sin transcodificar', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(Response.json({ jobId: 'job-1', status: 'queued' }))
      .mockResolvedValueOnce(Response.json({ status: 'completed' }))
      .mockResolvedValueOnce(
        new Response('original bytes', { headers: { 'Content-Type': 'audio/mpeg' } }),
      );
    const opts = options();
    const result = await fetchImportAudio('https://source.test/file.mp3', opts);
    expect(result.viaService).toBe(true);
    expect(await result.blob.text()).toBe('original bytes');
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).toMatchObject({
      targetFormat: 'original',
      authorizationConfirmed: true,
    });
    expect(fetch.mock.calls[1][1]?.headers).toMatchObject({
      Authorization: 'Bearer private-token',
    });
    expect(opts.onJob).toHaveBeenCalledWith('job-1');
  });
  it('no envía una fuente al servidor sin permiso cuando falla la conexión directa', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(
      fetchImportAudio('https://source.test/file.mp3', options(false)),
    ).rejects.toMatchObject({ code: 'authorization' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('no trata HTTP 403 como CORS ni intenta superar una denegación del origen', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 403 }));
    await expect(fetchImportAudio('https://source.test/file.mp3', options())).rejects.toThrow(
      'HTTP 403',
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('una cancelación del usuario no activa el servicio alternativo', async () => {
    const controller = new AbortController();
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Cancelado', 'AbortError')),
            { once: true },
          );
        }),
    );
    const promise = fetchImportAudio('https://source.test/file.mp3', {
      ...options(),
      signal: controller.signal,
    });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('no descarga enlaces YouTube sin servicio configurado y valida la URL del servicio', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const missing = options();
    missing.settings.serviceUrl = '';
    await expect(
      fetchImportAudio('https://youtu.be/Tx9zMFodNtA?si=UfzTwt08A33sy5_G', missing),
    ).rejects.toMatchObject({ code: 'configuration' });
    expect(fetch).not.toHaveBeenCalled();
    expect(serviceBase(' https://private.test/api/ ')).toBe('https://private.test/api');
    expect(() => serviceBase('https://user:pass@private.test')).toThrow();
    expect(() => serviceBase('http://public.test')).toThrow();
  });
});
