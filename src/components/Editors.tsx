import { useState } from 'react';
import { Modal, Field } from './common';
import { FilePicker } from './FilePicker';
import { db, uid } from '../services/db';
import { optimizeImage, addToPlaylists } from '../services/imports';
import type { Playlist, Song } from '../types';
export function PlaylistEditor({
  ownerId,
  playlist,
  onClose,
  notify,
}: {
  ownerId: string;
  playlist?: Playlist;
  onClose: () => void;
  notify: (s: string) => void;
}) {
  const [artwork, setArtwork] = useState(playlist?.artwork);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={playlist ? 'Editar playlist' : 'Crea una playlist'} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          try {
            const p: Playlist = {
              id: playlist?.id || uid(),
              ownerId,
              name: String(f.get('name')).trim(),
              description: String(f.get('description')).trim(),
              artwork,
              songIds: playlist?.songIds || [],
              createdAt: playlist?.createdAt || Date.now(),
            };
            if (!p.name) throw new Error('La playlist necesita un nombre.');
            await db.playlists.put(p);
            notify(playlist ? 'Playlist actualizada.' : 'Tu nueva playlist está lista.');
            onClose();
          } catch (err) {
            setError(String(err));
            setBusy(false);
          }
        }}
      >
        <FilePicker
          label="Portada personalizada"
          shape="cover"
          preview={artwork}
          onSelect={async (file) => setArtwork(await optimizeImage(file))}
          onClear={() => setArtwork(undefined)}
        />
        <Field label="Nombre">
          <input
            name="name"
            required
            maxLength={100}
            defaultValue={playlist?.name}
            placeholder="El soundtrack de tus días"
          />
        </Field>
        <Field label="Descripción">
          <textarea
            name="description"
            maxLength={500}
            defaultValue={playlist?.description}
            placeholder="¿Qué se siente escucharla?"
          />
        </Field>
        <p className="small muted">Playlist local · Solo en tu perfil de este dispositivo.</p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button disabled={busy} className="primary full">
          Guardar playlist
        </button>
      </form>
    </Modal>
  );
}
export function SongEditor({
  song,
  onClose,
  notify,
}: {
  song: Song;
  onClose: () => void;
  notify: (s: string) => void;
}) {
  const [artwork, setArtwork] = useState(song.artwork);
  const [error, setError] = useState('');
  return (
    <Modal title="Editar canción" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          try {
            await db.songs.update(song.id, {
              title: String(f.get('title')).trim(),
              artist: String(f.get('artist')).trim(),
              album: String(f.get('album')).trim(),
              genre: String(f.get('genre')).trim(),
              year: f.get('year') ? Number(f.get('year')) : undefined,
              artwork,
              updatedAt: Date.now(),
            });
            notify('Metadatos actualizados.');
            onClose();
          } catch (err) {
            setError(String(err));
          }
        }}
      >
        <FilePicker
          label="Portada"
          shape="cover"
          preview={artwork}
          onSelect={async (file) => setArtwork(await optimizeImage(file))}
          onClear={() => setArtwork(undefined)}
        />
        {[
          ['title', 'Título', song.title],
          ['artist', 'Artista', song.artist],
          ['album', 'Álbum', song.album],
          ['genre', 'Género', song.genre],
        ].map(([name, label, value]) => (
          <Field key={name} label={label}>
            <input
              name={name}
              defaultValue={value}
              required={['title', 'artist'].includes(name)}
              maxLength={200}
            />
          </Field>
        ))}
        <Field label="Año">
          <input name="year" type="number" min="1000" max="2200" defaultValue={song.year} />
        </Field>
        <p className="small muted">
          {song.mimeType} · {(song.size / 1024 / 1024).toFixed(2)} MB
          {song.bitrate ? ` · ${Math.round(song.bitrate / 1000)} kbps` : ''}
          <br />
          Guardada el {new Date(song.createdAt).toLocaleDateString('es')} · {song.playCount}{' '}
          reproducciones
        </p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button className="primary full">Guardar cambios</button>
      </form>
    </Modal>
  );
}
export function AssignDialog({
  song,
  playlists,
  onClose,
  notify,
}: {
  song: Song;
  playlists: Playlist[];
  onClose: () => void;
  notify: (s: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>(
    playlists.filter((p) => p.songIds.includes(song.id)).map((p) => p.id),
  );
  return (
    <Modal title="Añadir a playlists" onClose={onClose}>
      <p className="muted">{song.title}</p>
      {!playlists.length && <p>Crea una playlist desde la sección Playlists.</p>}
      {playlists.map((p) => (
        <label className="check" key={p.id}>
          <input
            type="checkbox"
            checked={selected.includes(p.id)}
            onChange={(e) =>
              setSelected(
                e.target.checked ? [...selected, p.id] : selected.filter((x) => x !== p.id),
              )
            }
          />
          {p.name}
        </label>
      ))}
      <button
        className="primary full"
        onClick={async () => {
          await db.transaction('rw', db.songs, db.playlists, async () => {
            for (const p of playlists)
              if (!selected.includes(p.id))
                await db.playlists.update(p.id, {
                  songIds: p.songIds.filter((x) => x !== song.id),
                });
            await addToPlaylists(song.ownerId, song.id, selected);
          });
          notify('Playlists actualizadas.');
          onClose();
        }}
      >
        Guardar selección
      </button>
    </Modal>
  );
}
