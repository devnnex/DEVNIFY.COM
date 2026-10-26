import { build } from 'esbuild';
export async function buildMp3Worker() {
  const result = await build({
    entryPoints: ['src/workers/mp3.worker.ts'],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    minify: true,
  });
  return result.outputFiles[0].text;
}
