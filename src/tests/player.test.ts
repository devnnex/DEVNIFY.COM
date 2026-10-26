import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import { db } from '../services/db';
import type { Song } from '../types';

class TestAudio extends EventTarget {
  src = '';
  currentTime = 0;
  duration = 20;
  paused = true;
  ended = false;
  playbackRate = 1;
  volume = 1;
  muted = false;
  setAttribute() {}
  getAttribute() {
    return this.src;
  }
  removeAttribute() {
    this.src = '';
  }
  load() {}
  play = vi.fn(async () => {
    this.ended = false;
    this.paused = false;
    this.dispatchEvent(new Event('play'));
  });
  pause = vi.fn(() => {
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
  });
  finish() {
    this.ended = true;
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
    this.dispatchEvent(new Event('ended'));
  }
}

const handlers = new Map<MediaSessionAction, MediaSessionActionHandler>();
const doc = Object.assign(new EventTarget(), {
  body: { append: vi.fn() },
  visibilityState: 'hidden',
});
let player: (typeof import('../services/player'))['player'];
let audio: TestAudio;
const tracks: Song[] = ['a', 'b', 'c'].map((id) => ({
  id,
  ownerId: 'owner',
  title: id,
  artist: 'Artist',
  album: '',
  genre: '',
  duration: 20,
  mimeType: 'audio/wav',
  size: 4,
  downloaded: true,
  sourceType: 'file',
  createdAt: 1,
  updatedAt: 1,
  playCount: 0,
  checksum: id,
  favorite: false,
}));
let created: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  vi.stubGlobal('Audio', TestAudio);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('navigator', {
    audioSession: { type: 'auto' },
    mediaSession: {
      playbackState: 'none',
      metadata: null,
      setPositionState: vi.fn(),
      setActionHandler: (action: MediaSessionAction, handler: MediaSessionActionHandler) =>
        handlers.set(action, handler),
    },
  });
  vi.stubGlobal(
    'MediaMetadata',
    class {
      constructor(data: MediaMetadataInit) {
        Object.assign(this, data);
      }
    },
  );
  ({ player } = await import('../services/player'));
  audio = player.audio as unknown as TestAudio;
});

beforeEach(async () => {
  vi.restoreAllMocks();
  await player.setOwner('');
  for (const table of db.tables) await table.clear();
  await db.users.put({
    id: 'owner',
    username: 'owner',
    name: 'Owner',
    salt: '',
    verifier: '',
    iterations: 1,
    createdAt: 1,
  });
  await db.songs.bulkPut(tracks);
  await db.audioBlobs.bulkPut(
    tracks.map(({ id }) => ({ id, ownerId: 'owner', blob: new Blob([id]) })),
  );
  await player.setOwner('owner');
  player.patch({ shuffle: false, repeat: 'off', eq: [0, 0, 0, 0, 0] });
  created = vi.spyOn(URL, 'createObjectURL');
  audio.play.mockClear();
  audio.pause.mockClear();
});

afterAll(async () => {
  await player.setOwner('');
  vi.unstubAllGlobals();
});

async function start(ids = ['a', 'b', 'c']) {
  await player.play(tracks[0], ids);
  await vi.waitFor(() => expect(created).toHaveBeenCalledTimes(2));
}

describe('background playback and headset controls', () => {
  it('starts the prepared next track synchronously even when database reads are suspended', async () => {
    await start();
    const before = audio.src;
    const pauses = audio.pause.mock.calls.length;
    const read = vi
      .spyOn(db.audioBlobs, 'get')
      .mockImplementation(() => new Dexie.Promise(() => {}));
    doc.dispatchEvent(new Event('visibilitychange'));
    audio.finish();
    expect(player.state.song?.id).toBe('b');
    expect(audio.src).not.toBe(before);
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(audio.pause).toHaveBeenCalledTimes(pauses);
    expect(navigator.mediaSession.playbackState).toBe('playing');
    read.mockRestore();
  });

  it('handles next, previous, pause and play commands from the system', async () => {
    await start();
    handlers.get('nexttrack')?.({ action: 'nexttrack' });
    expect(player.state.song?.id).toBe('b');
    handlers.get('pause')?.({ action: 'pause' });
    expect(player.state.playing).toBe(false);
    handlers.get('play')?.({ action: 'play' });
    expect(player.state.playing).toBe(true);
    audio.currentTime = 0;
    handlers.get('previoustrack')?.({ action: 'previoustrack' });
    await vi.waitFor(() => expect(player.state.song?.id).toBe('a'));
  });

  it('invalidates prepared audio when the queue changes', async () => {
    await start();
    player.setQueue(['a', 'c']);
    await vi.waitFor(() => expect(created).toHaveBeenCalledTimes(3));
    audio.finish();
    expect(player.state.song?.id).toBe('c');
  });

  it('stops at the end of the queue and wraps only with repeat all', async () => {
    await start(['a', 'b']);
    await player.next();
    audio.finish();
    expect(player.state.song?.id).toBe('b');
    expect(player.state.playing).toBe(false);
    player.patch({ repeat: 'all' });
    await vi.waitFor(() => expect(created).toHaveBeenCalledTimes(3));
    audio.finish();
    expect(player.state.song?.id).toBe('a');
    expect(player.state.playing).toBe(true);
  });

  it('repeats one on ended but the headset can still skip', async () => {
    await start();
    player.patch({ repeat: 'one' });
    await vi.waitFor(() => expect(created).toHaveBeenCalledTimes(3));
    audio.currentTime = 20;
    audio.finish();
    expect(player.state.song?.id).toBe('a');
    expect(audio.currentTime).toBe(0);
    handlers.get('nexttrack')?.({ action: 'nexttrack' });
    expect(player.state.song?.id).toBe('b');
  });

  it('uses the same shuffle selection for prefetch and playback', async () => {
    await start();
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    player.patch({ shuffle: true });
    await vi.waitFor(() => expect(created).toHaveBeenCalledTimes(3));
    audio.finish();
    expect(player.state.song?.id).toBe('c');
  });

  it('honors an expired sleep timer even if background timers were throttled', async () => {
    await start();
    player.patch({ sleepUntil: Date.now() - 1 });
    audio.finish();
    expect(player.state.song?.id).toBe('a');
    expect(player.state.playing).toBe(false);
    expect(player.state.sleepUntil).toBe(0);
  });

  it('releases the current and prepared tracks when changing profile', async () => {
    await start();
    const revoked = vi.spyOn(URL, 'revokeObjectURL');
    await player.setOwner('');
    expect(revoked).toHaveBeenCalledTimes(2);
    expect(audio.src).toBe('');
    expect(player.state.song).toBeUndefined();
  });
});
