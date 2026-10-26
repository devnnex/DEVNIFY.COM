import { build } from 'esbuild';
import { generateSW } from 'workbox-build';
import { readFile, writeFile, mkdir, cp, readdir, rm } from 'node:fs/promises';
import { resolve, extname, sep, join } from 'node:path';
import { createHash } from 'node:crypto';
import { buildMp3Worker } from './mp3-worker.mjs';

const workspace = process.cwd();
const mp3Worker = await buildMp3Worker();
const mime = { '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' };
const asset = async (path) =>
  `data:${mime[extname(path)]};base64,${(await readFile(resolve('public', path))).toString('base64')}`;
const result = await build({
  entryPoints: ['src/main.tsx'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome100', 'edge100', 'firefox115', 'safari16'],
  minify: true,
  write: false,
  outfile: 'devnify.js',
  jsx: 'automatic',
  define: {
    'process.env.NODE_ENV': '"production"',
    'import.meta.env.DEV': 'false',
    'import.meta.env.PROD': 'true',
    'import.meta.env.BASE_URL': '"./"',
  },
  plugins: [
    {
      name: 'embedded-devnify-artwork',
      setup(builder) {
        builder.onResolve({ filter: /^virtual:devnify-mp3-worker$/ }, () => ({
          path: 'mp3-worker',
          namespace: 'devnify-worker',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'devnify-worker' }, () => ({
          contents: mp3Worker,
          loader: 'text',
        }));
        builder.onLoad({ filter: /\.[jt]sx?$/ }, async ({ path }) => {
          if (!path.startsWith(resolve('src') + sep)) return;
          let source = await readFile(path, 'utf8');
          const references = [...source.matchAll(/`\$\{import\.meta\.env\.BASE_URL\}([^`]+)`/g)];
          for (const reference of references)
            source = source.replaceAll(reference[0], JSON.stringify(await asset(reference[1])));
          return { contents: source, loader: extname(path).slice(1) };
        });
      },
    },
  ],
});

const script = result.outputFiles
  .find((file) => file.path.endsWith('.js'))
  .text.replace(/<\/script/gi, '<\\/script');
const css = result.outputFiles
  .find((file) => file.path.endsWith('.css'))
  .text.replace(/<\/style/gi, '<\\/style');
const hash = createHash('sha256').update(script).digest('base64');
const favicon = await asset('icons/icon-192.png');
const appleIcon = await asset('icons/apple-touch-icon.png');
const template = await readFile('app.html', 'utf8');
const licenseFiles = ['lamejs-NOTICE.txt', 'LGPL-3.0.txt', 'GPL-3.0.txt'];
const thirdPartyNotices = [
  'Devnify includes @breezystack/lamejs 1.2.7, by Alex Zhukov and contributors. License: LGPL-3.0.',
  'https://lame.sourceforge.net/ · Source: https://github.com/shijinyu/lamejs · npm: @breezystack/lamejs@1.2.7',
  'The library is unmodified. See scripts/mp3-worker.mjs and src/workers/mp3.worker.ts to rebuild or replace the encoder.',
  ...(await Promise.all(
    licenseFiles.map((file) => readFile(join('public/licenses', file), 'utf8')),
  )),
].join('\n\n');
const escapeHtml = (text) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
let html = template
  .replace("script-src 'self'", `script-src 'self' 'sha256-${hash}'`)
  .replace('href="%BASE_URL%icons/icon.svg"', `href="${favicon}"`)
  .replace('href="%BASE_URL%icons/apple-touch-icon.png"', `href="${appleIcon}"`)
  .replace('</head>', () => `<style>${css}</style></head>`)
  .replace(
    '</body>',
    () =>
      `<template id="devnify-third-party-notices">${escapeHtml(thirdPartyNotices)}</template></body>`,
  )
  .replace(
    '<script type="module" src="/src/main.tsx"></script>',
    () => `<script>${script}</script>`,
  );
html =
  '<!-- Generated from src/ and app.html by npm run build. Opens directly without a server. -->\n' +
  html;

const manifest = (prefix) => ({
  name: 'Devnify',
  short_name: 'Devnify',
  description: 'Tu música, tu espacio. Reproductor personal offline.',
  theme_color: '#0d0c12',
  background_color: '#0d0c12',
  display: 'standalone',
  start_url: './index.html',
  scope: './',
  lang: 'es',
  icons: [
    { src: `${prefix}icon-192.png`, sizes: '192x192', type: 'image/png' },
    { src: `${prefix}icon-512.png`, sizes: '512x512', type: 'image/png' },
    { src: `${prefix}maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
});
await mkdir('dist', { recursive: true });
// Only previously generated production files in dist are replaced.
for (const file of await readdir('dist')) {
  const target = resolve('dist', file);
  if (!target.startsWith(resolve(workspace, 'dist') + sep))
    throw new Error('Output path outside dist.');
  await rm(target, { recursive: true, force: true });
}
await cp('public', 'dist', { recursive: true });
for (const [directory, prefix] of [
  ['.', 'public/icons/'],
  ['dist', 'icons/'],
]) {
  await writeFile(join(directory, 'index.html'), html);
  await writeFile(
    join(directory, 'manifest.webmanifest'),
    JSON.stringify(manifest(prefix), null, 2),
  );
  const generated = await generateSW({
    globDirectory: directory,
    globPatterns:
      directory === '.'
        ? ['index.html', 'manifest.webmanifest', 'public/icons/*.png']
        : ['index.html', 'manifest.webmanifest', 'icons/*.png'],
    swDest: join(directory, 'sw.js'),
    navigateFallback: 'index.html',
    cleanupOutdatedCaches: true,
    clientsClaim: true,
    skipWaiting: false,
    maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
    sourcemap: false,
  });
  for (const warning of generated.warnings) console.warn(warning);
}
console.log(
  `Devnify: index.html autocontenido (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB) y dist/ preparados.`,
);
