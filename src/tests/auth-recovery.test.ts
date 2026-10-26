import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { db, defaultSettings } from '../services/db';
import {
  register,
  login,
  saveSession,
  clearSession,
  resetPasswordFromSession,
} from '../services/auth';
import { importAudio } from '../services/imports';

function storage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
    key: (index) => [...values.keys()][index] ?? null,
  };
}

function audioFixture() {
  const buffer = new ArrayBuffer(44 + 16000);
  const view = new DataView(buffer);
  for (const [offset, text] of [
    [0, 'RIFF'],
    [8, 'WAVE'],
    [12, 'fmt '],
    [36, 'data'],
  ] as const)
    [...text].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  view.setUint32(4, buffer.byteLength - 8, true);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(40, 16000, true);
  return new Blob([buffer], { type: 'audio/wav' });
}

beforeEach(async () => {
  vi.stubGlobal('localStorage', storage());
  vi.stubGlobal('sessionStorage', storage());
  for (const table of db.tables) await table.clear();
});
afterEach(() => vi.restoreAllMocks());

it('restablece desde una sesión temporal, conserva biblioteca y otro perfil y cambia las credenciales', async () => {
  const user = await register('Juan', 'juan', 'old-password123', 'old-password123');
  const other = await register('Otro', 'otro', 'other-password123', 'other-password123');
  saveSession(user, false);
  const audio = audioFixture();
  const { song } = await importAudio(user.id, audio, 'Mi música.wav', ['favorites']);
  await db.playlists.add({
    id: 'playlist',
    ownerId: user.id,
    name: 'Mi playlist',
    description: '',
    songIds: [song.id],
    createdAt: 1,
  });
  await db.settings.put({
    ...defaultSettings(user.id),
    serviceToken: 'local-test-only',
    remember: false,
  });
  await db.history.add({
    id: 'history',
    ownerId: user.id,
    songId: song.id,
    playedAt: 1,
    seconds: 1,
  });
  await db.queueStates.put({
    ownerId: user.id,
    ids: [song.id],
    currentId: song.id,
    position: 0.5,
    shuffle: false,
    repeat: 'all',
  });
  const tables = db.tables.filter((table) => table.name !== 'users');
  const before = await Promise.all(tables.map((table) => table.toArray()));

  const updated = await resetPasswordFromSession(
    user.id,
    ' JUAN ',
    'new-password123',
    'new-password123',
  );

  expect(updated.id).toBe(user.id);
  expect(updated.username).toBe(user.username);
  expect(updated.salt).not.toBe(user.salt);
  expect(updated.verifier).not.toBe(user.verifier);
  expect(updated.iterations).toBe(600000);
  expect(JSON.stringify(updated)).not.toContain('new-password123');
  await expect(login('juan', 'old-password123')).rejects.toThrow('incorrectos');
  expect((await login('juan', 'new-password123')).id).toBe(user.id);
  expect(await db.users.get(other.id)).toEqual(other);
  expect(await Promise.all(tables.map((table) => table.toArray()))).toEqual(before);
  expect(await (await db.audioBlobs.get(song.id))!.blob.arrayBuffer()).toEqual(
    await audio.arrayBuffer(),
  );
  expect(sessionStorage.getItem('aura.session')).toBe(user.id);
  expect(localStorage.getItem('aura.session')).toBeNull();
});

it('no restablece sin sesión ni permite modificar otro perfil desde una sesión diferente', async () => {
  const user = await register('Juan', 'juan', 'old-password123', 'old-password123');
  const other = await register('Otro', 'otro', 'other-password123', 'other-password123');
  await expect(
    resetPasswordFromSession(user.id, 'juan', 'new-password123', 'new-password123'),
  ).rejects.toThrow('sesión abierta');
  saveSession(other, true);
  await expect(
    resetPasswordFromSession(user.id, 'juan', 'new-password123', 'new-password123'),
  ).rejects.toThrow('sesión abierta');
  expect(await db.users.get(user.id)).toEqual(user);
  expect(await db.users.get(other.id)).toEqual(other);
});

it('rechaza usuario incorrecto, clave corta y confirmación distinta sin modificar credenciales', async () => {
  const user = await register('Juan', 'juan', 'old-password123', 'old-password123');
  saveSession(user, true);
  await expect(
    resetPasswordFromSession(user.id, 'otro', 'new-password123', 'new-password123'),
  ).rejects.toThrow('usuario');
  await expect(resetPasswordFromSession(user.id, 'juan', 'corta', 'corta')).rejects.toThrow(
    '10 caracteres',
  );
  await expect(
    resetPasswordFromSession(user.id, 'juan', 'new-password123', 'different123'),
  ).rejects.toThrow('no coinciden');
  expect(await db.users.get(user.id)).toEqual(user);
});

it('no cambia credenciales si se cierra la sesión mientras se deriva la nueva contraseña', async () => {
  const user = await register('Juan', 'juan', 'old-password123', 'old-password123');
  saveSession(user, true);
  const deriveBits = crypto.subtle.deriveBits.bind(crypto.subtle);
  vi.spyOn(crypto.subtle, 'deriveBits').mockImplementationOnce((algorithm, key, length) => {
    clearSession();
    return deriveBits(algorithm, key, length);
  });
  await expect(
    resetPasswordFromSession(user.id, 'juan', 'new-password123', 'new-password123'),
  ).rejects.toThrow('sesión ha cambiado');
  expect(await db.users.get(user.id)).toEqual(user);
});
