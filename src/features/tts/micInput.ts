// Raw microphone capture for recording a reference voice.
//
// The browser's voice-call processing (echo cancellation, noise suppression,
// automatic gain) is switched OFF: it smears the timbre and pumps the level, and
// the cloned voice would inherit that. Samples are taken straight from the Web
// Audio graph as Float32 PCM — not MediaRecorder, whose WebM/Opus the TTS server
// cannot read without FFmpeg (and whose lossy coding the clone would copy too).
//
// The stream stays open between takes (no permission prompt or device warm-up per
// sentence); `start()` / `stop()` only decide which samples are kept. They do so
// by the AUDIO clock, not by when a batch reaches the page: batches queue up while
// the page is busy (seconds, in a throttled window), and counting a late batch as
// "after start()" once put 5 s of audio from before the take into it.

import { toMono, type Pcm } from './voiceAudio';

// Runs on the audio thread: forwards the input in ~43 ms batches, each stamped
// with the audio-clock frame of its first sample.
const WORKLET = `
class MdpCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(2048); this.n = 0; this.at = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        if (this.n === 0) this.at = currentFrame + i;
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) {
          this.port.postMessage({ at: this.at, data: this.buf }, [this.buf.buffer]);
          this.buf = new Float32Array(2048); this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('mdp-capture', MdpCapture);
`;

export interface MicDevice { id: string; label: string }

/** Audio inputs. Labels are empty until the page has had microphone access once. */
export async function listMicrophones(): Promise<MicDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === 'audioinput')
    .map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
}

export class MicInput {
  readonly sampleRate: number;
  readonly label: string;
  /** Peak of the latest batch (0…1), for a level meter. */
  level = 0;
  private chunks: Array<{ at: number; data: Float32Array }> = [];
  private recording = false;
  private closed = false;
  private from = 0;       // audio-clock frame where the take starts
  private received = 0;   // frame just after the newest batch that has arrived

  private readonly ctx: AudioContext;
  private readonly stream: MediaStream;
  private readonly nodes: AudioNode[] = [];

  private constructor(ctx: AudioContext, stream: MediaStream) {
    this.ctx = ctx;
    this.stream = stream;
    this.sampleRate = ctx.sampleRate;
    this.label = stream.getAudioTracks()[0]?.label || 'Microphone';
  }

  static async open(deviceId?: string): Promise<MicInput> {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This window cannot use a microphone.');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    } catch (e) {
      const name = (e as { name?: string } | null)?.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        throw new Error('Microphone access was refused. On Windows, check Settings → Privacy & security → Microphone (“Let desktop apps access your microphone”).');
      }
      if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new Error('No microphone was found.');
      throw new Error(`The microphone could not be opened: ${e instanceof Error ? e.message : String(e)}`);
    }
    const ctx = new AudioContext();
    try {
      const source = ctx.createMediaStreamSource(stream);
      // Pulled through a muted gain so the graph keeps running without playing
      // the microphone back through the speakers.
      const sink = ctx.createGain();
      sink.gain.value = 0;
      sink.connect(ctx.destination);
      const mic = new MicInput(ctx, stream);
      const onBatch = (at: number, data: Float32Array) => mic.take(at, data);
      let tap: AudioNode;
      try {
        const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
        try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
        const node = new AudioWorkletNode(ctx, 'mdp-capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' });
        node.port.onmessage = (e: MessageEvent<{ at: number; data: Float32Array }>) => onBatch(e.data.at, e.data.data);
        tap = node;
      } catch {
        // No AudioWorklet (or it may not load a blob: module here): the older,
        // main-thread processor still delivers the same samples.
        const node = ctx.createScriptProcessor(4096, 1, 1);
        // It runs on the page's thread, so "now" is a fair stamp for the batch just ending.
        node.onaudioprocess = (e) => {
          const data = new Float32Array(e.inputBuffer.getChannelData(0));
          onBatch(Math.max(0, Math.round(ctx.currentTime * ctx.sampleRate) - data.length), data);
        };
        tap = node;
      }
      source.connect(tap);
      tap.connect(sink);
      mic.nodes.push(source, tap, sink);
      if (ctx.state === 'suspended') await ctx.resume();
      return mic;
    } catch (e) {
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
      throw e;
    }
  }

  private take(at: number, data: Float32Array): void {
    let peak = 0;
    for (let i = 0; i < data.length; i++) { const a = Math.abs(data[i]); if (a > peak) peak = a; }
    this.level = peak;
    this.received = at + data.length;
    if (this.recording && this.received > this.from) this.chunks.push({ at, data });
  }

  private now(): number { return Math.round(this.ctx.currentTime * this.sampleRate); }

  get isRecording(): boolean { return this.recording; }

  start(): void {
    if (this.closed) throw new Error('The microphone is closed.');
    this.chunks = [];
    this.from = this.now();
    this.recording = true;
  }

  /** Stop and return the audio from start() to now — waiting briefly for batches
   *  still on their way, so the end of the last word is not lost. */
  async stop(): Promise<Pcm> {
    const until = this.now();
    for (let t = 0; this.recording && !this.closed && this.received < until && t < 50; t++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    this.recording = false;
    const from = this.from;
    const samples = new Float32Array(Math.max(0, until - from));
    let end = 0;
    for (const { at, data } of this.chunks) {
      const a = Math.max(at, from);
      const b = Math.min(at + data.length, until);
      if (b > a) { samples.set(data.subarray(a - at, b - at), a - from); end = Math.max(end, b - from); }
    }
    this.chunks = [];
    // Batches that never came (a stalled graph) leave no trailing silence behind.
    return { samples: samples.subarray(0, end), sampleRate: this.sampleRate };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.recording = false;
    this.chunks = [];
    for (const n of this.nodes) { try { n.disconnect(); } catch { /* already */ } }
    this.stream.getTracks().forEach((t) => t.stop());
    void this.ctx.close();
  }
}

/** Decode an audio file (WAV, MP3, M4A, OGG, FLAC… whatever Chromium reads) to mono PCM. */
export async function decodeAudioFile(data: ArrayBuffer): Promise<Pcm> {
  const ctx = new AudioContext();
  try {
    const buf = await ctx.decodeAudioData(data);
    return toMono(Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c)), buf.sampleRate);
  } catch {
    throw new Error('This file could not be read as audio.');
  } finally {
    void ctx.close();
  }
}
