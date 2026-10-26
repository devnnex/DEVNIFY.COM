import { Play, Pause, Heart, MoreHorizontal, ArrowUp, ArrowDown, Download } from 'lucide-react';
import { Cover, Empty } from './common';
import { player, usePlaybackStatus, formatTime } from '../services/player';
import { useState } from 'react';
import { db } from '../services/db';
import type { Song } from '../types';
export function SongList({
  songs,
  onMenu,
  onImport,
  reorder,
}: {
  songs: Song[];
  onMenu: (song: Song) => void;
  onImport: () => void;
  reorder?: (from: number, to: number) => void;
}) {
  usePlaybackStatus();
  const state = player.state;
  const [page, setPage] = useState(0);
  const pageSize = 75;
  const currentPage = Math.min(page, Math.max(0, Math.ceil(songs.length / pageSize) - 1));
  return (
    <div className="song-table">
      {!!songs.length && (
        <div className="song-table-head">
          <span>#</span>
          <span>TÍTULO</span>
          <span className="album-col">ÁLBUM</span>
          <span className="date-col">AÑADIDA</span>
          <span>DURACIÓN</span>
          <span />
        </div>
      )}
      {!songs.length && (
        <Empty
          title="Aquí empieza tu colección"
          action={
            <button className="primary" onClick={onImport}>
              <Download size={17} /> Añadir música
            </button>
          }
        >
          Importa las canciones que te acompañan. Se guardarán para escucharlas sin conexión.
        </Empty>
      )}
      {songs.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map((song, pageIndex) => {
        const i = currentPage * pageSize + pageIndex;
        const current = state.song?.id === song.id;
        return (
          <div
            className={`song-row ${current ? 'is-playing' : ''}`}
            key={song.id}
            draggable={!!reorder}
            onDragStart={(e) => e.dataTransfer.setData('text/aura-index', String(i))}
            onDragOver={(e) => {
              if (reorder) e.preventDefault();
            }}
            onDrop={(e) => {
              if (reorder) {
                e.preventDefault();
                const value = e.dataTransfer.getData('text/aura-index');
                if (value !== '') reorder(Number(value), i);
              }
            }}
          >
            <button
              className="row-play"
              aria-label={`${current && state.playing ? 'Pausar' : 'Reproducir'} ${song.title}`}
              onClick={() =>
                current
                  ? player.toggle()
                  : void player.play(
                      song,
                      songs.map((x) => x.id),
                    )
              }
            >
              <span className="track-number">
                {current && state.playing ? (
                  <span className="equalizer-icon">▂▆▃</span>
                ) : (
                  String(i + 1).padStart(2, '0')
                )}
              </span>
              <span className="track-play">
                {current && state.playing ? <Pause size={16} /> : <Play size={16} />}
              </span>
            </button>
            <button
              className="song-info"
              onClick={() =>
                void player.play(
                  song,
                  songs.map((x) => x.id),
                )
              }
            >
              <Cover src={song.artwork} />
              <span>
                <strong>{song.title}</strong>
                <small>
                  {song.artist}
                  {song.downloaded ? '' : ' · Archivo no disponible'}
                </small>
              </span>
            </button>
            <span className="album-col muted">{song.album || '—'}</span>
            <span className="date-col muted">
              {new Date(song.createdAt).toLocaleDateString('es', {
                day: 'numeric',
                month: 'short',
              })}
            </span>
            <span className="song-duration">{formatTime(song.duration)}</span>
            <div className="song-actions">
              <button
                className={`icon-button heart-row ${song.favorite ? 'active' : ''}`}
                aria-label={`${song.favorite ? 'Quitar de' : 'Añadir a'} favoritos: ${song.title}`}
                onClick={() => void db.songs.update(song.id, { favorite: !song.favorite })}
              >
                <Heart size={17} fill={song.favorite ? 'currentColor' : 'none'} />
              </button>
              {reorder && (
                <>
                  <button
                    className="icon-button"
                    aria-label={`Subir ${song.title}`}
                    disabled={i === 0}
                    onClick={() => reorder(i, i - 1)}
                  >
                    <ArrowUp size={15} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Bajar ${song.title}`}
                    disabled={i === songs.length - 1}
                    onClick={() => reorder(i, i + 1)}
                  >
                    <ArrowDown size={15} />
                  </button>
                </>
              )}
              <button
                className="icon-button"
                aria-label={`Opciones de ${song.title}`}
                onClick={() => onMenu(song)}
              >
                <MoreHorizontal size={19} />
              </button>
            </div>
          </div>
        );
      })}
      {songs.length > pageSize && (
        <div className="pagination">
          <button
            className="secondary"
            disabled={!currentPage}
            onClick={() => setPage(currentPage - 1)}
          >
            Anterior
          </button>
          <span className="small muted">
            Página {currentPage + 1} de {Math.ceil(songs.length / pageSize)}
          </span>
          <button
            className="secondary"
            disabled={(currentPage + 1) * pageSize >= songs.length}
            onClick={() => setPage(currentPage + 1)}
          >
            Siguiente
          </button>
        </div>
      )}
    </div>
  );
}
