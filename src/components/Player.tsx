import { useState, useRef } from 'react';
import { useArtworkColor } from '../hooks/useArtworkColor';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  Heart,
  Volume2,
  VolumeX,
  ListMusic,
  ChevronDown,
  Timer,
  SlidersHorizontal,
  Square,
} from 'lucide-react';
import { player, usePlayer, formatTime } from '../services/player';
import { db } from '../services/db';
import { Cover, Modal } from './common';
import type { Song } from '../types';
function Controls({ full = false }: { full?: boolean }) {
  const s = usePlayer();
  return (
    <div className={`play-controls ${full ? 'large' : ''}`}>
      <button
        className={`icon-button ${s.shuffle ? 'active' : ''}`}
        aria-label="Aleatorio"
        aria-pressed={s.shuffle}
        onClick={() => player.shuffle()}
      >
        <Shuffle size={19} />
      </button>
      <button className="icon-button" aria-label="Anterior" onClick={() => void player.previous()}>
        <SkipBack />
      </button>
      <button
        className="play-main"
        aria-label={s.playing ? 'Pausar' : 'Reproducir'}
        onClick={() => player.toggle()}
      >
        {s.playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
      </button>
      <button className="icon-button" aria-label="Siguiente" onClick={() => void player.next()}>
        <SkipForward />
      </button>
      <button
        className={`icon-button ${s.repeat !== 'off' ? 'active' : ''}`}
        aria-label={`Repetir: ${s.repeat}`}
        onClick={() => player.repeat()}
      >
        {s.repeat === 'one' ? <Repeat1 size={19} /> : <Repeat size={19} />}
      </button>
    </div>
  );
}
export function Player({ songs, notify }: { songs: Song[]; notify: (s: string) => void }) {
  const s = usePlayer();
  const [full, setFull] = useState(false);
  const [queue, setQueue] = useState(false);
  const [extras, setExtras] = useState(false);
  const song = songs.find((x) => x.id === s.song?.id) || s.song;
  const artworkColor = useArtworkColor(song?.artwork);
  const touch = useRef<{ x: number; y: number } | undefined>(undefined);
  const favorite = async () => {
    if (song) await db.songs.update(song.id, { favorite: !song.favorite });
  };
  const progress = (
    <input
      className="seek"
      aria-label="Posición de reproducción"
      type="range"
      min="0"
      max={s.duration || 1}
      step=".1"
      value={Math.min(s.time, s.duration || 1)}
      onChange={(e) => player.seek(Number(e.target.value))}
    />
  );
  return (
    <>
      {song && (
        <div className="mini-player">
          <button
            className="mini-song"
            onClick={() => setFull(true)}
            aria-label="Abrir reproductor completo"
          >
            <Cover src={song.artwork} />
            <span>
              <strong>{song.title}</strong>
              <small>{song.artist}</small>
            </span>
          </button>
          <button
            className={`icon-button favorite-mini ${song.favorite ? 'active' : ''}`}
            aria-label="Favorito"
            onClick={() => void favorite()}
          >
            <Heart size={18} fill={song.favorite ? 'currentColor' : 'none'} />
          </button>
          <div className="mini-center">
            <Controls />
            <div className="mini-progress">
              <span>{formatTime(s.time)}</span>
              {progress}
              <span>{formatTime(s.duration)}</span>
            </div>
          </div>
          <div className="mini-right">
            <button className="icon-button" aria-label="Abrir cola" onClick={() => setQueue(true)}>
              <ListMusic size={19} />
            </button>
            <button className="icon-button" aria-label="Silenciar" onClick={() => player.mute()}>
              {s.muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>
            <input
              aria-label="Volumen"
              type="range"
              min="0"
              max="1"
              step=".01"
              value={s.volume}
              onChange={(e) => player.volume(Number(e.target.value))}
            />
          </div>
          <button
            className="mobile-play play-main"
            aria-label={s.playing ? 'Pausar' : 'Reproducir'}
            onClick={() => player.toggle()}
          >
            {s.playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
          </button>
          <div
            className="mobile-progress"
            style={{
              width: `${s.duration ? (s.time / s.duration) * 100 : 0}%`,
            }}
          />
        </div>
      )}
      {s.error && (
        <div className="player-error" role="alert">
          {s.error}
          <button
            aria-label="Cerrar error de reproducción"
            onClick={() => player.patch({ error: '' })}
          >
            Cerrar
          </button>
        </div>
      )}
      {full && song && (
        <Modal title="Ahora suena" accent={artworkColor} onClose={() => setFull(false)}>
          <div className="now-playing">
            <div className="now-caption">
              <span>DE TU BIBLIOTECA</span>
              <button className="icon-button" aria-label="Minimizar" onClick={() => setFull(false)}>
                <ChevronDown />
              </button>
            </div>
            <div
              onTouchStart={(e) => {
                touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
              }}
              onTouchEnd={(e) => {
                if (!touch.current) return;
                const dx = e.changedTouches[0].clientX - touch.current.x;
                const dy = e.changedTouches[0].clientY - touch.current.y;
                if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
                  if (dx < 0) void player.next();
                  else void player.previous();
                }
                touch.current = undefined;
              }}
            >
              <Cover src={song.artwork} className={s.playing ? 'playing-cover' : ''} />
            </div>
            <div className="now-title">
              <div>
                <h2>{song.title}</h2>
                <p>
                  {song.artist}
                  {song.album ? ` · ${song.album}` : ''}
                </p>
              </div>
              <button
                className={`icon-button ${song.favorite ? 'active' : ''}`}
                aria-label="Favorito"
                onClick={() => void favorite()}
              >
                <Heart fill={song.favorite ? 'currentColor' : 'none'} />
              </button>
            </div>
            {progress}
            <div className="time-labels">
              <span>{formatTime(s.time)}</span>
              <span>{formatTime(s.duration)}</span>
            </div>
            <Controls full />
            <div className="now-options">
              <button
                className="icon-button"
                aria-label="Cola de reproducción"
                onClick={() => setQueue(true)}
              >
                <ListMusic />
              </button>
              <button
                className="icon-button"
                aria-label="Detener"
                onClick={() => {
                  player.pause();
                  player.seek(0);
                }}
              >
                <Square size={19} />
              </button>
              <button
                className={`icon-button ${s.sleepUntil ? 'active' : ''}`}
                aria-label="Opciones de audio y temporizador"
                onClick={() => setExtras(true)}
              >
                <SlidersHorizontal />
              </button>
            </div>
            <button
              className="text-button full"
              onClick={() => {
                setFull(false);
                location.hash = 'playlists';
              }}
            >
              Ver mis playlists
            </button>
          </div>
        </Modal>
      )}
      {queue && (
        <Modal title="Cola de reproducción" onClose={() => setQueue(false)}>
          <div className="section-head">
            <p className="muted">{s.ids.length} canciones</p>
            <button className="text-button" onClick={() => player.setQueue([])}>
              Vaciar cola
            </button>
          </div>
          {s.ids.length === 0 && (
            <p className="muted">Añade canciones desde su menú de opciones.</p>
          )}
          {s.ids.map((id, i) => {
            const item = songs.find((x) => x.id === id);
            return item ? (
              <div className="queue-row" key={id}>
                <button className="queue-song" onClick={() => void player.play(item)}>
                  <Cover src={item.artwork} />
                  <span>
                    {item.title}
                    <small>{item.artist}</small>
                  </span>
                </button>
                <button
                  className="icon-button"
                  disabled={i === 0}
                  aria-label={`Subir ${item.title}`}
                  onClick={() => {
                    const ids = [...s.ids];
                    [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
                    player.setQueue(ids);
                  }}
                >
                  ↑
                </button>
                <button
                  className="icon-button"
                  aria-label={`Quitar ${item.title} de la cola`}
                  onClick={() => player.setQueue(s.ids.filter((x) => x !== id))}
                >
                  ×
                </button>
              </div>
            ) : null;
          })}
        </Modal>
      )}
      {extras && (
        <Modal title="Hazlo sonar a tu manera" onClose={() => setExtras(false)}>
          <label className="field">
            <span>Volumen {Math.round(s.volume * 100)}%</span>
            <input
              aria-label="Volumen del reproductor"
              type="range"
              min="0"
              max="1"
              step=".01"
              value={s.volume}
              onChange={(e) => player.volume(Number(e.target.value))}
            />
          </label>
          <label className="field">
            <span>Velocidad</span>
            <select
              aria-label="Velocidad"
              value={s.speed}
              onChange={(e) => player.speed(Number(e.target.value))}
            >
              {[0.5, 0.75, 1, 1.25, 1.5, 2].map((n) => (
                <option key={n} value={n}>
                  {n}×
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>
              <Timer size={15} /> Temporizador de apagado
            </span>
            <select
              aria-label="Temporizador de apagado"
              value={s.sleepUntil ? 'active' : '0'}
              onChange={(e) => player.sleep(Number(e.target.value))}
            >
              {s.sleepUntil && (
                <option value="active">
                  Activo · {new Date(s.sleepUntil).toLocaleTimeString('es')}
                </option>
              )}
              <option value="0">Desactivado</option>
              {[5, 15, 30, 60, 90].map((n) => (
                <option key={n} value={n}>
                  {n} minutos
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Ecualizador</span>
            <select
              aria-label="Ecualizador"
              onChange={async (e) => {
                try {
                  await player.enableEqualizer();
                  const presets: Record<string, number[]> = {
                    Flat: [0, 0, 0, 0, 0],
                    'Bass Boost': [8, 5, 0, 0, 0],
                    Pop: [-1, 2, 4, 2, -1],
                    Rock: [5, 2, -2, 3, 5],
                    Classical: [3, 1, -1, 1, 3],
                    Vocal: [-3, -1, 5, 3, -1],
                  };
                  player.equalizer(presets[e.target.value]);
                } catch (err) {
                  notify(String(err));
                }
              }}
            >
              {['Flat', 'Bass Boost', 'Pop', 'Rock', 'Classical', 'Vocal'].map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </label>
          <div className="eq-bands">
            {['60 Hz', '230 Hz', '910 Hz', '3.6 kHz', '14 kHz'].map((label, i) => (
              <label key={label}>
                <input
                  aria-label={label}
                  type="range"
                  min="-12"
                  max="12"
                  value={s.eq[i]}
                  onChange={async (e) => {
                    try {
                      await player.enableEqualizer();
                      const eq = [...s.eq];
                      eq[i] = Number(e.target.value);
                      player.equalizer(eq);
                    } catch (err) {
                      notify(String(err));
                    }
                  }}
                />
                <span>{label}</span>
                <small>{s.eq[i]} dB</small>
              </label>
            ))}
          </div>
          <p className="small muted">
            La ecualización aplica margen de volumen para evitar saturación.
          </p>
        </Modal>
      )}
    </>
  );
}
