import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowRight, Headphones, ShieldCheck } from 'lucide-react';
import { login, register, saveSession } from '../services/auth';
import { db, defaultSettings } from '../services/db';
import { optimizeImage } from '../services/imports';
import { Field, artUrl, brandLogoUrl } from './common';
import type { User } from '../types';
import { FilePicker } from './FilePicker';
export function Auth({ onLogin }: { onLogin: (user: User) => void }) {
  const [signup, setSignup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [remember, setRemember] = useState(true);
  const [avatar, setAvatar] = useState<string>();
  const [username, setUsername] = useState('');
  const profiles = useLiveQuery(() => db.users.toArray(), []) || [];
  return (
    <main className="auth-shell">
      <section className="auth-story">
        <a className="brand" href="#home">
          <img src={brandLogoUrl} alt="" />
          Devnify<span>music</span>
        </a>
        <div>
          <span className="eyebrow">UN ESPACIO QUE SUENA A TI</span>
          <h1>
            Tu música.
            <br />A tu manera<span>.</span>
          </h1>
          <p>
            Lo que te mueve, siempre contigo.
            <br />
            Tu colección personal, incluso sin conexión.
          </p>
        </div>
        <img
          className="auth-art"
          src={artUrl}
          alt="Ilustración de auriculares sobre fondo lavanda"
        />
        <div className="story-footer">
          <Headphones size={18} /> Más música. Menos ruido.
        </div>
      </section>
      <section className="auth-form">
        <div className="auth-form-inner">
          <span className="eyebrow">BIENVENIDO A Devnify</span>
          <h2>{signup ? 'Hazlo tuyo.' : 'Qué bueno verte.'}</h2>
          <p className="muted">
            {signup ? 'Crea tu perfil y dale un hogar a tu música.' : 'Entra a tu espacio musical.'}
          </p>
          <div className="segmented">
            <button
              className={!signup ? 'selected' : ''}
              onClick={() => {
                setSignup(false);
                setError('');
              }}
            >
              Iniciar sesión
            </button>
            <button
              className={signup ? 'selected' : ''}
              onClick={() => {
                setSignup(true);
                setError('');
              }}
            >
              Crear cuenta
            </button>
          </div>
          {!signup && profiles.length > 0 && (
            <Field label="Elegir perfil local">
              <select value={username} onChange={(e) => setUsername(e.target.value)}>
                <option value="">Selecciona tu perfil</option>
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.username}>
                    {profile.name} · @{profile.username}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setError('');
              setBusy(true);
              const f = new FormData(e.currentTarget);
              try {
                const user = signup
                  ? await register(
                      String(f.get('name')),
                      String(f.get('username')),
                      String(f.get('password')),
                      String(f.get('confirmation')),
                      avatar,
                    )
                  : await login(String(f.get('username')), String(f.get('password')));
                if (!(await db.settings.get(user.id)))
                  await db.settings.put(defaultSettings(user.id));
                saveSession(user, remember);
                onLogin(user);
              } catch (err) {
                setError(err instanceof Error ? err.message : 'No se pudo abrir el perfil.');
              } finally {
                setBusy(false);
              }
            }}
          >
            {signup && (
              <>
                <Field label="Tu nombre">
                  <input
                    name="name"
                    required
                    maxLength={60}
                    autoComplete="name"
                    placeholder="¿Cómo te llamas?"
                  />
                </Field>
                <FilePicker
                  label="Avatar (opcional)"
                  preview={avatar}
                  onSelect={async (file) => setAvatar(await optimizeImage(file))}
                  onClear={() => setAvatar(undefined)}
                />
              </>
            )}
            <Field label="Usuario">
              <input
                name="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoComplete="username"
                placeholder="Tu nombre de usuario"
                minLength={3}
                maxLength={32}
              />
            </Field>
            <Field label="Contraseña">
              <input
                name="password"
                type="password"
                required
                autoComplete={signup ? 'new-password' : 'current-password'}
                minLength={signup ? 10 : 1}
                placeholder={signup ? 'Mínimo 10 caracteres' : 'Tu contraseña'}
              />
            </Field>
            {signup && (
              <Field label="Confirmar contraseña">
                <input name="confirmation" type="password" required autoComplete="new-password" />
              </Field>
            )}
            <label className="check">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />{' '}
              Mantener mi sesión en este dispositivo
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="primary full" disabled={busy}>
              {busy ? 'Un momento…' : signup ? 'Crear mi espacio' : 'Entrar a mi espacio'}
              <ArrowRight size={18} />
            </button>
          </form>
          <p className="privacy-note">
            <ShieldCheck size={18} />
            Tu cuenta y tu música se guardan en este navegador. No hay sincronización automática
            entre dispositivos.
          </p>
        </div>
      </section>
    </main>
  );
}
