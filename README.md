# Devnify

Reproductor musical personal, instalable y offline para GitHub Pages. React, TypeScript estricto, Vite, Dexie, Web Crypto, un único motor HTMLAudioElement, Web Audio y Workbox. La biblioteca empieza vacía: no contiene catálogo, tendencias ni escuchas ficticias.

[Captura móvil](docs/screenshots/inicio-movil.png) · [Captura de escritorio](docs/screenshots/inicio-escritorio.png) · [Resultados de validación](VALIDACION.md)

[Configurar importaciones y resolver fallos de conexión](docs/IMPORTACIONES.md): detección automática de YouTube, servicio propio, CORS, uso desde archivo local y conservación del formato original.

[Convertir vídeo a MP3 sin servidor](docs/CONVERSION-LOCAL.md): archivos del dispositivo y URLs directas compatibles, con guardado en Favoritos/playlists.

[Reproducción con pantalla bloqueada y actualizaciones del PWA](docs/REPRODUCCION-SEGUNDO-PLANO.md): preparación de la siguiente pista, controles de audífonos y comprobación en el teléfono.

[Activar el motor de descarga de YouTube](docs/DESCARGA-YOUTUBE.md): yt-dlp + FFmpeg, catálogo de fuentes autorizadas y conexión con Devnify. Requiere servidor separado; no está desplegado automáticamente.

## Ejecutar en este equipo

**Abre `index.html` con doble clic en Chrome o Edge.** La aplicación inicia desde ese archivo, sin terminal, CMD, instalación de Node ni servidor local. El HTML entregado incluye JavaScript, estilos, logo e ilustración; no depende de CDN ni de archivos externos para cargar la interfaz.

También puedes abrir directamente `dist/index.html`, o copiar únicamente el `index.html` a otra carpeta. La biblioteca depende del almacenamiento del navegador; conserva la ubicación del archivo y exporta respaldos antes de moverlo. La apertura `file://` se verificó en Chromium; otros navegadores pueden imponer restricciones adicionales al almacenamiento.

La **instalación como PWA** y sus actualizaciones mediante service worker funcionan cuando lo publicas por HTTPS. Al abrir el archivo local se utiliza la versión autocontenida sin intentar registrar un service worker. Las importaciones externas y YouTube siguen requiriendo conexión y los permisos del origen.

Los comandos siguientes son únicamente para desarrollar o regenerar la entrega. Instala Node.js 22.22 o posterior y ejecuta:

```sh
npm install
npm run dev
```

Abre la URL que muestra Vite para desarrollar. Para regenerar el HTML y probar la versión publicada de la PWA:

```sh
npm run build
npm run preview
```

`npm run build` compila el mismo código fuente en un `index.html` autocontenido, actualiza la entrega de la raíz y genera `dist/` para publicación. `app.html` es la plantilla de desarrollo; `index.html` es el archivo ejecutable generado. Los scripts `.cmd` y `.ps1` de arranque fueron retirados.

## Funciones

- Cuentas locales múltiples, selector de perfiles, avatar, sesiones recordadas opcionales, cambio de contraseña y eliminación confirmada por perfil.
- Recuperación desde una sesión abierta: **Ajustes → Olvidé mi contraseña** permite confirmar el usuario y establecer una nueva clave sin recordar la anterior. Conserva el mismo perfil y toda su biblioteca. La sesión abierta autoriza este restablecimiento; no es una verificación de identidad por correo ni una recuperación desde la pantalla de acceso.
- Verificadores PBKDF2-SHA256 con salt aleatorio y 600 000 iteraciones. No se guardan contraseñas en texto plano. Las cuentas separan los datos en la aplicación; no cifran la base completa ni sustituyen al acceso físico seguro al dispositivo.
- Importación múltiple de archivos y arrastrar/soltar. Lectura de metadatos, duración, portada, álbum, género, año y bitrate mediante `music-metadata`. Los Blobs se guardan en IndexedDB.
- Conversión local de vídeo/audio a MP3: **Añadir música → Vídeo a MP3**, seleccionar Favoritos/playlists y elegir archivo. El decodificador del navegador extrae el audio y LAME lo codifica en un Web Worker; no sube el vídeo ni necesita servidor, Internet o CMD. Admite archivos compatibles con el navegador de hasta 100 MB y 20 minutos, mono/estéreo; probado con MP4 H.264/AAC. Bitrates de 128/192/256/320 kbps. No obtiene el vídeo desde un enlace de YouTube.
- URLs HTTPS con CORS, validación del contenido, límite de tamaño, progreso según bytes reales, cancelación y reintento desde el formulario. El servidor auxiliar permite convertir fuentes expresamente autorizadas por su operador.
- Descarga de audio mediante URL, con destino visible en Favoritos/playlists. El servicio incorpora yt-dlp + FFmpeg para vídeos con permiso de descarga habilitados por su administrador. Se guarda el archivo en Devnify; no hay reproducción embebida de YouTube.
- Playlists locales con descripción, portada optimizada con recorte central y vista previa, múltiples asignaciones durante la importación, duplicación, edición, borrado y orden manual con arrastrar/soltar o botones accesibles. Orden por título, artista, duración y fecha.
- Reproductor completo y mini reproductor sincronizados: play, pausa, detener, seek, anterior/siguiente, shuffle, repeat off/all/one, volumen, mute, velocidad, cola, reproducir después, reordenación y temporizador.
- Ecualizador de cinco bandas y presets Flat, Bass Boost, Pop, Rock, Classical y Vocal en dispositivos compatibles. Un único grafo y margen de ganancia para evitar saturación por los presets. En iPhone/iPad se utiliza salida nativa y el ecualizador queda desactivado para evitar interrupciones de Web Audio al bloquear la pantalla.
- Media Session con metadatos y controles de pantalla bloqueada y audífonos cuando el navegador los admite. La siguiente pista se prepara durante la reproducción para iniciar el cambio sin esperar a IndexedDB. Restauración de pista, cola y posición sin autoplay.
- Favoritos, búsqueda sin acentos, álbumes, artistas, recientes, más escuchadas e historial real por perfil. Listas paginadas a 75 pistas para limitar el DOM.
- Borrado independiente del archivo offline o de la canción completa. Al importar de nuevo el mismo audio, se recupera el archivo conservando metadatos, favoritos y relaciones.
- Duplicados detectados mediante SHA-256 por perfil; una canción en varias playlists no duplica el audio.
- Respaldo ZIP portable con audio, metadatos, imágenes, playlists, favoritos, historial y preferencias. Cifrado AES-GCM opcional con contraseña y PBKDF2. Verificación SHA-256 antes de una restauración transaccional que combina datos y evita duplicar audio.
- PWA con caché del shell, recursos locales, manifest, iconos y búsqueda periódica de actualizaciones. Se aplican automáticamente con la app visible y la reproducción pausada, fuera de formularios y diálogos; también existe el botón Actualizar. No se cachean respuestas de servicios privados ni audio remoto indiscriminadamente.
- Almacenamiento estimado, solicitud de persistencia, estados de error y cuotas. Navegación mediante hash compatible con subdirectorios.

Las categorías son personales: **Recién añadidas** significa últimos siete días; **En rotación** y **Más escuchadas** utilizan reproducciones de tu colección, sin afirmar tendencias globales. **Descargadas** contiene solo archivos disponibles en el dispositivo. Una escucha se registra tras 30 segundos reales o la mitad de la pista, lo que ocurra primero; hacer seek no suma tiempo escuchado.

## Logos e iconos

- Interior: `public/assets/brand-logo.png` es el PNG lavanda original proporcionado por el usuario. Se usa en cabeceras, acceso y splash.
- Exterior de instalación: `public/icons/` contiene PNG de 192/512, maskable 512 y Apple 180, vinculados al manifest. **La primera imagen neón del chat no llegó como archivo accesible al entorno. Los iconos exteriores actuales son provisionales, recreados en SVG, y no deben confundirse con el original exacto.**

Para sustituir únicamente los iconos exteriores por la primera imagen original:

```sh
node scripts/icons.mjs "ruta/al/icono-exterior-original.png"
npm run build
```

El PNG interior se conserva. El favicon se incrusta desde `public/icons/icon-192.png` al compilar. Regenera el build después de cambiar los iconos.

## Publicar en GitHub Pages

1. Sube el contenido de esta carpeta a tu repositorio, incluyendo los dos `package-lock.json`, `public/`, `src/`, `e2e/fixtures/test.mp3` y `.github/workflows/`. No subas `node_modules`, `.tools`, `.env`, datos ni secretos.
2. Usa la rama `main` o ajusta las ramas de los workflows.
3. En **Settings → Pages → Source**, selecciona **GitHub Actions**.
4. El workflow `Deploy GitHub Pages` instala dependencias, verifica TypeScript, lint, unit tests, build y E2E, y publica `dist/`.
5. Abre `https://USUARIO.github.io/REPOSITORIO/` o su `index.html`.

Los iconos relativos, `scope: './'`, `start_url: './index.html'` y el SW generado evitan asumir que la app está en la raíz del dominio. Las vistas usan `#library`, `#playlists`, etc. No hace falta editar el build. También se genera un manifest y SW junto al `index.html` de la raíz para quien publique directamente esa carpeta; sus iconos apuntan a `public/icons/`.

El servicio opcional no se ejecuta en GitHub Pages. Debe alojarse aparte mediante HTTPS; consulta [import-service/README.md](import-service/README.md). La publicación no se ejecutó desde este entorno: no hay repositorio remoto ni cuenta de GitHub configurados para este proyecto.

## Instalar y actualizar

En Chrome/Edge, utiliza **Instalar Devnify** o la opción del navegador. En Safari de iPhone/iPad, **Compartir → Añadir a pantalla de inicio**. La app muestra instrucciones si no recibe `beforeinstallprompt`; no informa de instalación completada sin intervención del navegador.

Espera a que aparezca el aviso de preparación offline antes de desconectarte. Los audios se sirven desde IndexedDB, no desde la caché del SW. Tras publicar una nueva compilación en la misma URL, la app comprueba actualizaciones al abrirse, recuperar el foco, volver a primer plano o recuperar conexión, y cada minuto mientras está visible. Las actualizaciones se aplican cuando la música está pausada y no hay formularios ni diálogos abiertos. Mientras escuchas, aparece **Actualizar** para aplicarlas manualmente pausando primero. Se guardan cola y posición antes de recargar y se conservan perfiles, canciones y playlists, sin reinstalar. Las imágenes internas y los módulos de lectura de audio se incluyen en el precaché.

## Respaldo y recuperación

En Ajustes, escribe una contraseña de al menos diez caracteres para cifrar el archivo, o deja el campo vacío para exportar ZIP sin cifrar. La contraseña de la cuenta y el token del servicio no se exportan. Guarda la contraseña del respaldo: no existe recuperación de una clave perdida.

Para restaurar, abre o crea un perfil, escribe la contraseña del respaldo si procede y elige el archivo. Se valida el formato, versión e integridad antes de mostrar el resumen y solicitar la restauración. No se sobrescribe la biblioteca completa. Los mismos audios se combinan por checksum; se preservan favoritos y se evitan playlists equivalentes. Un respaldo dañado no altera la biblioteca. Las pistas sin archivo offline conservan sus metadatos y relaciones en el respaldo.

IndexedDB no sincroniza equipos. Los respaldos son la vía portable de transferencia. El navegador puede borrar datos o denegar persistencia; exporta periódicamente. Las operaciones ZIP y cifrado trabajan en memoria: en móviles y bibliotecas grandes, la memoria disponible puede limitar el respaldo antes de la cuota de IndexedDB. Límite de entrada de respaldo: 1 GB; descomprimido: 2 GB. La importación individual limita cada audio a 500 MB, además de la cuota del dispositivo.

## Comandos y pruebas

```sh
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
npm run preview
npx playwright install chromium
npm run test:e2e
```

Las fixtures son ondas de prueba generadas en este proyecto, no canciones comerciales. `e2e/fixtures/test.mp3` es un MP3 físico codificado con FFmpeg. Para regenerarlo con FFmpeg disponible:

```sh
node scripts/fixtures.mjs /ruta/a/ffmpeg
```

Playwright usa dos servidores locales: preview en 4173 y un servidor estático de QA en 4174 para verificar `/aura/index.html`, scope y rutas bajo subdirectorio. Las capturas responsive se guardan en `test-results/` y las trazas se conservan solo si hay fallos. Véase [VALIDACION.md](VALIDACION.md) para la evidencia y los límites de verificación.

## Estructura

```text
index.html                  Aplicación autocontenida: abrir con doble clic
app.html                    Plantilla de desarrollo
scripts/build.mjs           Compilación autocontenida y generación de PWA
src/pages/Home.tsx           Inicio y descubrimiento personal
src/components/             Acceso, listas, formularios, ajustes y reproductor
src/services/db.ts           IndexedDB y migraciones de esquema v1/v2
src/services/auth.ts         Contraseñas y sesiones locales
src/services/imports.ts      Archivos, URLs, metadatos e imágenes
src/services/player.ts       Motor y estado único de audio
src/services/backups.ts      ZIP, cifrado, integridad y restauración
src/tests/                  Pruebas de dominio y persistencia
public/assets/              Logo interior e ilustración local
public/icons/               Iconos exteriores provisionales
import-service/             API opcional Fastify + FFmpeg + Docker
e2e/                        Pruebas de navegador y fixtures reales
.github/workflows/          CI y publicación de dist en Pages
```

## Compatibilidad y límites

Pruebas ejecutadas en Chromium de escritorio y viewports móviles emulados. No se ha verificado en dispositivos físicos iOS/Android, Firefox o Safari. Códecs, reproducción en segundo plano, Media Session, persistencia e instalación varían por navegador y sistema operativo. No se promete paridad entre ellos.

El flujo YouTube valida el ID y envía la descarga al servicio privado configurado. El administrador debe habilitar el motor y los IDs con los permisos requeridos. La disponibilidad, restricciones de acceso y cambios del proveedor pueden hacer fallar una descarga; no se promete acceso universal. No se utilizan cookies del usuario ni se intenta superar DRM, pagos o inicios de sesión. La lectura de metadatos de un vídeo no se presenta como descarga probada de su audio.

Las portadas se recortan automáticamente al centro y se muestran antes de guardar; esta versión no incluye un editor de recorte manual. La búsqueda y la biblioteca permanecen locales. Las fuentes directas y el servicio reciben las URLs solicitadas al descargar. La reproducción posterior utiliza el archivo local y no establece conexiones con YouTube.

## Diagnóstico

- **No hay audio**: prueba MP3, revisa volumen/mute y el mensaje del reproductor. Los formatos con soporte MIME pero códec interno incompatible pueden fallar al decodificar. Recupera archivos eliminados importando de nuevo el mismo audio.
- **URL bloqueada**: el servidor debe permitir CORS y devolver audio. Usa el archivo local o el servicio configurado y autorizado. Las páginas HTML no son archivos de audio.
- **Servicio desconectado**: verifica URL HTTPS, token, orígenes y dominios aprobados. El resto de la biblioteca funciona sin ese servicio.
- **No abre offline en una URL publicada**: espera al precaché y recarga al menos una vez. Comprueba que el navegador conserva los datos del sitio. El archivo local ya incluye los recursos de interfaz y no necesita precaché.
- **No aparece instalar**: utiliza el menú del navegador y HTTPS/localhost; la opción depende del navegador y puede no estar disponible si ya está instalada.
- **Sesión o biblioteca vacía en otro equipo/URL**: los datos pertenecen al origen y navegador. Restaura un respaldo. HTTP y HTTPS son orígenes distintos.
- **Datos borrados por el navegador**: crea un perfil y restaura un respaldo. No existe una copia externa automática.
