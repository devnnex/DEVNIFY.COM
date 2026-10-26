import { beforeEach, describe, it, expect } from 'vitest';
import {
  db,
  defaultSettings,
  deleteUser,
  deleteSong,
  removeDownload,
  normalize,
} from '../services/db';
import { register, login, changePassword } from '../services/auth';
import { importAudio, addToPlaylists, youtubeId, validateHttps } from '../services/imports';
import { exportLibrary, inspectBackup, restoreLibrary } from '../services/backups';
function wav() {
  const frames = 8000;
  const bytes = new ArrayBuffer(44 + frames * 2);
  const v = new DataView(bytes);
  const text = (offset: number, value: string) =>
    [...value].forEach((c, i) => v.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  v.setUint32(4, 36 + frames * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true);
  v.setUint32(28, 16000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, frames * 2, true);
  for (let i = 0; i < frames; i++)
    v.setInt16(44 + i * 2, Math.sin((i / 8000) * 440 * Math.PI * 2) * 2000, true);
  return new Blob([bytes], { type: 'audio/wav' });
}
beforeEach(async () => {
  for (const table of db.tables) await table.clear();
});
describe('autenticación local', () => {
  it('deriva contraseñas, rechaza duplicados y contraseñas incorrectas y permite cambiarlas', async () => {
    const user = await register('Juan', 'juan', 'password123', 'password123');
    expect(user.verifier).not.toContain('password');
    expect(user.iterations).toBe(600000);
    expect((await login('JUAN', 'password123')).id).toBe(user.id);
    await expect(login('juan', 'incorrecta')).rejects.toThrow('incorrectos');
    await expect(register('Otro', 'Juan', 'password123', 'password123')).rejects.toThrow('existe');
    await changePassword(user, 'password123', 'nueva-clave123', 'nueva-clave123');
    await expect(login('juan', 'password123')).rejects.toThrow();
    expect((await login('juan', 'nueva-clave123')).id).toBe(user.id);
  });
  it('valida registro', async () => {
    await expect(register('Juan', 'ju', 'password123', 'password123')).rejects.toThrow();
    await expect(register('Juan', 'juan', 'short', 'short')).rejects.toThrow();
    await expect(register('Juan', 'juan', 'password123', 'mismatch')).rejects.toThrow();
  });
});
describe('biblioteca y respaldos', () => {
  it('respalda metadatos sin audio y recupera un archivo offline eliminado desde otro respaldo', async () => {
    const user = await register('Perfil', 'perfil', 'password123', 'password123');
    const { song } = await importAudio(user.id, wav(), 'Pista.wav');
    const full = await inspectBackup(await exportLibrary(user.id, ''), '');
    await removeDownload(user.id, song.id);
    const metadataOnly = await inspectBackup(await exportLibrary(user.id, ''), '');
    await restoreLibrary('restored', metadataOnly);
    const restored = (await db.songs.where({ ownerId: 'restored' }).first())!;
    expect(restored.downloaded).toBe(false);
    expect(await db.audioBlobs.get(restored.id)).toBeUndefined();
    await restoreLibrary('restored', full);
    expect((await db.songs.get(restored.id))?.downloaded).toBe(true);
    expect((await db.audioBlobs.get(restored.id))?.blob.size).toBe(wav().size);
  });
  it('elimina solo el archivo offline y lo recupera sin perder metadatos ni duplicar la canción', async () => {
    const { song } = await importAudio('a', wav(), 'Pista.wav', ['favorites']);
    await db.songs.update(song.id, { title: 'Mi título editado' });
    await removeDownload('a', song.id);
    expect((await db.songs.get(song.id))?.downloaded).toBe(false);
    expect(await db.audioBlobs.count()).toBe(0);
    const result = await importAudio('a', wav(), 'Otro nombre.wav');
    expect(result.song.id).toBe(song.id);
    expect(result.song.title).toBe('Mi título editado');
    expect(result.song.favorite).toBe(true);
    expect((await db.songs.get(song.id))?.downloaded).toBe(true);
    expect(await db.songs.count()).toBe(1);
  });
  it('importa blobs reales, detecta duplicados y aísla perfiles', async () => {
    const a = await importAudio('a', wav(), 'Pista.wav');
    const duplicate = await importAudio('a', wav(), 'Otra.wav');
    const b = await importAudio('b', wav(), 'Otra.wav');
    expect(a.song.duration).toBe(1);
    expect(duplicate.duplicate).toBe(true);
    expect(b.song.id).not.toBe(a.song.id);
    expect(await db.songs.count()).toBe(2);
    expect((await db.audioBlobs.get(a.song.id))?.blob.size).toBe(wav().size);
    await expect(addToPlaylists('b', a.song.id, ['favorites'])).rejects.toThrow();
    await expect(deleteSong('b', a.song.id)).rejects.toThrow();
  });
  it('guarda asignaciones sin duplicar audio y borra en cascada', async () => {
    const a = await importAudio('a', wav(), 'Pista.wav');
    await db.playlists.add({
      id: 'p',
      ownerId: 'a',
      name: 'Mi lista',
      description: '',
      songIds: [],
      createdAt: 0,
    });
    await addToPlaylists('a', a.song.id, ['p', 'favorites']);
    await addToPlaylists('a', a.song.id, ['p']);
    expect((await db.playlists.get('p'))?.songIds).toEqual([a.song.id]);
    expect((await db.songs.get(a.song.id))?.favorite).toBe(true);
    expect(await db.audioBlobs.count()).toBe(1);
    await deleteSong('a', a.song.id);
    expect((await db.playlists.get('p'))?.songIds).toEqual([]);
    expect(await db.audioBlobs.count()).toBe(0);
  });
  it('exporta y restaura audio, imágenes, playlists, historial y preferencias con integridad', async () => {
    const user = await register('Juan', 'juan', 'password123', 'password123');
    await db.settings.put({
      ...defaultSettings(user.id),
      serviceToken: 'secret',
      volume: 0.3,
    });
    const { song } = await importAudio(user.id, wav(), 'Canción.wav', ['favorites']);
    await db.songs.update(song.id, {
      artwork: 'data:image/png;base64,aGVsbG8=',
    });
    await db.playlists.add({
      id: 'p',
      ownerId: user.id,
      name: 'Música',
      description: 'Mi lista',
      artwork: 'data:image/png;base64,aGVsbG8=',
      songIds: [song.id],
      createdAt: 0,
    });
    await db.history.add({
      id: 'h',
      ownerId: user.id,
      songId: song.id,
      seconds: 1,
      playedAt: 100,
    });
    const blob = await exportLibrary(user.id, 'backup-password');
    const inspected = await inspectBackup(blob, 'backup-password');
    expect(JSON.stringify(inspected.manifest)).not.toContain('secret');
    await expect(inspectBackup(blob, 'wrong')).rejects.toThrow();
    expect(await restoreLibrary('new-user', inspected)).toBe(1);
    expect(await restoreLibrary('new-user', inspected)).toBe(0);
    const restored = await db.songs.where({ ownerId: 'new-user' }).first();
    expect(restored?.favorite).toBe(true);
    expect(restored?.artwork).toContain('data:');
    expect(await db.playlists.where({ ownerId: 'new-user' }).count()).toBe(1);
    expect(await db.history.where({ ownerId: 'new-user' }).count()).toBe(1);
    expect((await db.settings.get('new-user'))?.volume).toBe(0.3);
    const audio = await db.audioBlobs.get(restored!.id);
    expect(await audio!.blob.arrayBuffer()).toEqual(await wav().arrayBuffer());
  });
  it('rechaza archivos y respaldos corruptos sin modificar la biblioteca', async () => {
    await expect(importAudio('a', new Blob(['not audio']), 'fake.mp3')).rejects.toThrow();
    await expect(inspectBackup(new Blob(['broken']), '')).rejects.toThrow();
    expect(await db.songs.count()).toBe(0);
  });
  it('elimina solo los datos del perfil elegido', async () => {
    await importAudio('a', wav(), 'Pista.wav');
    await importAudio('b', wav(), 'Otra.wav');
    await deleteUser('a');
    expect(await db.songs.where({ ownerId: 'a' }).count()).toBe(0);
    expect(await db.songs.where({ ownerId: 'b' }).count()).toBe(1);
  });
});
it('valida URLs y permite búsqueda sin acentos', () => {
  expect(normalize('MÚSICA')).toBe('musica');
  expect(youtubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  expect(youtubeId('https://evil.test/watch?v=dQw4w9WgXcQ')).toBeNull();
  expect(() => validateHttps('javascript:alert(1)')).toThrow();
  expect(() => validateHttps('http://site.test/audio.mp3')).toThrow();
});
