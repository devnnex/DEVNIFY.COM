import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import { db } from '../services/db';
import type { Song } from '../types';
import { requiresNativeAudio } from '../services/audio-platform';

class TestContext {
  static latest: TestContext;
  state = 'running';
  destination = {};
  constructor() {
    TestContext.latest = this;
  }
  resume = vi.fn(async () => {
    this.state = 'running';
  });
  createMediaElementSource() {
    return { connect: vi.fn() };
  }
  createBiquadFilter() {
    return {
      connect: vi.fn(),
      gain: { value: 0 },
      frequency: { value: 0 },
      Q: { value: 0 },
      type: '',
    };
  }
  createGain() {
    return { connect: vi.fn(), gain: { value: 1 } };
  }
}

class TestAudio extends EventTarget {
  src = '';
  currentTime = 0;
  duration = 20;
  paused = true;
  ended = false;
  loop = false;
  readyState = 4;
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
  load = vi.fn(() => {
    this.currentTime = 0;
    this.ended = false;
  });
  play = vi.fn(async () => {
    this.ended = false;
    this.paused = false;
    this.dispatchEvent(new Event('play'));
    this.dispatchEvent(new Event('playing'));
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
  vi.stubGlobal('AudioContext', TestContext);
  vi.stubGlobal('HTMLMediaElement', { HAVE_FUTURE_DATA: 3 });
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('navigator', {
    userAgent: 'Desktop test browser',
    maxTouchPoints: 0,
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
    expect(audio.pause).toHaveBeenCalledTimes(pauses + 1);
    expect(audio.load).toHaveBeenCalled();
    expect(player.state.loading).toBe(false);
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

  it('recovers an interrupted equalizer during a headset play command', async () => {
    await start();
    player.equalizer([8, 5, 0, 0, 0]);
    await player.enableEqualizer();
    const context = TestContext.latest;
    handlers.get('pause')?.({ action: 'pause' });
    context.state = 'interrupted';
    context.resume.mockClear();
    handlers.get('play')?.({ action: 'play' });
    expect(context.resume).toHaveBeenCalledOnce();
    expect(context.state).toBe('running');
    expect(audio.paused).toBe(false);
    expect(player.state.loading).toBe(false);
  });

  it('does not overwrite a pause with a delayed failed play attempt', async () => {
    await start();
    player.pause();
    let rejectPlay!: (reason: Error) => void;
    audio.play.mockImplementationOnce(
      () =>
        new Promise<void>((_, reject) => {
          rejectPlay = reject;
        }),
    );
    const pending = player.resume();
    player.pause();
    rejectPlay(new Error('Old play failure'));
    await pending;
    expect(player.state.playing).toBe(false);
    expect(player.state.error).toBe('');
    audio.dispatchEvent(new Event('canplay'));
    expect(audio.paused).toBe(true);
  });

  it('retries an aborted resource change once from canplay without opening the app', async () => {
    await start();
    player.pause();
    audio.readyState = 0;
    audio.play.mockRejectedValueOnce(new DOMException('Resource changed', 'AbortError'));
    await player.resume();
    const calls = audio.play.mock.calls.length;
    audio.readyState = 4;
    audio.dispatchEvent(new Event('canplay'));
    expect(audio.play).toHaveBeenCalledTimes(calls + 1);
    expect(audio.paused).toBe(false);
    expect(player.state.loading).toBe(false);
  });
});

describe('iOS native playback', () => {
  it('detects iPhone and desktop-mode iPad without changing Android or Mac playback', () => {
    expect(requiresNativeAudio({ userAgent: 'iPhone AppleWebKit Safari', maxTouchPoints: 5 })).toBe(
      true,
    );
    expect(
      requiresNativeAudio({ userAgent: 'Macintosh AppleWebKit Safari', maxTouchPoints: 5 }),
    ).toBe(true);
    expect(
      requiresNativeAudio({ userAgent: 'Macintosh AppleWebKit Safari', maxTouchPoints: 0 }),
    ).toBe(false);
    expect(requiresNativeAudio({ userAgent: 'Android Chrome', maxTouchPoints: 5 })).toBe(false);
  });

  it('keeps saved equalizer settings off the iPhone output and advances at the native loop boundary', async () => {
    const originalNavigator = navigator;
    const originalHandlers = new Map(handlers);
    vi.stubGlobal('navigator', {
      ...navigator,
      userAgent: 'iPhone AppleWebKit Safari',
      maxTouchPoints: 5,
    });
    const { Player } = await import('../services/player');
    const native = new Player();
    const nativeAudio = native.audio as unknown as TestAudio;
    const constructContext = vi.fn(() => {
      throw new Error('Web Audio must not be attached on iPhone');
    });
    vi.stubGlobal('AudioContext', constructContext);
    try {
      await native.setOwner('owner');
      native.equalizer([8, 5, 0, 0, 0]);
      await native.enableEqualizer();
      await native.play(tracks[0], ['a', 'b']);
      await vi.waitFor(() => expect(nativeAudio.loop).toBe(true));
      handlers.get('pause')?.({ action: 'pause' });
      handlers.get('play')?.({ action: 'play' });
      expect(nativeAudio.paused).toBe(false);
      expect(constructContext).not.toHaveBeenCalled();
      native.seek(19.8);
      nativeAudio.currentTime = 0.1;
      nativeAudio.dispatchEvent(new Event('timeupdate'));
      expect(native.state.song?.id).toBe('b');
      expect(nativeAudio.paused).toBe(false);
      expect(nativeAudio.loop).toBe(false);
      nativeAudio.finish();
      expect(native.state.playing).toBe(false);
    } finally {
      await native.setOwner('');
      handlers.clear();
      for (const [action, handler] of originalHandlers) handlers.set(action, handler);
      vi.stubGlobal('navigator', originalNavigator);
      vi.stubGlobal('AudioContext', TestContext);
    }
  });
});
