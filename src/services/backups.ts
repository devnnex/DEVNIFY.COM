import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { db, uid } from './db';
import { bytesToHex } from './auth';
import type { Song, Playlist, History, Settings } from '../types';
interface Manifest {
  version: 1;
  profile: { name: string; avatar?: string };
  songs: Song[];
  playlists: Playlist[];
  history: History[];
  settings: Omit<Settings, 'serviceToken'>;
  hashes: Record<string, string>;
}
async function key(password: string, salt: Uint8Array<ArrayBuffer>) {
  const material = await crypto.subtle.importKey('raw', strToU8(password), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
export async function exportLibrary(ownerId: string, password: string) {
  const user = await db.users.get(ownerId);
  if (!user) throw new Error('Perfil no disponible.');
  const songs = await db.songs.where({ ownerId }).toArray();
  const files: Record<string, Uint8Array<ArrayBuffer>> = {};
  const hashes: Record<string, string> = {};
  for (const song of songs) {
    if (!song.downloaded) continue;
    const audio = await db.audioBlobs.get(song.id);
    if (!audio || audio.ownerId !== ownerId) throw new Error(`Falta el archivo de ${song.title}.`);
    const path = `audio/${song.id}`;
    files[path] = new Uint8Array(await audio.blob.arrayBuffer());
    hashes[path] = bytesToHex(await crypto.subtle.digest('SHA-256', files[path]));
  }
  const settings = await db.settings.get(ownerId);
  const manifest: Manifest = {
    version: 1,
    profile: { name: user.name, avatar: user.avatar },
    songs,
    playlists: await db.playlists.where({ ownerId }).toArray(),
    history: await db.history.where({ ownerId }).toArray(),
    settings: {
      ownerId,
      serviceUrl: settings?.serviceUrl || '',
      remember: settings?.remember ?? true,
      volume: settings?.volume ?? 0.8,
      speed: settings?.speed ?? 1,
      eq: settings?.eq ?? [0, 0, 0, 0, 0],
    },
    hashes,
  };
  files['manifest.json'] = strToU8(JSON.stringify(manifest));
  const zip = new Uint8Array(zipSync(files, { level: 0 }));
  if (!password) return new Blob([zip], { type: 'application/zip' });
  if (password.length < 10) throw new Error('Usa al menos 10 caracteres para cifrar el respaldo.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await key(password, salt),
    zip,
  );
  return new Blob([strToU8('AURAENC1'), salt, iv, encrypted], {
    type: 'application/octet-stream',
  });
}
export async function inspectBackup(file: Blob, password: string) {
  if (file.size > 1024 * 1024 * 1024) throw new Error('El respaldo supera 1 GB.');
  let data = new Uint8Array(await file.arrayBuffer());
  if (strFromU8(data.slice(0, 8)) === 'AURAENC1') {
    try {
      data = new Uint8Array(
        await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: data.slice(24, 36) },
          await key(password, data.slice(8, 24)),
          data.slice(36),
        ),
      );
    } catch {
      throw new Error('Contraseña incorrecta o respaldo dañado.');
    }
  }
  let files: Record<string, Uint8Array<ArrayBuffer>>;
  let manifest: Manifest;
  try {
    let total = 0;
    files = unzipSync(data, {
      filter: (entry) => {
        total += entry.originalSize;
        if (total > 2 * 1024 * 1024 * 1024) throw new Error('Respaldo demasiado grande.');
        return true;
      },
    });
    manifest = JSON.parse(strFromU8(files['manifest.json']));
  } catch {
    throw new Error('El archivo no es un respaldo Devnify válido.');
  }
  if (
    manifest.version !== 1 ||
    !Array.isArray(manifest.songs) ||
    !Array.isArray(manifest.playlists) ||
    !Array.isArray(manifest.history) ||
    !manifest.hashes ||
    !manifest.profile ||
    typeof manifest.profile.name !== 'string' ||
    !manifest.profile.name.trim() ||
    manifest.profile.name.length > 200 ||
    (manifest.profile.avatar !== undefined && typeof manifest.profile.avatar !== 'string')
  )
    throw new Error('Versión o estructura de respaldo no compatible.');
  const ids = new Set<string>();
  for (const s of manifest.songs) {
    if (
      typeof s.id !== 'string' ||
      ids.has(s.id) ||
      typeof s.title !== 'string' ||
      typeof s.artist !== 'string' ||
      typeof s.album !== 'string' ||
      typeof s.genre !== 'string' ||
      typeof s.mimeType !== 'string' ||
      !Number.isFinite(s.createdAt) ||
      !Number.isFinite(s.size) ||
      s.size < 0 ||
      !Number.isFinite(s.playCount) ||
      s.playCount < 0 ||
      !['file', 'direct-url', 'authorized-import'].includes(s.sourceType) ||
      typeof s.favorite !== 'boolean' ||
      (s.downloaded !== undefined && typeof s.downloaded !== 'boolean') ||
      typeof s.checksum !== 'string' ||
      !Number.isFinite(s.duration) ||
      s.duration <= 0
    )
      throw new Error('Metadatos de audio no válidos.');
    ids.add(s.id);
    if (s.downloaded === false) continue;
    const bytes = files[`audio/${s.id}`];
    if (
      !bytes ||
      bytesToHex(await crypto.subtle.digest('SHA-256', bytes)) !==
        manifest.hashes[`audio/${s.id}`] ||
      manifest.hashes[`audio/${s.id}`] !== s.checksum
    )
      throw new Error(`Integridad incorrecta: ${s.title}.`);
  }
  for (const p of manifest.playlists)
    if (
      typeof p.name !== 'string' ||
      !Array.isArray(p.songIds) ||
      p.songIds.some((x) => !ids.has(x))
    )
      throw new Error('Relaciones de playlist no válidas.');
  for (const h of manifest.history)
    if (
      typeof h.songId !== 'string' ||
      !ids.has(h.songId) ||
      !Number.isFinite(h.seconds) ||
      h.seconds < 0 ||
      !Number.isFinite(h.playedAt)
    )
      throw new Error('Historial no válido.');
  return { manifest, files };
}
export async function restoreLibrary(
  ownerId: string,
  backup: Awaited<ReturnType<typeof inspectBackup>>,
) {
  const { manifest, files } = backup;
  const mapping = new Map<string, string>();
  let added = 0;
  await db.transaction(
    'rw',
    [db.songs, db.audioBlobs, db.playlists, db.history, db.settings, db.users],
    async () => {
      for (const source of manifest.songs) {
        const existing = await db.songs
          .where('[ownerId+checksum]')
          .equals([ownerId, source.checksum])
          .first();
        const id = existing?.id || uid();
        mapping.set(source.id, id);
        if (existing) {
          if (source.favorite) await db.songs.update(id, { favorite: true });
          if (!existing.downloaded && source.downloaded !== false) {
            await db.audioBlobs.put({
              id,
              ownerId,
              blob: new Blob([files[`audio/${source.id}`]], { type: source.mimeType }),
            });
            await db.songs.update(id, { downloaded: true });
          }
          continue;
        }
        await db.songs.add({
          ...source,
          id,
          ownerId,
          downloaded: source.downloaded !== false,
          size: source.downloaded === false ? source.size : files[`audio/${source.id}`].length,
        });
        if (source.downloaded !== false)
          await db.audioBlobs.add({
            id,
            ownerId,
            blob: new Blob([files[`audio/${source.id}`]], {
              type: source.mimeType,
            }),
          });
        added++;
      }
      for (const p of manifest.playlists) {
        const songIds = p.songIds.map((id) => mapping.get(id)!).filter(Boolean);
        const existing = (await db.playlists.where({ ownerId }).toArray()).find(
          (x) => x.name === p.name && JSON.stringify(x.songIds) === JSON.stringify(songIds),
        );
        if (!existing) await db.playlists.add({ ...p, id: uid(), ownerId, songIds });
      }
      for (const h of manifest.history) {
        const songId = mapping.get(h.songId);
        if (
          songId &&
          !(await db.history
            .where({ ownerId, songId })
            .filter((x) => x.playedAt === h.playedAt)
            .count())
        )
          await db.history.add({ ...h, id: uid(), ownerId, songId });
      }
      const previous = await db.settings.get(ownerId);
      const pref = manifest.settings;
      if (pref)
        await db.settings.put({
          ownerId,
          serviceUrl: typeof pref.serviceUrl === 'string' ? pref.serviceUrl : '',
          serviceToken: previous?.serviceToken || '',
          remember: !!pref.remember,
          volume: Math.max(0, Math.min(1, Number.isFinite(pref.volume) ? pref.volume : 0.8)),
          speed: [0.5, 0.75, 1, 1.25, 1.5, 2].includes(pref.speed) ? pref.speed : 1,
          eq:
            Array.isArray(pref.eq) && pref.eq.length === 5
              ? pref.eq.map((x) => Math.max(-12, Math.min(12, Number(x) || 0)))
              : [0, 0, 0, 0, 0],
        });
      await db.users.update(ownerId, {
        name: manifest.profile.name,
        avatar: manifest.profile.avatar,
      });
    },
  );
  return added;
}
