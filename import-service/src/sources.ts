import { readFile } from 'node:fs/promises';

export interface AuthorizedAudioSource {
  audioUrl?: string;
  extractFromYoutube?: true;
  authorizationReference: string;
}
export function youtubeVideoId(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('Introduce un enlace HTTPS válido.');
  if (url.hostname === 'youtu.be') {
    const id = url.pathname.slice(1);
    if (!/^[\w-]{11}$/.test(id))
      throw new Error('El enlace de YouTube no contiene un vídeo válido.');
    return id;
  }
  if (
    [
      'youtube.com',
      'www.youtube.com',
      'm.youtube.com',
      'www.youtube-nocookie.com',
      'youtube-nocookie.com',
    ].includes(url.hostname)
  ) {
    const id =
      url.searchParams.get('v') ||
      url.pathname.match(/^\/(?:shorts|embed)\/([\w-]{11})(?:\/|$)/)?.[1];
    if (!id || !/^[\w-]{11}$/.test(id))
      throw new Error('El enlace de YouTube no contiene un vídeo válido.');
    return id;
  }
  return null;
}
export async function loadAuthorizedAudioSources(
  path?: string,
): Promise<Record<string, AuthorizedAudioSource>> {
  if (!path) return {};
  let data: unknown;
  try {
    data = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new Error(
      'No se pudo leer AUTHORIZED_YOUTUBE_AUDIO_FILE. Comprueba su ruta y formato JSON.',
    );
  }
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new Error('El catálogo de fuentes autorizadas debe ser un objeto JSON.');
  const entries: Record<string, AuthorizedAudioSource> = {};
  for (const [id, raw] of Object.entries(data)) {
    if (!/^[\w-]{11}$/.test(id) || !raw || typeof raw !== 'object')
      throw new Error('Entrada de fuente autorizada no válida.');
    const source = raw as Partial<AuthorizedAudioSource>;
    if (typeof source.authorizationReference !== 'string' || !source.authorizationReference.trim())
      throw new Error(
        'Cada fuente necesita una referencia de autorización verificada por el administrador.',
      );
    if (source.extractFromYoutube === true) {
      if (source.audioUrl !== undefined)
        throw new Error('Elige audioUrl o extractFromYoutube, no ambos.');
      entries[id] = {
        extractFromYoutube: true,
        authorizationReference: source.authorizationReference,
      };
      continue;
    }
    if (typeof source.audioUrl !== 'string')
      throw new Error('Indica audioUrl o extractFromYoutube: true.');
    const url = new URL(source.audioUrl);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      youtubeVideoId(source.audioUrl)
    )
      throw new Error('La fuente autorizada debe ser un archivo de audio HTTPS independiente.');
    entries[id] = { audioUrl: url.href, authorizationReference: source.authorizationReference };
  }
  return entries;
}
export function resolveAudioSource(raw: string, sources: Record<string, AuthorizedAudioSource>) {
  const id = youtubeVideoId(raw);
  if (!id) return raw;
  const source = sources[id];
  if (!source)
    throw new Error(
      'Este vídeo no tiene una fuente de audio autorizada configurada en tu servicio. Añade el archivo original o pide al administrador que habilite su enlace de descarga; no se ha descargado nada.',
    );
  return source.extractFromYoutube ? `https://www.youtube.com/watch?v=${id}` : source.audioUrl!;
}
