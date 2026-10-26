import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const rate = 16000,
  frames = rate * 4;
const b = Buffer.alloc(44 + frames * 2);
b.write('RIFF');
b.writeUInt32LE(36 + frames * 2, 4);
b.write('WAVE', 8);
b.write('fmt ', 12);
b.writeUInt32LE(16, 16);
b.writeUInt16LE(1, 20);
b.writeUInt16LE(1, 22);
b.writeUInt32LE(rate, 24);
b.writeUInt32LE(rate * 2, 28);
b.writeUInt16LE(2, 32);
b.writeUInt16LE(16, 34);
b.write('data', 36);
b.writeUInt32LE(frames * 2, 40);
for (let i = 0; i < frames; i++)
  b.writeInt16LE(Math.round(Math.sin((i / rate) * 440 * Math.PI * 2) * 3000), 44 + i * 2);
await mkdir('e2e/fixtures', { recursive: true });
await writeFile('e2e/fixtures/test.wav', b);
const ffmpeg = process.argv[2] || 'ffmpeg';
const result = spawnSync(
  ffmpeg,
  [
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    'e2e/fixtures/test.wav',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '128k',
    '-y',
    'e2e/fixtures/test.mp3',
  ],
  { stdio: 'inherit', windowsHide: true },
);
if (result.status !== 0) throw new Error('FFmpeg no pudo generar la prueba MP3.');
