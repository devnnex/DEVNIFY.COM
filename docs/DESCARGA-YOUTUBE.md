# Motor de descarga YouTube → audio → Devnify

Devnify tiene el flujo **pegar URL → elegir Favoritos/playlists → Descargar y añadir**. El archivo se guarda completo como Blob en IndexedDB y la reproducción posterior no usa el servidor. Se retiró la reproducción embebida y no hay enlaces para escuchar en YouTube.

El motor implementado es **yt-dlp + FFmpeg** en `import-service/`. La página de referencia y2mate anuncia conversión y descarga, pero su interfaz pública no permite verificar qué herramienta ejecuta internamente. Esta integración no utiliza sus APIs privadas ni envía enlaces a ese proveedor.

## Activación del servidor

El HTML y una PWA no pueden ejecutar `yt-dlp` ni FFmpeg de servidor en GitHub Pages. Despliega `import-service` en un equipo/VPS que pueda ejecutar procesos y expón su API mediante HTTPS. El Dockerfile incluye Python, yt-dlp, Node y FFmpeg. En Windows se admite el ejecutable oficial `yt-dlp.exe` configurado por ruta.

Variables:

```dotenv
IMPORT_TOKEN=UN_SECRETO_ALEATORIO_DE_32_CARACTERES_O_MAS
ALLOWED_ORIGINS=https://TU_USUARIO.github.io
ALLOW_FILE_ORIGIN=false
ENABLE_YOUTUBE_DOWNLOADS=true
YTDLP_PATH=yt-dlp
FFMPEG_PATH=ffmpeg
AUTHORIZED_YOUTUBE_AUDIO_FILE=/app/config/authorized-audio.json
```

El contenedor ya define `YTDLP_PATH=/opt/ytdlp/bin/yt-dlp`; conserva ese valor al usar Docker. Para apertura directa del HTML, `ALLOW_FILE_ORIGIN=true` permite acceso autenticado desde el origen opaco `null`. El token sigue siendo obligatorio.

## Vídeos habilitados

Las descargas parten de un catálogo privado del administrador. Cada vídeo debe tener los permisos de descarga necesarios del proveedor y titulares. El botón del cliente no demuestra esos permisos. No se habilita un catálogo universal por defecto.

Archivo JSON, usando el ID real de un vídeo que esté autorizado:

```json
{
  "VIDEO_ID_01": {
    "extractFromYoutube": true,
    "authorizationReference": "Referencia de los permisos verificados para este vídeo"
  }
}
```

También puede conservarse un archivo original independiente en vez de extraerlo:

```json
{
  "VIDEO_ID_02": {
    "audioUrl": "https://audio.tudominio.com/archivo.mp3",
    "authorizationReference": "Propiedad o licencia y autorización de descarga verificadas"
  }
}
```

En ese segundo modo, el dominio del archivo debe aparecer en `ALLOWED_SOURCE_HOSTS`. No mezcles `audioUrl` y `extractFromYoutube` en la misma entrada. El catálogo se carga al iniciar el servicio; reinícialo después de editarlo. Si lo usas en Docker, monta el archivo de catálogo como solo lectura en la ruta configurada.

El enlace `Tx9zMFodNtA` facilitado en el chat **no se ha habilitado** sin una fuente o permisos de descarga acreditados. No se presenta una prueba de metadatos ni una fixture como si ese audio estuviese descargado.

## Conectar con la aplicación

En Devnify abre **Añadir música → URL de audio → Configurar**. Guarda la URL HTTPS del servicio y su token. El diagnóstico distingue si el motor de YouTube está desactivado, si falta yt-dlp o si está disponible. Después basta pegar el enlace, elegir el destino y pulsar **Descargar y añadir**.

Para enlaces de YouTube se solicita MP3 por defecto. El servicio toma la pista `bestaudio` disponible y FFmpeg la convierte al bitrate elegido. Convertir a 320 kbps no mejora la fuente. Se recuperan título y artista de los metadatos cuando están disponibles.

## Comportamiento y límites

- yt-dlp recibe un único ID validado y una URL canónica fija de YouTube mediante `spawn` sin shell. No recibe órdenes ni argumentos arbitrarios del cliente.
- Sin cookies del usuario, contraseñas de YouTube, proxies públicos, plugins externos ni opciones para formatos DRM. No se intenta superar inicios de sesión, contenido privado, pagos o restricciones de acceso.
- Se rechazan directos/estrenos, duración desconocida o superior a dos horas y archivos mayores de 200 MB. Hay cancelación y tiempos máximos por etapa.
- Puede fallar por disponibilidad del vídeo, cambios del proveedor, límites, bloqueos de red o versiones de yt-dlp. Actualiza la dependencia desde su fuente oficial; no se promete descarga universal.
- El servidor solo hace falta al importar. Una vez guardado, Devnify reproduce el archivo local sin red ni servidor.
- La música puede seguir sonando al bloquear la pantalla en sistemas compatibles. No se pausa por cambiar de vista ni por `visibilitychange`; se publican metadatos, posición y controles Media Session. La continuidad con pantalla bloqueada debe verificarse en el teléfono concreto. Apagar completamente el teléfono, forzar el cierre o que el sistema termine la PWA detiene el audio.

Fuentes: [yt-dlp oficial](https://github.com/yt-dlp/yt-dlp), [FFmpeg](https://ffmpeg.org/) y [Media Session](https://developer.mozilla.org/en-US/docs/Web/API/Media_Session_API).
