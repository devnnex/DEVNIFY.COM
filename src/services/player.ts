import { useSyncExternalStore } from 'react';
import { db, uid, ownedSong } from './db';
import type { Song, QueueState } from '../types';
import { requiresNativeAudio } from './audio-platform';
interface State {
  song?: Song;
  playing: boolean;
  loading: boolean;
  time: number;
  duration: number;
  volume: number;
  muted: boolean;
  speed: number;
  ids: string[];
  shuffle: boolean;
  repeat: QueueState['repeat'];
  error: string;
  sleepUntil: number;
  eq: number[];
}
interface PreparedTrack {
  song: Song;
  url: string;
}
export class Player {
  audio = new Audio();
  readonly supportsEqualizer = !requiresNativeAudio();
  ownerId = '';
  private objectUrl = '';
  private token = 0;
  private preparation = 0;
  private nextId?: string;
  private prepared?: PreparedTrack;
  private playbackIntent = false;
  private playAttempt = 0;
  private playPending = false;
  private canPlayRetry = false;
  private recorded = false;
  private listening = 0;
  private lastWall = 0;
  private historyId = '';
  private lastPersist = 0;
  private queuePersistAt = 0;
  private listeners = new Set<() => void>();
  private context?: AudioContext;
  private filters: BiquadFilterNode[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  state: State = {
    playing: false,
    loading: false,
    time: 0,
    duration: 0,
    volume: 0.8,
    muted: false,
    speed: 1,
    ids: [],
    shuffle: false,
    repeat: 'off',
    error: '',
    sleepUntil: 0,
    eq: [0, 0, 0, 0, 0],
  };
  constructor() {
    this.audio.preload = 'auto';
    this.audio.hidden = true;
    this.audio.setAttribute('playsinline', '');
    this.audio.setAttribute('aria-hidden', 'true');
    document.body.append(this.audio);
    // Safari can use this hint to retain a music playback session while locked.
    this.claimAudioSession();
    document.addEventListener('visibilitychange', () => {
      // Keep the native media element playing when the PWA leaves the foreground.
      this.syncMediaSession();
      void this.persist();
    });
    window.addEventListener('pagehide', () => {
      void this.persist();
    });
    this.audio.addEventListener('play', () => {
      this.lastWall = performance.now();
      this.patch({ playing: true });
    });
    this.audio.addEventListener('playing', () => {
      this.patch({ playing: true, loading: false, error: '' });
    });
    this.audio.addEventListener('canplay', () => {
      // WebKit may abort play() while selecting a replacement resource. Retry
      // from the media readiness event, never a background timer or UI effect.
      if (this.playbackIntent && this.audio.paused && !this.playPending && this.canPlayRetry) {
        this.canPlayRetry = false;
        void this.resume(false);
      }
    });
    this.audio.addEventListener('pause', () => {
      // An ended element can emit pause before ended. Keep the system session
      // alive until the next track starts or the queue actually finishes.
      if (this.audio.ended || (this.state.loading && this.playbackIntent)) return;
      this.playbackIntent = false;
      this.canPlayRetry = false;
      this.lastWall = 0;
      this.patch({ playing: false, loading: false });
      void this.persist();
    });
    this.audio.addEventListener('timeupdate', () => {
      if (this.checkSleep()) return;
      // iOS may release the audio session before delivering ended. A native
      // loop keeps that session eligible; advance at its wrap without cutting
      // the tail of the song or depending on a background timer.
      if (
        this.audio.loop &&
        this.playbackIntent &&
        !this.state.loading &&
        !this.audio.paused &&
        this.state.repeat !== 'one' &&
        this.state.time - this.audio.currentTime > Math.max(1, this.state.duration / 2)
      ) {
        void this.next(true);
        return;
      }
      const now = performance.now();
      if (!this.audio.paused && this.lastWall)
        this.listening += Math.min((now - this.lastWall) / 1000, 2);
      this.lastWall = now;
      this.patch({ time: this.audio.currentTime });
      if (
        !this.recorded &&
        this.state.song &&
        this.listening >= Math.min(30, this.state.duration * 0.5)
      ) {
        this.recorded = true;
        void this.record();
      }
      if (this.recorded && now - this.lastPersist > 5000) {
        this.lastPersist = now;
        void db.history.update(this.historyId, { seconds: this.listening });
      }
      if (now - this.queuePersistAt > 4000) {
        this.queuePersistAt = now;
        void this.persist();
      }
    });
    this.audio.addEventListener('loadedmetadata', () =>
      this.patch({ duration: this.audio.duration || 0 }),
    );
    this.audio.addEventListener('ended', () => {
      if (this.checkSleep()) return;
      if (this.state.repeat === 'one') {
        this.seek(0);
        void this.resume();
      } else void this.next(true);
    });
    this.audio.addEventListener('error', () => {
      if (this.audio.getAttribute('src'))
        this.patch({
          error: 'No se puede decodificar este audio. Prueba a convertirlo a MP3.',
          playing: false,
          loading: false,
        });
    });
    if ('mediaSession' in navigator) {
      const handlers: Partial<Record<MediaSessionAction, MediaSessionActionHandler>> = {
        play: () => void this.resume(),
        pause: () => this.pause(),
        previoustrack: () => void this.previous(),
        nexttrack: () => void this.next(),
        seekto: (d) => this.seek(d.seekTime || 0),
        seekbackward: (details) => this.seek(this.audio.currentTime - (details.seekOffset || 10)),
        seekforward: (details) => this.seek(this.audio.currentTime + (details.seekOffset || 10)),
        stop: () => {
          this.pause();
          this.seek(0);
        },
      };
      for (const [name, handler] of Object.entries(handlers))
        try {
          navigator.mediaSession.setActionHandler(name as MediaSessionAction, handler);
        } catch {
          /* Unsupported system action */
        }
    }
  }
  private claimAudioSession() {
    try {
      const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
      if (session && session.type !== 'playback') session.type = 'playback';
    } catch {
      /* Optional API; native HTML audio remains the fallback. */
    }
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSnapshot = () => this.state;
  patch(p: Partial<State>) {
    this.state = { ...this.state, ...p };
    for (const fn of this.listeners) fn();
    this.syncMediaSession();
    if ('ids' in p || 'shuffle' in p || 'repeat' in p) this.prepareNext();
  }
  private syncMediaSession() {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = this.state.song
      ? this.state.playing
        ? 'playing'
        : 'paused'
      : 'none';
    try {
      if (!this.state.song || !Number.isFinite(this.state.duration) || this.state.duration <= 0) {
        navigator.mediaSession.setPositionState?.();
        return;
      }
      navigator.mediaSession.setPositionState?.({
        duration: this.state.duration,
        playbackRate: this.state.speed,
        position: Math.max(0, Math.min(this.audio.currentTime || 0, this.state.duration)),
      });
    } catch {
      /* Some platforms do not implement position controls. */
    }
  }
  async setOwner(ownerId: string) {
    this.stop();
    this.ownerId = ownerId;
    this.patch({
      song: undefined,
      ids: [],
      time: 0,
      duration: 0,
      error: '',
      sleepUntil: 0,
    });
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
    if (!ownerId) return;
    const [q, settings] = await Promise.all([
      db.queueStates.get(ownerId),
      db.settings.get(ownerId),
    ]);
    if (this.ownerId !== ownerId) return;
    if (settings) {
      this.volume(settings.volume);
      this.speed(settings.speed);
      this.equalizer(settings.eq);
    }
    if (q) {
      this.patch({ ids: q.ids, shuffle: q.shuffle, repeat: q.repeat });
      if (q.currentId) {
        try {
          await this.load(q.currentId, false);
          this.seek(q.position);
        } catch {
          this.patch({ loading: false });
        }
      }
    }
  }
  async load(id: string, autoplay = true) {
    const token = ++this.token;
    const owner = this.ownerId;
    this.playbackIntent = autoplay;
    this.patch({ loading: true });
    let track: PreparedTrack;
    if (this.prepared?.song.id === id && this.prepared.song.ownerId === owner) {
      track = this.prepared;
      this.prepared = undefined;
    } else {
      const [song, record] = await Promise.all([ownedSong(owner, id), db.audioBlobs.get(id)]);
      if (token !== this.token || owner !== this.ownerId) return;
      if (!record || record.ownerId !== owner)
        throw new Error('No se encuentra el archivo de esta canción.');
      track = { song, url: URL.createObjectURL(record.blob) };
    }
    this.clearPrepared();
    if (this.recorded) void db.history.update(this.historyId, { seconds: this.listening });
    const previousUrl = this.objectUrl;
    this.objectUrl = track.url;
    this.recorded = false;
    this.listening = 0;
    this.historyId = uid();
    // Keep the same native element. Safari needs an explicit resource reset,
    // with pause/load/play all in the original media-control event task.
    this.audio.pause();
    this.audio.src = this.objectUrl;
    this.audio.load();
    if (previousUrl) URL.revokeObjectURL(previousUrl);
    // Browsers may reset the rate when replacing the media resource.
    this.audio.playbackRate = this.state.speed;
    const { song } = track;
    this.patch({ song, time: 0, duration: song.duration, error: '', loading: autoplay });
    const playback = autoplay ? this.resume() : undefined;
    if ('mediaSession' in navigator && typeof MediaMetadata !== 'undefined')
      navigator.mediaSession.metadata = new MediaMetadata({
        title: song.title,
        artist: song.artist,
        album: song.album,
        artwork: song.artwork ? [{ src: song.artwork }] : [],
      });
    // With a prepared track play() is called inside ended/nexttrack, before
    // awaiting IndexedDB or another task that may be suspended in background.
    this.prepareNext();
    await playback;
    await this.persist();
  }
  async play(song: Song, ids?: string[]) {
    if (ids) this.patch({ ids: [...new Set(ids)] });
    else if (!this.state.ids.includes(song.id)) this.patch({ ids: [...this.state.ids, song.id] });
    try {
      await this.load(song.id);
    } catch (e) {
      this.patch({
        error: e instanceof Error ? e.message : 'No se pudo reproducir.',
        loading: false,
      });
    }
  }
  async resume(allowRetry = true) {
    if (!this.state.song) return;
    const token = this.token;
    const attempt = ++this.playAttempt;
    this.playbackIntent = true;
    this.playPending = true;
    this.canPlayRetry = allowRetry;
    this.claimAudioSession();
    this.patch({ loading: this.audio.paused, error: '' });
    try {
      const equalizer =
        this.supportsEqualizer && this.state.eq.some((x) => x !== 0) && !this.context
          ? this.enableEqualizer()
          : this.context && this.context.state !== 'running' && this.context.state !== 'closed'
            ? this.context.resume()
            : undefined;
      await Promise.all([this.audio.play(), equalizer]);
    } catch (e) {
      if (token !== this.token || attempt !== this.playAttempt) return;
      if (
        e instanceof Error &&
        e.name === 'AbortError' &&
        this.playbackIntent &&
        this.canPlayRetry
      ) {
        if (this.audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
          this.playPending = false;
          this.canPlayRetry = false;
          void this.resume(false);
        }
        return;
      }
      this.playbackIntent = false;
      this.patch({
        playing: false,
        loading: false,
        error: e instanceof Error ? e.message : 'Pulsa reproducir para continuar.',
      });
    } finally {
      if (attempt === this.playAttempt) this.playPending = false;
    }
  }
  pause() {
    this.playbackIntent = false;
    ++this.playAttempt;
    this.playPending = false;
    this.canPlayRetry = false;
    // Cancel an asynchronous track lookup so it cannot undo this pause.
    ++this.token;
    this.audio.pause();
    this.patch({ playing: false, loading: false });
    if (this.recorded) void db.history.update(this.historyId, { seconds: this.listening });
  }
  toggle() {
    if (this.audio.paused) void this.resume();
    else this.pause();
  }
  stop() {
    ++this.token;
    this.clearPrepared();
    this.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = '';
    clearTimeout(this.timer);
    this.patch({ playing: false, time: 0, sleepUntil: 0 });
  }
  seek(time: number) {
    if (!Number.isFinite(time)) return;
    const clamped = Math.max(0, Math.min(time, this.state.duration || 0));
    this.audio.currentTime = clamped;
    this.patch({ time: clamped });
    void this.persist();
  }
  async next(ended = false) {
    if (this.checkSleep()) return;
    const id = this.nextId ?? this.chooseNext();
    if (!id) {
      if (ended) this.pause();
      return;
    }
    try {
      await this.load(id);
    } catch (e) {
      this.patch({ error: String(e), playing: !this.audio.paused, loading: false });
    }
  }
  private chooseNext() {
    const { ids, song, shuffle, repeat } = this.state;
    if (!ids.length) return;
    if (shuffle && ids.length > 1) {
      const candidates = ids.filter((id) => id !== song?.id);
      return candidates[Math.floor(Math.random() * candidates.length)];
    }
    const index = ids.indexOf(song?.id || '') + 1;
    return ids[index] ?? (repeat === 'all' ? ids[0] : undefined);
  }
  private clearPrepared() {
    ++this.preparation;
    if (this.prepared) URL.revokeObjectURL(this.prepared.url);
    this.prepared = undefined;
    this.nextId = undefined;
    this.updateNativeLoop();
  }
  private updateNativeLoop() {
    this.audio.loop = !this.supportsEqualizer && (this.state.repeat === 'one' || !!this.prepared);
  }
  private prepareNext() {
    this.clearPrepared();
    if (!this.state.song || !this.ownerId) return;
    const id = this.chooseNext();
    this.nextId = id;
    if (!id) return;
    const preparation = this.preparation;
    const owner = this.ownerId;
    void Promise.all([ownedSong(owner, id), db.audioBlobs.get(id)])
      .then(([song, record]) => {
        if (preparation !== this.preparation || owner !== this.ownerId) return;
        if (record?.ownerId === owner) {
          this.prepared = { song, url: URL.createObjectURL(record.blob) };
          this.updateNativeLoop();
        }
      })
      .catch(() => {
        // Report unavailable audio only when playback is requested.
      });
  }
  private checkSleep() {
    if (!this.state.sleepUntil || Date.now() < this.state.sleepUntil) return false;
    this.pause();
    this.patch({ sleepUntil: 0 });
    return true;
  }
  async previous() {
    if (this.audio.currentTime > 3) {
      this.seek(0);
      return;
    }
    const index = this.state.ids.indexOf(this.state.song?.id || '');
    if (index > 0) {
      try {
        await this.load(this.state.ids[index - 1]);
      } catch (e) {
        this.patch({
          error: e instanceof Error ? e.message : 'Audio no disponible.',
          loading: false,
        });
      }
    } else this.seek(0);
  }
  volume(volume: number) {
    this.audio.volume = volume;
    this.patch({ volume });
    void this.savePreference({ volume });
  }
  mute() {
    this.audio.muted = !this.audio.muted;
    this.patch({ muted: this.audio.muted });
  }
  speed(speed: number) {
    this.audio.playbackRate = speed;
    this.patch({ speed });
    void this.savePreference({ speed });
  }
  shuffle() {
    this.patch({ shuffle: !this.state.shuffle });
    void this.persist();
  }
  repeat() {
    this.patch({
      repeat: this.state.repeat === 'off' ? 'all' : this.state.repeat === 'all' ? 'one' : 'off',
    });
    void this.persist();
  }
  queue(ids: string[], next = false) {
    const q = [...this.state.ids];
    const pos = next ? Math.max(0, q.indexOf(this.state.song?.id || '') + 1) : q.length;
    for (const id of ids) {
      const existing = q.indexOf(id);
      if (existing !== -1) q.splice(existing, 1);
    }
    q.splice(Math.min(pos, q.length), 0, ...ids);
    this.patch({ ids: q });
    void this.persist();
  }
  setQueue(ids: string[]) {
    this.patch({ ids });
    void this.persist();
  }
  sleep(minutes: number) {
    clearTimeout(this.timer);
    this.patch({ sleepUntil: minutes ? Date.now() + minutes * 60000 : 0 });
    if (minutes)
      this.timer = setTimeout(() => {
        this.pause();
        this.patch({ sleepUntil: 0 });
      }, minutes * 60000);
  }
  equalizer(values: number[]) {
    this.patch({ eq: values });
    this.filters.forEach((f, i) => (f.gain.value = values[i]));
    void this.savePreference({ eq: values });
  }
  async enableEqualizer() {
    // Attaching a MediaElementSource is permanent for that element. Keep iOS
    // on its native output even when a saved profile has a non-flat preset.
    if (!this.supportsEqualizer) return;
    if (!this.context) {
      this.context = new AudioContext();
      const input = this.context.createMediaElementSource(this.audio);
      let previous: AudioNode = input;
      [60, 230, 910, 3600, 14000].forEach((frequency, i) => {
        const filter = this.context!.createBiquadFilter();
        filter.type = i === 0 ? 'lowshelf' : i === 4 ? 'highshelf' : 'peaking';
        filter.frequency.value = frequency;
        filter.Q.value = 1;
        filter.gain.value = this.state.eq[i];
        previous.connect(filter);
        this.filters.push(filter);
        previous = filter;
      });
      const gain = this.context.createGain();
      gain.gain.value = 0.5;
      previous.connect(gain);
      gain.connect(this.context.destination);
    }
    await this.context.resume();
  }
  async record() {
    const song = this.state.song;
    const ownerId = this.ownerId;
    if (!song) return;
    await db.transaction('rw', db.songs, db.history, async () => {
      const fresh = await db.songs.get(song.id);
      if (fresh?.ownerId !== ownerId) return;
      await db.songs.update(song.id, {
        playCount: fresh.playCount + 1,
        lastPlayedAt: Date.now(),
      });
      await db.history.add({
        id: this.historyId,
        ownerId,
        songId: song.id,
        playedAt: Date.now(),
        seconds: this.listening,
      });
    });
  }
  async persist() {
    const ownerId = this.ownerId;
    if (!ownerId) return;
    if (!(await db.users.get(ownerId)) || this.ownerId !== ownerId) return;
    await db.queueStates.put({
      ownerId: this.ownerId,
      ids: this.state.ids,
      currentId: this.state.song?.id,
      position: this.audio.currentTime || 0,
      shuffle: this.state.shuffle,
      repeat: this.state.repeat,
    });
  }
  async savePreference(values: Partial<{ volume: number; speed: number; eq: number[] }>) {
    if (this.ownerId) await db.settings.update(this.ownerId, values);
  }
}
export const player = new Player();
export const usePlayer = () => useSyncExternalStore(player.subscribe, player.getSnapshot);
export const useCurrentSongId = () =>
  useSyncExternalStore(player.subscribe, () => player.state.song?.id);
export const usePlaybackStatus = () =>
  useSyncExternalStore(player.subscribe, () => `${player.state.song?.id}:${player.state.playing}`);
export function formatTime(value: number) {
  if (!Number.isFinite(value)) return '0:00';
  return `${Math.floor(value / 60)}:${Math.floor(value % 60)
    .toString()
    .padStart(2, '0')}`;
}
