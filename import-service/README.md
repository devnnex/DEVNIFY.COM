# Devnify Music Import Service

API de trabajos para descargar archivos de audio desde fuentes HTTPS autorizadas, conservar el original o convertirlos a MP3 real con FFmpeg. Incluye un motor opcional de yt-dlp para vídeos de YouTube con permisos de descarga registrados por el administrador. El frontend y la reproducción posterior siguen funcionando sin el servicio. No se utilizan proxies públicos.

Consulta [la configuración de YouTube](../docs/DESCARGA-YOUTUBE.md) para habilitar yt-dlp y los IDs autorizados. El Dockerfile instala yt-dlp con una versión fijada; actualízala periódicamente desde la fuente oficial.

## Configuración

Requiere Node.js 22.22+, FFmpeg con `libmp3lame` y almacenamiento temporal. Copia `.env.example` a `.env`, completa las variables y mantén el archivo fuera de Git.

- `IMPORT_TOKEN`: secreto aleatorio de al menos 32 caracteres. Es para un despliegue personal o grupo de confianza; quien conozca el token puede consultar todos los trabajos de ese servicio. Para un servicio multiusuario público se necesita identidad y autorización por trabajo adicionales.
- `ALLOWED_ORIGINS`: orígenes exactos separados por comas, por ejemplo `https://USUARIO.github.io`. El origen no incluye el nombre del repositorio.
- `ALLOW_FILE_ORIGIN`: `false` por defecto. Activa `true` únicamente para usar el servicio desde el `index.html` abierto por doble clic. Permite explícitamente el origen `null`, que no identifica el HTML por sí solo, y exige el token. No admite introducir `null` en `ALLOWED_ORIGINS` sin habilitar esta opción.
- `ALLOWED_SOURCE_HOSTS`: nombres de dominio exactos de archivos propios/licenciados cuya descarga permite el proveedor. Sin comodines. Vacío deshabilita importaciones. Una casilla del cliente no sustituye la revisión de derechos y términos por el operador.
- `AUTHORIZED_YOUTUBE_AUDIO_FILE`: catálogo JSON del administrador; cada ID tiene `extractFromYoutube: true` o `audioUrl`, y una `authorizationReference` de los permisos verificados.
- `ENABLE_YOUTUBE_DOWNLOADS`: `false` por defecto. `true` habilita el motor solo para las entradas `extractFromYoutube` autorizadas.
- `YTDLP_PATH`: ejecutable oficial yt-dlp; el contenedor configura `/opt/ytdlp/bin/yt-dlp`.
- `FFMPEG_PATH`: ejecutable FFmpeg, por defecto `ffmpeg`.
- `DATA_DIR`: carpeta de trabajos, por defecto `./data`.
- `HOST` y `PORT`: por defecto `127.0.0.1:3001`; el contenedor usa `0.0.0.0`.

```sh
npm ci
npm run build
node --env-file=.env dist/server.js
```

Para Docker, desde `import-service`:

```sh
docker build -t devnify-import .
docker run --rm --env-file .env -p 127.0.0.1:3001:3001 --memory=512m --cpus=1 --pids-limit=64 devnify-import
```

Expón el servicio mediante un reverse proxy HTTPS con límites de acceso. El Dockerfile usa un usuario sin privilegios e instala FFmpeg. Los archivos temporales no deben publicarse como archivos estáticos. Configura límites de disco del contenedor o del host; la cola es deliberadamente pequeña.

En **Devnify → Ajustes → Music Import Service**, guarda URL y token y comprueba la conexión. También puedes configurarla dentro de **Añadir música → URL de audio**. El botón «Descargar y añadir» autoriza enviar el enlace al servicio configurado si hace falta. «Original» intenta descarga directa o conserva el archivo sin convertir. «MP3» usa FFmpeg. Los enlaces de YouTube usan el servicio y MP3 por defecto; no abren un reproductor externo. Para probar localmente se admite HTTP únicamente en localhost; Pages en HTTPS debe usar un servicio HTTPS accesible.

## API

Todas las rutas requieren `Authorization: Bearer <IMPORT_TOKEN>`. CORS se limita a los orígenes configurados.

```http
GET /health
POST /api/imports
GET /api/imports/{jobId}
GET /api/imports/{jobId}/file
DELETE /api/imports/{jobId}
```

POST:

```json
{"sourceUrl":"https://TU-DOMINIO/audio.wav","targetFormat":"mp3","quality":192,"authorizationConfirmed":true}
```

Respuesta `202`: `{"jobId":"uuid","status":"queued"}`. Estados reales: `queued`, `processing`, `completed`, `failed`, `cancelled`. `targetFormat` admite `mp3` y `original`. Original valida contenedor y duración, conserva los bytes y entrega su MIME sin ejecutar FFmpeg. No se inventan porcentajes. Bitrates MP3: 128, 192, 256 y 320 kbps; convertir a un bitrate mayor no mejora la fuente. `/health` informa `capabilities.original`, `capabilities.fileOrigin`, fuentes habilitadas y disponibilidad de FFmpeg.

`GET /file` entrega el MIME de salida —MP3 u original— solo en `completed`, con `Cache-Control: no-store`. `DELETE` cancela descargas y procesos y elimina el resultado. El frontend elimina el trabajo tras guardar y validar el Blob en IndexedDB. Los trabajos expiran a la hora; los trabajos interrumpidos por reinicio se marcan fallidos. Los estados se conservan en disco.

## Límites y seguridad

- HTTPS, puerto 443, sin credenciales en URL, hostnames aprobados explícitamente.
- Bloqueo de IP privadas, loopback, link-local, rangos reservados y metadatos cloud; resolución DNS validada y conexión fijada a una IP aprobada, manteniendo verificación TLS y nombre del host.
- Las URLs de archivo directas no siguen redirects ni admiten dominios de YouTube/Googlevideo. El motor opcional yt-dlp usa solo el extractor YouTube con una URL canónica generada desde un ID autorizado; se deshabilitan plugins, cookies, configuraciones externas, proxies y formatos no reproducibles/DRM.
- 200 MB por fuente, duración reconocible de hasta dos horas, cinco minutos por conversión y 60 segundos sin actividad en la descarga.
- Un proceso activo, un hilo de FFmpeg, hasta 30 trabajos conservados, máximo 10 trabajos nuevos y 180 solicitudes totales por minuto/IP para permitir consultas de estado. Respuestas 400, 401, 403, 404, 409 y 429 según la condición.
- FFmpeg recibe argumentos mediante `spawn` sin shell; formatos de entrada limitados a contenedores de audio conocidos y solo protocolo local `file`. FFmpeg no recibe URLs remotas.
- Autenticación de tiempo constante sobre hashes de token. No hay tokens incorporados en el frontend público. El token configurado por el usuario se guarda localmente para su integración.
- El operador debe mantener FFmpeg y la imagen base actualizados, proporcionar HTTPS y aprobar realmente las fuentes. No se presenta esta configuración como un servicio público multiusuario listo sin controles adicionales.

## Verificación

```sh
npm run build
npm test
```

Para incluir conversión real, define `FFMPEG_PATH`. Para ejecutar además descarga HTTPS de una fixture CC0 de MDN y el ciclo POST → estado → archivo → DELETE, define `RUN_NETWORK_IMPORT=1`. La prueba de red es optativa para CI, no sustituye pruebas con las fuentes reales de cada operador. El registro de validación de la entrega indica qué se ejecutó.
