import { useRef, useState } from 'react';
import {
  Upload,
  Link,
  Youtube,
  Info,
  Download,
  Link2,
  CheckCircle2,
  Settings2,
  Headphones,
  FolderHeart,
  Film,
} from 'lucide-react';
import { Modal, Field } from './common';
import { ImportServiceForm } from './ImportServiceForm';
import { importAudio, youtubeId, validateHttps } from '../services/imports';
import {
  fetchImportAudio,
  cancelImportJob,
  describeImportError,
  ImportConnectionError,
} from '../services/import-service';
import { db, uid } from '../services/db';
import { convertToMp3 } from '../services/local-conversion';
import type { Playlist, Settings } from '../types';

export function ImportDialog({
  ownerId,
  playlists,
  settings,
  onClose,
  notify,
  initialPlaylistId,
}: {
  ownerId: string;
  playlists: Playlist[];
  settings: Settings;
  onClose: () => void;
  notify: (message: string) => void;
  initialPlaylistId?: string;
}) {
  const [tab, setTab] = useState('file');
  const [selected, setSelected] = useState<string[]>(initialPlaylistId ? [initialPlaylistId] : []);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const [connectionNeeded, setConnectionNeeded] = useState(false);
  const [url, setUrl] = useState('');
  const [format, setFormat] = useState<'original' | 'mp3'>('original');
  const [quality, setQuality] = useState('192');
  const [showConnection, setShowConnection] = useState(false);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [newName, setNewName] = useState('');
  const abort = useRef<AbortController | null>(null);
  const job = useRef<{ id: string; settings: Settings } | null>(null);
  const active = useRef(false);
  let videoId: string | null = null;
  try {
    videoId = youtubeId(url.trim());
  } catch {
    /* Incomplete URL while typing. */
  }
  const connected = !!settings.serviceUrl && !!settings.serviceToken;
  const destinations = [{ id: 'favorites', name: 'Favoritos' }, ...playlists];
  const destinationNames = destinations
    .filter((item) => selected.includes(item.id))
    .map((item) => item.name);

  async function files(items: FileList | File[]) {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setFileErrors([]);
    setError(false);
    setMessage('Leyendo audio y metadatos…');
    let count = 0;
    const controller = new AbortController();
    abort.current = controller;
    for (const file of Array.from(items)) {
      try {
        if (controller.signal.aborted) break;
        const converting = tab === 'convert' || file.type.startsWith('video/');
        const blob = converting
          ? await convertToMp3(file, {
              signal: controller.signal,
              bitrate: Number(quality),
              onProgress: setProgress,
              onStatus: setMessage,
            })
          : file;
        if (controller.signal.aborted) break;
        const result = await importAudio(
          ownerId,
          blob,
          converting ? file.name.replace(/\.[^.]+$/, '') + '.mp3' : file.name,
          selected,
        );
        count++;
        setMessage(`${result.duplicate ? 'Ya existía' : 'Guardado'}: ${result.song.title}`);
      } catch (cause) {
        setFileErrors((previous) => [...previous, `${file.name}: ${describeImportError(cause)}`]);
      }
    }
    setBusy(false);
    active.current = false;
    if (count) notify(`${count} archivo(s) procesado(s) en tu biblioteca.`);
  }
  async function releaseJob() {
    const current = job.current;
    job.current = null;
    if (current)
      try {
        await cancelImportJob(current.settings, current.id);
      } catch {
        /* The server also expires temporary jobs. */
      }
  }
  function cancel() {
    abort.current?.abort();
    void releaseJob();
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (active.current) return;
    setMessage('');
    setError(false);
    setConnectionNeeded(false);
    const source = url.trim();
    try {
      const parsed = validateHttps(source);
      if (
        ['youtu.be', 'youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(parsed.hostname) &&
        !videoId
      )
        throw new Error('No es una URL de vídeo de YouTube válida.');
    } catch (cause) {
      setError(true);
      setMessage(describeImportError(cause));
      return;
    }
    active.current = true;
    setBusy(true);
    setProgress(null);
    const controller = new AbortController();
    abort.current = controller;
    const timeout = setTimeout(() => controller.abort(), 420000);
    try {
      let remoteMetadata: { title?: string; artist?: string } | undefined;
      const result = await fetchImportAudio(source, {
        settings,
        signal: controller.signal,
        format: videoId && format === 'original' ? 'mp3' : format,
        quality: Number(quality),
        authorized: true,
        onProgress: setProgress,
        onStatus: setMessage,
        onMetadata: (metadata) => {
          remoteMetadata = metadata;
        },
        onJob: (id) => {
          job.current = { id, settings };
        },
      });
      if (controller.signal.aborted) throw new DOMException('Cancelado', 'AbortError');
      setMessage('Guardando el archivo y añadiendo a tu colección…');
      const filename = videoId
        ? `Audio ${videoId}`
        : decodeURIComponent(new URL(source).pathname.split('/').pop() || 'Audio importado');
      const needsLocalConversion =
        !videoId &&
        ((format === 'mp3' && !['audio/mpeg', 'audio/mp3'].includes(result.blob.type)) ||
          result.blob.type.startsWith('video/'));
      const audioBlob = needsLocalConversion
        ? await convertToMp3(result.blob, {
            signal: controller.signal,
            bitrate: Number(quality),
            onProgress: setProgress,
            onStatus: setMessage,
          })
        : result.blob;
      const imported = await importAudio(
        ownerId,
        audioBlob,
        filename,
        selected,
        result.viaService ? 'authorized-import' : 'direct-url',
        source,
        remoteMetadata,
      );
      const destination = destinationNames.length ? destinationNames.join(', ') : 'Tu biblioteca';
      setMessage(
        `${imported.duplicate ? 'Ya estaba guardado' : 'Guardado offline'}: ${imported.song.title} · ${destination}`,
      );
      notify(`Audio guardado en ${destination}. Ya puedes escucharlo sin conexión.`);
    } catch (cause) {
      setError(true);
      setMessage(describeImportError(cause));
      if (
        cause instanceof ImportConnectionError &&
        ['configuration', 'authorization', 'network'].includes(cause.code)
      )
        setConnectionNeeded(true);
    } finally {
      clearTimeout(timeout);
      await releaseJob();
      setBusy(false);
      active.current = false;
    }
  }

  return (
    <Modal
      title="Añade tu música"
      onClose={() => {
        cancel();
        onClose();
      }}
      wide
    >
      <p className="muted">Descarga una vez. Escucha en Devnify, incluso sin conexión.</p>
      <div className="import-tabs">
        {[
          { id: 'file', icon: Upload, label: 'Dispositivo' },
          { id: 'url', icon: Link, label: 'URL de audio' },
          { id: 'convert', icon: Film, label: 'Vídeo a MP3' },
        ].map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            className={tab === id ? 'selected' : ''}
            disabled={busy}
            onClick={() => {
              setTab(id);
              setMessage('');
              setError(false);
              setConnectionNeeded(false);
            }}
          >
            <Icon size={19} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <Field label="Añadir a playlists">
        <div className="playlist-checks">
          {destinations.map((item) => (
            <label className="check" key={item.id}>
              <input
                type="checkbox"
                disabled={busy}
                checked={selected.includes(item.id)}
                onChange={(event) =>
                  setSelected(
                    event.target.checked
                      ? [...selected, item.id]
                      : selected.filter((id) => id !== item.id),
                  )
                }
              />
              {item.name}
            </label>
          ))}
          <span className="muted small">
            Puedes elegir Favoritos y varias playlists. Sin selección, se guarda en tu biblioteca.
          </span>
        </div>
      </Field>
      <div className="inline-create">
        <input
          aria-label="Nombre de nueva playlist"
          placeholder="Nueva playlist"
          value={newName}
          disabled={busy}
          onChange={(event) => setNewName(event.target.value)}
        />
        <button
          className="secondary"
          disabled={busy || !newName.trim()}
          onClick={async () => {
            try {
              const item: Playlist = {
                id: uid(),
                ownerId,
                name: newName.trim(),
                description: '',
                songIds: [],
                createdAt: Date.now(),
              };
              await db.playlists.add(item);
              setSelected([...selected, item.id]);
              setNewName('');
            } catch (cause) {
              setError(true);
              setMessage(describeImportError(cause));
            }
          }}
        >
          Crear
        </button>
      </div>
      {tab !== 'url' ? (
        <>
          <label
            className={`dropzone ${busy ? 'disabled' : ''}`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (!busy) void files(event.dataTransfer.files);
            }}
          >
            <div className="drop-icon">
              <Upload />
            </div>
            <strong>
              {tab === 'convert'
                ? 'Convierte tu vídeo en música'
                : 'Haz espacio para lo que te gusta'}
            </strong>
            <span>
              {tab === 'convert'
                ? 'Extrae el audio y guárdalo como MP3 en tu biblioteca'
                : 'Arrastra tus canciones o selecciona archivos'}
            </span>
            <small>
              {tab === 'convert'
                ? 'Sin servidor ni Internet · MP4/AAC compatible · Hasta 100 MB y 20 minutos'
                : 'MP3, M4A, AAC, WAV, FLAC, OGG, OPUS · Hasta 500 MB por archivo'}
            </small>
            <input
              aria-label={tab === 'convert' ? 'Vídeo para convertir' : 'Archivos de música'}
              type="file"
              multiple
              disabled={busy}
              accept={
                tab === 'convert'
                  ? 'video/*,audio/*,.mp4,.mov,.webm'
                  : 'audio/*,.mp3,.m4a,.aac,.wav,.flac,.ogg,.opus'
              }
              onChange={(event) => {
                if (event.target.files) {
                  const chosen = Array.from(event.target.files);
                  event.target.value = '';
                  void files(chosen);
                }
              }}
            />
            <span className="primary">
              {tab === 'convert' ? 'Elegir vídeo y convertir' : 'Seleccionar música'}
            </span>
          </label>
          {tab === 'convert' && (
            <Field label="Calidad del MP3">
              <select
                aria-label="Calidad del MP3"
                value={quality}
                disabled={busy}
                onChange={(event) => setQuality(event.target.value)}
              >
                {[128, 192, 256, 320].map((value) => (
                  <option key={value} value={value}>
                    {value} kbps{value === 192 ? ' · Recomendada' : ''}
                  </option>
                ))}
              </select>
              <small className="muted">
                La conversión ocurre en este dispositivo. Un bitrate mayor no mejora el original.
              </small>
            </Field>
          )}
        </>
      ) : (
        <form onSubmit={(event) => void submit(event)}>
          <Field label="URL HTTPS del archivo de audio">
            <input
              type="url"
              value={url}
              required
              disabled={busy}
              onChange={(event) => {
                setUrl(event.target.value);
                setMessage('');
                setError(false);
                setConnectionNeeded(false);
              }}
              placeholder="Pega el enlace que quieres guardar"
            />
          </Field>
          {videoId && (
            <div className="source-card">
              <div className="source-heading">
                <span className="source-icon">
                  <Youtube size={22} />
                </span>
                <div>
                  <strong>Enlace de YouTube reconocido</strong>
                  <span>
                    {connected
                      ? 'Descarga mediante tu servicio configurado'
                      : 'Necesita un servicio de descarga'}
                  </span>
                </div>
              </div>
              <p>
                {connected
                  ? 'Tu servicio puede obtener el audio con yt-dlp si tiene habilitada la descarga de este vídeo. Se guardará en Devnify cuando el archivo esté completo.'
                  : 'El enlace de YouTube no entrega el archivo a esta aplicación. La conversión local funciona con un vídeo que ya tengas: ábrelo en «Vídeo a MP3». Para obtenerlo directamente de YouTube hace falta un servicio de descarga.'}
              </p>
            </div>
          )}
          <div className="download-destination">
            <FolderHeart size={19} />
            <div>
              <span>SE GUARDARÁ EN</span>
              <strong>{destinationNames.join(' + ') || 'Tu biblioteca'}</strong>
            </div>
            <span className="download-offline-tag">
              <Headphones size={13} /> Offline
            </span>
          </div>
          <button className="primary full download-cta" disabled={busy}>
            <Download size={18} />
            {busy ? 'Descargando…' : 'Descargar y añadir'}
          </button>
          <p className="small muted download-consent">
            Al descargar confirmas que puedes guardar este audio y autorizas enviar el enlace a tu
            conexión configurada si hace falta.
          </p>
          <details className="download-options">
            <summary>Opciones de descarga y conexión</summary>
            <div className="import-quality">
              <Field label="Formato de importación">
                <select
                  aria-label="Formato de importación"
                  value={format}
                  disabled={busy}
                  onChange={(event) => setFormat(event.target.value as 'original' | 'mp3')}
                >
                  <option value="original">Original · Conservar la calidad</option>
                  <option value="mp3">
                    MP3 ·{' '}
                    {videoId ? 'Convertir mediante el servicio' : 'Convertir en este dispositivo'}
                  </option>
                </select>
              </Field>
              {format === 'mp3' && (
                <Field label="Bitrate MP3">
                  <select
                    aria-label="Bitrate MP3"
                    value={quality}
                    disabled={busy}
                    onChange={(event) => setQuality(event.target.value)}
                  >
                    {[128, 192, 256, 320].map((value) => (
                      <option key={value} value={value}>
                        {value} kbps
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </div>
            {format === 'mp3' && (
              <p className="small muted">Un bitrate mayor no mejora la calidad original.</p>
            )}
            <p className="small muted">
              Los archivos directos se descargan desde su origen y pueden convertirse aquí a MP3. El
              servicio externo se utiliza para YouTube o cuando el origen no permite leer el
              archivo.
            </p>
          </details>
          <div className={`connection-strip ${connected ? 'connected' : ''}`}>
            <span>
              {connected ? <CheckCircle2 size={16} /> : <Link2 size={16} />}{' '}
              {connected
                ? 'Conexión de descarga configurada'
                : 'Servicio externo opcional · Sin configurar'}
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => setShowConnection(!showConnection)}
            >
              <Settings2 size={14} />
              {showConnection ? 'Ocultar' : 'Configurar'}
            </button>
          </div>
        </form>
      )}
      {showConnection && tab === 'url' && (
        <div className="inline-connection">
          <ImportServiceForm settings={settings} notify={notify} />
        </div>
      )}
      {busy && (tab === 'url' || tab === 'convert') && (
        <div className="progress">
          <progress aria-label="Progreso de descarga" max="100" value={progress ?? undefined} />
          <button className="secondary" onClick={cancel}>
            Cancelar
          </button>
        </div>
      )}
      {message && (
        <p className={`import-status ${error ? 'failed' : ''}`} role="status">
          <Info size={16} />
          {message}
        </p>
      )}
      {connectionNeeded && (
        <div className="import-recovery">
          <button type="button" className="secondary" onClick={() => setShowConnection(true)}>
            <Link2 size={15} />
            Configurar conexión
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setTab('file');
              setMessage('');
              setError(false);
            }}
          >
            Importar desde mi dispositivo
          </button>
        </div>
      )}
      {fileErrors.length > 0 && (
        <div className="error" role="alert">
          {fileErrors.map((text, index) => (
            <p key={index}>{text}</p>
          ))}
        </div>
      )}
    </Modal>
  );
}
