# Descargar y añadir a Devnify

El flujo es **pegar URL → seleccionar Favoritos y/o playlists → Descargar y añadir**. La descarga termina antes de registrar éxito; el audio se guarda como Blob en IndexedDB y se reproduce offline desde Devnify. No hay reproducción embebida ni redirección para escuchar en YouTube.

## URL directa de audio

Un enlace HTTPS a MP3/M4A/WAV/FLAC/OGG compatible se intenta descargar directamente. Si el navegador no puede leerlo por CORS/red y hay conexión configurada, se reintenta mediante el servidor. Las respuestas HTTP 401/403 no se tratan como si fueran un simple fallo de CORS. «Original» conserva los bytes del audio; «MP3» convierte localmente si el archivo se puede descargar y decodificar. Un vídeo MP4/WebM compatible se convierte a MP3 para guardar solo el audio. Si se utiliza el servicio externo, este puede convertir mediante FFmpeg.

## Vídeo del dispositivo, sin servidor

**Añadir música → Vídeo a MP3** extrae y codifica el audio de un archivo local compatible, incluso offline al abrir el HTML con doble clic. También permite elegir Favoritos y playlists. No obtiene los bytes de un vídeo desde una página de YouTube. [Formatos, límites y motor local](CONVERSION-LOCAL.md).

La cabecera CORS la controla el servidor del archivo. Añadir `Access-Control-Allow-Origin` a la petición o usar `no-cors` en el navegador no permite leer un archivo bloqueado. No se utilizan proxies públicos. [Referencia MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS).

## URL de YouTube

Se integra **yt-dlp + FFmpeg** en el servicio de importación. Para usarlo hay que instalar y habilitar el motor, registrar los vídeos con permiso de descarga en el catálogo del administrador y conectar la API con Devnify. También se admite asociar el ID a un archivo original independiente autorizado.

La configuración completa está en [DESCARGA-YOUTUBE.md](DESCARGA-YOUTUBE.md). El enlace del chat `Tx9zMFodNtA` se reconoció y se obtuvieron sus metadatos reales; no se ha descargado su audio ni se ha habilitado automáticamente sin los permisos de descarga correspondientes.

## Conexión

Abre **Añadir música → URL de audio → Configurar** o **Ajustes → Music Import Service**, guarda la URL HTTPS y el token y comprueba la conexión. El diagnóstico muestra el estado de yt-dlp y FFmpeg.

La aplicación sigue abriendo con doble clic en `index.html`. El HTML no puede ejecutar procesos de servidor ni iniciar un servicio remoto: `import-service/` necesita un despliegue aparte. Para conectarte desde `file://`, el servidor debe habilitar `ALLOW_FILE_ORIGIN=true`; el token sigue siendo obligatorio porque el origen opaco `null` no identifica por sí solo este archivo.

Las descargas directas autorizadas se limitan a los dominios exactos de `ALLOWED_SOURCE_HOSTS`, sin comodines ni redirects. Para YouTube, los IDs habilitados se resuelven a URLs canónicas fijas. Ningún token se incrusta en el HTML.

## Segundo plano y offline

Una vez guardado el audio, se puede escuchar sin red ni conexión con el servidor. La reproducción usa un único elemento `<audio>` persistente y Media Session; no se pausa al cambiar de vista ni al recibir `visibilitychange`. Se publican título, artista, posición y acciones de reproducción/pausa, anterior/siguiente y seek al sistema.

Bloquear o apagar la **pantalla** puede mantener la reproducción en plataformas compatibles. Apagar completamente el **teléfono**, forzar el cierre o que el sistema termine la aplicación detiene el audio. La continuidad y el cambio de pistas con pantalla bloqueada deben verificarse en el teléfono y navegador reales; no se acreditan mediante emulación de escritorio. [Media Session](https://developer.mozilla.org/en-US/docs/Web/API/Media_Session_API).

## Evidencia

Las pruebas de navegador descargan audio binario de fixtures, lo añaden a Favoritos y una playlist y verifican persistencia y reproducción offline, fin de pista y acciones multimedia. El script opcional `scripts/verify-import-service.mjs` conecta el HTML local con un servidor temporal real, resuelve un ID sintético a una fixture CC0 de MDN, la descarga y convierte con FFmpeg, la guarda y la reproduce offline. No se presenta esa fixture como una extracción de YouTube.
