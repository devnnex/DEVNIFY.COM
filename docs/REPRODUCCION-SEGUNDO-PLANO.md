# Pantalla bloqueada, audífonos y actualizaciones

El caso previsto es iniciar una cola o playlist y bloquear la pantalla del teléfono dejando Devnify abierta. No requiere volver a la app para solicitar la siguiente canción.

El reproductor conserva un único elemento de audio nativo. Prepara el archivo y la URL de la siguiente pista mientras suena la actual. Al recibir `ended` o el comando multimedia `nexttrack`, pausa el elemento, cambia la fuente y ejecuta `load()` y `play()` en la misma tarea, sin esperar a leer la base de datos. La pista anterior se libera después de seleccionar la nueva fuente. Después prepara la siguiente pista. Los cambios de cola, repetición, aleatorio y perfil descartan la preparación anterior; solo se mantiene una pista anticipada.

En iPhone/iPad se mantiene la salida nativa y no se conecta el elemento a Web Audio, incluso si el perfil conserva un preset de otro dispositivo. El ecualizador aparece desactivado con una explicación. Esto evita que una interrupción del contexto del ecualizador deje el elemento reproduciendo sin salida audible. En los demás dispositivos se recuperan tanto contextos `suspended` como `interrupted` al recibir reproducir.

En iOS, si la próxima pista ya está preparada, se arma un bucle nativo como puente de sesión. Al detectar que la posición vuelve al inicio se pasa inmediatamente a la siguiente pista. Así el cambio no depende exclusivamente de `ended`, cuando el sistema puede haber liberado ya la sesión de audio, y no se recorta el final de la canción. La última pista sin repetición no arma ese bucle. Repetir una utiliza el bucle nativo. El control de posición explícito actualiza el estado antes del evento para distinguirlo de un cambio de pista.

Al terminar la última canción, la cola se detiene si la repetición está desactivada. Repetir todo vuelve al principio; repetir una reinicia la misma pista. El comando siguiente de los audífonos permite saltar incluso en repetir una. El temporizador de apagado se comprueba también en los eventos del audio por si el sistema retrasa los temporizadores en segundo plano.

Se registran los comandos de Media Session para reproducir, pausar, siguiente, anterior y desplazamiento. El sistema operativo decide qué comando envía cada gesto del audífono: el doble toque debe estar configurado como siguiente pista. No se interpretan toques directamente desde la página. En navegadores con Audio Session se solicita el tipo `playback` al iniciar y al reanudar. Si WebKit aborta la reproducción durante el cambio de fuente, hay un único reintento desde `canplay`; una pausa explícita cancela ese reintento y las lecturas pendientes.

## Publicación sin reinstalación

Cada publicación debe incluir la compilación nueva y su `sw.js` generado, manteniendo URL y ámbito del PWA. El workflow de GitHub Pages ya ejecuta `npm run build` antes de publicar `dist/`.

La app busca cambios al iniciar, volver al primer plano, recuperar foco o conexión y cada minuto mientras está visible. El registro usa `updateViaCache: 'none'`. Una versión descargada espera mientras hay reproducción, carga de una pista, formularios, diálogos o campos de edición activos. Con la app visible y en reposo se guarda la cola y la posición y se activa la actualización. El botón **Actualizar** permite hacerlo manualmente; pausa la música. Si otra ventana activa una versión nueva, la ventana que está reproduciendo aplaza su recarga.

Las actualizaciones del shell no borran IndexedDB. Se conservan perfiles, canciones, playlists y cola. La reproducción restaurada queda pausada. La versión anterior ya instalada deberá detectar y recibir esta actualización mediante su mecanismo habitual; basta cerrar y volver a abrir la app o utilizar **Actualizar** si aparece, sin desinstalar ni borrar datos. Un archivo abierto mediante `file://` no recibe publicaciones del servidor.

## Validación

Pruebas automatizadas: transición con app oculta y lecturas de audio pendientes, comandos multimedia, invalidación de la cola, repetición, aleatorio, temporizador y cambio de perfil. Se comprueban la recuperación de contextos interrumpidos, cancelación de intentos antiguos, reintento de carga y el puente nativo de iPhone. En Chromium se comprueba reproducción offline y fin real de pista, y se sirven tres versiones de producción consecutivas para verificar actualización automática, conservación de la canción y posición y aplazamiento durante la reproducción. La prueba de controles con la página oculta se ejecuta también en WebKit con perfil de iPhone; esa visibilidad es simulada.

Para comprobar el comportamiento en un teléfono físico:

1. Publicar la compilación y abrir la versión actualizada del PWA.
2. Añadir al menos tres canciones descargadas a una playlist e iniciar la primera.
3. Bloquear la pantalla y dejar que terminen varias canciones; comprobar que continúan sin desbloquear. Repetir sin conexión.
4. Con audífonos conectados, probar siguiente, anterior, pausa y reproducción con la pantalla bloqueada.
5. Repetir con repetición/aleatorio. En Android/escritorio, repetir también con ecualizador activado; en iPhone/iPad comprobar el aviso de salida nativa.
6. Publicar otra versión mientras suena música: comprobar que continúa y que la actualización se aplica al pausar con la app visible. Verificar biblioteca y posición.

La suspensión real de iOS/Android y los gestos Bluetooth requieren esa comprobación física. No quedan acreditados mediante emulación de escritorio. La PWA depende del soporte del navegador y no puede ejecutar audio si el sistema termina su proceso.

La prueba WebKit usa un perfil persistente porque los perfiles privados de Playwright no admiten Blobs en IndexedDB. Cuando el port no proporciona Media Session se añade un adaptador de comandos solo para la prueba; la carga de audio y su posición usan el motor real. En Windows la prueba WebKit de audio se omite porque incluso una página mínima con un WAV permanece en `readyState = 0` en este entorno. El workflow la ejecuta en Linux con las dependencias multimedia de Playwright.

Referencias: [Media Session](https://developer.mozilla.org/en-US/docs/Web/API/Media_Session_API), [Audio Session](https://developer.mozilla.org/en-US/docs/Web/API/Audio_Session_API), [contextos interrumpidos en Safari](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/state#resuming_interrupted_play_states_in_ios_safari), [incidencia de WebKit sobre cambio de pista en segundo plano](https://bugs.webkit.org/show_bug.cgi?id=261554), [actualización del service worker](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/updateViaCache).
