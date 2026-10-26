# Verificación ejecutada

Validaciones locales del 25 y 26 de octubre de 2026. La actualización del día 26 incluye recuperación de contraseña desde una sesión abierta y corrección de los campos que provocaban zoom al enfocarlos en móviles. El repositorio es `devnnex/DEVNIFY.COM`, rama `main`. No se acredita un servidor de descarga de producción.

| Comprobación | Resultado |
| --- | --- |
| TypeScript y ESLint | Correctos |
| Pruebas de dominio | 20 aprobadas el día 26: perfiles, recuperación desde sesión, biblioteca, respaldos e importación |
| Build | Correcto: HTML autocontenido de aproximadamente 1,89 MB en raíz y dist; manifiestos y service workers generados |
| Playwright Chromium | Suite completa: 18 aprobadas el día 26 sobre el nuevo build |
| Build del servicio opcional | Correcto |
| Pruebas del servicio con FFmpeg, yt-dlp y red habilitados | 11 aprobadas, ninguna omitida |
| Conversión local sin red | MP4 H.264/AAC físico → MP3 real → IndexedDB → recarga → reproducción |
| Integración con servicio real temporal | HTML local → API autenticada → fuente HTTPS CC0 → FFmpeg → guardado → reproducción offline |

## Campos móviles y zoom al enfocar

Los campos de texto, contraseñas, búsqueda, URLs, números, áreas de texto y selectores se muestran a 16 px cuando el viewport mide hasta 900 px o existe un puntero táctil (`any-pointer: coarse`). Esta segunda condición cubre pantallas táctiles en horizontal o de mayor tamaño. La regla se aplica después de los estilos específicos de cada formulario. No se cambia el tamaño de checkboxes, sliders ni selectores de archivos, y se conserva la posibilidad de ampliar manualmente la página.

Se inspeccionó el HTML compilado en Chromium con emulación táctil: acceso a 320, 390, 844, 1024 y 1366 px; registro, editor de playlist con textarea, importación por URL con opciones y servicio, ajustes, recuperación y búsqueda. Las fuentes computadas fueron de 16 px, sin desbordamiento horizontal y con escala de viewport 1 al enfocar los campos revisados. En escritorio de 1440 px sin pantalla táctil se conserva el tamaño anterior. Evidencia temporal: `test-results/input-focus-qa.json` y capturas de navegador.

El cambio responde al cálculo de zoom de [WebKit para iOS](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/API/ios/WKWebViewIOS.mm), que utiliza un tamaño estándar de 16 para el texto del campo enfocado. La emulación de Chromium no acredita el comportamiento del teclado nativo de un iPhone físico; ese límite se mantiene.

## Recuperación desde una sesión abierta

Se añadieron cuatro pruebas de dominio: restablecimiento desde una sesión temporal con conservación de datos, rechazo sin sesión o para otro perfil, validación del usuario y de la nueva contraseña, y cancelación del cambio si se cierra la sesión mientras se calcula el verificador. Se comprueba que se renuevan salt/verificador, que la contraseña anterior deja de funcionar y que no cambian las canciones, bytes de audio, playlists, favoritos, historial, preferencias, cola ni el otro perfil.

`e2e/password-recovery.spec.ts` abre el HTML por `file://`, sin red, en un viewport móvil. Registra un perfil sin sesión permanente, recarga la misma pestaña, importa un MP3 real a Favoritos y una playlist y abre **Ajustes → Olvidé mi contraseña**. Comprueba el rechazo de un usuario incorrecto y establece una nueva contraseña sin pedir la anterior. Recarga, cierra sesión, verifica que la clave anterior falla y entra con la nueva. La playlist y Favoritos conservan la canción y el audio se reproduce. Sin solicitudes HTTP ni errores JavaScript. La prueba de cambio normal de contraseña con clave anterior también pasó sobre el mismo build.

El restablecimiento confía en la sesión local que ya está abierta; no es una verificación de identidad por correo. Solo modifica las credenciales del perfil de esa sesión. Las pruebas usan almacenamiento aislado y no cambian el perfil real del usuario.

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
