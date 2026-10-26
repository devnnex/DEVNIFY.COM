import { useSyncExternalStore } from 'react';
import { db, uid, ownedSong } from './db';
import type { Song, QueueState } from '../types';
interface State {
  song?: Song;
  playing: boolean;
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
class Player {
  audio = new Audio();
  ownerId = '';
  private objectUrl = '';
  private token = 0;
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
    this.audio.addEventListener('pause', () => {
      this.lastWall = 0;
      this.patch({ playing: false });
      void this.persist();
    });
    this.audio.addEventListener('timeupdate', () => {
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
          /* Stale queue item */
        }
      }
    }
  }
  async load(id: string, autoplay = true) {
    const token = ++this.token;
    const owner = this.ownerId;
    const song = await ownedSong(owner, id);
    const record = await db.audioBlobs.get(id);
    if (token !== this.token || owner !== this.ownerId) return;
    if (!record || record.ownerId !== owner)
      throw new Error('No se encuentra el archivo de esta canción.');
    this.pause();
    this.audio.removeAttribute('src');
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = URL.createObjectURL(record.blob);
    this.recorded = false;
    this.listening = 0;
    this.historyId = uid();
    this.audio.src = this.objectUrl;
    this.patch({ song, time: 0, duration: song.duration, error: '' });
    if ('mediaSession' in navigator)
      navigator.mediaSession.metadata = new MediaMetadata({
        title: song.title,
        artist: song.artist,
        album: song.album,
        artwork: song.artwork ? [{ src: song.artwork }] : [],
      });
    if (autoplay) await this.resume();
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
      });
    }
  }
  async resume() {
    if (!this.state.song) return;
    const token = this.token;
    try {
      if (this.state.eq.some((x) => x !== 0) && !this.context) await this.enableEqualizer();
      if (this.context?.state === 'suspended') await this.context.resume();
      await this.audio.play();
    } catch (e) {
      if (token !== this.token || (e instanceof Error && e.name === 'AbortError')) return;
      this.patch({
        error: e instanceof Error ? e.message : 'Pulsa reproducir para continuar.',
      });
    }
  }
  pause() {
    this.audio.pause();
    if (this.recorded) void db.history.update(this.historyId, { seconds: this.listening });
  }
  toggle() {
    if (this.audio.paused) void this.resume();
    else this.pause();
  }
  stop() {
    ++this.token;
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
    let ids = this.state.ids;
    if (!ids.length) return;
    let index = ids.indexOf(this.state.song?.id || '');
    if (this.state.shuffle && ids.length > 1) {
      const candidates = ids.filter((id) => id !== this.state.song?.id);
      ids = [...ids];
      index = ids.indexOf(candidates[Math.floor(Math.random() * candidates.length)]) - 1;
    }
    if (index + 1 >= ids.length) {
      if (this.state.repeat === 'all') index = -1;
      else {
        if (ended) this.pause();
        return;
      }
    }
    try {
      await this.load(ids[index + 1]);
    } catch (e) {
      this.patch({ error: String(e) });
    }
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
        this.patch({ error: e instanceof Error ? e.message : 'Audio no disponible.' });
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
