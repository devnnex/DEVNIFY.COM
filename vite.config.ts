import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { buildMp3Worker } from './scripts/mp3-worker.mjs';
export default defineConfig({
  base: './',
  plugins: [
    react(),
    {
      name: 'devnify-development-entry',
      resolveId(id) {
        if (id === 'virtual:devnify-mp3-worker') return '\0devnify-mp3-worker';
      },
      async load(id) {
        if (id === '\0devnify-mp3-worker')
          return `export default ${JSON.stringify(await buildMp3Worker())}`;
      },
      configureServer(server) {
        server.middlewares.use((request, _response, next) => {
          if (request.url === '/' || request.url?.split('?')[0] === '/index.html')
            request.url = '/app.html';
          next();
        });
      },
    },
  ],
});
