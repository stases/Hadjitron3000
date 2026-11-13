// Decoded sample audio, shared by every engine (live and offline).

const decoded = new Map<string, AudioBuffer>();
const pending = new Map<string, Promise<AudioBuffer>>();
const reversed = new WeakMap<AudioBuffer, AudioBuffer>();
let decoder: OfflineAudioContext | undefined;

export function decodeSample(id: string, bytes: Uint8Array): Promise<AudioBuffer> {
  const done = decoded.get(id);
  if (done) return Promise.resolve(done);
  let p = pending.get(id);
  if (!p) {
    decoder ??= new OfflineAudioContext(1, 1, 44100);
    // decodeAudioData detaches the buffer it is given, so hand it a copy.
    p = decoder.decodeAudioData(bytes.slice().buffer).then(
      (buf) => {
        decoded.set(id, buf);
        pending.delete(id);
        return buf;
      },
      (err: unknown) => {
        pending.delete(id);
        throw err;
      },
    );
    pending.set(id, p);
  }
  return p;
}

export function sampleBuffer(id: string): AudioBuffer | undefined {
  return decoded.get(id);
}

export function reversedBuffer(buf: AudioBuffer): AudioBuffer {
  let rev = reversed.get(buf);
  if (!rev) {
    rev = new AudioBuffer({ length: buf.length, sampleRate: buf.sampleRate, numberOfChannels: buf.numberOfChannels });
    for (let c = 0; c < buf.numberOfChannels; c++) rev.getChannelData(c).set(buf.getChannelData(c).slice().reverse());
    reversed.set(buf, rev);
  }
  return rev;
}
