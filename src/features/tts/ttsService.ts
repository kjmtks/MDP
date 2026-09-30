// Text-to-speech for read-aloud (rehearsal, narrated auto-play, module API).
// Three selectable engines:
//   - 'webspeech' : the browser/OS Web Speech API (SpeechSynthesis). Zero setup,
//     cross-platform; voices come from the OS (and, when online, cloud voices).
//   - 'voicevox'  : a LOCAL VOICEVOX engine (default http://127.0.0.1:50021). The
//     user runs VOICEVOX; we POST /audio_query then /synthesis and play the WAV.
//     CORS is permitted by the engine, so the renderer calls it directly.
//   - 'irodori'   : a LOCAL Irodori-TTS server (Aratako/Irodori-TTS-Server, an
//     OpenAI-compatible /v1/audio/speech; default http://127.0.0.1:8088) that the
//     user runs, like the VOICEVOX engine.
// VOICEVOX and Irodori return AUDIO DATA, so their clips can be prefetched and
// pre-generated; Web Speech only speaks live. Config is persisted in app settings.

export type TtsEngine = 'webspeech' | 'voicevox' | 'irodori';

export interface TtsConfig {
  engine: TtsEngine;
  rate: number;              // speaking rate; ~0.5–2.0. VOICEVOX speedScale / Irodori speed.
  pitch: number;             // Web Speech pitch 0–2 (VOICEVOX and Irodori ignore it).
  webspeechVoiceURI: string; // chosen SpeechSynthesisVoice.voiceURI ('' = default)
  voicevoxUrl: string;       // e.g. http://127.0.0.1:50021
  voicevoxSpeaker: number;   // VOICEVOX style id
  irodoriUrl: string;        // e.g. http://127.0.0.1:8088
  irodoriApiKey: string;     // the server's IRODORI_API_KEY ('' = the server needs none)
  irodoriVoice: string;      // server voice id (a reference clip in its voices/), or 'none'
  irodoriCaption: string;    // Voice Design text ("落ち着いた低めの男性の声…"); '' = none
}

export const DEFAULT_TTS: TtsConfig = {
  engine: 'webspeech',
  rate: 1,
  pitch: 1,
  webspeechVoiceURI: '',
  voicevoxUrl: 'http://127.0.0.1:50021',
  voicevoxSpeaker: 1,
  irodoriUrl: 'http://127.0.0.1:8088',
  irodoriApiKey: '',
  irodoriVoice: 'none',
  irodoriCaption: '',
};

/** Engines that return audio DATA (synthesized ahead of playback) rather than
 *  speaking live — so a clip can be prefetched or the whole show pre-generated,
 *  and a failure can fall back to Web Speech. */
export const synthesizesAudio = (engine: TtsEngine): boolean => engine === 'voicevox' || engine === 'irodori';

/** Display name of an engine, for status lines and error messages. */
export const engineLabel = (engine: TtsEngine): string =>
  engine === 'voicevox' ? 'VOICEVOX' : engine === 'irodori' ? 'Irodori-TTS' : 'Web Speech';

// Opt-in TTS diagnostics: run `localStorage.mdpTtsDebug = '1'` in DevTools (per
// window) and every speak/cancel/stop plus each utterance's lifecycle events are
// logged with stack traces — for hunting down "speech stops immediately" reports.
export function ttsDebug(): boolean {
  try { return window.localStorage.getItem('mdpTtsDebug') === '1'; } catch { return false; }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ttsLog(...args: any[]): void {
  if (ttsDebug()) console.log(`[mdpTts ${new Date().toISOString().slice(11, 23)}]`, ...args);
}
function ttsTrace(label: string): void {
  if (ttsDebug()) console.trace(`[mdpTts] ${label}`);
}

// A running utterance: `done` resolves when speech finishes (or is stopped/errors);
// `stop()` cancels it immediately and resolves `done`.
export interface Utterance { done: Promise<void>; stop: () => void }

// Spoken-position progress, for callers that highlight the text as it is read.
// Web Speech reports word boundaries: charIndex (+ charLength when the platform
// provides it) into the spoken string. VOICEVOX and Irodori play a pre-synthesized
// WAV, so they report only `fraction` (0..1 of playback time) — an approximation.
export interface SpeakProgress { charIndex?: number; charLength?: number; fraction?: number }
export type SpeakProgressCallback = (p: SpeakProgress) => void;

const NOOP: Utterance = { done: Promise.resolve(), stop: () => {} };

// ---- Web Speech ------------------------------------------------------------

export function webSpeechAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function listWebSpeechVoices(): SpeechSynthesisVoice[] {
  return webSpeechAvailable() ? window.speechSynthesis.getVoices() : [];
}

// Voices load asynchronously on first use; resolve once they're populated.
export function loadWebSpeechVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!webSpeechAvailable()) return Promise.resolve([]);
  const now = window.speechSynthesis.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; resolve(window.speechSynthesis.getVoices()); };
    window.speechSynthesis.addEventListener('voiceschanged', finish, { once: true });
    setTimeout(finish, 1200); // some platforms never fire the event
  });
}

// Narrator selection for Web Speech, used by per-call overrides (module API):
//   voice — narrator by voiceURI/name, exact first then case-insensitive substring
//           (e.g. 'Zira' matches "Microsoft Zira - English (United States)").
//   lang  — BCP-47 prefix (e.g. 'en', 'en-US', 'ja'); picks the configured default
//           voice when it matches, else the best installed voice for that language
//           (local voices first). No match → undefined; the utterance then carries
//           only `lang` and the OS chooses.
// With neither given this reduces to the configured default voice (legacy behavior).
export interface VoiceSelect { voice?: string; lang?: string }

// One warning per missing voice/language, so a slide that speaks repeatedly does
// not flood the console. Plain console.warn: visible with DevTools (F12) without
// turning on the mdpTtsDebug flag, because this is a MACHINE SETUP problem that
// only shows up on someone else's laptop.
const warnedVoices = new Set<string>();
function warnMissingVoice(what: string, voices: SpeechSynthesisVoice[]): void {
  if (warnedVoices.has(what)) return;
  warnedVoices.add(what);
  console.warn(
    `[MDP TTS] No installed narrator for ${what}. Installed: `
    + (voices.map((v) => `${v.name} (${v.lang})`).join(', ') || '(none)')
    + '. On Windows, add that language and its Speech feature in '
    + 'Settings > Time & language > Language & region.',
  );
}

export function resolveWebSpeechVoice(sel: VoiceSelect, cfg: TtsConfig): SpeechSynthesisVoice | undefined {
  const voices = listWebSpeechVoices();
  const wanted = (sel.voice || '').trim().toLowerCase();
  if (wanted) {
    const named = voices.find((v) => v.voiceURI.toLowerCase() === wanted || v.name.toLowerCase() === wanted)
      || voices.find((v) => v.name.toLowerCase().includes(wanted) || v.voiceURI.toLowerCase().includes(wanted));
    // A deck that names a narrator ("Zira") must still speak on a machine where
    // that narrator is not installed: fall through to the language match instead
    // of returning nothing. Only the requested VOICE is lost, never the speech.
    if (named) return named;
    warnMissingVoice(`voice "${sel.voice}"`, voices);
  }
  const def = cfg.webspeechVoiceURI ? voices.find((v) => v.voiceURI === cfg.webspeechVoiceURI) : undefined;
  const lang = (sel.lang || '').trim().toLowerCase();
  if (!lang) return def;
  const matches = (v: SpeechSynthesisVoice) => v.lang.toLowerCase().replace(/_/g, '-').startsWith(lang);
  if (def && matches(def)) return def;
  const cand = voices.filter(matches);
  const pick = cand.find((v) => v.localService && v.default) || cand.find((v) => v.localService) || cand[0];
  // No voice for this language is installed at all — the classic cross-machine
  // failure (a Japanese Windows with no English voice). Invisible otherwise.
  if (!pick) warnMissingVoice(`language "${sel.lang}"`, voices);
  return pick;
}

// Chromium GC workaround: SpeechSynthesis does NOT keep a queued utterance alive,
// and once speakWebSpeech returns nothing else references it — a garbage-collected
// utterance goes SILENT mid-speech (long-standing crbug). Hits busy windows first
// (e.g. the presenter, whose rAF timer loop makes GC frequent). Hold every live
// utterance here until it ends, errors, or is stopped.
const liveUtterances = new Set<SpeechSynthesisUtterance>();

function speakWebSpeech(text: string, cfg: TtsConfig, sel?: VoiceSelect, onProgress?: SpeakProgressCallback): Utterance {
  const synth = window.speechSynthesis;
  const u = new SpeechSynthesisUtterance(text);
  const v = resolveWebSpeechVoice(sel || {}, cfg);
  if (v) { u.voice = v; u.lang = v.lang; }
  else if (sel?.lang) u.lang = sel.lang;
  if (onProgress) {
    u.onboundary = (e: SpeechSynthesisEvent) => {
      // Word boundaries only (some platforms also emit 'sentence'); charLength is
      // absent on older platforms — the caller then finds the word end itself.
      if (e.name && e.name !== 'word') return;
      onProgress({ charIndex: e.charIndex, charLength: e.charLength });
    };
  }
  u.rate = Math.max(0.1, Math.min(10, cfg.rate || 1));
  u.pitch = Math.max(0, Math.min(2, cfg.pitch ?? 1));
  let resolve!: () => void;
  const done = new Promise<void>((r) => { resolve = r; });
  const finish = () => { liveUtterances.delete(u); resolve(); };
  u.onend = (e) => { ttsLog('utterance END', { elapsed: e.elapsedTime, text: text.slice(0, 40) }); finish(); };
  u.onerror = (e) => { ttsLog('utterance ERROR', { error: e.error, text: text.slice(0, 40) }); finish(); };
  if (ttsDebug()) {
    u.onstart = () => ttsLog('utterance START', { voice: u.voice?.name || '(default)', lang: u.lang, text: text.slice(0, 40) });
    u.onpause = () => ttsLog('utterance PAUSE');
  }
  liveUtterances.add(u);
  ttsTrace('cancel() before speak');
  synth.cancel();
  synth.speak(u);
  ttsLog('speak queued', { text: text.slice(0, 40), voice: v?.name || '(default)', pending: synth.pending, speaking: synth.speaking, paused: synth.paused });
  return { done, stop: () => { ttsTrace('utterance.stop() → cancel()'); try { synth.cancel(); } catch { /* ignore */ } finish(); } };
}

// ---- VOICEVOX --------------------------------------------------------------

export interface VoicevoxStyle { id: number; label: string }

// Fetch the installed speakers/styles from a running VOICEVOX engine.
export async function listVoicevoxSpeakers(url: string): Promise<VoicevoxStyle[]> {
  const base = (url || DEFAULT_TTS.voicevoxUrl).replace(/\/+$/, '');
  const res = await fetch(`${base}/speakers`);
  if (!res.ok) throw new Error(`VOICEVOX /speakers returned ${res.status}`);
  const data = await res.json() as Array<{ name: string; styles: Array<{ name: string; id: number }> }>;
  const out: VoicevoxStyle[] = [];
  for (const sp of data) for (const st of sp.styles || []) out.push({ id: st.id, label: `${sp.name} / ${st.name}` });
  return out;
}

// ---- Cancellation --------------------------------------------------------------
//
// Synthesis requests take an AbortSignal: stopping a rehearsal, pausing / closing
// the auto-play or cancelling a pre-generation aborts the request in flight rather
// than letting it run to completion for nothing. An aborted call rejects with an
// AbortError, which callers treat as "stopped", never as a failure.
export const isAbortError = (e: unknown): boolean => (e as { name?: string } | null)?.name === 'AbortError';
const abortError = (): Error => new DOMException('The synthesis was cancelled.', 'AbortError');

// Synthesize VOICEVOX audio WITHOUT playing it yet (so callers can prefetch the
// next segment while the current one plays). Returns an object URL for a WAV blob.
async function synthVoicevox(text: string, cfg: TtsConfig, signal?: AbortSignal): Promise<string> {
  const base = (cfg.voicevoxUrl || DEFAULT_TTS.voicevoxUrl).replace(/\/+$/, '');
  const speaker = cfg.voicevoxSpeaker || 0;
  const q = await fetch(`${base}/audio_query?speaker=${speaker}&text=${encodeURIComponent(text)}`, { method: 'POST', signal });
  if (!q.ok) throw new Error(`VOICEVOX /audio_query returned ${q.status}`);
  const query = await q.json();
  query.speedScale = Math.max(0.5, Math.min(2, cfg.rate || 1));
  // Aborted between the two calls → the (heavier) synthesis is never requested.
  const s = await fetch(`${base}/synthesis?speaker=${speaker}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(query), signal,
  });
  if (!s.ok) throw new Error(`VOICEVOX /synthesis returned ${s.status}`);
  const blob = await s.blob();
  return URL.createObjectURL(blob);
}

// ---- Irodori-TTS -------------------------------------------------------------

// The server sends no CORS headers unless IRODORI_CORS_ORIGINS is configured, so
// in Electron every call goes through a narrow relay in the main process
// (app/ttsRelay.cjs — only this server's API paths). The web build has no relay
// and calls the server directly; that needs the server's IRODORI_CORS_ORIGINS set
// to the page's origin (a JSON list, e.g. ["http://localhost:3000"]).
interface HttpResult { status: number; contentType: string; body: Uint8Array }
// A reference clip to register on the server as a voice (multipart upload).
interface VoiceUpload { voiceId?: string; filename: string; data: Uint8Array }
type TtsRelay = (req: {
  url: string; method: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: string; upload?: VoiceUpload; apiKey?: string; id?: string;
}) => Promise<HttpResult>;
type ElectronTts = { ttsHttp?: TtsRelay; ttsHttpAbort?: (id: string) => Promise<boolean> };

/** Where an Irodori server is and how to authenticate to it. `apiKey` is the
 *  server's IRODORI_API_KEY, sent as `Authorization: Bearer …` ('' = none). */
export interface IrodoriServer { url: string; apiKey?: string }
export const irodoriServerOf = (cfg: TtsConfig): IrodoriServer => ({ url: cfg.irodoriUrl, apiKey: cfg.irodoriApiKey });

const irodoriBase = (url: string): string => (url || DEFAULT_TTS.irodoriUrl).trim().replace(/\/+$/, '');

/** Does the server run on THIS computer? A voice registered on any other server
 *  can be spoken with (or replaced) by everyone who holds that server's key, and
 *  its audio file sits on a machine someone else administers. */
export function isLocalIrodoriServer(url: string): boolean {
  try {
    const host = new URL(irodoriBase(url)).hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return host === 'localhost' || host === '::1' || /^127\./.test(host);
  } catch { return false; }
}

// A bearer token travels in an HTTP header: printable ASCII only, no spaces —
// anything else would be rejected by the HTTP stack (or smuggle a header).
const API_KEY = /^[\x21-\x7E]+$/;
function apiKeyOf(server: IrodoriServer): string {
  const key = (server.apiKey || '').trim();
  if (key && !API_KEY.test(key)) throw new Error('Irodori-TTS: the API key may only contain printable ASCII characters (no spaces).');
  return key;
}

// `json` → POST it; `upload` → multipart POST (or PUT when `method` says so);
// neither → GET (or DELETE when `method` says so). `signal` aborts the request: the connection is closed, which is
// what makes the server stop a streamed synthesis (see irodoriSpeech).
async function irodoriHttp(
  server: IrodoriServer, path: string,
  opts: { json?: unknown; upload?: VoiceUpload; method?: 'POST' | 'PUT' | 'DELETE'; signal?: AbortSignal } = {},
): Promise<HttpResult> {
  const base = irodoriBase(server.url);
  const url = `${base}${path}`;
  const apiKey = apiKeyOf(server);
  const { json, upload, signal } = opts;
  if (signal?.aborted) throw abortError();
  const method = opts.method || (json !== undefined || upload ? 'POST' : 'GET');
  const body = json === undefined ? undefined : JSON.stringify(json);
  const electron = (window as unknown as { electronAPI?: ElectronTts }).electronAPI;
  const relay = electron?.ttsHttp;
  // The relay can only be interrupted by id (an AbortSignal cannot cross IPC).
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const onAbort = () => { void electron?.ttsHttpAbort?.(id); };
  try {
    if (relay) {
      signal?.addEventListener('abort', onAbort, { once: true });
      return await relay({ url, method, body, upload, id, ...(apiKey ? { apiKey } : {}) });
    }
    const headers: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
    let init: RequestInit = { method, headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers, body, signal };
    if (upload) {
      const form = new FormData();
      if (upload.voiceId) form.append('voice_id', upload.voiceId);
      form.append('file', new Blob([upload.data.slice()], { type: 'audio/wav' }), upload.filename);
      init = { method, headers, body: form, signal };
    }
    const res = await fetch(url, init);
    return { status: res.status, contentType: res.headers.get('content-type') || '', body: new Uint8Array(await res.arrayBuffer()) };
  } catch (e) {
    if (signal?.aborted) throw abortError();
    // Connection refused / DNS / CORS all land here. The raw text ("fetch failed",
    // "Error invoking remote method…") says nothing useful to a presenter.
    ttsLog('irodori request failed', url, String(e));
    throw new Error(`Irodori-TTS server not reachable at ${base} — is it running?`);
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

// The server answers errors OpenAI-style: {"error":{"message":…}}.
function irodoriError(r: HttpResult): string {
  // 401 = the server has IRODORI_API_KEY set and ours is missing or different.
  const hint = r.status === 401 ? ' — set the server’s API key in the Irodori-TTS settings.' : '';
  const text = new TextDecoder().decode(r.body);
  try {
    const j = JSON.parse(text);
    const m = j?.error?.message || j?.detail;
    if (m) return `Irodori-TTS: ${m}${hint}`;
  } catch { /* not JSON */ }
  return `Irodori-TTS returned HTTP ${r.status}${hint}`;
}

const irodoriJson = <T>(r: HttpResult): T => JSON.parse(new TextDecoder().decode(r.body)) as T;

// The server rejects any `model` but its configured name (IRODORI_MODEL_NAME,
// "irodori-tts" by default), so ask it once per server instead of assuming.
const irodoriModelIds = new Map<string, string>();
async function irodoriModelId(server: IrodoriServer): Promise<string> {
  const base = irodoriBase(server.url);
  const known = irodoriModelIds.get(base);
  if (known) return known;
  try {
    const r = await irodoriHttp(server, '/v1/models');
    const id = r.status === 200 ? irodoriJson<{ data?: Array<{ id?: string }> }>(r).data?.[0]?.id : undefined;
    if (id) { irodoriModelIds.set(base, id); return id; }
  } catch { /* fall through to the documented default */ }
  return 'irodori-tts';
}

/** Voice ids the server offers: the files in its voices/ folder, voices.json
 *  aliases, and 'none' (no reference — Voice Design / text only). */
export async function listIrodoriVoices(server: IrodoriServer): Promise<string[]> {
  const r = await irodoriHttp(server, '/v1/audio/voices');
  if (r.status !== 200) throw new Error(irodoriError(r));
  const ids = (irodoriJson<{ data?: Array<{ id?: string }> }>(r).data || []).map((v) => String(v.id || '')).filter(Boolean);
  return ids.sort((a, b) => (a === 'none' ? -1 : b === 'none' ? 1 : a.localeCompare(b)));
}

export interface IrodoriStatus { checkpoint: string; loaded: boolean; loading: boolean }

/** Server status. /health never loads the model, so it answers instantly — and
 *  tells whether the FIRST synthesis will have to wait for a model load. It is
 *  also the one endpoint the server leaves open without the API key. */
export async function irodoriHealth(server: IrodoriServer): Promise<IrodoriStatus> {
  const r = await irodoriHttp(server, '/health');
  if (r.status !== 200) throw new Error(irodoriError(r));
  const h = irodoriJson<{ model?: { hf_checkpoint?: string }; runtime?: { loaded?: boolean; loading?: boolean; checkpoint?: string } }>(r);
  return {
    checkpoint: String(h.runtime?.checkpoint || h.model?.hf_checkpoint || ''),
    loaded: !!h.runtime?.loaded,
    loading: !!h.runtime?.loading,
  };
}

// Join the WAVs of consecutive chunks into one: the first chunk's `fmt ` plus all
// `data` payloads (the chunks of one request share a format — 48 kHz 16-bit mono).
function joinWavs(parts: Uint8Array[]): Uint8Array {
  if (parts.length === 1) return parts[0];
  let fmt: Uint8Array | null = null;
  const datas: Uint8Array[] = [];
  const ascii = (b: Uint8Array, i: number) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
  for (const b of parts) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    if (b.length < 12 || ascii(b, 0) !== 'RIFF' || ascii(b, 8) !== 'WAVE') throw new Error('Irodori-TTS sent audio that is not a WAV file.');
    for (let i = 12; i + 8 <= b.length;) {
      const id = ascii(b, i);
      const size = Math.min(v.getUint32(i + 4, true), b.length - i - 8);
      const chunk = b.subarray(i + 8, i + 8 + size);
      if (id === 'fmt ') {
        if (!fmt) fmt = chunk;
        else if (fmt.length !== chunk.length || fmt.some((x, k) => x !== chunk[k])) throw new Error('Irodori-TTS sent chunks in different audio formats.');
      } else if (id === 'data') datas.push(chunk);
      i += 8 + size + (size & 1);
    }
  }
  if (!fmt) throw new Error('Irodori-TTS sent a WAV without a format chunk.');
  const dataLen = datas.reduce((n, d) => n + d.length, 0);
  const out = new Uint8Array(20 + fmt.length + 8 + dataLen);
  const w = new DataView(out.buffer);
  const put = (i: number, s: string) => { for (let k = 0; k < 4; k++) out[i + k] = s.charCodeAt(k); };
  put(0, 'RIFF'); w.setUint32(4, out.length - 8, true); put(8, 'WAVE');
  put(12, 'fmt '); w.setUint32(16, fmt.length, true); out.set(fmt, 20);
  let p = 20 + fmt.length;
  put(p, 'data'); w.setUint32(p + 4, dataLen, true); p += 8;
  for (const d of datas) { out.set(d, p); p += d.length; }
  return out;
}

// One /v1/audio/speech call → the WAV bytes. Always STREAMED (SSE, one event per
// text chunk), because that is the only mode in which the server notices a client
// leaving: when a stop/cancel aborts the request, a streamed synthesis ends after
// the chunk in progress, while a plain request renders the whole text for nobody
// (measured on v4-Large: ~3 s of wasted GPU time instead of ~48 s for a 6-chunk
// text). A request still waiting in the server's queue is dropped the same way.
async function irodoriSpeech(text: string, cfg: TtsConfig, signal?: AbortSignal): Promise<Uint8Array> {
  const server = irodoriServerOf(cfg);
  const caption = (cfg.irodoriCaption || '').trim();
  const r = await irodoriHttp(server, '/v1/audio/speech', {
    signal,
    json: {
      model: await irodoriModelId(server),
      input: text,
      voice: (cfg.irodoriVoice || '').trim() || 'none',
      response_format: 'wav',
      speed: Math.max(0.25, Math.min(4, cfg.rate || 1)),
      stream_format: 'sse',
      ...(caption ? { irodori: { caption } } : {}),
    },
  });
  // Errors found before streaming starts (auth, validation, model load) come back
  // as a plain JSON error response.
  if (r.status !== 200) throw new Error(irodoriError(r));
  const parts: Uint8Array[] = [];
  let done = false;
  for (const block of new TextDecoder().decode(r.body).split(/\r?\n\r?\n/)) {
    const event = /^event: *(.+)$/m.exec(block)?.[1]?.trim();
    const data = /^data: *(.*)$/m.exec(block)?.[1];
    if (!event || data === undefined) continue;
    const payload = JSON.parse(data);
    if (event === 'audio_chunk') {
      const bin = atob(String(payload.audio_base64 || ''));
      const bytes = new Uint8Array(bin.length);
      for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
      parts.push(bytes);
    } else if (event === 'error') {
      throw new Error(`Irodori-TTS: ${payload?.error?.message || 'synthesis failed'}`);
    } else if (event === 'done') {
      done = true;
    }
  }
  if (!done || !parts.length) throw new Error('Irodori-TTS: the audio stream ended before the synthesis finished.');
  return joinWavs(parts);
}

// Synthesize with Irodori WITHOUT playing (same contract as synthVoicevox).
async function synthIrodori(text: string, cfg: TtsConfig, signal?: AbortSignal): Promise<string> {
  const wav = await irodoriSpeech(text, cfg, signal);
  return URL.createObjectURL(new Blob([wav.slice()], { type: 'audio/wav' }));
}

// ---- Irodori: locking a designed voice ----------------------------------------
//
// A Voice Design caption alone does NOT fix the speaker: without a reference the
// server draws a fresh random seed per request (and per long-text chunk), and the
// caption only constrains WHAT KIND of voice comes out. Measured on v4-Large with a
// speaker-verification model: caption-only sentences matched each other as the
// same speaker in 2 of 6 pairs; a fixed seed barely helped (3 of 6); but ONE clip
// made from the caption and then used as the reference voice made every pair the
// same speaker (6 of 6, cosine ≥ 0.95). So "design once, then clone" is the way to
// get one steady narrator.

/** Neutral lecture-style text for that one design clip (~12 s at speed 1). */
export const IRODORI_REFERENCE_TEXT =
  'それでは、本日の内容を順番に説明していきます。まず前回の復習をしてから、'
  + '新しい概念を具体例とともに確認し、最後に簡単な演習に取り組みます。';

/** The server's rule for voice ids (they become file names in its voices/). */
export const IRODORI_VOICE_ID = /^[A-Za-z0-9_-]+$/;

/** Speak the reference text in a voice designed from `cfg.irodoriCaption` (no
 *  reference voice, natural speed) → WAV bytes to audition and then register. */
export async function designIrodoriVoice(cfg: TtsConfig, signal?: AbortSignal): Promise<Uint8Array> {
  return irodoriSpeech(IRODORI_REFERENCE_TEXT, { ...cfg, irodoriVoice: 'none', rate: 1 }, signal);
}

/** Register `wav` on the server as voice `voiceId` (a file in its voices/).
 *  Returns 'exists' when that id is taken and `replace` is false, so the caller
 *  can ask before overwriting. On a shared server every key holder sees — and
 *  can replace — the same set of voices. */
export async function saveIrodoriVoice(server: IrodoriServer, voiceId: string, wav: Uint8Array, replace = false): Promise<'saved' | 'exists'> {
  if (!IRODORI_VOICE_ID.test(voiceId)) throw new Error('A voice name may only contain letters, digits, - and _.');
  const upload: VoiceUpload = { filename: `${voiceId}.wav`, data: wav };
  const r = replace
    ? await irodoriHttp(server, `/v1/audio/voices/${voiceId}`, { upload, method: 'PUT' })
    : await irodoriHttp(server, '/v1/audio/voices', { upload: { ...upload, voiceId } });
  if (!replace && r.status === 409) return 'exists';
  if (r.status !== 200 && r.status !== 201) throw new Error(irodoriError(r));
  return 'saved';
}

/** Remove voice `voiceId` (its file in the server's voices/). A voices.json alias
 *  is not a file and cannot be removed this way (the server answers 404). */
export async function deleteIrodoriVoice(server: IrodoriServer, voiceId: string): Promise<void> {
  if (!IRODORI_VOICE_ID.test(voiceId)) throw new Error('A voice name may only contain letters, digits, - and _.');
  const r = await irodoriHttp(server, `/v1/audio/voices/${voiceId}`, { method: 'DELETE' });
  if (r.status !== 200) throw new Error(irodoriError(r));
}

function playAudioUrl(url: string, revoke: boolean, onProgress?: SpeakProgressCallback): Utterance {
  const audio = new Audio(url);
  let resolve!: () => void;
  const done = new Promise<void>((r) => { resolve = r; });
  const finish = () => { if (revoke) URL.revokeObjectURL(url); resolve(); };
  audio.onended = finish;
  audio.onerror = finish;
  if (onProgress) {
    audio.addEventListener('timeupdate', () => {
      const d = audio.duration;
      if (d > 0 && isFinite(d)) onProgress({ fraction: Math.min(1, audio.currentTime / d) });
    });
  }
  void audio.play().catch(finish);
  return { done, stop: () => { try { audio.pause(); } catch { /* ignore */ } finish(); } };
}

// ---- Prefetchable clips (for the narrated auto-play) ------------------------

// A prepared utterance: `play()` starts it (returns an Utterance) and may be called
// MORE THAN ONCE — a pre-generated clip is replayed when the show is restarted or
// jumps back. `dispose()` frees the held resources (the WAV's object URL); the clip
// must not be played afterwards. Callers own the lifetime: dispose every clip you
// synthesized once you are done with it.
export interface Clip { play: () => Utterance; dispose: () => void }

// Prepare `text` for the configured engine WITHOUT playing. For VOICEVOX / Irodori
// this does the (slow) synthesis up front, so the caller can prefetch the next unit
// during playback of the current one — or pre-generate the WHOLE show before it
// starts (see the auto-play's pre-generate mode). For Web Speech there is nothing
// to pre-synthesize, so play() speaks on demand.
// `signal` aborts a synthesis still in progress (rejects with an AbortError).
export async function synthesize(
  text: string, cfg: TtsConfig, sel?: VoiceSelect, onProgress?: SpeakProgressCallback, signal?: AbortSignal,
): Promise<Clip> {
  const t = (text || '').trim();
  if (!t) return { play: () => NOOP, dispose: () => {} };
  if (synthesizesAudio(cfg.engine)) {
    const url = cfg.engine === 'irodori' ? await synthIrodori(t, cfg, signal) : await synthVoicevox(t, cfg, signal);
    // Aborted just as the audio arrived: nobody will play it.
    if (signal?.aborted) { URL.revokeObjectURL(url); throw abortError(); }
    let freed = false;
    return {
      play: () => (freed ? NOOP : playAudioUrl(url, false, onProgress)),
      dispose: () => { if (!freed) { freed = true; URL.revokeObjectURL(url); } },
    };
  }
  return { play: () => (webSpeechAvailable() ? speakWebSpeech(t, cfg, sel, onProgress) : NOOP), dispose: () => {} };
}

// ---- Unified entry point ---------------------------------------------------

// Speak `text` with the configured engine. Returns immediately with an Utterance;
// for VOICEVOX / Irodori the async synthesis is wrapped so stop() works even
// mid-request — it aborts the request, so the server stops working on it too.
export function speak(text: string, cfg: TtsConfig, sel?: VoiceSelect, onProgress?: SpeakProgressCallback): Utterance {
  const t = (text || '').trim();
  if (!t) return NOOP;
  if (synthesizesAudio(cfg.engine)) {
    let stopped = false;
    let inner: Utterance | null = null;
    const ac = new AbortController();
    const done = (async () => {
      let clip: Clip;
      try {
        clip = await synthesize(t, cfg, sel, onProgress, ac.signal); // may throw if the engine is unreachable
      } catch (e) {
        if (stopped && isAbortError(e)) return;  // stopped mid-synthesis: not a failure
        throw e;
      }
      if (stopped) { clip.dispose(); return; }
      try {
        inner = clip.play();
        if (stopped) { inner.stop(); return; }
        await inner.done;
      } finally {
        clip.dispose();  // one-shot playback owns the clip
      }
    })();
    return { done, stop: () => { stopped = true; ac.abort(); inner?.stop(); } };
  }
  if (webSpeechAvailable()) return speakWebSpeech(t, cfg, sel, onProgress);
  return NOOP;
}
