import type { Settings } from '../types';
import { downloadAudio, validateHttps, youtubeId } from './imports';

export class ImportConnectionError extends Error {
  constructor(
    public code: 'network' | 'configuration' | 'authorization' | 'source' | 'service',
    message: string,
  ) {
    super(message);
    this.name = 'ImportConnectionError';
  }
}
export function serviceBase(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new ImportConnectionError(
      'configuration',
      'Indica la URL de tu conexión de importación.',
    );
  }
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))
  )
    throw new ImportConnectionError(
      'configuration',
      'La conexión debe usar HTTPS; HTTP solo está permitido en localhost.',
    );
  if (url.username || url.password || url.search || url.hash)
    throw new ImportConnectionError(
      'configuration',
      'La URL de la conexión no debe incluir credenciales, consultas ni fragmentos.',
    );
  return url.href.replace(/\/$/, '');
}
export function isNetworkFailure(error: unknown) {
  return (
    error instanceof TypeError ||
    (error instanceof ImportConnectionError && error.code === 'network')
  );
}
export function describeImportError(error: unknown) {
  if (error instanceof Error && error.name === 'AbortError')
    return 'Importación cancelada o tiempo de espera agotado.';
  if (error instanceof TypeError)
    return 'No pudimos conectar con la fuente. Puede deberse a su configuración de acceso, a la red o a un bloqueo del navegador.';
  return error instanceof Error ? error.message : 'No se pudo importar el audio.';
}
async function jsonRequest(
  url: string,
  token: string,
  signal: AbortSignal,
  init: RequestInit = {},
) {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ImportConnectionError(
      'network',
      'No pudimos conectar con tu servicio. Comprueba su URL, disponibilidad y los orígenes permitidos; al abrir index.html como archivo local necesita habilitar ese modo en el servidor.',
    );
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new ImportConnectionError(
      'service',
      'La conexión respondió con un formato inesperado. Comprueba que la URL apunta al servicio de Devnify.',
    );
  }
  if (!response.ok)
    throw new ImportConnectionError(
      response.status === 401 ? 'authorization' : 'service',
      body.message || `El servicio respondió HTTP ${response.status}.`,
    );
  return body;
}
export interface ServiceHealth {
  status: 'ok';
  ffmpeg: boolean;
  capabilities?: {
    original: boolean;
    fileOrigin: boolean;
    youtubeEnabled?: boolean;
    ytDlp?: boolean;
  };
  sourceHosts?: string[];
}
export async function checkImportService(
  settings: Pick<Settings, 'serviceUrl' | 'serviceToken'>,
  signal = AbortSignal.timeout(10000),
): Promise<ServiceHealth> {
  if (!settings.serviceToken.trim())
    throw new ImportConnectionError('configuration', 'Añade el token de acceso de tu conexión.');
  const result = await jsonRequest(
    `${serviceBase(settings.serviceUrl)}/health`,
    settings.serviceToken,
    signal,
  );
  if (result.status !== 'ok' || typeof result.ffmpeg !== 'boolean')
    throw new ImportConnectionError('service', 'El servicio no reconoce el protocolo de Devnify.');
  return result;
}
export async function cancelImportJob(
  settings: Pick<Settings, 'serviceUrl' | 'serviceToken'>,
  id: string,
) {
  await jsonRequest(
    `${serviceBase(settings.serviceUrl)}/api/imports/${encodeURIComponent(id)}`,
    settings.serviceToken,
    AbortSignal.timeout(5000),
    { method: 'DELETE' },
  );
}
interface RemoteOptions {
  settings: Settings;
  signal: AbortSignal;
  format: 'original' | 'mp3';
  quality: number;
  onStatus: (message: string) => void;
  onProgress: (value: number | null) => void;
  onJob: (id: string) => void;
  onMetadata?: (metadata: { title?: string; artist?: string }) => void;
}
export async function importViaService(sourceUrl: string, options: RemoteOptions) {
  validateHttps(sourceUrl);
  const { settings, signal, onStatus, onProgress, onJob, format, quality } = options;
  const base = serviceBase(settings.serviceUrl);
  if (!settings.serviceToken.trim())
    throw new ImportConnectionError(
      'configuration',
      'Completa el token de tu conexión antes de importar.',
    );
  onStatus(
    format === 'original'
      ? 'Preparando la descarga mediante tu conexión…'
      : 'Preparando la conversión a MP3…',
  );
  const job = await jsonRequest(`${base}/api/imports`, settings.serviceToken, signal, {
    method: 'POST',
    body: JSON.stringify({
      sourceUrl,
      targetFormat: format,
      quality,
      authorizationConfirmed: true,
    }),
  });
  if (typeof job.jobId !== 'string' || !/^[\w-]{1,80}$/.test(job.jobId))
    throw new ImportConnectionError(
      'service',
      'El servicio no devolvió un identificador de importación válido.',
    );
  onJob(job.jobId);
  while (true) {
    if (signal.aborted) throw new DOMException('Cancelado', 'AbortError');
    const state = await jsonRequest(
      `${base}/api/imports/${job.jobId}`,
      settings.serviceToken,
      signal,
    );
    if (state.status === 'completed') {
      options.onMetadata?.({
        title: typeof state.title === 'string' ? state.title.slice(0, 200) : undefined,
        artist: typeof state.artist === 'string' ? state.artist.slice(0, 200) : undefined,
      });
      break;
    }
    if (['failed', 'cancelled'].includes(state.status))
      throw new ImportConnectionError(
        'service',
        state.error || 'El servicio no pudo preparar el audio.',
      );
    if (!['queued', 'processing'].includes(state.status))
      throw new ImportConnectionError(
        'service',
        'El servicio devolvió un estado de importación no reconocido.',
      );
    onStatus(
      state.status === 'queued'
        ? 'Tu importación está en cola…'
        : format === 'original'
          ? 'Tu conexión está obteniendo el archivo…'
          : 'Convirtiendo tu audio a MP3…',
    );
    await new Promise<void>((resolve, reject) => {
      const aborted = () => {
        clearTimeout(timeout);
        reject(new DOMException('Cancelado', 'AbortError'));
      };
      const timeout = setTimeout(() => {
        signal.removeEventListener('abort', aborted);
        resolve();
      }, 750);
      signal.addEventListener('abort', aborted, { once: true });
    });
  }
  onStatus('Guardando el audio en este dispositivo…');
  return downloadAudio(`${base}/api/imports/${job.jobId}/file`, signal, onProgress, {
    Authorization: `Bearer ${settings.serviceToken}`,
  });
}
export async function fetchImportAudio(
  sourceUrl: string,
  options: RemoteOptions & { authorized: boolean },
) {
  validateHttps(sourceUrl);
  if (youtubeId(sourceUrl)) {
    if (!options.settings.serviceUrl || !options.settings.serviceToken)
      throw new ImportConnectionError(
        'configuration',
        'Esta aplicación estática no puede obtener el archivo desde YouTube por sí sola. Necesita un servicio de descarga con una fuente de audio autorizada para ese vídeo. Si ya tienes el vídeo, usa «Vídeo a MP3» sin servidor. Todavía no se ha guardado ninguna canción.',
      );
    if (!options.authorized)
      throw new ImportConnectionError(
        'authorization',
        'Confirma el permiso para enviar este enlace a tu conexión de descarga.',
      );
    return { blob: await importViaService(sourceUrl, options), viaService: true };
  }
  const direct = new AbortController();
  const cancelled = () => direct.abort();
  options.signal.addEventListener('abort', cancelled, { once: true });
  if (options.signal.aborted) direct.abort();
  let timeout = setTimeout(() => direct.abort(), 20000);
  try {
    options.onStatus('Descargando desde la fuente original…');
    const blob = await downloadAudio(sourceUrl, direct.signal, (value) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => direct.abort(), 20000);
      options.onProgress(value);
    });
    return { blob, viaService: false };
  } catch (error) {
    clearTimeout(timeout);
    if (options.signal.aborted) throw new DOMException('Cancelado', 'AbortError');
    const timedOut = direct.signal.aborted;
    if (!timedOut && !isNetworkFailure(error)) throw error;
    if (!options.settings.serviceUrl || !options.settings.serviceToken)
      throw new ImportConnectionError(
        'configuration',
        'La fuente no pudo descargarse directamente. Conecta tu servicio de importación para reintentar desde el servidor, o importa el archivo desde tu dispositivo.',
      );
    if (!options.authorized)
      throw new ImportConnectionError(
        'authorization',
        'La descarga directa no está disponible. Confirma el permiso para enviar el enlace a tu conexión y vuelve a importar; Devnify reintentará automáticamente.',
      );
    options.onProgress(null);
    options.onStatus('La descarga directa no está disponible. Reintentando con tu conexión…');
    return { blob: await importViaService(sourceUrl, options), viaService: true };
  } finally {
    clearTimeout(timeout);
    options.signal.removeEventListener('abort', cancelled);
  }
}
