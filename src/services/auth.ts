import { db, uid } from './db';
import type { User } from '../types';
const iterations = 600000;
export const bytesToHex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (x) => x.toString(16).padStart(2, '0')).join('');
export async function derive(password: string, salt: string, rounds = iterations) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  return bytesToHex(
    await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: new TextEncoder().encode(salt),
        iterations: rounds,
        hash: 'SHA-256',
      },
      key,
      256,
    ),
  );
}
export async function register(
  name: string,
  username: string,
  password: string,
  confirmation: string,
  avatar?: string,
) {
  name = name.trim();
  username = username.trim().toLowerCase();
  if (!name || !/^[-a-z0-9_]{3,32}$/.test(username))
    throw new Error('Indica un nombre y un usuario de 3–32 caracteres (letras, números, _ o -).');
  if (password.length < 10) throw new Error('Usa al menos 10 caracteres en la contraseña.');
  if (password !== confirmation) throw new Error('Las contraseñas no coinciden.');
  if (await db.users.where({ username }).count())
    throw new Error('Este nombre de usuario ya existe en el dispositivo.');
  const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(24)).buffer);
  const user: User = {
    id: uid(),
    name,
    username,
    salt,
    verifier: await derive(password, salt),
    iterations,
    createdAt: Date.now(),
    avatar,
  };
  await db.users.add(user);
  return user;
}
export async function login(username: string, password: string) {
  const user = await db.users.where({ username: username.trim().toLowerCase() }).first();
  if (!user) throw new Error('Usuario o contraseña incorrectos.');
  const hash = await derive(password, user.salt, user.iterations);
  let mismatch = 0;
  for (let i = 0; i < hash.length; i++)
    mismatch |= hash.charCodeAt(i) ^ user.verifier.charCodeAt(i);
  if (mismatch) throw new Error('Usuario o contraseña incorrectos.');
  return user;
}
export async function changePassword(
  user: User,
  current: string,
  password: string,
  confirmation: string,
) {
  await login(user.username, current);
  if (password.length < 10 || password !== confirmation)
    throw new Error(
      'La nueva contraseña debe tener 10 caracteres y coincidir con la confirmación.',
    );
  const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(24)).buffer);
  await db.users.update(user.id, {
    salt,
    verifier: await derive(password, salt),
    iterations,
  });
}

function activeSessionId() {
  return sessionStorage.getItem('aura.session') || localStorage.getItem('aura.session');
}

export async function resetPasswordFromSession(
  userId: string,
  username: string,
  password: string,
  confirmation: string,
) {
  const user = await restoreSession();
  if (!user || user.id !== userId)
    throw new Error('Necesitas una sesión abierta de este perfil para restablecer su contraseña.');
  if (username.trim().toLowerCase() !== user.username)
    throw new Error('El usuario no coincide con el perfil de esta sesión.');
  if (password.length < 10) throw new Error('Usa al menos 10 caracteres en la nueva contraseña.');
  if (password !== confirmation) throw new Error('Las contraseñas no coinciden.');

  const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(24)).buffer);
  const verifier = await derive(password, salt);
  return db.transaction('rw', db.users, async () => {
    const current = await db.users.get(userId);
    if (activeSessionId() !== userId || !current)
      throw new Error('La sesión ha cambiado. Vuelve a abrir la recuperación desde tu perfil.');
    if (current.salt !== user.salt || current.verifier !== user.verifier)
      throw new Error('La contraseña cambió mientras se procesaba. Vuelve a intentarlo.');
    await db.users.update(userId, { salt, verifier, iterations });
    return { ...current, salt, verifier, iterations };
  });
}

export function saveSession(user: User, remember: boolean) {
  sessionStorage.setItem('aura.session', user.id);
  if (remember) localStorage.setItem('aura.session', user.id);
  else localStorage.removeItem('aura.session');
}
export function clearSession() {
  sessionStorage.removeItem('aura.session');
  localStorage.removeItem('aura.session');
}
export async function restoreSession() {
  const id = activeSessionId();
  return id ? db.users.get(id) : undefined;
}
