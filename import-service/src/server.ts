import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { timingSafeEqual, createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { JobManager, ffmpegPath } from './jobs.js';
import { loadAuthorizedAudioSources } from './sources.js';
import { youtubeDownloadsEnabled, youtubeToolAvailable } from './youtube.js';
export async function buildServer() {
  const token = process.env.IMPORT_TOKEN || '';
  if (token.length < 32) throw new Error('Configura IMPORT_TOKEN con al menos 32 caracteres.');
  const origins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const allowFileOrigin = process.env.ALLOW_FILE_ORIGIN === 'true';
  if (allowFileOrigin && !origins.includes('null')) origins.push('null');
  if (!allowFileOrigin && origins.includes('null'))
    throw new Error(
      'Para permitir el origen de archivo local usa explícitamente ALLOW_FILE_ORIGIN=true.',
    );
  if (!origins.length) throw new Error('Configura ALLOWED_ORIGINS.');
  const manager = new JobManager(
    resolve(process.env.DATA_DIR || 'data'),
    (process.env.ALLOWED_SOURCE_HOSTS || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
    await loadAuthorizedAudioSources(process.env.AUTHORIZED_YOUTUBE_AUDIO_FILE),
  );
  await manager.init();
  const app = Fastify({
    bodyLimit: 8192,
    logger: {
      level: 'info',
      redact: ['req.headers.authorization', 'body.sourceUrl'],
    },
  });
  await app.register(cors, {
    origin: origins,
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type'],
  });
  await app.register(rateLimit, { max: 180, timeWindow: '1 minute' });
  const expected = createHash('sha256').update(`Bearer ${token}`).digest();
  app.addHook('preHandler', async (req, reply) => {
    const incoming = createHash('sha256')
      .update(req.headers.authorization || '')
      .digest();
    if (!timingSafeEqual(expected, incoming))
      return reply.code(401).send({ message: 'Token de acceso no válido.' });
    if (req.headers.origin && !origins.includes(req.headers.origin))
      return reply.code(403).send({ message: 'Origen no permitido.' });
  });
  app.get('/health', async () => ({
    status: 'ok',
    capabilities: {
      original: true,
      fileOrigin: allowFileOrigin,
      authorizedAudioSources: true,
      youtubeEnabled: youtubeDownloadsEnabled(),
      ytDlp: await youtubeToolAvailable(),
    },
    sourceHosts: (process.env.ALLOWED_SOURCE_HOSTS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    ffmpeg: await new Promise<boolean>((r) => {
      const p = spawn(ffmpegPath(), ['-version'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      p.on('error', () => r(false));
      p.on('exit', (code) => r(code === 0));
    }),
  }));
  app.post<{
    Body: {
      sourceUrl: string;
      targetFormat: 'original' | 'mp3';
      quality: number;
      authorizationConfirmed: boolean;
    };
  }>(
    '/api/imports',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['sourceUrl', 'targetFormat', 'quality', 'authorizationConfirmed'],
          properties: {
            sourceUrl: { type: 'string', maxLength: 2048 },
            targetFormat: { enum: ['mp3', 'original'] },
            quality: { type: 'integer', enum: [128, 192, 256, 320] },
            authorizationConfirmed: { const: true },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        const job = await manager.create(
          req.body.sourceUrl,
          req.body.quality,
          req.body.targetFormat,
        );
        return reply.code(202).send({ jobId: job.id, status: job.status });
      } catch (err) {
        return reply.code(400).send({
          message: err instanceof Error ? err.message : 'Fuente no disponible.',
        });
      }
    },
  );
  app.get<{ Params: { id: string } }>('/api/imports/:id', async (req, reply) => {
    const job = manager.jobs.get(req.params.id);
    if (!job) return reply.code(404).send({ message: 'Trabajo no encontrado o expirado.' });
    return {
      jobId: job.id,
      status: job.status,
      error: job.error,
      title: job.title,
      artist: job.artist,
    };
  });
  app.get<{ Params: { id: string } }>('/api/imports/:id/file', async (req, reply) => {
    const job = manager.jobs.get(req.params.id);
    if (!job) return reply.code(404).send({ message: 'Trabajo no encontrado.' });
    if (job.status !== 'completed')
      return reply.code(409).send({ message: 'El audio todavía no está disponible.' });
    return reply
      .header('Cache-Control', 'no-store')
      .header('Content-Disposition', `attachment; filename="${job.fileName || 'audio.mp3'}"`)
      .type(job.mimeType || 'audio/mpeg')
      .send(createReadStream(manager.output(job)));
  });
  app.delete<{ Params: { id: string } }>('/api/imports/:id', async (req, reply) => {
    const job = await manager.cancel(req.params.id);
    if (!job) return reply.code(404).send({ message: 'Trabajo no encontrado.' });
    return { jobId: job.id, status: job.status };
  });
  app.addHook('onClose', () => manager.close());
  return app;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const app = await buildServer();
  await app.listen({
    port: Number(process.env.PORT) || 3001,
    host: process.env.HOST || '127.0.0.1',
  });
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => void app.close());
}
