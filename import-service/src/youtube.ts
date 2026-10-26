import { spawn, type ChildProcess } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

export const ytDlpPath = () => process.env.YTDLP_PATH || 'yt-dlp';
export const youtubeDownloadsEnabled = () => process.env.ENABLE_YOUTUBE_DOWNLOADS === 'true';
interface Metadata {
  id: string;
  title: string;
  uploader?: string;
  artist?: string;
  duration: number;
  is_live?: boolean;
  live_status?: string;
  availability?: string;
}
function run(
  args: string[],
  signal: AbortSignal,
  onSpawn?: (child: ChildProcess) => void,
  timeoutMs = 300000,
) {
  return new Promise<string>((resolveResult, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Cancelado', 'AbortError'));
      return;
    }
    const child = spawn(ytDlpPath(), args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      signal,
    });
    onSpawn?.(child);
    let stdout = '',
      stderr = '',
      settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolveResult(stdout);
    };
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error('La descarga de YouTube superó el tiempo de espera.'));
    }, timeoutMs);
    child.stdout?.on('data', (data) => {
      stdout += String(data);
      if (stdout.length > 2 * 1024 * 1024) {
        child.kill('SIGKILL');
        finish(new Error('Metadatos de descarga demasiado grandes.'));
      }
    });
    child.stderr?.on('data', (data) => {
      if (stderr.length < 12000) stderr += String(data);
    });
    child.on('error', (error) =>
      finish(
        error.name === 'AbortError'
          ? new DOMException('Cancelado', 'AbortError')
          : new Error(
              'No se pudo iniciar yt-dlp. Instálalo o configura YTDLP_PATH en el servidor.',
            ),
      ),
    );
    child.on('exit', (code) =>
      finish(
        code === 0
          ? undefined
          : new Error(
              `No se pudo obtener el audio. ${stderr.replace(/https?:\/\/\S+/g, '[origen]').slice(-500) || `yt-dlp terminó con código ${code}.`}`,
            ),
      ),
    );
  });
}
export function youtubeArguments(id: string) {
  if (!/^[\w-]{11}$/.test(id)) throw new Error('Identificador de YouTube no válido.');
  return [
    '--ignore-config',
    '--no-config-locations',
    '--no-plugin-dirs',
    '--no-remote-components',
    '--no-playlist',
    '--no-cookies',
    '--no-cache-dir',
    '--no-mark-watched',
    '--no-update',
    '--no-allow-unplayable-formats',
    '--no-js-runtimes',
    '--js-runtimes',
    `node:${process.execPath}`,
    '--socket-timeout',
    '30',
    '--retries',
    '1',
    '--fragment-retries',
    '1',
    '--extractor-retries',
    '1',
    '--proxy',
    '',
    '--use-extractors',
    'youtube',
    '--no-color',
    '--no-progress',
  ];
}
export async function downloadYoutubeAudio(
  id: string,
  directory: string,
  signal: AbortSignal,
  onSpawn?: (child: ChildProcess) => void,
  execute: typeof run = run,
) {
  if (!youtubeDownloadsEnabled())
    throw new Error(
      'El motor de YouTube está desactivado. El administrador debe configurar y habilitar las descargas autorizadas.',
    );
  const url = `https://www.youtube.com/watch?v=${id}`;
  const base = youtubeArguments(id);
  let metadata: Metadata;
  try {
    metadata = JSON.parse(
      await execute(
        [...base, '--skip-download', '--dump-single-json', '--', url],
        signal,
        onSpawn,
        60000,
      ),
    );
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('yt-dlp devolvió metadatos no válidos.');
    throw error;
  }
  if (
    metadata.id !== id ||
    !Number.isFinite(metadata.duration) ||
    metadata.duration <= 0 ||
    metadata.duration > 7200 ||
    metadata.is_live ||
    ['is_live', 'is_upcoming', 'post_live'].includes(metadata.live_status || '')
  )
    throw new Error(
      'Solo se admiten vídeos completos de hasta dos horas; no directos ni próximos estrenos.',
    );
  if (
    metadata.availability &&
    ['private', 'premium_only', 'subscriber_only', 'needs_auth'].includes(metadata.availability)
  )
    throw new Error(
      'El vídeo requiere acceso adicional y no se puede descargar con este servicio.',
    );
  await execute(
    [
      ...base,
      '--format',
      'bestaudio',
      '--max-filesize',
      '200M',
      '--match-filters',
      '!is_live & duration <= 7200',
      '--no-part',
      '--no-continue',
      '--no-overwrites',
      '--fixup',
      'never',
      '--output',
      join(directory, 'youtube-source.%(ext)s'),
      '--',
      url,
    ],
    signal,
    onSpawn,
  );
  const files = (await readdir(directory)).filter((name) =>
    /^youtube-source\.[a-zA-Z0-9]+$/.test(name),
  );
  if (files.length !== 1) throw new Error('La descarga no produjo un archivo de audio válido.');
  const path = resolve(directory, files[0]);
  if (!path.startsWith(resolve(directory) + sep)) throw new Error('Ruta de descarga no válida.');
  const file = await stat(path);
  if (file.size < 100 || file.size > 200 * 1024 * 1024)
    throw new Error('El archivo está vacío o supera 200 MB.');
  return { path, title: metadata.title, artist: metadata.artist || metadata.uploader || '' };
}
export async function youtubeToolAvailable() {
  if (!youtubeDownloadsEnabled()) return false;
  try {
    await run(['--ignore-config', '--version'], AbortSignal.timeout(5000), undefined, 5000);
    return true;
  } catch {
    return false;
  }
}
