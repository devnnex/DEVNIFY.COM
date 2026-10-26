import { useState } from 'react';
import { Link2, CheckCircle2, LoaderCircle, ShieldCheck, Wifi } from 'lucide-react';
import { Field } from './common';
import {
  checkImportService,
  describeImportError,
  serviceBase,
  type ServiceHealth,
} from '../services/import-service';
import { db } from '../services/db';
import type { Settings } from '../types';

export function ImportServiceForm({
  settings,
  notify,
}: {
  settings: Settings;
  notify: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<ServiceHealth>();
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  return (
    <div className="import-connection-form">
      <div className="connection-intro">
        <span className="connection-icon">
          <Link2 size={20} />
        </span>
        <div>
          <strong>Tu conexión de importación</strong>
          <p>Un puente privado para obtener tus archivos autorizados.</p>
        </div>
      </div>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          setSaved(false);
          setHealth(undefined);
          const data = new FormData(event.currentTarget);
          try {
            const raw = String(data.get('url')).trim();
            const serviceUrl = raw ? serviceBase(raw) : '';
            const serviceToken = String(data.get('token')).trim();
            await db.settings.put({ ...settings, serviceUrl, serviceToken });
            setSaved(true);
            if (!serviceUrl) {
              notify('Conexión desactivada.');
              return;
            }
            const result = await checkImportService({ serviceUrl, serviceToken });
            setHealth(result);
            notify('Tu conexión está lista para importar audio.');
          } catch (cause) {
            setError(describeImportError(cause));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="URL del servicio">
          <input
            name="url"
            type="url"
            placeholder="https://importar.tudominio.com"
            defaultValue={settings.serviceUrl}
            autoComplete="url"
          />
        </Field>
        <Field label="Token de acceso">
          <input
            name="token"
            type="password"
            defaultValue={settings.serviceToken}
            placeholder="El token de tu servicio privado"
            autoComplete="off"
          />
        </Field>
        <button className="primary full" disabled={busy}>
          {busy ? <LoaderCircle size={16} className="spin" /> : <Wifi size={16} />}
          {busy ? 'Comprobando conexión…' : 'Guardar y comprobar conexión'}
        </button>
      </form>
      {health && (
        <div className="connection-result" role="status">
          <CheckCircle2 size={17} />
          <div>
            <strong>Conexión verificada</strong>
            {health.capabilities?.youtubeEnabled !== undefined && (
              <p>
                {health.capabilities.youtubeEnabled
                  ? health.capabilities.ytDlp
                    ? 'Motor de YouTube listo (yt-dlp).'
                    : 'Motor de YouTube habilitado; falta instalar yt-dlp.'
                  : 'Motor de YouTube desactivado en este servidor.'}
              </p>
            )}
            <p>
              {health.capabilities?.original
                ? 'Descarga en formato original disponible.'
                : 'Servicio compatible conectado.'}{' '}
              {health.ffmpeg ? 'Conversión MP3 disponible.' : 'Conversión MP3 no disponible.'}
            </p>
            {!!health.sourceHosts?.length && (
              <small>Fuentes habilitadas: {health.sourceHosts.join(', ')}</small>
            )}
          </div>
        </div>
      )}
      {error && (
        <div className="connection-error" role="alert">
          <strong>
            {saved ? 'Guardado; falta completar la conexión' : 'Revisa la configuración'}
          </strong>
          <p>{error}</p>
        </div>
      )}
      <p className="connection-privacy">
        <ShieldCheck size={15} />
        Solo se envía el enlace cuando autorizas usar tu conexión. Tus archivos locales permanecen
        en el dispositivo.
      </p>
      {location.protocol === 'file:' && (
        <p className="small muted">
          Para usar esta conexión desde el archivo local, su administrador debe habilitar{' '}
          <code>ALLOW_FILE_ORIGIN=true</code>. El token sigue siendo obligatorio.
        </p>
      )}
    </div>
  );
}
