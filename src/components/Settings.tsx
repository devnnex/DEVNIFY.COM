import { useEffect, useState } from 'react';
import {
  Download,
  Upload,
  ShieldCheck,
  Database,
  LogOut,
  HardDrive,
  Wifi,
  UserRound,
  LockKeyhole,
} from 'lucide-react';
import { db, deleteUser } from '../services/db';
import { changePassword, saveSession } from '../services/auth';
import { optimizeImage, downloadFile } from '../services/imports';
import { exportLibrary, inspectBackup, restoreLibrary } from '../services/backups';
import { Field, Modal } from './common';
import { FilePicker } from './FilePicker';
import { ImportServiceForm } from './ImportServiceForm';
import { player } from '../services/player';
import type { User, Song, Playlist, Settings as Preferences, History } from '../types';
export function Settings({
  user,
  songs,
  playlists,
  settings,
  history,
  onLogout,
  onUser,
  notify,
  install,
}: {
  user: User;
  songs: Song[];
  playlists: Playlist[];
  settings: Preferences;
  history: History[];
  onLogout: () => void;
  onUser: (u: User) => void;
  notify: (s: string) => void;
  install: () => void;
}) {
  const [storage, setStorage] = useState<StorageEstimate>();
  const [password, setPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [backupPassword, setBackupPassword] = useState('');
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof inspectBackup>>>();
  const [error, setError] = useState('');
  useEffect(() => {
    void navigator.storage
      ?.estimate()
      .then(setStorage)
      .catch(() => setStorage(undefined));
  }, [songs.length]);
  const bytes = songs.reduce((n, s) => n + (s.downloaded ? s.size : 0), 0);
  const hours = history.reduce((n, h) => n + h.seconds, 0) / 3600;
  const topArtist = Object.entries(
    songs.reduce<Record<string, number>>((acc, s) => {
      acc[s.artist] = (acc[s.artist] || 0) + s.playCount;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1])[0];
  async function update(values: Partial<Preferences>) {
    await db.settings.put({ ...settings, ...values });
  }
  return (
    <>
      <div className="page-heading">
        <span className="eyebrow">A TU MANERA</span>
        <h1>
          Tu espacio, tus reglas<span>.</span>
        </h1>
        <p className="muted">Cuida tu colección. Personaliza tu experiencia.</p>
      </div>
      <div className="stats-grid">
        {[
          [songs.length, 'canciones'],
          [playlists.length, 'playlists'],
          [`${hours.toFixed(1)} h`, 'escuchadas'],
          [`${(bytes / 1024 / 1024).toFixed(1)} MB`, 'de música'],
        ].map(([value, label]) => (
          <div className="stat-card" key={label}>
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <div className="settings-grid">
        <section className="settings-card">
          <h2>
            <UserRound size={20} /> Mi perfil
          </h2>
          <FilePicker
            label="Avatar de tu perfil"
            preview={user.avatar}
            onSelect={async (file) => {
              const avatar = await optimizeImage(file);
              await db.users.update(user.id, { avatar });
              onUser({ ...user, avatar });
              notify('Avatar actualizado.');
            }}
            onClear={async () => {
              await db.users.update(user.id, { avatar: undefined });
              onUser({ ...user, avatar: undefined });
            }}
          />
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const name = String(f.get('name')).trim();
              if (name) {
                await db.users.update(user.id, { name });
                onUser({ ...user, name });
                notify('Perfil actualizado.');
              }
            }}
          >
            <Field label="Nombre visible">
              <input name="name" defaultValue={user.name} required maxLength={60} />
            </Field>
            <p className="small muted">@{user.username} · Cuenta local de este navegador</p>
            <button className="secondary">Guardar nombre</button>
          </form>
          <label className="check">
            <input
              type="checkbox"
              checked={settings.remember}
              onChange={(e) => {
                void update({ remember: e.target.checked });
                saveSession(user, e.target.checked);
              }}
            />{' '}
            Mantener sesión al cerrar
          </label>
          <button className="text-button" onClick={() => setPassword(true)}>
            <LockKeyhole size={16} /> Cambiar contraseña
          </button>
          <div className="divider" />
          <button className="secondary full" onClick={onLogout}>
            <LogOut size={16} /> Cerrar sesión / cambiar perfil
          </button>
        </section>
        <section className="settings-card">
          <h2>
            <HardDrive size={20} /> Almacenamiento
          </h2>
          <div className="storage-number">
            {(bytes / 1024 / 1024).toFixed(1)}
            <small>MB de audio en este perfil</small>
          </div>
          <progress max={storage?.quota || 1} value={storage?.usage || 0} />
          <p className="small muted">
            {storage
              ? `Navegador: ${((storage.usage || 0) / 1024 / 1024).toFixed(1)} MB usados de ${((storage.quota || 0) / 1024 / 1024 / 1024).toFixed(1)} GB estimados.`
              : 'El navegador no ofrece una estimación de cuota en este modo de apertura.'}
          </p>
          <button
            className="secondary full"
            onClick={async () => {
              let granted = false;
              try {
                granted = (await navigator.storage?.persist?.()) || false;
              } catch {
                notify(
                  'Este navegador no permite solicitar persistencia desde un archivo local. Conserva tus respaldos.',
                );
                return;
              }
              notify(
                granted
                  ? 'El navegador concedió almacenamiento persistente.'
                  : 'El navegador no concedió persistencia. Mantén tus respaldos.',
              );
            }}
          >
            <ShieldCheck size={17} /> Solicitar almacenamiento persistente
          </button>
          <p className="notice">
            El navegador puede eliminar los datos. Un respaldo es la forma de recuperar o transferir
            tu música a otro dispositivo.
          </p>
          <h3>Tu actividad</h3>
          <p className="muted">
            {topArtist?.[1]
              ? `Artista más escuchado: ${topArtist[0]} · ${topArtist[1]} reproducciones.`
              : 'Todavía no hay suficientes escuchas.'}
          </p>
          <p className="small muted">
            Una reproducción se cuenta tras escuchar 30 segundos o la mitad de la canción, lo que
            ocurra primero.
          </p>
          <button className="secondary full" onClick={install}>
            <Download size={17} /> Instalar Devnify
          </button>
        </section>
        <section className="settings-card">
          <h2>
            <Database size={20} /> Respaldo y recuperación
          </h2>
          <p className="muted">
            Audio, portadas, playlists, favoritos, historial y preferencias en un archivo portable.
          </p>
          <Field label="Contraseña del respaldo (opcional)">
            <input
              type="password"
              autoComplete="new-password"
              placeholder="Mínimo 10 caracteres para cifrar"
              value={backupPassword}
              onChange={(e) => setBackupPassword(e.target.value)}
            />
          </Field>
          <p className="small muted">
            Con contraseña: cifrado AES-GCM. Sin contraseña: ZIP legible. No se exportan
            credenciales de cuenta ni del servicio.
          </p>
          <button
            className="primary full"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const blob = await exportLibrary(user.id, backupPassword);
                downloadFile(
                  blob,
                  `devnify-backup-${new Date().toISOString().slice(0, 10)}.${backupPassword ? 'devnify' : 'zip'}`,
                );
                notify('Respaldo generado. Conserva el archivo en un lugar seguro.');
              } catch (err) {
                notify(String(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Download size={18} />
            {busy ? 'Procesando…' : 'Exportar biblioteca'}
          </button>
          <label className={`secondary full file-button ${busy ? 'disabled' : ''}`}>
            <Upload size={18} /> Importar respaldo
            <input
              type="file"
              accept=".devnify,.aura,.zip"
              disabled={busy}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setBusy(true);
                try {
                  setPreview(await inspectBackup(file, backupPassword));
                } catch (err) {
                  notify(String(err));
                } finally {
                  setBusy(false);
                  e.target.value = '';
                }
              }}
            />
          </label>
        </section>
        <section className="settings-card">
          <h2>
            <Wifi size={20} /> Music Import Service
          </h2>
          <ImportServiceForm settings={settings} notify={notify} />
        </section>
      </div>
      <section className="danger-zone">
        <div>
          <h3>Eliminar este perfil</h3>
          <p className="muted">Se eliminarán su música, playlists y datos de este navegador.</p>
        </div>
        <button
          className="danger"
          onClick={async () => {
            if (
              window.confirm(
                `¿Eliminar definitivamente el perfil de ${user.name} y toda su biblioteca? Exporta un respaldo antes de continuar.`,
              )
            ) {
              await player.setOwner('');
              await deleteUser(user.id);
              onLogout();
            }
          }}
        >
          Eliminar cuenta
        </button>
      </section>
      {password && (
        <Modal title="Cambiar contraseña" onClose={() => setPassword(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setError('');
              const f = new FormData(e.currentTarget);
              try {
                const fresh = await db.users.get(user.id);
                if (!fresh) throw new Error('Perfil no disponible');
                await changePassword(
                  fresh,
                  String(f.get('current')),
                  String(f.get('new')),
                  String(f.get('confirmation')),
                );
                onUser((await db.users.get(user.id))!);
                notify('Contraseña actualizada.');
                setPassword(false);
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              }
            }}
          >
            {[
              ['current', 'Contraseña actual'],
              ['new', 'Nueva contraseña'],
              ['confirmation', 'Confirmación'],
            ].map(([name, label]) => (
              <Field key={name} label={label}>
                <input
                  type="password"
                  name={name}
                  autoComplete={name === 'current' ? 'current-password' : 'new-password'}
                  required
                  minLength={name === 'current' ? 1 : 10}
                />
              </Field>
            ))}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="primary full">Actualizar contraseña</button>
          </form>
        </Modal>
      )}
      {preview && (
        <Modal title="Restaurar biblioteca" onClose={() => setPreview(undefined)}>
          <p>
            Este respaldo contiene <strong>{preview.manifest.songs.length} canciones</strong> y{' '}
            <strong>{preview.manifest.playlists.length} playlists</strong> de{' '}
            {preview.manifest.profile.name}.
          </p>
          <p className="muted">
            Se combinarán con tu biblioteca. Los audios duplicados se conservarán una sola vez. Se
            restaurarán el nombre, avatar y preferencias del respaldo.
          </p>
          <button
            disabled={busy}
            className="primary full"
            onClick={async () => {
              setBusy(true);
              try {
                const count = await restoreLibrary(user.id, preview);
                const restoredUser = (await db.users.get(user.id))!;
                const restoredSettings = await db.settings.get(user.id);
                if (restoredSettings) {
                  player.volume(restoredSettings.volume);
                  player.speed(restoredSettings.speed);
                  player.equalizer(restoredSettings.eq);
                  saveSession(restoredUser, restoredSettings.remember);
                }
                onUser(restoredUser);
                notify(`Respaldo restaurado. ${count} canciones nuevas.`);
                setPreview(undefined);
              } catch (err) {
                notify(String(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Restaurando…' : 'Confirmar restauración'}
          </button>
        </Modal>
      )}
    </>
  );
}
