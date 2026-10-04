// Removing a steady background hiss from a reference voice before it is registered.
//
// A cloned voice copies its reference's room as well as its speaker: the hiss of a
// microphone — recorded with the browser's own noise suppression off, for fidelity
// (micInput.ts) — comes back in every line the server reads. Cleaning the reference
// once cleans them all.
//
// Spectral gating (as in Audacity's Noise Reduction and noisereduce's stationary
// mode): the noise spectrum is learnt from the quietest frames — the room tone at
// the joins of the takes and the pauses between phrases — and each frequency bin of
// each frame is turned down where it does not stand clearly above that noise. The
// gain is smoothed over time and frequency, so what is left of the noise does not
// warble ("musical noise"). For STEADY noise only — hiss, hum, a fan, an air
// conditioner — not voices, music or clatter.
// Pure functions on Float32 PCM — no DOM, so they run under Node for tests.

import type { Pcm } from './voiceAudio';

export type NoiseReduction = 'off' | 'light' | 'standard' | 'strong';

/** How far each level turns the noise down at most, dB. */
export const NOISE_REDUCTION_DB: Record<Exclude<NoiseReduction, 'off'>, number> = { light: 12, standard: 20, strong: 30 };

const FRAME_SEC = 0.02;          // ~21 ms frames (1024 samples at 48 kHz), 75 % overlap
const NOISE_SHARE = 0.15;        // the quietest 15 % of frames are taken as noise
const MIN_NOISE_FRAMES = 8;
const THRESHOLD_STD = 1.5;       // a bin counts as signal this many std above the noise mean (dB)
const SOFTNESS_DB = 2;           // width of the soft step around that threshold
const SMOOTH_HZ = 300;           // gain smoothing across frequency …
const SMOOTH_SEC = 0.05;         // … and time

// ---- FFT (in place, radix 2) ------------------------------------------------------

function fft(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

// Triangular smoothing of a row of `len` values in place, half-width `w` (≥ 1).
function smoothRow(v: Float32Array, off: number, len: number, stride: number, w: number, tmp: Float32Array): void {
  for (let i = 0; i < len; i++) {
    let s = 0;
    let wsum = 0;
    for (let k = -w; k <= w; k++) {
      const j = i + k;
      if (j < 0 || j >= len) continue;
      const kw = w + 1 - Math.abs(k);
      s += v[off + j * stride] * kw;
      wsum += kw;
    }
    tmp[i] = s / wsum;
  }
  for (let i = 0; i < len; i++) v[off + i * stride] = tmp[i];
}

/** `pcm` with its steady background noise turned down by up to the level's dB.
 *  Returns `pcm` itself when off, or when it is too short / has no quiet part to
 *  learn the noise from. */
export function reduceNoise(pcm: Pcm, level: NoiseReduction = 'standard'): Pcm {
  if (level === 'off') return pcm;
  const x = pcm.samples;
  const sr = pcm.sampleRate;
  let n = 256;
  while (n < sr * FRAME_SEC && n < 4096) n <<= 1;
  const hop = n / 4;
  if (x.length < n * 4) return pcm;

  // Pad by one frame on each side, so every sample is covered by four frames.
  const padded = new Float64Array(x.length + 2 * n);
  for (let i = 0; i < x.length; i++) padded[i + n] = x[i];
  const frames = Math.floor((padded.length - n) / hop) + 1;
  const bins = n / 2 + 1;
  const win = new Float64Array(n);
  for (let i = 0; i < n; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);

  // Spectra of every frame (kept for the synthesis) and their levels in dB.
  const specRe = new Float32Array(frames * bins);
  const specIm = new Float32Array(frames * bins);
  const levelDb = new Float32Array(frames * bins);
  const energy = new Float64Array(frames);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let f = 0; f < frames; f++) {
    const at = f * hop;
    let e = 0;
    for (let i = 0; i < n; i++) {
      const v = padded[at + i] * win[i];
      re[i] = v; im[i] = 0;
      e += v * v;
    }
    energy[f] = e / n;
    fft(re, im, false);
    for (let k = 0; k < bins; k++) {
      const o = f * bins + k;
      specRe[o] = re[k]; specIm[o] = im[k];
      levelDb[o] = 10 * Math.log10(re[k] * re[k] + im[k] * im[k] + 1e-20);
    }
  }

  // The noise: the quietest frames that are not digital silence (the padding).
  const candidates: number[] = [];
  for (let f = 0; f < frames; f++) if (energy[f] > 1e-12) candidates.push(f);
  candidates.sort((a, b) => energy[a] - energy[b]);
  const noise = candidates.slice(0, Math.max(MIN_NOISE_FRAMES, Math.floor(candidates.length * NOISE_SHARE)));
  if (noise.length < MIN_NOISE_FRAMES || candidates.length < MIN_NOISE_FRAMES * 3) return pcm;
  const threshold = new Float32Array(bins);
  for (let k = 0; k < bins; k++) {
    let s = 0;
    let s2 = 0;
    for (const f of noise) { const d = levelDb[f * bins + k]; s += d; s2 += d * d; }
    const mean = s / noise.length;
    const std = Math.sqrt(Math.max(0, s2 / noise.length - mean * mean));
    threshold[k] = mean + THRESHOLD_STD * std;
  }

  // Soft mask (1 = signal, 0 = noise), smoothed over frequency and time, as gain.
  const gain = levelDb;   // reused in place
  for (let f = 0; f < frames; f++) {
    for (let k = 0; k < bins; k++) {
      const o = f * bins + k;
      gain[o] = 1 / (1 + Math.exp(-(levelDb[o] - threshold[k]) / SOFTNESS_DB));
    }
  }
  const tmp = new Float32Array(Math.max(bins, frames));
  const wf = Math.max(1, Math.round(SMOOTH_HZ / 2 / (sr / n)));
  const wt = Math.max(1, Math.round(SMOOTH_SEC / 2 / (hop / sr)));
  for (let f = 0; f < frames; f++) smoothRow(gain, f * bins, bins, 1, wf, tmp);
  for (let k = 0; k < bins; k++) smoothRow(gain, k, frames, bins, wt, tmp);
  const floor = 10 ** (-NOISE_REDUCTION_DB[level] / 20);

  // Resynthesis: weighted overlap-add, normalised by the summed squared window.
  const out = new Float64Array(padded.length);
  const norm = new Float64Array(padded.length);
  for (let f = 0; f < frames; f++) {
    for (let k = 0; k < bins; k++) {
      const o = f * bins + k;
      const g = floor + (1 - floor) * gain[o];
      re[k] = specRe[o] * g; im[k] = specIm[o] * g;
      if (k > 0 && k < n / 2) { re[n - k] = re[k]; im[n - k] = -im[k]; }
    }
    fft(re, im, true);
    const at = f * hop;
    for (let i = 0; i < n; i++) {
      out[at + i] += re[i] * win[i];
      norm[at + i] += win[i] * win[i];
    }
  }
  const samples = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const w = norm[i + n];
    samples[i] = w > 1e-9 ? out[i + n] / w : 0;
  }
  return { samples, sampleRate: sr };
}

// ---- the choice, remembered on this computer (like the microphone) ------------------

const KEY = 'mdp.recording.noiseReduction';
const LEVELS: NoiseReduction[] = ['off', 'light', 'standard', 'strong'];

/** The level chosen last on this computer (default: standard). */
export function savedNoiseReduction(): NoiseReduction {
  try {
    const v = localStorage.getItem(KEY) as NoiseReduction | null;
    return v && LEVELS.includes(v) ? v : 'standard';
  } catch { return 'standard'; }
}

export function saveNoiseReduction(level: NoiseReduction): void {
  try { localStorage.setItem(KEY, level); } catch { /* not remembered */ }
}
