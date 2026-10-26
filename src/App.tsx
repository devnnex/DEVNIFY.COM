import { HomePage } from './pages/Home';
import { navigation } from './constants';
import { useCallback, useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useRegisterSW } from './hooks/usePwa';
import {
  Search,
  ListMusic,
  Settings as SettingsIcon,
  Plus,
  Heart,
  ArrowUpRight,
  ArrowLeft,
  Play,
  Shuffle,
  MoreHorizontal,
  Download,
  Headphones,
  WifiOff,
  Check,
  ChevronRight,
  FolderPlus,
  Trash2,
  Pencil,
  Copy,
} from 'lucide-react';
import { db, defaultSettings, normalize, deleteSong, removeDownload, uid } from './services/db';
import { restoreSession, clearSession } from './services/auth';
import { player, useCurrentSongId, formatTime } from './services/player';
import { downloadFile } from './services/imports';
import { Auth } from './components/Auth';
import { Cover, Empty, Modal, brandLogoUrl } from './components/common';
import { ImportDialog } from './components/ImportDialog';
import { SongList } from './components/SongList';
import { Player } from './components/Player';
import { Settings } from './components/Settings';
import { PlaylistEditor, SongEditor, AssignDialog } from './components/Editors';
import type { User, Song, Playlist, View } from './types';
interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}
export default function App() {
  const [user, setUser] = useState<User>();
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>((location.hash.slice(1) as View) || 'home');
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('songs');
  const [importing, setImporting] = useState(false);
  const [playlistEditor, setPlaylistEditor] = useState<Playlist | 'new'>();
  const [selectedPlaylist, setSelectedPlaylist] = useState<string>();
  const [menuSong, setMenuSong] = useState<Song>();
  const [editSong, setEditSong] = useState<Song>();
  const [assignSong, setAssignSong] = useState<Song>();
  const [playlistMenu, setPlaylistMenu] = useState<Playlist>();
  const [toast, setToast] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const [installEvent, setInstallEvent] = useState<InstallEvent>();
  const [installHelp, setInstallHelp] = useState(false);
  const currentSongId = useCurrentSongId();
  const notify = useCallback((s: string) => setToast(s), []);
  const {
    needRefresh: [needRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW();
  useEffect(() => {
    void restoreSession()
      .then(setUser)
      .catch((e) => notify(`No se pudo abrir el almacenamiento: ${String(e)}`))
      .finally(() => setLoading(false));
  }, [notify]);
  useEffect(() => {
    void player.setOwner(user?.id || '').catch((e) => notify(String(e)));
  }, [user?.id, notify]);
  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(''), 6500);
    return () => clearTimeout(timeout);
  }, [toast]);
  useEffect(() => {
    if (offlineReady) {
      notify('Devnify está preparada para abrirse sin conexión.');
      setOfflineReady(false);
    }
  }, [offlineReady, notify, setOfflineReady]);
  useEffect(() => {
    const hash = () => {
      const next = location.hash.slice(1);
      setView(navigation.some((n) => n.id === next) ? (next as View) : 'home');
      setSelectedPlaylist(undefined);
    };
    const connection = () => setOnline(navigator.onLine);
    const install = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as InstallEvent);
    };
    window.addEventListener('hashchange', hash);
    window.addEventListener('online', connection);
    window.addEventListener('offline', connection);
    window.addEventListener('beforeinstallprompt', install);
    const key = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement)?.closest(
          'input,textarea,select,button,a,[contenteditable=true],dialog',
        ) ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey
      )
        return;
      if (e.code === 'Space') {
        e.preventDefault();
        player.toggle();
      }
      if (e.key.toLowerCase() === 'm') player.mute();
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (e.shiftKey) void player.next();
        else player.seek(player.audio.currentTime + 10);
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (e.shiftKey) void player.previous();
        else player.seek(player.audio.currentTime - 10);
      }
    };
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('hashchange', hash);
      window.removeEventListener('online', connection);
      window.removeEventListener('offline', connection);
      window.removeEventListener('beforeinstallprompt', install);
      window.removeEventListener('keydown', key);
    };
  }, []);
  const songs =
    useLiveQuery(() => (user ? db.songs.where({ ownerId: user.id }).toArray() : []), [user?.id]) ||
    [];
  const playlists =
    useLiveQuery(
      () => (user ? db.playlists.where({ ownerId: user.id }).toArray() : []),
      [user?.id],
    ) || [];
  const history =
    useLiveQuery(
      () => (user ? db.history.where({ ownerId: user.id }).toArray() : []),
      [user?.id],
    ) || [];
  const pref = useLiveQuery(() => (user ? db.settings.get(user.id) : undefined), [user?.id]);
  const settings = pref || defaultSettings(user?.id || '');
  function navigate(next: View) {
    location.hash = next;
    setView(next);
    setSelectedPlaylist(undefined);
    setQuery('');
    setGroup('songs');
    setFilter('all');
  }
  async function install() {
    if (installEvent) {
      await installEvent.prompt();
      const choice = await installEvent.userChoice;
      notify(
        choice.outcome === 'accepted'
          ? 'Instalación aceptada por el navegador.'
          : 'Instalación cancelada.',
      );
      setInstallEvent(undefined);
    } else setInstallHelp(true);
  }
  function logout() {
    player.stop();
    clearSession();
    setUser(undefined);
    setSelectedPlaylist(undefined);
    setMenuSong(undefined);
    setAssignSong(undefined);
    setEditSong(undefined);
    setPlaylistMenu(undefined);
    setImporting(false);
    setPlaylistEditor(undefined);
    navigate('home');
  }
  if (loading)
    return (
      <div className="splash">
        <img src={brandLogoUrl} alt="Devnify" />
        <span>
          Devnify<span className="lime">.</span>
        </span>
        <small>Tu música, tu espacio.</small>
      </div>
    );
  if (!user)
    return (
      <>
        <Auth onLogin={setUser} />
        {toast && (
          <div className="toast" role="status">
            {toast}
          </div>
        )}
      </>
    );
  const selected = playlists.find((p) => p.id === selectedPlaylist);
  let visible = songs.filter((s) => {
    if (filter === 'downloaded' && !s.downloaded) return false;
    if (filter === 'favorites' && !s.favorite) return false;
    if (filter === 'new' && Date.now() - s.createdAt > 7 * 86400000) return false;
    if ((filter === 'trending' || filter === 'top') && !s.playCount) return false;
    const text = normalize(query);
    return !text || normalize(`${s.title} ${s.artist} ${s.album} ${s.genre}`).includes(text);
  });
  if (group === 'recent')
    visible = visible
      .filter((s) => s.lastPlayedAt)
      .sort((a, b) => (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0));
  else if (filter === 'top' || filter === 'trending')
    visible.sort((a, b) => b.playCount - a.playCount);
  else visible.sort((a, b) => b.createdAt - a.createdAt);
  const playlistSongs = selected
    ? selected.songIds.map((id) => songs.find((s) => s.id === id)).filter((s): s is Song => !!s)
    : [];
  const playCollection = (items: Song[], shuffle = false) => {
    const list = items.filter((s) => s.downloaded);
    if (!list.length) {
      setImporting(true);
      return;
    }
    player.patch({ shuffle });
    void player.play(
      shuffle ? list[Math.floor(Math.random() * list.length)] : list[0],
      list.map((s) => s.id),
    );
  };
  const playlistCards = (items: Playlist[]) =>
    items.map((p) => (
      <article className="playlist-card" key={p.id}>
        <button
          className="playlist-cover-button"
          onClick={() => {
            navigate('playlists');
            setSelectedPlaylist(p.id);
          }}
        >
          <Cover
            src={p.artwork || songs.find((s) => p.songIds.includes(s.id) && s.artwork)?.artwork}
          />
          <span className="playlist-cover-icon">
            <ArrowUpRight size={22} />
          </span>
        </button>
        <div className="playlist-card-info">
          <button
            onClick={() => {
              navigate('playlists');
              setSelectedPlaylist(p.id);
            }}
          >
            <strong>{p.name}</strong>
            <small>
              {p.songIds.length} canciones · {user.name}
            </small>
          </button>
          <button
            className="icon-button"
            aria-label={`Reproducir playlist ${p.name}`}
            disabled={!p.songIds.length}
            onClick={() =>
              playCollection(
                p.songIds.map((id) => songs.find((s) => s.id === id)).filter((s): s is Song => !!s),
              )
            }
          >
            <Play size={18} fill="currentColor" />
          </button>
          <button
            className="icon-button"
            aria-label={`Opciones de playlist ${p.name}`}
            onClick={() => setPlaylistMenu(p)}
          >
            <MoreHorizontal size={18} />
          </button>
        </div>
      </article>
    ));
  return (
    <div className={`app-shell ${currentSongId ? 'has-player' : ''}`}>
      <aside className="sidebar">
        <a className="brand" href="#home" onClick={() => navigate('home')}>
          <img src={brandLogoUrl} alt="" />
          Devnify<span>music</span>
        </a>
        <span className="sidebar-label">TU ESPACIO</span>
        <nav>
          {navigation
            .filter((n) => n.id !== 'settings')
            .map((n) => (
              <button
                key={n.id}
                onClick={() => navigate(n.id)}
                className={view === n.id ? 'selected' : ''}
              >
                <n.icon size={21} />
                {n.label}
                {view === n.id && <span className="nav-dot" />}
              </button>
            ))}
        </nav>
        <div className="sidebar-divider" />
        <div className="sidebar-label-row">
          <span className="sidebar-label">TU COLECCIÓN</span>
          <button
            className="icon-button"
            aria-label="Crear playlist"
            onClick={() => setPlaylistEditor('new')}
          >
            <Plus size={17} />
          </button>
        </div>
        <button
          className="sidebar-favorites"
          onClick={() => {
            navigate('library');
            setFilter('favorites');
          }}
        >
          <span>
            <Heart size={17} />
          </span>{' '}
          Tus favoritos <small>{songs.filter((s) => s.favorite).length}</small>
        </button>
        {playlists.slice(0, 5).map((p) => (
          <button
            className="sidebar-playlist"
            key={p.id}
            onClick={() => {
              navigate('playlists');
              setSelectedPlaylist(p.id);
            }}
          >
            <Cover src={p.artwork} />
            <span>{p.name}</span>
          </button>
        ))}
        {!playlists.length && (
          <p className="sidebar-hint">
            Un lugar para cada estado de ánimo. Crea tu primera playlist.
          </p>
        )}
        <div className="sidebar-bottom">
          <div className="offline-card">
            <Headphones size={27} />
            <strong>Tu música. Sin límites.</strong>
            <p>Guarda tus canciones y llévalas contigo, sin conexión.</p>
            <button onClick={() => void install()}>
              Instalar Devnify <ArrowUpRight size={16} />
            </button>
          </div>
          <button
            className={`settings-nav ${view === 'settings' ? 'active' : ''}`}
            onClick={() => navigate('settings')}
          >
            <SettingsIcon size={20} /> Ajustes
          </button>
          <button className="sidebar-profile" onClick={() => navigate('settings')}>
            {user.avatar ? (
              <img className="avatar" src={user.avatar} alt="" />
            ) : (
              <div className="avatar">{user.name[0]}</div>
            )}
            <span>
              <strong>{user.name}</strong>
              <small>Mi perfil local</small>
            </span>
            <ChevronRight size={17} />
          </button>
        </div>
      </aside>
      <div className="main-layout">
        <header className="topbar">
          <div className="breadcrumb">
            Tu música <span>/</span>{' '}
            <strong>{navigation.find((n) => n.id === view)?.label || 'Inicio'}</strong>
          </div>
          <a className="mobile-brand" href="#home">
            <img src={brandLogoUrl} alt="" />
            Devnify<span>music</span>
          </a>
          <div className="topbar-actions">
            <button className="search-pill" onClick={() => navigate('search')}>
              <Search size={17} />
              <span>Buscar en tu colección</span>
              <kbd>⌕</kbd>
            </button>
            {!online && (
              <span className="offline-badge">
                <WifiOff size={14} /> Sin conexión
              </span>
            )}
            <button
              className="icon-button header-favorites"
              aria-label="Ver favoritos"
              onClick={() => {
                navigate('library');
                setFilter('favorites');
              }}
            >
              <Heart size={20} />
            </button>
            <button
              className="topbar-avatar"
              aria-label="Abrir perfil"
              onClick={() => navigate('settings')}
            >
              {user.avatar ? (
                <img className="avatar" src={user.avatar} alt="" />
              ) : (
                <span className="avatar">{user.name[0]}</span>
              )}
            </button>
          </div>
        </header>
        <main className="main-content">
          {view === 'home' ? (
            <HomePage
              user={user}
              songs={songs}
              playlists={playlists}
              visible={visible}
              filter={filter}
              onFilter={setFilter}
              onAddMusic={() => setImporting(true)}
              onCreatePlaylist={() => setPlaylistEditor('new')}
              onNavigate={navigate}
              onSongMenu={setMenuSong}
              renderPlaylists={playlistCards}
            />
          ) : view === 'settings' ? (
            <Settings
              user={user}
              songs={songs}
              playlists={playlists}
              settings={settings}
              history={history}
              onLogout={logout}
              onUser={setUser}
              notify={notify}
              install={() => void install()}
            />
          ) : view === 'playlists' ? (
            selected ? (
              <>
                <button
                  className="text-button back-button"
                  onClick={() => setSelectedPlaylist(undefined)}
                >
                  <ArrowLeft size={17} /> Tus playlists
                </button>
                <div className="playlist-detail-header">
                  <Cover src={selected.artwork || playlistSongs.find((s) => s.artwork)?.artwork} />
                  <div>
                    <span className="eyebrow">PLAYLIST PERSONAL</span>
                    <h1>{selected.name}</h1>
                    <p className="muted">
                      {selected.description || 'Un lugar para tus canciones.'}
                    </p>
                    <p className="small">
                      {user.name} · {playlistSongs.length} canciones ·{' '}
                      {formatTime(playlistSongs.reduce((n, s) => n + s.duration, 0))}
                    </p>
                  </div>
                </div>
                <div className="playlist-toolbar">
                  <button
                    className="primary"
                    disabled={!playlistSongs.length}
                    onClick={() => playCollection(playlistSongs)}
                  >
                    <Play size={18} fill="currentColor" /> Reproducir
                  </button>
                  <button
                    className="secondary"
                    disabled={!playlistSongs.length}
                    onClick={() => playCollection(playlistSongs, true)}
                  >
                    <Shuffle size={18} /> Aleatorio
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Editar playlist"
                    onClick={() => setPlaylistEditor(selected)}
                  >
                    <Pencil size={19} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Opciones de playlist"
                    onClick={() => setPlaylistMenu(selected)}
                  >
                    <MoreHorizontal />
                  </button>
                  <select
                    aria-label="Ordenar playlist"
                    defaultValue="manual"
                    onChange={async (e) => {
                      const mode = e.target.value;
                      if (mode === 'manual') return;
                      const items = [...playlistSongs].sort((a, b) =>
                        mode === 'title'
                          ? a.title.localeCompare(b.title)
                          : mode === 'artist'
                            ? a.artist.localeCompare(b.artist)
                            : mode === 'duration'
                              ? a.duration - b.duration
                              : b.createdAt - a.createdAt,
                      );
                      await db.playlists.update(selected.id, {
                        songIds: items.map((s) => s.id),
                      });
                      e.target.value = 'manual';
                    }}
                  >
                    <option value="manual">Orden manual</option>
                    <option value="title">Por título</option>
                    <option value="artist">Por artista</option>
                    <option value="duration">Por duración</option>
                    <option value="date">Por fecha</option>
                  </select>
                </div>
                <p className="small muted">
                  Arrastra para reordenar o usa las flechas de cada canción. Añade pistas desde el
                  menú de tu biblioteca.
                </p>
                <SongList
                  songs={playlistSongs}
                  onMenu={setMenuSong}
                  onImport={() => setImporting(true)}
                  reorder={async (from, to) => {
                    const ids = [...selected.songIds];
                    if (from < 0 || to < 0 || from >= ids.length || to >= ids.length) return;
                    ids.splice(to, 0, ids.splice(from, 1)[0]);
                    await db.playlists.update(selected.id, { songIds: ids });
                  }}
                />
              </>
            ) : (
              <>
                <div className="page-heading with-action">
                  <div>
                    <span className="eyebrow">HECHAS POR TI</span>
                    <h1>
                      Tus playlists<span className="lime">.</span>
                    </h1>
                    <p className="muted">Cada momento merece su propia banda sonora.</p>
                  </div>
                  <button className="primary" onClick={() => setPlaylistEditor('new')}>
                    <Plus size={19} /> Crear playlist
                  </button>
                </div>
                {playlists.length ? (
                  <div className="playlist-grid full-playlists">{playlistCards(playlists)}</div>
                ) : (
                  <Empty
                    title="Ponle nombre a tu próximo momento"
                    action={
                      <button className="primary" onClick={() => setPlaylistEditor('new')}>
                        <Plus size={17} /> Mi primera playlist
                      </button>
                    }
                  >
                    Tus playlists son locales, personales y tan únicas como tú.
                  </Empty>
                )}
              </>
            )
          ) : (
            <>
              <div className="page-heading with-action">
                <div>
                  <span className="eyebrow">
                    {view === 'search' ? 'ENCUENTRA TU RITMO' : 'TODO LO QUE TE MUEVE'}
                  </span>
                  <h1>
                    {view === 'search' ? '¿Qué quieres escuchar?' : 'Tu biblioteca'}
                    <span className="lime">.</span>
                  </h1>
                  <p className="muted">
                    {songs.length} canciones · Tu música guardada en este dispositivo.
                  </p>
                </div>
                <button className="primary" onClick={() => setImporting(true)}>
                  <Plus size={19} /> Añadir música
                </button>
              </div>
              <div className="library-search">
                <Search size={21} />
                <input
                  autoFocus={view === 'search'}
                  aria-label="Buscar canciones, artistas, álbumes o playlists"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Canciones, artistas, álbumes, géneros, playlists…"
                />
                {query && (
                  <button
                    className="icon-button"
                    aria-label="Limpiar búsqueda"
                    onClick={() => setQuery('')}
                  >
                    ×
                  </button>
                )}
              </div>
              <div className="filter-tabs">
                {[
                  ['songs', 'Canciones'],
                  ['albums', 'Álbumes'],
                  ['artists', 'Artistas'],
                  ['recent', 'Recientes'],
                ].map(([id, label]) => (
                  <button
                    className={group === id ? 'selected' : ''}
                    key={id}
                    onClick={() => setGroup(id)}
                  >
                    {label}
                  </button>
                ))}
                <button
                  className={filter === 'favorites' ? 'selected' : ''}
                  onClick={() => {
                    setFilter(filter === 'favorites' ? 'all' : 'favorites');
                    setGroup('songs');
                  }}
                >
                  <Heart size={14} /> Favoritos
                </button>
                <button
                  className={filter === 'downloaded' ? 'selected' : ''}
                  onClick={() => {
                    setFilter('downloaded');
                    setGroup('songs');
                  }}
                >
                  <Download size={14} /> Descargadas
                </button>
                <button
                  className={filter === 'top' ? 'selected' : ''}
                  onClick={() => {
                    setFilter('top');
                    setGroup('songs');
                  }}
                >
                  Más escuchadas
                </button>
              </div>
              {group === 'albums' || group === 'artists' ? (
                <div className="group-grid">
                  {[
                    ...new Set(
                      visible.map((s) => (group === 'albums' ? s.album || 'Sin álbum' : s.artist)),
                    ),
                  ].map((name) => {
                    const collection = visible.filter(
                      (s) => (group === 'albums' ? s.album || 'Sin álbum' : s.artist) === name,
                    );
                    return (
                      <button
                        className="group-card"
                        key={name}
                        onClick={() => {
                          setQuery(name === 'Sin álbum' ? '' : name);
                          setGroup('songs');
                        }}
                      >
                        <Cover src={collection.find((s) => s.artwork)?.artwork} />
                        <strong>{name}</strong>
                        <small>{collection.length} canciones</small>
                      </button>
                    );
                  })}
                  {!visible.length && (
                    <Empty title="Aún no hay música">
                      Importa canciones para explorar tus artistas y álbumes.
                    </Empty>
                  )}
                </div>
              ) : (
                <SongList
                  songs={visible}
                  onMenu={setMenuSong}
                  onImport={() => setImporting(true)}
                />
              )}{' '}
              {!!query &&
                !!playlists.filter((p) => normalize(p.name).includes(normalize(query))).length && (
                  <>
                    <div className="section-head">
                      <h2>Playlists</h2>
                    </div>
                    <div className="playlist-grid">
                      {playlistCards(
                        playlists.filter((p) => normalize(p.name).includes(normalize(query))),
                      )}
                    </div>
                  </>
                )}
            </>
          )}
        </main>
        <footer className="content-footer">
          <span>
            Devnify<span className="lime">.</span> music
          </span>
          <span>Hecho para escuchar. Diseñado para sentir.</span>
          <span>
            <span className="online-dot" />
            {online ? 'Todo en su lugar' : 'Tu música sigue contigo'}
          </span>
        </footer>
      </div>
      <nav className="bottom-nav" aria-label="Navegación móvil">
        {navigation.map((n) => (
          <button
            key={n.id}
            onClick={() => navigate(n.id)}
            aria-label={n.label}
            className={view === n.id ? 'selected' : ''}
          >
            <n.icon size={21} />
            <span>{n.label}</span>
          </button>
        ))}
      </nav>
      <Player songs={songs} notify={notify} />
      {importing && (
        <ImportDialog
          ownerId={user.id}
          playlists={playlists}
          settings={settings}
          initialPlaylistId={selected?.id}
          onClose={() => setImporting(false)}
          notify={notify}
        />
      )}{' '}
      {playlistEditor && (
        <PlaylistEditor
          ownerId={user.id}
          playlist={playlistEditor === 'new' ? undefined : playlistEditor}
          onClose={() => setPlaylistEditor(undefined)}
          notify={notify}
        />
      )}{' '}
      {editSong && (
        <SongEditor song={editSong} onClose={() => setEditSong(undefined)} notify={notify} />
      )}{' '}
      {assignSong && (
        <AssignDialog
          song={assignSong}
          playlists={playlists}
          onClose={() => setAssignSong(undefined)}
          notify={notify}
        />
      )}{' '}
      {menuSong && (
        <Modal title={menuSong.title} onClose={() => setMenuSong(undefined)}>
          <div className="action-menu">
            <button
              onClick={() => {
                void player.play(menuSong);
                setMenuSong(undefined);
              }}
            >
              <Play /> Reproducir
            </button>
            <button
              onClick={() => {
                player.queue([menuSong.id], true);
                notify('Sonará a continuación.');
                setMenuSong(undefined);
              }}
            >
              <ChevronRight /> Reproducir después
            </button>
            <button
              onClick={() => {
                player.queue([menuSong.id]);
                notify('Añadida a la cola.');
                setMenuSong(undefined);
              }}
            >
              <ListMusic /> Añadir a cola
            </button>
            <button
              onClick={() => {
                setAssignSong(menuSong);
                setMenuSong(undefined);
              }}
            >
              <FolderPlus /> Añadir a playlists
            </button>
            <button
              onClick={() => {
                void db.songs.update(menuSong.id, {
                  favorite: !menuSong.favorite,
                });
                setMenuSong(undefined);
              }}
            >
              <Heart /> {menuSong.favorite ? 'Quitar de' : 'Añadir a'} favoritos
            </button>
            <button
              onClick={() => {
                setEditSong(menuSong);
                setMenuSong(undefined);
              }}
            >
              <Pencil /> Editar metadatos, portada y detalles
            </button>
            <button
              disabled={!menuSong.downloaded}
              onClick={async () => {
                const audio = await db.audioBlobs.get(menuSong.id);
                if (audio?.ownerId === user.id) {
                  const extension =
                    (
                      {
                        'audio/mpeg': 'mp3',
                        'audio/wav': 'wav',
                        'audio/flac': 'flac',
                        'audio/mp4': 'm4a',
                        'audio/ogg': 'ogg',
                        'audio/opus': 'opus',
                      } as Record<string, string>
                    )[menuSong.mimeType] || 'audio';
                  downloadFile(audio.blob, `${menuSong.artist} - ${menuSong.title}.${extension}`);
                }
                setMenuSong(undefined);
              }}
            >
              <Download /> Exportar archivo de audio
            </button>
            {menuSong.downloaded ? (
              <button
                className="danger-text"
                onClick={async () => {
                  if (
                    confirm(
                      `¿Eliminar solo el archivo offline de “${menuSong.title}”? Se conservarán sus metadatos, favoritos y playlists. Podrás recuperar el audio importando el mismo archivo.`,
                    )
                  ) {
                    if (currentSongId === menuSong.id) {
                      player.stop();
                      player.patch({ song: undefined });
                    }
                    await removeDownload(user.id, menuSong.id);
                    setMenuSong(undefined);
                    notify('Archivo eliminado. Metadatos y playlists conservados.');
                  }
                }}
              >
                <Trash2 /> Eliminar solo archivo offline
              </button>
            ) : (
              <button
                onClick={() => {
                  setMenuSong(undefined);
                  setImporting(true);
                }}
              >
                <Download /> Recuperar audio: importar el mismo archivo
              </button>
            )}
            {selected && selected.songIds.includes(menuSong.id) && (
              <button
                onClick={async () => {
                  await db.playlists.update(selected.id, {
                    songIds: selected.songIds.filter((id) => id !== menuSong.id),
                  });
                  setMenuSong(undefined);
                  notify('Canción quitada de esta playlist.');
                }}
              >
                <ListMusic /> Quitar solo de esta playlist
              </button>
            )}
            <button
              className="danger-text"
              onClick={async () => {
                if (
                  confirm(
                    `¿Eliminar “${menuSong.title}” y su archivo offline de la biblioteca y todas las playlists?`,
                  )
                ) {
                  if (currentSongId === menuSong.id) {
                    player.stop();
                    player.patch({ song: undefined });
                  }
                  await deleteSong(user.id, menuSong.id);
                  setMenuSong(undefined);
                  notify('Canción y archivo eliminados.');
                }
              }}
            >
              <Trash2 /> Eliminar de la biblioteca y del dispositivo
            </button>
          </div>
        </Modal>
      )}
      {playlistMenu && (
        <Modal title={playlistMenu.name} onClose={() => setPlaylistMenu(undefined)}>
          <div className="action-menu">
            <button
              onClick={() => {
                setPlaylistEditor(playlistMenu);
                setPlaylistMenu(undefined);
              }}
            >
              <Pencil /> Editar nombre, descripción y portada
            </button>
            <button
              onClick={async () => {
                await db.playlists.add({
                  ...playlistMenu,
                  id: uid(),
                  name: `${playlistMenu.name} (copia)`,
                  createdAt: Date.now(),
                });
                setPlaylistMenu(undefined);
                notify('Playlist duplicada.');
              }}
            >
              <Copy /> Duplicar playlist
            </button>
            <button
              onClick={() => {
                player.queue(playlistMenu.songIds);
                notify('Playlist añadida a la cola.');
                setPlaylistMenu(undefined);
              }}
            >
              <ListMusic /> Añadir a cola
            </button>
            <button
              className="danger-text"
              onClick={async () => {
                if (
                  confirm(
                    `¿Eliminar la playlist “${playlistMenu.name}”? Las canciones seguirán en la biblioteca.`,
                  )
                ) {
                  await db.playlists.delete(playlistMenu.id);
                  setPlaylistMenu(undefined);
                  setSelectedPlaylist(undefined);
                  notify('Playlist eliminada.');
                }
              }}
            >
              <Trash2 /> Eliminar playlist
            </button>
          </div>
        </Modal>
      )}
      {installHelp && (
        <Modal title="Lleva Devnify contigo" onClose={() => setInstallHelp(false)}>
          <p>
            En iPhone o iPad, abre esta página en Safari y selecciona{' '}
            <strong>Compartir → Añadir a pantalla de inicio</strong>.
          </p>
          <p>
            En Android o escritorio, abre el menú de Chrome o Edge y selecciona{' '}
            <strong>Instalar aplicación</strong> o <strong>Añadir a pantalla de inicio</strong>{' '}
            cuando esté disponible.
          </p>
          <p className="notice">
            La instalación requiere HTTPS o localhost y un navegador compatible. Las canciones
            importadas permanecen en este navegador.
          </p>
        </Modal>
      )}
      {needRefresh && (
        <div className="update-banner" role="status">
          <span>Hay una nueva versión de Devnify.</span>
          <button
            onClick={() => {
              player.pause();
              void updateServiceWorker(true);
            }}
          >
            Actualizar
          </button>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
          <button aria-label="Cerrar aviso" onClick={() => setToast('')}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
