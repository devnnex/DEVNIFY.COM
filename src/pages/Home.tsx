import type { ReactNode } from 'react';
import { Plus, Play, ArrowUpRight, Heart, ListMusic, Music2, Volume2 } from 'lucide-react';
import { Cover, artUrl } from '../components/common';
import { SongList } from '../components/SongList';
import { player, formatTime } from '../services/player';
import type { User, Song, Playlist, View } from '../types';
import { filters } from '../constants';
interface Props {
  user: User;
  songs: Song[];
  playlists: Playlist[];
  visible: Song[];
  filter: string;
  onFilter: (filter: string) => void;
  onAddMusic: () => void;
  onCreatePlaylist: () => void;
  onNavigate: (view: View) => void;
  onSongMenu: (song: Song) => void;
  renderPlaylists: (items: Playlist[]) => ReactNode;
}
export function HomePage({
  user,
  songs,
  playlists,
  visible,
  filter,
  onFilter,
  onAddMusic,
  onCreatePlaylist,
  onNavigate,
  onSongMenu,
  renderPlaylists,
}: Props) {
  const recent = [...songs]
    .filter((s) => s.lastPlayedAt)
    .sort((a, b) => (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0))
    .slice(0, 4);
  const featured = [...songs].sort((a, b) => b.createdAt - a.createdAt).slice(0, 20);
  const totalTime = songs.reduce((n, s) => n + s.duration, 0);
  const greeting =
    new Date().getHours() < 12
      ? 'Buenos días'
      : new Date().getHours() < 19
        ? 'Buenas tardes'
        : 'Buenas noches';

  const playCollection = (items: Song[]) => {
    const list = items.filter((s) => s.downloaded);
    if (!list.length) {
      onAddMusic();
      return;
    }
    void player.play(
      list[0],
      list.map((s) => s.id),
    );
  };
  return (
    <>
      <div className="home-heading">
        <div>
          <span className="eyebrow">{greeting.toUpperCase()}</span>
          <h1>
            Hola, {user.name.split(' ')[0]}
            <span className="lime">.</span>
          </h1>
          <p className="muted">Dale play a lo que te hace sentir.</p>
        </div>
        <button className="primary add-music" onClick={() => onAddMusic()}>
          <Plus size={19} /> Añadir música
        </button>
      </div>
      <div className="filter-tabs">
        {filters.map(([id, label]) => (
          <button key={id} className={filter === id ? 'selected' : ''} onClick={() => onFilter(id)}>
            {label}
          </button>
        ))}
      </div>
      {filter === 'all' ? (
        <>
          <div className="section-head">
            <h2>
              Hecho para tus oídos
              <span className="little-spark"> ✧</span>
            </h2>
            <span className="small muted">Tu colección. Tu ritmo.</span>
          </div>
          <div className="feature-grid">
            <article className="feature-card lavender">
              <div className="feature-text">
                <span className="card-kicker">TU DESCUBRIMIENTO SEMANAL</span>
                <h2>
                  Dale play
                  <br />a tu semana.
                </h2>
                <p>
                  Redescubre lo último que
                  <br />
                  añadiste a tu colección.
                </p>
                <div className="feature-actions">
                  <button
                    className="feature-play"
                    aria-label="Reproducir recién añadidas"
                    onClick={() => playCollection(featured)}
                  >
                    <Play size={20} fill="currentColor" />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Ver recién añadidas"
                    onClick={() => {
                      onNavigate('library');
                      onFilter('new');
                    }}
                  >
                    <ArrowUpRight />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Importar a tu colección"
                    onClick={() => onAddMusic()}
                  >
                    <Plus size={21} />
                  </button>
                </div>
              </div>
              <img
                className="feature-art"
                src={featured.find((s) => s.artwork)?.artwork || artUrl}
                alt="Ilustración musical de auriculares"
              />
            </article>
            <article className="feature-card lime-card">
              <div className="card-kicker">SIEMPRE A MANO</div>
              <Heart className="big-heart" strokeWidth={1} />
              <h2>
                Lo tuyo,
                <br />
                en repeat.
              </h2>
              <div className="lime-card-footer">
                <span>{songs.filter((s) => s.favorite).length} canciones favoritas</span>
                <button
                  className="feature-play"
                  aria-label="Abrir favoritos"
                  onClick={() => {
                    onNavigate('library');
                    onFilter('favorites');
                  }}
                >
                  <ArrowUpRight size={23} />
                </button>
              </div>
            </article>
          </div>
          <div className="section-head playlists-section">
            <div>
              <h2>El soundtrack de tus días</h2>
              <p className="muted small">Una playlist para cada versión de ti.</p>
            </div>
            <button className="text-button" onClick={() => onNavigate('playlists')}>
              Ver todas <ArrowUpRight size={16} />
            </button>
          </div>
          {playlists.length ? (
            <div className="playlist-grid">{renderPlaylists(playlists.slice(0, 4))}</div>
          ) : (
            <button className="create-playlist-banner" onClick={() => onCreatePlaylist()}>
              <span className="create-icon">
                <ListMusic size={28} />
              </span>
              <span>
                <strong>Todo empieza con una playlist</strong>
                <small>Reúne tus canciones y ponle nombre al momento.</small>
              </span>
              <span className="circle-plus">
                <Plus size={22} />
              </span>
            </button>
          )}
          <div className="home-bottom-grid">
            <section>
              <div className="section-head">
                <h2>{recent.length ? 'Vuelve a sentirlo' : 'Tu biblioteca, a tu ritmo'}</h2>
                <button className="text-button" onClick={() => onNavigate('library')}>
                  Ver biblioteca <ArrowUpRight size={16} />
                </button>
              </div>
              {songs.length ? (
                <div className="compact-songs">
                  {(recent.length ? recent : songs.slice(0, 4)).map((song) => (
                    <button
                      key={song.id}
                      className="compact-song"
                      onClick={() =>
                        void player.play(
                          song,
                          songs.map((s) => s.id),
                        )
                      }
                    >
                      <Cover src={song.artwork} />
                      <span>
                        <strong>{song.title}</strong>
                        <small>{song.artist}</small>
                      </span>
                      <Play size={17} />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="first-import">
                  <span className="outline-icon">
                    <Music2 size={27} />
                  </span>
                  <div>
                    <h3>Tu próxima canción favorita está aquí.</h3>
                    <p className="muted">Importa tu música para comenzar.</p>
                  </div>
                  <button
                    className="icon-button"
                    aria-label="Importar música"
                    onClick={() => onAddMusic()}
                  >
                    <Plus size={23} />
                  </button>
                </div>
              )}
            </section>
            <aside className="library-note">
              <span className="note-icon">
                <Volume2 size={18} />
              </span>
              <span className="eyebrow">SOLO TÚ Y TU MÚSICA</span>
              <h3>
                {songs.length
                  ? `${songs.length} canciones. Infinitos momentos.`
                  : 'Menos conexión. Más emoción.'}
              </h3>
              <p>
                {songs.length
                  ? `${formatTime(totalTime)} de música guardada en este dispositivo.`
                  : 'Tus canciones se quedan contigo, incluso cuando el mundo se desconecta.'}
              </p>
              <span className="local-label">
                <span /> Biblioteca personal · Offline ready
              </span>
            </aside>
          </div>
        </>
      ) : (
        <>
          <div className="section-head">
            <h2>{filters.find((f) => f[0] === filter)?.[1]}</h2>
            <span className="muted small">
              {filter === 'trending'
                ? 'Canciones de tu colección con reproducciones registradas.'
                : filter === 'new'
                  ? 'Añadidas en los últimos 7 días.'
                  : `${visible.length} canciones`}
            </span>
          </div>
          <SongList songs={visible} onMenu={onSongMenu} onImport={() => onAddMusic()} />
        </>
      )}
    </>
  );
}
