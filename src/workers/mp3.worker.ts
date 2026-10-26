import { Mp3Encoder } from '@breezystack/lamejs';
interface EncodingRequest {
  channels: Float32Array[];
  sampleRate: number;
  bitrate: number;
}
const worker = globalThis as unknown as {
  onmessage: (event: MessageEvent<EncodingRequest>) => void;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};
worker.onmessage = ({ data }) => {
  try {
    const { channels, sampleRate, bitrate } = data;
    if (!channels.length || channels.length > 2 || !channels[0].length)
      throw new Error('El archivo no contiene canales de audio válidos.');
    const encoder = new Mp3Encoder(channels.length, sampleRate, bitrate);
    const chunks: Uint8Array[] = [];
    let size = 0;
    let lastPercent = -1;
    const pcm = (samples: Float32Array, start: number, end: number) => {
      const output = new Int16Array(end - start);
      for (let i = start; i < end; i++) {
        const value = Math.max(-1, Math.min(1, samples[i]));
        output[i - start] = Math.round(value * (value < 0 ? 32768 : 32767));
      }
      return output;
    };
    const store = (chunk: Uint8Array) => {
      if (chunk.length) {
        const bytes = new Uint8Array(chunk.length);
        bytes.set(chunk);
        chunks.push(bytes);
        size += bytes.length;
      }
    };
    for (let start = 0; start < channels[0].length; start += 1152) {
      const end = Math.min(start + 1152, channels[0].length);
      store(
        encoder.encodeBuffer(
          pcm(channels[0], start, end),
          channels[1] ? pcm(channels[1], start, end) : undefined,
        ),
      );
      const percent = Math.floor((end / channels[0].length) * 100);
      if (percent !== lastPercent) {
        lastPercent = percent;
        worker.postMessage({ type: 'progress', percent });
      }
    }
    store(encoder.flush());
    const output = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    worker.postMessage({ type: 'complete', buffer: output.buffer }, [output.buffer]);
  } catch (error) {
    worker.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'No se pudo codificar el MP3.',
    });
  }
};
