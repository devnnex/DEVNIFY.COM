import { request } from 'node:https';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, writeFile, readFile, readdir, rm, stat, rename } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { approvedSource } from './security.js';
import { parseFile } from 'music-metadata';
import { resolveAudioSource, type AuthorizedAudioSource } from './sources.js';
import { youtubeVideoId } from './sources.js';
import { downloadYoutubeAudio, youtubeDownloadsEnabled } from './youtube.js';
export interface Job {
  id: string;
  sourceUrl: string;
  quality: number;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  createdAt: number;
  error?: string;
  targetFormat?: 'original' | 'mp3';
  fileName?: string;
  mimeType?: string;
  youtubeId?: string;
  title?: string;
  artist?: string;
}
export const ffmpegPath = () => process.env.FFMPEG_PATH || 'ffmpeg';
export async function convertFile(
  input: string,
  output: string,
  quality: number,
  onSpawn?: (p: ChildProcess) => void,
) {
  const metadata = await parseFile(input);
  if (!metadata.format.duration || metadata.format.duration > 7200)
    throw new Error('El audio debe tener duración reconocible de hasta 2 horas.');
  return new Promise<void>((resolve, reject) => {
    const process = spawn(
      ffmpegPath(),
      [
        '-nostdin',
        '-hide_banner',
        '-loglevel',
        'error',
        '-protocol_whitelist',
        'file',
        '-format_whitelist',
        'mp3,wav,flac,ogg,aac,mov,matroska,webm',
        '-i',
        input,
        '-map',
        '0:a:0',
        '-vn',
        '-threads',
        '1',
        '-c:a',
        'libmp3lame',
        '-b:a',
        `${quality}k`,
        '-y',
        output,
      ],
      { shell: false, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true },
    );
    onSpawn?.(process);
    let detail = '';
    process.stderr?.on('data', (chunk) => {
      if (detail.length < 3000) detail += String(chunk);
    });
    const timeout = setTimeout(() => {
      process.kill('SIGKILL');
      reject(new Error('La conversión superó el límite de 5 minutos.'));
    }, 300000);
    process.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    process.on('exit', (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg no pudo convertir el audio (${code}): ${detail.slice(-250)}`));
    });
  });
}
export class JobManager {
  jobs = new Map<string, Job>();
  private active?: string;
  private controller?: AbortController;
  private child?: ChildProcess;
  private timer?: ReturnType<typeof setInterval>;
  private closed = false;
  constructor(
    public dir: string,
    public hosts: string[],
    private authorizedSources: Record<string, AuthorizedAudioSource> = {},
  ) {}
  path(id: string, file: string) {
    return join(this.dir, id, file);
  }
  output(job: Job) {
    return this.path(job.id, job.fileName || 'audio.mp3');
  }
  async init() {
    await mkdir(this.dir, { recursive: true });
    for (const id of await readdir(this.dir)) {
      if (!/^[a-f0-9-]{36}$/.test(id)) continue;
      try {
        const job: Job = JSON.parse(await readFile(this.path(id, 'job.json'), 'utf8'));
        if (job.id !== id) continue;
        if (['queued', 'processing'].includes(job.status)) {
          job.status = 'failed';
          job.error = 'El servicio se reinició. Reintenta la importación.';
          await this.save(job);
          await rm(this.path(id, 'source'), { force: true });
        }
        this.jobs.set(id, job);
      } catch {
        await rm(join(this.dir, id), { force: true, recursive: true });
      }
    }
    await this.cleanup();
    this.timer = setInterval(() => void this.cleanup(), 60000);
    this.timer.unref();
  }
  async save(job: Job) {
    await mkdir(join(this.dir, job.id), { recursive: true });
    await writeFile(this.path(job.id, 'job.json'), JSON.stringify(job));
  }
  async create(sourceUrl: string, quality: number, targetFormat: 'original' | 'mp3' = 'mp3') {
    if (this.jobs.size >= 30)
      throw new Error('Hay demasiados trabajos pendientes; espera o elimina trabajos anteriores.');
    const resolvedSource = resolveAudioSource(sourceUrl, this.authorizedSources);
    const youtubeId = youtubeVideoId(resolvedSource);
    if (youtubeId) {
      if (!youtubeDownloadsEnabled())
        throw new Error(
          'Las descargas de YouTube no están habilitadas en el servidor. Configura yt-dlp y ENABLE_YOUTUBE_DOWNLOADS.',
        );
    } else await approvedSource(resolvedSource, this.hosts);
    const job: Job = {
      id: randomUUID(),
      sourceUrl: resolvedSource,
      quality,
      status: 'queued',
      createdAt: Date.now(),
      targetFormat,
      youtubeId: youtubeId || undefined,
    };
    await this.save(job);
    this.jobs.set(job.id, job);
    setImmediate(() => void this.process());
    return job;
  }
  async process() {
    if (this.active || this.closed) return;
    const job = [...this.jobs.values()].find((j) => j.status === 'queued');
    if (!job) return;
    this.active = job.id;
    this.controller = new AbortController();
    job.status = 'processing';
    let source = this.path(job.id, 'source');
    try {
      await this.save(job);
      if (job.youtubeId) {
        const result = await downloadYoutubeAudio(
          job.youtubeId,
          join(this.dir, job.id),
          this.controller.signal,
          (child) => (this.child = child),
        );
        source = result.path;
        job.title = result.title;
        job.artist = result.artist;
      } else await this.download(job, source, this.controller.signal);
      if ((job.status as string) === 'cancelled') return;
      if (job.targetFormat === 'original') {
        const metadata = await parseFile(source);
        if (!metadata.format.duration || metadata.format.duration > 7200)
          throw new Error('El archivo debe contener audio de hasta dos horas.');
        const container = metadata.format.container || '';
        const format = /^(M4A|isom|mp4|MPEG-4|QuickTime)/i.test(container)
          ? ['m4a', 'audio/mp4']
          : /WAVE/i.test(container)
            ? ['wav', 'audio/wav']
            : /FLAC/i.test(container)
              ? ['flac', 'audio/flac']
              : /Ogg/i.test(container)
                ? ['ogg', 'audio/ogg']
                : /ADTS/i.test(container)
                  ? ['aac', 'audio/aac']
                  : /Matroska|WebM/i.test(container)
                    ? ['webm', 'audio/webm']
                    : /MPEG|MP3/i.test(container)
                      ? ['mp3', 'audio/mpeg']
                      : null;
        if (!format)
          throw new Error(
            'Este contenedor no admite conservación directa. Selecciona conversión a MP3.',
          );
        job.fileName = `audio.${format[0]}`;
        job.mimeType = format[1];
        if ((job.status as string) === 'cancelled') return;
        await rename(source, this.output(job));
      } else {
        job.fileName = 'audio.mp3';
        job.mimeType = 'audio/mpeg';
        await convertFile(source, this.output(job), job.quality, (p) => (this.child = p));
      }
      if ((job.status as string) === 'cancelled') return;
      const output = await stat(this.output(job));
      if (output.size < 100) throw new Error('La conversión devolvió un archivo vacío.');
      job.status = 'completed';
    } catch (err) {
      if ((job.status as string) !== 'cancelled') {
        job.status = 'failed';
        job.error = err instanceof Error ? err.message : 'Fallo al procesar la importación.';
      }
    } finally {
      const leftoverSources = (await readdir(join(this.dir, job.id)).catch(() => [])).filter(
        (name) => /^youtube-source\.[a-zA-Z0-9.]+$/.test(name),
      );
      const cleanup = await Promise.allSettled([
        rm(source, { force: true }),
        ...leftoverSources.map((name) => rm(this.path(job.id, name), { force: true })),
        ...(job.status !== 'completed' ? [rm(this.output(job), { force: true })] : []),
      ]);
      if (cleanup.some((result) => result.status === 'rejected')) {
        job.status = 'failed';
        job.error =
          'No se pudieron limpiar los archivos temporales. Revisa el almacenamiento del servidor.';
      }
      try {
        await this.save(job);
      } catch {
        job.status = 'failed';
        job.error = 'No se pudo guardar el estado del trabajo. Revisa el espacio del servidor.';
      }
      this.active = undefined;
      this.child = undefined;
      this.controller = undefined;
      setImmediate(() => void this.process());
    }
  }
  async download(job: Job, path: string, signal: AbortSignal) {
    const { url, address, family } = await approvedSource(job.sourceUrl, this.hosts);
    await new Promise<void>((resolve, reject) => {
      const req = request(
        url,
        {
          method: 'GET',
          signal,
          timeout: 60000,
          // Pin one validated address rather than Node's automatic multi-address lookup.
          ...{ autoSelectFamily: false },
          family,
          lookup: (_hostname, _options, callback) => callback(null, address, family),
          headers: {
            'User-Agent': 'DevnifyMusicImport/1.0',
            Accept: 'audio/*,video/mp4,application/octet-stream',
          },
        },
        (res) => {
          if (res.statusCode !== 200) {
            res.resume();
            reject(
              new Error(
                `El origen respondió HTTP ${res.statusCode}. Los redireccionamientos no están permitidos.`,
              ),
            );
            return;
          }
          const content = res.headers['content-type']?.split(';')[0] || '';
          if (
            !content.startsWith('audio/') &&
            !['video/mp4', 'video/webm', 'application/octet-stream'].includes(content)
          ) {
            res.resume();
            reject(new Error('La fuente no devuelve un archivo de audio compatible.'));
            return;
          }
          let received = 0;
          const limit = new Transform({
            transform(chunk, _encoding, callback) {
              received += chunk.length;
              callback(
                received > 200 * 1024 * 1024 ? new Error('La fuente supera 200 MB.') : null,
                chunk,
              );
            },
          });
          void pipeline(res, limit, createWriteStream(path), { signal }).then(resolve, reject);
        },
      );
      req.on('timeout', () => req.destroy(new Error('El origen agotó el tiempo de espera.')));
      req.on('error', reject);
      req.end();
    });
  }
  async cancel(id: string) {
    const job = this.jobs.get(id);
    if (!job) return;
    if (this.active === id) {
      job.status = 'cancelled';
      this.controller?.abort();
      this.child?.kill('SIGKILL');
      await this.save(job);
    } else {
      job.status = 'cancelled';
      await this.save(job);
      await rm(this.output(job), { force: true });
    }
    return job;
  }
  async cleanup() {
    for (const job of this.jobs.values())
      if (job.id !== this.active && Date.now() - job.createdAt > 3600000) {
        await rm(join(this.dir, job.id), { force: true, recursive: true });
        this.jobs.delete(job.id);
      }
  }
  async close() {
    this.closed = true;
    clearInterval(this.timer);
    if (this.active) await this.cancel(this.active);
  }
}
