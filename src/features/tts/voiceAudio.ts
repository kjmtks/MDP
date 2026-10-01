// Audio helpers for recording the presenter's own voice as an Irodori-TTS
// reference ("voice calibration"): judge each take, trim and level it, join the
// takes into one reference clip, encode/decode 16-bit WAV, pick sentences to read
// from the deck's own @script, and pack the takes + transcripts as a training set.
// Pure functions on Float32 PCM — no DOM, so they run under Node for tests.

import { sentenceUnits } from '../autoplay/autoplay';

export interface Pcm { samples: Float32Array; sampleRate: number }

// ---- judging one take ----------------------------------------------------------

export interface TakeAnalysis {
  /** Sample range to keep: the speech plus a short margin of room tone. */
  start: number;
  end: number;
  /** Seconds from the first to the last voiced frame (no margins). */
  speechSec: number;
  /** Mean level of the voiced frames and of the quietest frames, dBFS. */
  speechDb: number;
  noiseDb: number;
  /** Largest |sample| inside the kept range (0…1). */
  peak: number;
  /** Samples at or near full scale inside the kept range. */
  clipped: number;
}

const FRAME_SEC = 0.02;
const MARGIN_SEC = 0.15;      // room tone kept on each side; two margins make the gap between joined takes
const MIN_RUN = 3;            // voiced frames in a row (60 ms) before a run counts as speech, so a click does not
const EDGE_SEC = 0.12;        // ignored at both ends: the click of the button that started / stopped the take

/** Find the speech in a take. null = nothing that sounds like speech. */
export function analyzeTake(pcm: Pcm): TakeAnalysis | null {
  const { samples: x, sampleRate: sr } = pcm;
  const n = Math.max(1, Math.round(sr * FRAME_SEC));
  const edge = Math.min(Math.round(sr * EDGE_SEC), Math.floor(x.length / 4));
  const from = edge;
  const to = x.length - edge;
  const frames = Math.floor((to - from) / n);
  if (frames < MIN_RUN * 2) return null;
  const db = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (let i = from + f * n, e = i + n; i < e; i++) s += x[i] * x[i];
    db[f] = 10 * Math.log10(s / n + 1e-12);
  }
  const sorted = Array.from(db).sort((a, b) => a - b);
  const noiseDb = sorted[Math.floor(frames * 0.1)];
  const loudDb = sorted[Math.min(frames - 1, Math.floor(frames * 0.95))];
  if (loudDb < -60) return null;
  // Voiced = clearly above the room and not far below the loudest part.
  const threshold = Math.max(noiseDb + 10, loudDb - 30, -60);
  let first = -1;
  let last = -1;
  for (let f = 0, run = 0; f < frames; f++) {
    run = db[f] > threshold ? run + 1 : 0;
    if (run >= MIN_RUN) {
      if (first < 0) first = f - MIN_RUN + 1;
      last = f;
    }
  }
  if (first < 0) return null;
  let power = 0;
  let voiced = 0;
  for (let f = first; f <= last; f++) {
    if (db[f] > threshold) { power += 10 ** (db[f] / 10); voiced++; }
  }
  const margin = Math.round(sr * MARGIN_SEC);
  const start = Math.max(0, from + first * n - margin);
  const end = Math.min(x.length, from + (last + 1) * n + margin);
  let peak = 0;
  let clipped = 0;
  for (let i = start; i < end; i++) {
    const a = Math.abs(x[i]);
    if (a > peak) peak = a;
    if (a >= 0.995) clipped++;
  }
  return {
    start, end,
    speechSec: ((last - first + 1) * n) / sr,
    speechDb: 10 * Math.log10(power / Math.max(1, voiced) + 1e-12),
    noiseDb, peak, clipped,
  };
}

export type TakeIssue = 'empty' | 'clipped' | 'quiet' | 'noisy' | 'short';

/** Problems worth a retake. 'empty' cannot be used at all; the rest are warnings. */
export function takeIssues(a: TakeAnalysis | null, text: string): TakeIssue[] {
  if (!a) return ['empty'];
  const out: TakeIssue[] = [];
  if (a.clipped > 3) out.push('clipped');
  if (a.speechDb < -42) out.push('quiet');
  if (a.speechDb - a.noiseDb < 18) out.push('noisy');
  // Nobody reads 14 Japanese characters — or 25 letters of English — a second: the
  // take was cut off.
  if (a.speechSec < countChars(text) / (mostlyJapanese(text) ? 14 : 25)) out.push('short');
  return out;
}

export const TAKE_ISSUE_TEXT: Record<TakeIssue, string> = {
  empty: 'No speech was recorded — check the microphone and read the sentence again.',
  clipped: 'Too loud: the recording is distorted. Move back from the microphone or lower its input level.',
  quiet: 'Very quiet. Move closer to the microphone or raise its input level.',
  noisy: 'Background noise is loud compared with your voice. A quieter room or a headset microphone helps.',
  short: 'This take looks cut off — was the whole sentence read?',
};

/** The kept range of a take at a common speaking level (≈ −20 dBFS while
 *  voiced, peaks ≤ −1 dBFS), so takes from one session sound alike when joined. */
export function levelTake(pcm: Pcm, a: TakeAnalysis): Pcm {
  const gainDb = Math.min(20, -20 - a.speechDb);
  let gain = 10 ** (gainDb / 20);
  if (a.peak > 0) gain = Math.min(gain, 0.89 / a.peak);
  const out = new Float32Array(a.end - a.start);
  for (let i = 0; i < out.length; i++) out[i] = pcm.samples[a.start + i] * gain;
  return { samples: out, sampleRate: pcm.sampleRate };
}

// ---- the reference clip ----------------------------------------------------------

/** Length of the reference built from the takes. The server uses at most 30 s
 *  of a reference and cuts the rest; a 12 s clip already held the speaker
 *  steady in tests, so 25 s is ample and stays clear of that limit. */
export const REFERENCE_MAX_SEC = 25;

/** Join takes (already trimmed; their margins make natural pauses) in order,
 *  stopping before REFERENCE_MAX_SEC. A first take longer than that is cut. */
export function buildReference(takes: Pcm[], maxSec = REFERENCE_MAX_SEC): Pcm {
  if (!takes.length) throw new Error('No recordings to build a voice from.');
  const sampleRate = takes[0].sampleRate;
  if (takes.some((t) => t.sampleRate !== sampleRate)) throw new Error('The recordings have different sample rates.');
  const max = Math.floor(maxSec * sampleRate);
  const used: Float32Array[] = [];
  let total = 0;
  for (const t of takes) {
    if (total + t.samples.length > max) {
      if (!used.length) { used.push(t.samples.subarray(0, max)); total = max; }
      break;
    }
    used.push(t.samples);
    total += t.samples.length;
  }
  const samples = new Float32Array(total);
  let p = 0;
  for (const u of used) { samples.set(u, p); p += u.length; }
  return { samples, sampleRate };
}

/** A clip read in from an audio file: drop the silence at both ends, bring it to
 *  speaking level and keep at most REFERENCE_MAX_SEC. */
export function referenceFromFile(pcm: Pcm): { ref: Pcm; analysis: TakeAnalysis } | null {
  const a = analyzeTake(pcm);
  if (!a) return null;
  return { ref: buildReference([levelTake(pcm, a)]), analysis: a };
}

/** Convert to another sample rate (linear interpolation — plenty for speech
 *  between the usual 44.1 / 48 kHz device rates). */
export function resample(pcm: Pcm, rate: number): Pcm {
  if (pcm.sampleRate === rate) return pcm;
  const ratio = pcm.sampleRate / rate;
  const x = pcm.samples;
  const out = new Float32Array(Math.floor(x.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const p = i * ratio;
    const k = Math.floor(p);
    const f = p - k;
    out[i] = x[k] * (1 - f) + (k + 1 < x.length ? x[k + 1] : x[k]) * f;
  }
  return { samples: out, sampleRate: rate };
}

/** Mix any channel layout down to mono. */
export function toMono(channels: Float32Array[], sampleRate: number): Pcm {
  if (channels.length === 1) return { samples: channels[0], sampleRate };
  const len = Math.min(...channels.map((c) => c.length));
  const out = new Float32Array(len);
  for (const c of channels) for (let i = 0; i < len; i++) out[i] += c[i] / channels.length;
  return { samples: out, sampleRate };
}

// ---- WAV ---------------------------------------------------------------------------

/** 16-bit mono PCM WAV — what the server's reference loader reads without FFmpeg. */
export function encodeWav(pcm: Pcm): Uint8Array {
  const { samples, sampleRate } = pcm;
  const out = new Uint8Array(44 + samples.length * 2);
  const v = new DataView(out.buffer);
  const put = (i: number, s: string) => { for (let k = 0; k < 4; k++) out[i + k] = s.charCodeAt(k); };
  put(0, 'RIFF'); v.setUint32(4, out.length - 8, true); put(8, 'WAVE');
  put(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);                   // PCM
  v.setUint16(22, 1, true);                   // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);      // byte rate
  v.setUint16(32, 2, true);                   // block align
  v.setUint16(34, 16, true);                  // bits per sample
  put(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true);
  }
  return out;
}

/** Read a 16-bit PCM WAV (as written by encodeWav) back into mono samples. */
export function decodeWav(bytes: Uint8Array): Pcm {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (i: number) => String.fromCharCode(bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]);
  if (bytes.length < 12 || ascii(0) !== 'RIFF' || ascii(8) !== 'WAVE') throw new Error('Not a WAV file.');
  let channels = 1;
  let sampleRate = 0;
  let bits = 0;
  for (let i = 12; i + 8 <= bytes.length;) {
    const id = ascii(i);
    const size = Math.min(v.getUint32(i + 4, true), bytes.length - i - 8);
    if (id === 'fmt ') {
      if (v.getUint16(i + 8, true) !== 1) throw new Error('Only PCM WAV files are supported here.');
      channels = v.getUint16(i + 10, true);
      sampleRate = v.getUint32(i + 12, true);
      bits = v.getUint16(i + 22, true);
    } else if (id === 'data') {
      if (bits !== 16 || !sampleRate) throw new Error('Only 16-bit PCM WAV files are supported here.');
      const frames = Math.floor(size / (2 * channels));
      const out = new Float32Array(frames);
      for (let f = 0; f < frames; f++) {
        let s = 0;
        for (let c = 0; c < channels; c++) s += v.getInt16(i + 8 + (f * channels + c) * 2, true);
        out[f] = s / channels / 0x8000;
      }
      return { samples: out, sampleRate };
    }
    i += 8 + size + (size & 1);
  }
  throw new Error('The WAV file has no audio data.');
}

// ---- what to read ----------------------------------------------------------------

export const countChars = (s: string): number => s.replace(/\s+/g, '').length;

/** "45 s" / "3 min 20 s". */
export const formatSeconds = (s: number): string => {
  const r = Math.round(s);
  return r < 60 ? `${r} s` : `${Math.floor(r / 60)} min ${r % 60} s`;
};

// Used when the deck has too little narration: plain lecture sentences with a
// spread of sounds, a question and some numbers.
const FALLBACK_SENTENCES = [
  'それでは、本日の内容を順番に説明していきます。',
  'まず前回の復習をしてから、新しい概念を具体例とともに確認します。',
  'この図の横軸は時間、縦軸は観測された値を表しています。',
  'なぜこのような結果になるのか、少し考えてみてください。',
  'ここで重要なのは、仮定をひとつずつ確かめることです。',
  '実験の条件を変えると、誤差はどのように変わるでしょうか。',
  '結論を急がずに、データが示していることを丁寧に読み取りましょう。',
  '例えば、温度が十度上がると、反応の速さはおよそ二倍になります。',
  '最後に、今日のポイントを三つにまとめておきます。',
  '質問があれば、遠慮なくいつでも手を挙げてください。',
  '次回までに、配布した演習問題に取り組んでおいてください。',
  'ありがとうございました。それでは、今日はここまでにしましょう。',
];

// Mostly kana / kanji: read as Japanese (counted by characters, not words).
function mostlyJapanese(s: string): boolean {
  const n = countChars(s);
  return n > 0 && (s.match(/[぀-ヿ㐀-鿿ｦ-ﾟ]/g) || []).length / n >= 0.5;
}

// A sentence worth reading: a normal length — 12–80 characters of Japanese, or
// 4–30 words of English (or another spaced language) — and no URLs or code. Any
// language: a voice is a voice, and Chatterbox speaks English as well.
function readable(s: string): boolean {
  if (/https?:|www\.|[<>{}=_\\]/.test(s)) return false;
  if (mostlyJapanese(s)) {
    const n = countChars(s);
    return n >= 12 && n <= 80;
  }
  const words = s.trim().split(/\s+/).filter(Boolean).length;
  return /\p{L}/u.test(s) && words >= 4 && words <= 30;
}

/** Sentences to read, in order: the deck's scripts as a reading takes them
 *  (`scripts` — scriptsInReadingOrder: the slide on screen first, else the deck's
 *  first script, then page after page), split into sentences; after them
 *  `extraText` (the default passage) and a built-in set, which a deck without
 *  scripts starts with. Sentences already in `exclude` (recorded) are left out. */
export function pickSentences(scripts: string[], extraText = '', exclude: string[] = []): string[] {
  const seen = new Set(exclude.map((s) => s.trim()));
  const out: string[] = [];
  for (const raw of [...scripts.flatMap(sentenceUnits), ...sentenceUnits(extraText), ...FALLBACK_SENTENCES]) {
    const s = raw.trim();
    if (!s || seen.has(s) || !readable(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/** Reading speed from the takes, comparable to the talk-time setting: the
 *  voiced time of each sentence plus a typical half-second pause after it.
 *  null when there is too little to judge. */
export function readingCharsPerMin(takes: Array<{ text: string; speechSec: number }>): number | null {
  const sec = takes.reduce((n, t) => n + t.speechSec + 0.5, 0);
  if (sec < 8) return null;
  const chars = takes.reduce((n, t) => n + countChars(t.text), 0);
  return Math.round(chars / (sec / 60));
}

// ---- the training set --------------------------------------------------------------

/** Files of a Hugging Face "audiofolder" dataset: wavs/NNN.wav + metadata.csv
 *  (file_name,text), plus `extra` text files (name → content) at the top. */
export function trainingSetFiles(
  takes: Array<{ text: string; wav: Uint8Array }>, extra: Record<string, string> = {},
): Array<{ name: string; data: Uint8Array }> {
  const enc = new TextEncoder();
  const csv = (s: string) => `"${s.replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
  const width = Math.max(3, String(takes.length).length);
  const rows = ['file_name,text'];
  const files: Array<{ name: string; data: Uint8Array }> = [];
  takes.forEach((t, i) => {
    const name = `wavs/${String(i + 1).padStart(width, '0')}.wav`;
    files.push({ name, data: t.wav });
    rows.push(`${name},${csv(t.text)}`);
  });
  return [
    { name: 'metadata.csv', data: enc.encode(`${rows.join('\n')}\n`) },
    ...files,
    ...Object.entries(extra).map(([name, text]) => ({ name, data: enc.encode(text) })),
  ];
}

// ---- ZIP (stored, no compression — WAV barely compresses) --------------------------

let crcTable: Uint32Array | null = null;
function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function storedZip(files: Array<{ name: string; data: Uint8Array }>, date = new Date()): Uint8Array {
  const enc = new TextEncoder();
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const head = (sig: number, central: boolean) => {
      const h = new Uint8Array((central ? 46 : 30) + name.length);
      const v = new DataView(h.buffer);
      let p = 0;
      const u32 = (x: number) => { v.setUint32(p, x, true); p += 4; };
      const u16 = (x: number) => { v.setUint16(p, x, true); p += 2; };
      u32(sig);
      if (central) u16(20);                   // version made by
      u16(20); u16(0x0800);                   // version needed; flags: UTF-8 names
      u16(0); u16(time); u16(day);            // stored
      u32(crc); u32(f.data.length); u32(f.data.length);
      u16(name.length); u16(0);
      if (central) { u16(0); u16(0); u16(0); u32(0); u32(offset); }
      h.set(name, p);
      return h;
    };
    const local = head(0x04034b50, false);
    locals.push(local, f.data);
    centrals.push(head(0x02014b50, true));
    offset += local.length + f.data.length;
  }
  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const v = new DataView(end.buffer);
  v.setUint32(0, 0x06054b50, true);
  v.setUint16(8, files.length, true);
  v.setUint16(10, files.length, true);
  v.setUint32(12, cdSize, true);
  v.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cdSize + 22);
  let p = 0;
  for (const part of [...locals, ...centrals, end]) { out.set(part, p); p += part.length; }
  return out;
}
