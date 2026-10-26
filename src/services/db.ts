import Dexie, { type EntityTable } from 'dexie';
import type { User, Song, AudioRecord, Playlist, History, Settings, QueueState } from '../types';
export const db = new Dexie('AuraMusicDB') as Dexie & {
  users: EntityTable<User, 'id'>;
  songs: EntityTable<Song, 'id'>;
  audioBlobs: EntityTable<AudioRecord, 'id'>;
  playlists: EntityTable<Playlist, 'id'>;
  history: EntityTable<History, 'id'>;
  settings: EntityTable<Settings, 'ownerId'>;
  queueStates: EntityTable<QueueState, 'ownerId'>;
};
db.version(1).stores({
  users: 'id,&username',
  songs: 'id,ownerId,[ownerId+checksum],createdAt',
  audioBlobs: 'id,ownerId',
  playlists: 'id,ownerId',
  history: 'id,ownerId,[ownerId+songId]',
  settings: 'ownerId',
  queueStates: 'ownerId',
});
db.version(2)
  .stores({ songs: 'id,ownerId,[ownerId+checksum],createdAt' })
  .upgrade((tx) =>
    tx
      .table('songs')
      .toCollection()
      .modify((song) => {
        song.downloaded = true;
      }),
  );
export const uid = () => crypto.randomUUID();
export function defaultSettings(ownerId: string): Settings {
  return {
    ownerId,
    serviceUrl: '',
    serviceToken: '',
    remember: true,
    volume: 0.8,
    speed: 1,
    eq: [0, 0, 0, 0, 0],
  };
}
export async function ownedSong(ownerId: string, id: string) {
  const song = await db.songs.get(id);
  if (!song || song.ownerId !== ownerId) throw new Error('Canción no disponible en este perfil.');
  return song;
}
export async function removeDownload(ownerId: string, id: string) {
  await ownedSong(ownerId, id);
  await db.transaction('rw', db.songs, db.audioBlobs, async () => {
    await db.audioBlobs.delete(id);
    await db.songs.update(id, { downloaded: false });
  });
}
export async function deleteSong(ownerId: string, id: string) {
  await ownedSong(ownerId, id);
  await db.transaction(
    'rw',
    [db.songs, db.audioBlobs, db.playlists, db.history, db.queueStates],
    async () => {
      await db.songs.delete(id);
      await db.audioBlobs.delete(id);
      const lists = await db.playlists.where({ ownerId }).toArray();
      for (const p of lists)
        await db.playlists.update(p.id, {
          songIds: p.songIds.filter((x) => x !== id),
        });
      await db.history.where({ ownerId, songId: id }).delete();
      const q = await db.queueStates.get(ownerId);
      if (q)
        await db.queueStates.put({
          ...q,
          ids: q.ids.filter((x) => x !== id),
          currentId: q.currentId === id ? undefined : q.currentId,
        });
    },
  );
}
export async function deleteUser(ownerId: string) {
  await db.transaction('rw', db.tables, async () => {
    for (const table of [db.songs, db.audioBlobs, db.playlists, db.history])
      await table.where({ ownerId }).delete();
    await db.settings.delete(ownerId);
    await db.queueStates.delete(ownerId);
    await db.users.delete(ownerId);
  });
}
export const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
