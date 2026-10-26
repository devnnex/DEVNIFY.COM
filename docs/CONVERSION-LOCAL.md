# Vídeo a MP3 sin servidor

Abre `index.html` y entra en **Añadir música → Vídeo a MP3**. Selecciona Favoritos y/o las playlists de destino, elige la calidad MP3 y abre un vídeo guardado en tu dispositivo. El audio se convierte y se guarda dentro de Devnify. No se sube el archivo ni se requiere terminal, conexión a Internet o servicio externo. El flujo también admite audio compatible para convertirlo a MP3.

El archivo debe poder decodificarse mediante Web Audio en ese navegador. Se probó un MP4 real con vídeo H.264 y audio AAC; otros contenedores y códecs dependen del navegador. Límite de entrada: 100 MB, audio mono/estéreo de hasta 20 minutos. La decodificación necesita memoria para todo el audio; un móvil con pocos recursos puede rechazar archivos grandes. La codificación se ejecuta en un Web Worker y puede cancelarse. Los porcentajes corresponden a las muestras codificadas, no a un temporizador.

En **URL de audio**, un enlace HTTPS directo a un archivo también puede convertirse aquí seleccionando MP3. El servidor del archivo debe permitir leerlo mediante CORS. Si ya devuelve MP3 se conserva para evitar recodificarlo. Cuando hay un servicio configurado y falla la descarga directa, ese servicio puede descargar y convertir el archivo.

Un enlace `youtu.be/...` apunta a una página de YouTube; no proporciona directamente los bytes del vídeo al conversor. Esta función **no descarga YouTube por sí sola**. Para importar desde esa URL, la integración de yt-dlp incluida en `import-service/` requiere ejecutarse aparte. No se ha desplegado ni activado un servidor al abrir el HTML.

La prueba `e2e/local-conversion.spec.ts` abre el HTML por `file://` con el navegador offline, convierte el MP4 binario de `e2e/fixtures/local-video.mp4`, comprueba las cabeceras y duración del MP3 guardado y su relación con Favoritos/playlist, recarga y reproduce. También rechaza un archivo corrupto sin guardar canciones y verifica la conversión de una URL directa mediante una respuesta de red controlada.

## Motor y licencia

La codificación usa **@breezystack/lamejs 1.2.7**, de Alex Zhukov y colaboradores, sin modificar su biblioteca, bajo LGPL-3.0. [LAME](https://lame.sourceforge.net/) · [Código del paquete](https://github.com/shijinyu/lamejs) · [Paquete exacto](https://www.npmjs.com/package/@breezystack/lamejs/v/1.2.7).

El aviso original y los textos de licencia están en `public/licenses/` y se incluyen en el HTML generado dentro de `template#devnify-third-party-notices`. El paquete y versión exactos están fijados en `package-lock.json`. Para reconstruir o sustituir el codificador, cambia la dependencia/importación de `src/workers/mp3.worker.ts`, ejecuta `npm install` y `npm run build`. `scripts/mp3-worker.mjs` genera el worker que se incorpora al HTML; se mantienen accesibles el código de integración y las instrucciones de recompilación.

Referencias técnicas: [decodeAudioData](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData) y [CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS).
