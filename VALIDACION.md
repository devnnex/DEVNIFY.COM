# Verificación ejecutada

Entrega local del 25 de octubre de 2026. No hay despliegue público ni servidor de descarga activo.

| Comprobación | Resultado |
| --- | --- |
| TypeScript y ESLint | Correctos |
| Pruebas de dominio | 16 aprobadas: perfiles, biblioteca, respaldos y estrategia de importación |
| Build | Correcto: HTML autocontenido de aproximadamente 1,89 MB en raíz y dist; manifiestos y service workers generados |
| Playwright Chromium | 17 pruebas aprobadas |
| Build del servicio opcional | Correcto |
| Pruebas del servicio con FFmpeg, yt-dlp y red habilitados | 11 aprobadas, ninguna omitida |
| Conversión local sin red | MP4 H.264/AAC físico → MP3 real → IndexedDB → recarga → reproducción |
| Integración con servicio real temporal | HTML local → API autenticada → fuente HTTPS CC0 → FFmpeg → guardado → reproducción offline |

## Conversión sin servidor

`e2e/local-conversion.spec.ts` verifica tres casos:

1. Abre el `index.html` de la raíz por `file://`, con el contexto del navegador offline. Registra un perfil, selecciona Favoritos y una playlist nueva y convierte `e2e/fixtures/local-video.mp4`. El fixture es un vídeo MP4 real con imagen H.264 y una señal sonora AAC de tres segundos, generado con FFmpeg. Comprueba los registros y bytes guardados en IndexedDB, tipo `audio/mpeg`, códec MPEG y duración del MP3. Recarga y comprueba que el reproductor avanza. Sin solicitudes HTTP ni errores JavaScript.
2. Rechaza un vídeo corrupto con un error visible y sin guardar canciones.
3. Descarga un MP4 por una URL directa controlada por el test y lo convierte localmente sin servicio configurado. Se comprueban los bytes y duración del MP3 guardado. La respuesta de red es una fixture; la conversión y almacenamiento son reales.

El codificador LAME se incorpora al HTML y se ejecuta en un Web Worker de Blob. No necesita descargar WASM, código ni bibliotecas al iniciar. Las licencias y avisos se incluyen en el HTML y en `public/licenses/`. Detalles en [CONVERSION-LOCAL.md](docs/CONVERSION-LOCAL.md).

## Otras pruebas de navegador

Las catorce pruebas restantes verifican registro y contraseñas, biblioteca, importación y duplicados de audio real, favoritos, playlists y portadas, cola y controles del reproductor, velocidad, ecualizador, temporizador, respaldo y recuperación, separación de perfiles y persistencia offline. Incluyen:

- Apertura directa tanto de `index.html` como de `dist/index.html`, sin red, registro de service worker ni dependencias externas para cargar la aplicación.
- Viewports de 320 a 1440 píxeles sin desbordamiento y navegación móvil.
- Selector premium de imágenes con vista previa, cambio y eliminación, y guardado del avatar.
- URL directa con HTTP fallido, contenido inválido y audio válido; reintento mediante un servicio configurado tras un fallo de red. Esas respuestas se controlan en el navegador.
- Reconocimiento del enlace de YouTube facilitado, destinos visibles y ausencia de iframe o reproductor externo. Sin servicio, se muestra un error y no se presenta la canción como descargada.
- Descarga por URL a Favoritos y playlist, recarga con el contexto offline, reproducción, fin real de pista y avance de cola. Se invocan los handlers Media Session que registra la aplicación para probar seek, pausa y play. Un evento de visibilidad no detiene el audio.
- Publicación estática simulada bajo `/aura/` para comprobar compatibilidad con subdirectorios, manifiesto relativo y navegación offline mediante service worker. El nombre comercial continúa siendo Devnify.

## Dominio y servicio opcional

Las dieciséis pruebas de dominio usan `fake-indexeddb` para ejecutar los servicios reales de la biblioteca sobre una implementación de prueba de IndexedDB. Cubren PBKDF2, usuarios y cambio de contraseña, importación de WAV binario, checksums y duplicados, aislamiento por propietario, relaciones de playlists, favoritos y borrado, eliminación del archivo offline y recuperación al reimportar. También cubren respaldos ZIP cifrados, contraseña incorrecta, restauración y combinación sin duplicados, archivos corruptos y pistas sin descarga. La estrategia de red no envía el token al origen; no trata HTTP 403 como CORS ni reintenta después de cancelar.

Las once pruebas del servicio verifican restricciones de red y de fuentes, token, CORS y acceso desde origen `null`, validación de trabajos y catálogos, FFmpeg real WAV → MP3 y dos descargas HTTPS reales del archivo CC0 de MDN: conservación byte por byte y conversión/entrega del MP3. Verifican además argumentos y validación de resultados de yt-dlp; el ejecutable oficial real acepta los argumentos y rechaza una URL sin extractor. Los escenarios de metadatos/archivo de la prueba unitaria del extractor usan un ejecutor inyectado, no una descarga real de YouTube.

Se ejecutó también `scripts/verify-import-service.mjs` contra una API temporal real, token aleatorio y el HTML abierto por `file://`. Un ID sintético se resuelve al archivo independiente CC0 de MDN; el servicio lo descarga y convierte mediante FFmpeg, y Devnify lo guarda en Favoritos y una playlist y lo reproduce offline. No hay interceptación de red ni simulación de FFmpeg en ese script. El servidor temporal se cerró al terminar.

Se verificó la versión oficial de yt-dlp y se consultaron los metadatos reales del enlace `Tx9zMFodNtA`. **No se ha descargado el audio de ese vídeo ni se ha habilitado en el catálogo.** No se acredita una extracción de YouTube mediante una consulta de metadatos o una fixture CC0.

## Límites de la validación

- No se probaron teléfonos físicos, instalación PWA por el usuario ni continuidad con la pantalla bloqueada en iOS/Android. Los controles multimedia se verificaron en Chromium de escritorio. Apagar completamente el teléfono detiene el audio.
- No se ejecutaron Safari/Firefox ni una revisión completa con lectores de pantalla. Otros códecs de vídeo dependen del decodificador del navegador; no se promete compatibilidad universal.
- No se probaron bibliotecas de gigabytes, disco lleno físico, agotamiento real de memoria/cuota ni cierres forzados. El conversor tiene límites de tamaño/duración, cancelación y errores; un móvil con pocos recursos puede no procesar archivos grandes.
- El Dockerfile está preparado, pero no se construyó ni ejecutó un contenedor. El servicio se compiló y probó con Node, FFmpeg y el ejecutable oficial de yt-dlp de este equipo.
- No hay API pública desplegada. Abrir el HTML no inicia yt-dlp ni un proceso de servidor. Un enlace de YouTube requiere ese servicio; la conversión local trabaja sobre archivos ya disponibles.
- El logo interior es el PNG original recibido. El icono exterior de instalación sigue siendo provisional: el archivo original de la primera imagen no estaba disponible en el entorno. `scripts/icons.mjs` permite reemplazarlo.
- No hay URL pública de GitHub Pages verificada. Las capturas en `docs/screenshots/` y `test-results/` son estados reales de la interfaz de prueba; no representan un catálogo musical comercial.
