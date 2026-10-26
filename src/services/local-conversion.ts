import encoderSource from 'virtual:devnify-mp3-worker';

function aborted() {
  return new DOMException('Conversión cancelada', 'AbortError');
}
export async function convertToMp3(
  input: Blob,
  options: {
    signal: AbortSignal;
    bitrate: number;
    onProgress: (percent: number | null) => void;
    onStatus: (message: string) => void;
  },
) {
  const { signal, onProgress, onStatus } = options;
  if (signal.aborted) throw aborted();
  if (input.size > 100 * 1024 * 1024)
    throw new Error('La conversión en este dispositivo admite archivos de hasta 100 MB.');
  if (![128, 192, 256, 320].includes(options.bitrate)) throw new Error('Bitrate MP3 no válido.');
  onProgress(null);
  onStatus('Leyendo el audio del archivo en tu dispositivo…');
  const decoder = new AudioContext({ sampleRate: 44100 });
  let decoded: AudioBuffer;
  const stop = () => {
    void decoder.close().catch(() => undefined);
  };
  signal.addEventListener('abort', stop, { once: true });
  try {
    decoded = await decoder.decodeAudioData(await input.arrayBuffer());
  } catch {
    if (signal.aborted) throw aborted();
    throw new Error(
      'El navegador no puede extraer audio de este archivo. Prueba un MP4 con audio AAC, M4A o WAV compatible. No se ha guardado una canción.',
    );
  } finally {
    signal.removeEventListener('abort', stop);
    if (decoder.state !== 'closed') await decoder.close();
  }
  if (signal.aborted) throw aborted();
  if (decoded.duration > 1200 || decoded.numberOfChannels > 2 || !decoded.length)
    throw new Error('La conversión local admite audio mono o estéreo de hasta 20 minutos.');
  const channels = Array.from(
    { length: decoded.numberOfChannels },
    (_, index) => new Float32Array(decoded.getChannelData(index)),
  );
  onStatus('Convirtiendo a MP3 en tu dispositivo…');
  const objectUrl = URL.createObjectURL(new Blob([encoderSource], { type: 'text/javascript' }));
  let worker: Worker;
  try {
    worker = new Worker(objectUrl);
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
  return new Promise<Blob>((resolve, reject) => {
    let done = false;
    const finish = (blob?: Blob, error?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      signal.removeEventListener('abort', cancel);
      worker.terminate();
      URL.revokeObjectURL(objectUrl);
      if (error) reject(error);
      else resolve(blob!);
    };
    const cancel = () => finish(undefined, aborted());
    const timeout = setTimeout(
      () =>
        finish(
          undefined,
          new Error(
            'La conversión tardó demasiado en este dispositivo. Prueba un archivo más corto.',
          ),
        ),
      300000,
    );
    worker.onerror = () =>
      finish(
        undefined,
        new Error(
          'No se pudo ejecutar el conversor local. Comprueba que tu navegador permite Web Workers.',
        ),
      );
    worker.onmessage = ({
      data,
    }: {
      data: { type: string; percent?: number; buffer?: ArrayBuffer; message?: string };
    }) => {
      if (data.type === 'progress') onProgress(data.percent ?? null);
      if (data.type === 'error')
        finish(undefined, new Error(data.message || 'No se pudo convertir el audio.'));
      if (data.type === 'complete') {
        if (!data.buffer?.byteLength)
          finish(undefined, new Error('La conversión produjo un archivo vacío.'));
        else finish(new Blob([data.buffer], { type: 'audio/mpeg' }));
      }
    };
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) {
      cancel();
      return;
    }
    worker.postMessage(
      { channels, sampleRate: decoded.sampleRate, bitrate: options.bitrate },
      channels.map((channel) => channel.buffer),
    );
  });
}
