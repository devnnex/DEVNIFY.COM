import { db, uid, ownedSong } from './db';
import { bytesToHex } from './auth';
import type { Song } from '../types';
export async function optimizeImage(file: Blob): Promise<string> {
  if (!file.type.startsWith('image/') || file.size > 20 * 1024 * 1024)
    throw new Error('Selecciona una imagen válida de hasta 20 MB.');
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 600;
  const ctx = canvas.getContext('2d')!;
  const side = Math.min(bitmap.width, bitmap.height);
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    600,
    600,
  );
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.85);
}
export async function addToPlaylists(ownerId: string, songId: string, playlistIds: string[]) {
  await ownedSong(ownerId, songId);
  await db.transaction('rw', db.songs, db.playlists, async () => {
    if (playlistIds.includes('favorites')) await db.songs.update(songId, { favorite: true });
    for (const id of playlistIds.filter((x) => x !== 'favorites')) {
      const p = await db.playlists.get(id);
      if (p?.ownerId !== ownerId) throw new Error('Playlist no disponible.');
      await db.playlists.update(id, {
        songIds: [...new Set([...p.songIds, songId])],
      });
    }
  });
}
export async function importAudio(
  ownerId: string,
  file: Blob,
  filename: string,
  playlistIds: string[] = [],
  sourceType: Song['sourceType'] = 'file',
  sourceUrl?: string,
  metadataOverrides?: { title?: string; artist?: string },
) {
  if (!file.size || file.size > 500 * 1024 * 1024)
    throw new Error('El audio debe ocupar entre 1 byte y 500 MB.');
  let metadata;
  try {
    const { parseBlob } = await import('music-metadata');
    metadata = await parseBlob(file);
  } catch {
    throw new Error('No se pudo leer este archivo de audio. Comprueba su formato.');
  }
  const duration = metadata.format.duration;
  if (!duration || !Number.isFinite(duration) || duration <= 0)
    throw new Error('El archivo no contiene audio válido con duración reconocible.');
  const probe = document.createElement('audio');
  const type =
    (file.type.startsWith('audio/') ? file.type : '') ||
    (/^(M4A|isom|mp4|MPEG-4)/i.test(metadata.format.container || '') ? 'audio/mp4' : '') ||
    {
      MP3: 'audio/mpeg',
      FLAC: 'audio/flac',
      WAVE: 'audio/wav',
      Ogg: 'audio/ogg',
      ADTS: 'audio/aac',
      'MPEG-4': 'audio/mp4',
    }[metadata.format.container || ''] ||
    'audio/mpeg';
  if (!probe.canPlayType(type))
    throw new Error(
      'Tu navegador no admite este códec. Convierte el archivo a MP3 o utiliza el servicio de importación.',
    );
  const checksum = bytesToHex(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
  const existing = await db.songs.where('[ownerId+checksum]').equals([ownerId, checksum]).first();
  if (existing) {
    await db.transaction('rw', db.songs, db.audioBlobs, db.playlists, async () => {
      if (!(await db.audioBlobs.get(existing.id))) {
        await db.audioBlobs.put({
          id: existing.id,
          ownerId,
          blob: new Blob([file], { type }),
        });
        await db.songs.update(existing.id, { downloaded: true });
      }
      await addToPlaylists(ownerId, existing.id, playlistIds);
    });
    return {
      song: { ...existing, downloaded: true },
      duplicate: existing.downloaded,
    };
  }
  let artwork: string | undefined;
  const pic = metadata.common.picture?.[0];
  if (pic)
    artwork = await optimizeImage(new Blob([new Uint8Array(pic.data)], { type: pic.format }));
  const now = Date.now();
  const song: Song = {
    id: uid(),
    ownerId,
    title: metadata.common.title || metadataOverrides?.title || filename.replace(/\.[^.]+$/, ''),
    artist: metadata.common.artist || metadataOverrides?.artist || 'Artista desconocido',
    album: metadata.common.album || '',
    genre: metadata.common.genre?.join(', ') || '',
    year: metadata.common.year,
    duration,
    mimeType: type,
    size: file.size,
    downloaded: true,
    artwork,
    sourceType,
    sourceUrl,
    createdAt: now,
    updatedAt: now,
    playCount: 0,
    checksum,
    favorite: false,
    bitrate: metadata.format.bitrate,
  };
  try {
    await db.transaction('rw', db.songs, db.audioBlobs, db.playlists, async () => {
      await db.songs.add(song);
      await db.audioBlobs.add({
        id: song.id,
        ownerId,
        blob: new Blob([file], { type }),
      });
      await addToPlaylists(ownerId, song.id, playlistIds);
    });
  } catch (e) {
    if (e instanceof Error && /quota/i.test(e.name + e.message))
      throw new Error('No hay espacio suficiente. Exporta un respaldo y libera almacenamiento.');
    throw e;
  }
  return { song, duplicate: false };
}
export function validateHttps(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Introduce una URL HTTPS válida.');
  }
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('La fuente debe ser una URL HTTPS sin credenciales.');
  return url;
}
export function youtubeId(value: string) {
  const u = validateHttps(value);
  if (u.hostname === 'youtu.be')
    return /^[\w-]{11}$/.test(u.pathname.slice(1)) ? u.pathname.slice(1) : null;
  if (['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(u.hostname)) {
    const id = u.searchParams.get('v') || u.pathname.match(/^\/(?:shorts|embed)\/([\w-]{11})/)?.[1];
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  }
  return null;
}
export async function downloadAudio(
  value: string,
  signal: AbortSignal,
  onProgress: (value: number | null) => void,
  headers?: HeadersInit,
) {
  const target = new URL(value);
  if (!(
    headers &&
    target.protocol === 'http:' &&
    ['localhost', '127.0.0.1'].includes(target.hostname)
  ))
    validateHttps(value);
  const response = await fetch(value, {
    signal,
    headers,
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  });
  if (!response.ok) throw new Error(`El servidor respondió HTTP ${response.status}.`);
  const type = response.headers.get('content-type')?.split(';')[0] || '';
  if (
    !type.startsWith('audio/') &&
    !['application/octet-stream', 'video/mp4', 'video/webm'].includes(type)
  )
    throw new Error('La URL no devuelve un archivo de audio compatible.');
  const total = Number(response.headers.get('content-length'));
  if (total > 500 * 1024 * 1024) throw new Error('El archivo supera el límite de 500 MB.');
  if (!response.body) throw new Error('Respuesta sin archivo.');
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value: part } = await reader.read();
      if (done) break;
      received += part.length;
      if (received > 500 * 1024 * 1024) throw new Error('El archivo supera el límite de 500 MB.');
      chunks.push(new Uint8Array(part));
      onProgress(total ? Math.min(100, (received / total) * 100) : null);
    }
  } catch (e) {
    await reader.cancel();
    throw e;
  }
  return new Blob(chunks, { type });
}
export function downloadFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
