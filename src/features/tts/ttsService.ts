// Text-to-speech for read-aloud (rehearsal, narrated auto-play, video export, module API).
// Three selectable engines:
//   - 'webspeech' : the browser/OS Web Speech API (SpeechSynthesis). Zero setup,
//     cross-platform; voices come from the OS (and, when online, cloud voices).
//   - 'voicevox'  : a LOCAL VOICEVOX engine (default http://127.0.0.1:50021). The
//     user runs VOICEVOX; we POST /audio_query then /synthesis and play the WAV.
//     CORS is permitted by the engine, so the renderer calls it directly.
//   - 'openai'    : any TTS server with OpenAI's speech API (POST /v1/audio/speech)
//     — one the user runs, such as Irodori-TTS-Server (default
//     http://127.0.0.1:8088), Kokoro-FastAPI or openedai-speech, or OpenAI itself.
//     Irodori-TTS-Server's extensions (reference voices, Voice Design) are used when
//     it is the server.
// VOICEVOX and the TTS server return AUDIO DATA, so their clips can be prefetched and
// pre-generated; Web Speech only speaks live. Config is persisted in app settings.

import {
  NO_DESCRIPTION, describeFromHealth, describeFromProfile, matchProfile, optionsFromOpenApi, reportedLanguages,
  speechRequestBody, type SpeechServerDescription,
} from './speechOptions';
import { onSpeechProfilesChanged, speechProfiles } from './speechProfiles';

export type TtsEngine = 'webspeech' | 'voicevox' | 'openai';

/** An SSH jump host ("bastion") the TTS-server requests can go through — desktop
 *  app only (app/sshTunnel.cjs). The bastion opens the connection to the server, so
 *  a server that admits only campus addresses works from home; `enabled` switches
 *  between that and connecting directly, keeping the rest. Secrets (password, key
 *  passphrase) are NOT here: the main process keeps them encrypted, bound to this
 *  bastion / key file. */
export interface SshBastion {
  enabled: boolean;
  host: string;
  port: number;
  user: string;
  auth: 'key' | 'password';
  keyPath: string;           // private key file for auth 'key' ('~' = home folder)
}

export const DEFAULT_SSH_BASTION: SshBastion = {
  enabled: false, host: '', port: 22, user: '', auth: 'key', keyPath: '~/.ssh/id_ed25519',
};

/** VOICEVOX voice shaping — audio_query's pitchScale / intonationScale /
 *  volumeScale. An absent field keeps the engine's own value for the style. */
export interface VoicevoxShape { pitch?: number; intonation?: number; volume?: number }

/** The range VOICEVOX accepts for each shaping value (values are clamped to it). */
export const VOICEVOX_SHAPE_RANGE: Record<keyof VoicevoxShape, readonly [number, number]> = {
  pitch: [-0.15, 0.15], intonation: [0, 2], volume: [0, 2],
};

export interface TtsConfig {
  engine: TtsEngine;
  rate: number;              // speaking rate; ~0.5–2.0. VOICEVOX speedScale / the server's `speed`.
  pitch: number;             // Web Speech pitch 0–2 (VOICEVOX and the server ignore it).
  webspeechVoiceURI: string; // chosen SpeechSynthesisVoice.voiceURI ('' = default)
  voicevoxUrl: string;       // e.g. http://127.0.0.1:50021
  voicevoxSpeaker: number;   // VOICEVOX style id
  openaiUrl: string;         // the TTS server's URL, with or without /v1 (e.g. http://127.0.0.1:8088)
  openaiApiKey: string;      // sent as Authorization: Bearer … ('' = the server needs none)
  openaiModel: string;       // '' = the speech model the server lists
  openaiVoice: string;       // the server's voice id ('' = its default; Irodori 'none' = no reference voice)
  openaiInstructions: string; // how to speak: Irodori's Voice Design caption / OpenAI's `instructions`
  openaiSsh: SshBastion;     // optional bastion to reach the server through
  // The TTS server's own options (speechOptions.ts): the server's defaults from the
  // settings, merged with a call's. Only the ones the server takes are sent.
  openaiExtra?: Record<string, unknown>;
  voicevoxShape?: VoicevoxShape; // per-utterance shaping (set by a call, never stored)
  lang?: string;             // the line's language (BCP-47), for a server's language option
}

export const DEFAULT_TTS: TtsConfig = {
  engine: 'webspeech',
  rate: 1,
  pitch: 1,
  webspeechVoiceURI: '',
  voicevoxUrl: 'http://127.0.0.1:50021',
  voicevoxSpeaker: 1,
  openaiUrl: 'http://127.0.0.1:8088',
  openaiApiKey: '',
  openaiModel: '',
  openaiVoice: '',
  openaiInstructions: '',
  openaiSsh: DEFAULT_SSH_BASTION,
};

/** Engines that return audio DATA (synthesized ahead of playback) rather than
 *  speaking live — so a clip can be prefetched or the whole show pre-generated,
 *  and a failure can fall back to Web Speech. */
export const synthesizesAudio = (engine: TtsEngine): boolean => engine === 'voicevox' || engine === 'openai';

/** Display name of an engine, for status lines and error messages. */
export const engineLabel = (engine: TtsEngine): string =>
  engine === 'voicevox' ? 'VOICEVOX' : engine === 'openai' ? 'TTS server (OpenAI-compatible)' : 'Web Speech';

/** An engine as a deck or a module script names it: 'server' / 'tts' / 'irodori' /
 *  'openai' all mean the TTS server. '' / 'auto' / anything else → null (the
 *  caller picks — by language and the app's narrator). */
export function engineFromName(name: string | null | undefined): TtsEngine | null {
  switch ((name || '').trim().toLowerCase()) {
    case 'webspeech': return 'webspeech';
    case 'voicevox': return 'voicevox';
    case 'openai': case 'server': case 'tts': case 'irodori': return 'openai';
    default: return null;
  }
}

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
// provides it) into the spoken string. VOICEVOX and the TTS server play pre-synthesized
// audio, so they report only `fraction` (0..1 of playback time) — an approximation.
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
  return URL.createObjectURL(await voicevoxWav(text, cfg, signal));
}

/** Write a shape into an audio_query (pitch → pitchScale, …), clamped to the range
 *  VOICEVOX accepts; absent or non-numeric values leave the style's own value. */
function applyVoicevoxShape(query: Record<string, unknown>, shape?: VoicevoxShape): void {
  if (!shape) return;
  for (const k of Object.keys(VOICEVOX_SHAPE_RANGE) as Array<keyof VoicevoxShape>) {
    const v = shape[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const [lo, hi] = VOICEVOX_SHAPE_RANGE[k];
    query[`${k}Scale`] = Math.max(lo, Math.min(hi, v));
  }
}

async function voicevoxWav(text: string, cfg: TtsConfig, signal?: AbortSignal): Promise<Blob> {
  const base = (cfg.voicevoxUrl || DEFAULT_TTS.voicevoxUrl).replace(/\/+$/, '');
  const speaker = cfg.voicevoxSpeaker || 0;
  const q = await fetch(`${base}/audio_query?speaker=${speaker}&text=${encodeURIComponent(text)}`, { method: 'POST', signal });
  if (!q.ok) throw new Error(`VOICEVOX /audio_query returned ${q.status}`);
  const query = await q.json();
  query.speedScale = Math.max(0.5, Math.min(2, cfg.rate || 1));
  applyVoicevoxShape(query, cfg.voicevoxShape);
  // Aborted between the two calls → the (heavier) synthesis is never requested.
  const s = await fetch(`${base}/synthesis?speaker=${speaker}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(query), signal,
  });
  if (!s.ok) throw new Error(`VOICEVOX /synthesis returned ${s.status}`);
  return s.blob();
}

/** The narration of `text` as audio BYTES — WAV from VOICEVOX; WAV (or what else the
 *  server sends, e.g. MP3) from a TTS server — for the video export, which needs the
 *  audio itself (Web Speech only plays aloud and gives no audio data, so it cannot
 *  be recorded this way). */
export async function synthesizeAudio(text: string, cfg: TtsConfig, signal?: AbortSignal): Promise<Uint8Array> {
  if (cfg.engine === 'openai') return (await serverSpeech(text, cfg, signal)).bytes;
  if (cfg.engine === 'voicevox') return new Uint8Array(await (await voicevoxWav(text, cfg, signal)).arrayBuffer());
  throw new Error('Web Speech gives no audio data — choose VOICEVOX or a TTS server to make a narrated video.');
}

// ---- OpenAI-compatible TTS servers ---------------------------------------------
//
// The 'openai' engine speaks through any server with OpenAI's speech API —
// POST <base>/v1/audio/speech {model, input, voice, response_format, speed}, with
// `Authorization: Bearer <key>` when the server wants a key: OpenAI itself, or a
// server the user runs (Irodori-TTS-Server, Kokoro-FastAPI, openedai-speech,
// Speaches…). `<base>` is the URL as the user gives it, with or without the /v1.
//
// Irodori-TTS-Server (Aratako) adds extensions, used when it is the server — its
// /health answers with the model runtime: a voices/ registry (list, register,
// replace and remove reference voices), Voice Design (`irodori.caption`), the
// model's load status, and SSE streaming, the one mode in which it notices a client
// leaving. Any other server gets a plain request, with the voice description sent
// as OpenAI's `instructions`; its voice list comes from /v1/audio/voices when it
// has one (Kokoro-FastAPI does), else the voice is typed in.
//
// These servers usually send no CORS headers (Irodori only with
// IRODORI_CORS_ORIGINS), so in Electron every call goes through a narrow relay in
// the main process (app/ttsRelay.cjs — only these API paths). The web build has no
// relay and calls the server directly; that needs the server to allow the page's
// origin (Irodori: IRODORI_CORS_ORIGINS, a JSON list, e.g. ["http://localhost:3000"]).

/** Why a request through the SSH bastion failed, in a form the settings panel can
 *  act on: 'hostkey-unknown' (first connection — show `fingerprint` to confirm),
 *  'hostkey-mismatch' (the key changed — `expected` was pinned), 'no-secret' /
 *  'auth' (password or passphrase missing or wrong), 'key', 'connect', 'forward'
 *  (the bastion cannot reach the server), 'config', 'unavailable'. */
export interface SshBastionProblem {
  code: string;
  message: string;
  host?: string;
  port?: number;
  fingerprint?: string;
  keyType?: string;
  expected?: string;
}
export class SshBastionError extends Error {
  readonly problem: SshBastionProblem;
  constructor(problem: SshBastionProblem) {
    super(`SSH bastion: ${problem.message}`);
    this.name = 'SshBastionError';
    this.problem = problem;
  }
}

// `messages`: Irodori's X-Irodori-Messages header (what the model did with the
// request), where it can be read — not by a web page unless the server exposes it.
interface HttpResult { status: number; contentType: string; body: Uint8Array; sshError?: SshBastionProblem; messages?: string }
// A reference clip to register on the server as a voice (multipart upload).
interface VoiceUpload { voiceId?: string; filename: string; data: Uint8Array }
type SshTarget = Omit<SshBastion, 'enabled'>;
type TtsRelay = (req: {
  url: string; method: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: string; upload?: VoiceUpload; apiKey?: string; id?: string;
  ssh?: SshTarget;
}) => Promise<HttpResult>;
type ElectronTts = { ttsHttp?: TtsRelay; ttsHttpAbort?: (id: string) => Promise<boolean> };

/** Where a TTS server is and how to reach it. `apiKey` goes out as
 *  `Authorization: Bearer …` ('' = none). `ssh`: go through this bastion (present
 *  only while its switch is on). */
export interface SpeechServer { url: string; apiKey?: string; ssh?: SshBastion }
export const speechServerOf = (cfg: TtsConfig): SpeechServer => ({
  url: cfg.openaiUrl,
  apiKey: cfg.openaiApiKey,
  ...(cfg.openaiSsh?.enabled ? { ssh: cfg.openaiSsh } : {}),
});

// The server's root: the URL as given, without a trailing /v1 (the paths add it).
const serverBase = (url: string): string =>
  (url || DEFAULT_TTS.openaiUrl).trim().replace(/\/+$/, '').replace(/\/v1$/i, '');
// One server = one root reached one way: the same address through a bastion is
// another machine.
const serverKey = (s: SpeechServer): string =>
  `${serverBase(s.url)}${s.ssh ? ` via ${s.ssh.user}@${s.ssh.host}:${s.ssh.port}` : ''}`;

/** The choices made on one server — they do not carry over to another, whose
 *  voices, models and options are its own (settings' `openaiProfiles`). */
export interface SpeechProfile { voice: string; model: string; instructions: string; extra?: Record<string, unknown> }

/** A named speaker a deck calls by name (`mainvoice: @name`): the engine, its voice and
 *  how it speaks (settings' `voicePresets` — this computer's). `connection` names a
 *  saved connection: the TTS server to speak on instead of the current one. */
export interface VoicePreset {
  name: string;
  engine: TtsEngine;
  voice: string;                     // Web Speech narrator, the server's voice id, or a VOICEVOX style id
  prompt?: string;                   // TTS server: how to speak
  extra?: Record<string, unknown>;   // TTS server: its own options
  voicevox?: VoicevoxShape;          // VOICEVOX shaping
  connection?: string;               // TTS server: a saved connection's name
}

/** A preset name a deck can write after `@` (no spaces or argument punctuation). */
export const PRESET_NAME = /^[\p{L}\p{N}_.-]{1,40}$/u;

/** A saved way to a TTS server — its URL, API key and the SSH bastion to go
 *  through (settings' `openaiConnections`) — picked from a list instead of typed
 *  again (the campus server, the one at home, OpenAI…). A bastion's password or
 *  passphrase is not in it: the main process keeps one per bastion. */
export interface SpeechConnection { name: string; url: string; apiKey: string; ssh: SshBastion }

/** Is `c` the connection the settings use now? The bastion's details count only
 *  while its switch is on (off, it is a direct connection either way). */
export function isSameConnection(c: SpeechConnection, cfg: Pick<TtsConfig, 'openaiUrl' | 'openaiApiKey' | 'openaiSsh'>): boolean {
  const a = c.ssh;
  const b = cfg.openaiSsh ?? DEFAULT_SSH_BASTION;
  const sameRoute = a.enabled === b.enabled && (!a.enabled || (
    a.host === b.host && a.port === b.port && a.user === b.user && a.auth === b.auth && (a.auth !== 'key' || a.keyPath === b.keyPath)));
  return serverBase(c.url) === serverBase(cfg.openaiUrl) && c.apiKey === (cfg.openaiApiKey || '') && sameRoute;
}

/** Which server a profile belongs to: its URL. A named server is the same machine
 *  whether reached directly or through a bastion (on campus / at home); only a
 *  loopback address through a bastion is the bastion itself. */
export function speechProfileKey(s: SpeechServer): string {
  const base = serverBase(s.url);
  try {
    const u = new URL(base);
    const key = `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
    const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const loopback = host === 'localhost' || host === '::1' || /^127\./.test(host);
    return loopback && s.ssh ? `${key} via ${s.ssh.host}` : key;
  } catch {
    return base;
  }
}

/** Does the server run on THIS computer? A voice registered on any other server
 *  can be spoken with (or replaced) by everyone who holds that server's key, and
 *  its audio file sits on a machine someone else administers. Through a bastion
 *  the address is the bastion's own, so `127.0.0.1` there is someone else's. */
export function isLocalSpeechServer(url: string, ssh?: SshBastion): boolean {
  if (ssh?.enabled) return false;
  try {
    const host = new URL(serverBase(url)).hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return host === 'localhost' || host === '::1' || /^127\./.test(host);
  } catch { return false; }
}

// ---- the SSH bastion's stored state (desktop app) --------------------------------

/** What the main process holds for a bastion — never the secrets themselves. */
export interface SshBastionInfo {
  encryption: boolean;       // the OS keystore can protect a saved secret
  hasPassword: boolean;      // for user@host:port
  hasPassphrase: boolean;    // for the key file
  hostKey: { fingerprint: string; keyType: string; at: number } | null;
}
type SshReply = { ok: true; info: SshBastionInfo } | { ok: false; problem: SshBastionProblem };
type SshApi = {
  ttsSshInfo?: (req: unknown) => Promise<SshReply>;
  ttsSshSecret?: (req: unknown) => Promise<SshReply>;
  ttsSshTrust?: (req: unknown) => Promise<SshReply>;
  ttsSshForget?: (req: unknown) => Promise<SshReply>;
};
const sshApi = (): SshApi | undefined => (window as unknown as { electronAPI?: SshApi }).electronAPI;

/** The bastion needs the desktop app (Node does the SSH; a browser cannot). */
export const sshBastionSupported = (): boolean => typeof sshApi()?.ttsSshInfo === 'function';

async function sshCall(name: keyof SshApi, req: unknown): Promise<SshBastionInfo> {
  const fn = sshApi()?.[name];
  if (!fn) throw new SshBastionError({ code: 'unavailable', message: 'The SSH bastion works only in the desktop app.' });
  const r = await fn(req);
  if (!r.ok) throw new SshBastionError(r.problem);
  return r.info;
}
export const sshBastionInfo = (ssh: SshBastion): Promise<SshBastionInfo> => sshCall('ttsSshInfo', ssh);
/** Save (or with '' clear) the password for user@host:port, or the key file's passphrase. */
export const setSshBastionSecret = (kind: 'password' | 'passphrase', ssh: SshBastion, value: string): Promise<SshBastionInfo> =>
  sshCall('ttsSshSecret', { ...ssh, kind, value });
/** Pin the host key the bastion just presented (after the user compared the fingerprint). */
export const trustSshBastionHostKey = (ssh: SshBastion, fingerprint: string): Promise<SshBastionInfo> =>
  sshCall('ttsSshTrust', { host: ssh.host, port: ssh.port, fingerprint });
/** Forget the pinned host key (the bastion's administrator replaced it). */
export const forgetSshBastionHostKey = (ssh: SshBastion): Promise<SshBastionInfo> =>
  sshCall('ttsSshForget', { host: ssh.host, port: ssh.port });

// ---- requests ------------------------------------------------------------------------

// A bearer token travels in an HTTP header: printable ASCII only, no spaces —
// anything else would be rejected by the HTTP stack (or smuggle a header).
const API_KEY = /^[\x21-\x7E]+$/;
function apiKeyOf(server: SpeechServer): string {
  const key = (server.apiKey || '').trim();
  if (key && !API_KEY.test(key)) throw new Error('TTS server: the API key may only contain printable ASCII characters (no spaces).');
  return key;
}

// `json` → POST it; `upload` → multipart POST (or PUT when `method` says so);
// neither → GET (or DELETE when `method` says so). `signal` aborts the request: the connection is closed, which is
// what makes Irodori stop a streamed synthesis (see irodoriStreamedSpeech).
async function speechHttp(
  server: SpeechServer, path: string,
  opts: { json?: unknown; upload?: VoiceUpload; method?: 'POST' | 'PUT' | 'DELETE'; signal?: AbortSignal } = {},
): Promise<HttpResult> {
  const base = serverBase(server.url);
  const url = `${base}${path}`;
  const apiKey = apiKeyOf(server);
  const { json, upload, signal } = opts;
  if (signal?.aborted) throw abortError();
  const method = opts.method || (json !== undefined || upload ? 'POST' : 'GET');
  const body = json === undefined ? undefined : JSON.stringify(json);
  const electron = (window as unknown as { electronAPI?: ElectronTts }).electronAPI;
  const relay = electron?.ttsHttp;
  const ssh = server.ssh?.enabled ? server.ssh : undefined;
  if (ssh && !relay) throw new SshBastionError({ code: 'unavailable', message: 'The SSH bastion works only in the desktop app.' });
  // The relay can only be interrupted by id (an AbortSignal cannot cross IPC).
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const onAbort = () => { void electron?.ttsHttpAbort?.(id); };
  let sshProblem: SshBastionProblem | undefined;
  try {
    if (relay) {
      signal?.addEventListener('abort', onAbort, { once: true });
      const res = await relay({
        url, method, body, upload, id, ...(apiKey ? { apiKey } : {}),
        ...(ssh ? { ssh: { host: ssh.host, port: ssh.port, user: ssh.user, auth: ssh.auth, keyPath: ssh.keyPath } } : {}),
      });
      if (!res.sshError) return res;
      sshProblem = res.sshError;       // thrown below, past the catch-all
    } else {
      const headers: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
      let init: RequestInit = { method, headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers, body, signal };
      if (upload) {
        const form = new FormData();
        if (upload.voiceId) form.append('voice_id', upload.voiceId);
        form.append('file', new Blob([upload.data.slice()], { type: 'audio/wav' }), upload.filename);
        init = { method, headers, body: form, signal };
      }
      const res = await fetch(url, init);
      const messages = res.headers.get('x-irodori-messages');
      return {
        status: res.status, contentType: res.headers.get('content-type') || '', body: new Uint8Array(await res.arrayBuffer()),
        ...(messages ? { messages } : {}),
      };
    }
  } catch (e) {
    if (signal?.aborted) throw abortError();
    // Connection refused / DNS / CORS all land here. The raw text ("fetch failed",
    // "Error invoking remote method…") says nothing useful to a presenter — except
    // through a bastion, where the tunnel works and the reason (a TLS certificate,
    // the server itself) is worth showing.
    ttsLog('TTS server request failed', url, String(e));
    if (ssh) {
      const why = String((e as Error)?.message || e).replace(/^[\s\S]*Error: /, '').replace(/^ttsHttp: /, '');
      throw new Error(`TTS server not reachable at ${base} through the SSH bastion ${ssh.host}: ${why}`);
    }
    throw new Error(`TTS server not reachable at ${base} — is it running?`);
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
  if (signal?.aborted) throw abortError();
  throw new SshBastionError(sshProblem as SshBastionProblem);
}

// Errors come back OpenAI-style ({"error":{"message":…}}) or FastAPI-style
// ({"detail":"…"} or a list of validation problems).
function speechError(r: HttpResult): string {
  // 401 = the server wants a key and ours is missing or different.
  const hint = r.status === 401 ? ' — set the server’s API key in the TTS settings.' : '';
  const text = new TextDecoder().decode(r.body);
  try {
    const j = JSON.parse(text);
    const detail = j?.detail;
    const m = j?.error?.message || (typeof detail === 'string' ? detail : Array.isArray(detail) ? detail[0]?.msg : '');
    if (m) return `TTS server: ${m}${hint}`;
  } catch { /* not JSON */ }
  return `The TTS server returned HTTP ${r.status}${hint}`;
}
const refused = (r: HttpResult): boolean => r.status === 401 || r.status === 403;

const speechJson = <T>(r: HttpResult): T => JSON.parse(new TextDecoder().decode(r.body)) as T;

// ---- what the server is and offers -------------------------------------------------

export interface IrodoriStatus { checkpoint: string; loaded: boolean; loading: boolean }

/** A server as Connect finds it. */
export interface SpeechServerInfo {
  /** 'irodori' = Irodori-TTS-Server: Voice Design and model status are available.
   *  'openai' = any other OpenAI-compatible server. */
  kind: 'irodori' | 'openai';
  /** Irodori's model status (null for other servers). */
  health: IrodoriStatus | null;
  /** Model ids from /v1/models ([] = the server lists none). */
  models: string[];
  /** The voices the server offers (null = it has no list: the voice is typed in). */
  voices: string[] | null;
  /** Voices can be registered here in Irodori-TTS-Server's way (see probeHealth). */
  voiceRegistry: boolean;
  /** What it takes beyond OpenAI's request, and what it speaks (speechOptions.ts). */
  description: SpeechServerDescription;
}

// Registering a voice is NOT part of OpenAI's speech API: Irodori-TTS-Server adds
// it (multipart `file` + `voice_id` to POST /v1/audio/voices, PUT to replace,
// DELETE — in every version since its first), and kjai01's Chatterbox server copies
// that form. OpenAI's own POST /v1/audio/voices takes another one (a sample plus a
// consent recording), so the path alone proves nothing and is never probed. A
// server is taken to register voices the Irodori way only when it says so in its
// /health: Irodori itself, or the same `voices` folder report (`files`).
interface HealthProbe {
  irodori: IrodoriStatus | null;
  voiceRegistry: boolean;
  /** An error status: the server is up but cannot say (e.g. a proxy whose TTS
   *  process is stopped) — ask again later rather than remember "not Irodori". */
  failed: HttpResult | null;
}

// /health — open without the API key and never loads the model, so it answers at
// once; Irodori's tells whether the FIRST synthesis will wait for a model load.
// Throws only when the server cannot be reached at all.
async function probeHealth(server: SpeechServer): Promise<HealthProbe> {
  const r = await speechHttp(server, '/health');
  if (r.status >= 500) return { irodori: null, voiceRegistry: false, failed: r };
  if (r.status !== 200) return { irodori: null, voiceRegistry: false, failed: null };
  try {
    const h = speechJson<{
      model?: { hf_checkpoint?: string }; runtime?: { loaded?: unknown; loading?: unknown; checkpoint?: string };
      voices?: { files?: unknown };
    }>(r);
    const voiceRegistry = typeof h?.voices?.files === 'number';
    if (!h?.model || !('hf_checkpoint' in h.model) || typeof h.runtime?.loaded !== 'boolean') {
      return { irodori: null, voiceRegistry, failed: null };
    }
    const irodori = {
      checkpoint: String(h.runtime.checkpoint || h.model.hf_checkpoint || ''),
      loaded: h.runtime.loaded,
      loading: !!h.runtime.loading,
    };
    return { irodori, voiceRegistry: true, failed: null };
  } catch { return { irodori: null, voiceRegistry: false, failed: null }; }
}

// Which kind each server is, found once per server (Connect finds it afresh).
const kinds = new Map<string, Promise<SpeechServerInfo['kind']>>();
const knownKinds = new Map<string, SpeechServerInfo['kind']>();
function serverKind(server: SpeechServer): Promise<SpeechServerInfo['kind']> {
  const key = serverKey(server);
  let p = kinds.get(key);
  if (!p) {
    const asked: Promise<SpeechServerInfo['kind']> = probeHealth(server).then(({ irodori, failed }) => {
      const kind = irodori ? 'irodori' : 'openai';
      if (!failed) knownKinds.set(key, kind);
      else if (kinds.get(key) === asked) kinds.delete(key);   // it could not say: ask again next time
      return kind;
    });
    p = asked;
    kinds.set(key, p);
    p.catch(() => { if (kinds.get(key) === asked) kinds.delete(key); });   // unreachable now: ask again next time
  }
  return p;
}
/** The server's kind if it is known already (undefined = not asked yet). */
export const knownServerKind = (server: SpeechServer): SpeechServerInfo['kind'] | undefined => knownKinds.get(serverKey(server));
/** Find out the server's kind in the background (e.g. at startup), so a later
 *  decision that needs it — which languages it speaks — has it at hand. */
export const warmUpSpeechServer = (server: SpeechServer): void => { serverKind(server).catch(() => { /* not running */ }); };

async function listModels(server: SpeechServer): Promise<string[]> {
  const r = await speechHttp(server, '/v1/models');
  if (refused(r)) throw new Error(speechError(r));
  if (r.status !== 200) return [];
  try {
    return (speechJson<{ data?: Array<{ id?: unknown }> }>(r).data || []).map((m) => String(m?.id || '')).filter(Boolean);
  } catch { return []; }
}

// Irodori answers {data:[{id,…}]}, Kokoro-FastAPI {voices:["af_bella",…]}; others
// have no such path (null: the voice is typed in).
async function listVoices(server: SpeechServer): Promise<string[] | null> {
  const r = await speechHttp(server, '/v1/audio/voices');
  if (refused(r)) throw new Error(speechError(r));
  if (r.status !== 200) return null;
  let list: unknown;
  try {
    const j = speechJson<{ data?: unknown; voices?: unknown }>(r);
    list = Array.isArray(j) ? j : Array.isArray(j?.data) ? j.data : j?.voices;
  } catch { return null; }
  if (!Array.isArray(list)) return null;
  const ids = list.map((v) => {
    if (typeof v === 'string') return v;
    const o = (v || {}) as { id?: unknown; voice_id?: unknown; name?: unknown };
    return String(o.id ?? o.voice_id ?? o.name ?? '');
  }).filter(Boolean);
  return ids.sort((a, b) => (a === 'none' ? -1 : b === 'none' ? 1 : a.localeCompare(b)));
}

/** Connect: what the server is (Irodori-TTS-Server or another OpenAI-compatible
 *  one), its models and voices. Rejects when it cannot be reached, refuses the
 *  API key, answers only errors (its TTS process is down — said in its words), or
 *  the bastion needs attention (SshBastionError). */
export async function inspectSpeechServer(server: SpeechServer): Promise<SpeechServerInfo> {
  const { irodori: health, voiceRegistry, failed } = await probeHealth(server);   // also: does it answer at all?
  if (failed) {
    // /health and /v1/models both failing = up, but not speaking (kjai01's proxy
    // with its TTS process stopped says "start it in the portal"): not "Connected".
    const m = await speechHttp(server, '/v1/models');
    if (m.status >= 500) throw new Error(speechError(m));
  }
  const kind = health ? 'irodori' : 'openai';
  const key = serverKey(server);
  if (!failed) {
    kinds.set(key, Promise.resolve(kind));
    knownKinds.set(key, kind);
  }
  const [models, voices, description] = await Promise.all([
    listModels(server), listVoices(server), describeSpeechServer(server, true).catch(() => NO_DESCRIPTION),
  ]);
  return { kind, health, models, voices, voiceRegistry, description };
}

// ---- what the server takes beyond OpenAI's request (speechOptions.ts) ----------------

const descriptions = new Map<string, Promise<SpeechServerDescription>>();
const knownDescriptions = new Map<string, SpeechServerDescription>();
// A profile added or changed in the workspace may describe a server differently.
onSpeechProfilesChanged(() => { descriptions.clear(); knownDescriptions.clear(); });

const jsonOf = (r: HttpResult | null): unknown => {
  if (!r || r.status !== 200) return null;
  try { return speechJson<unknown>(r); } catch { return null; }
};

// The server's own word (/health `options`), else a profile that recognizes it, else
// its OpenAPI schema, else nothing — none of them asked of the server. `passing`: the
// server answered only errors (a proxy whose TTS process is stopped) — not to be kept.
async function findDescription(server: SpeechServer): Promise<{ desc: SpeechServerDescription; passing: boolean }> {
  const [h, m] = await Promise.all([speechHttp(server, '/health'), speechHttp(server, '/v1/models').catch(() => null)]);
  const passing = h.status >= 500;
  const facts = { url: serverBase(server.url), health: jsonOf(h), models: jsonOf(m) };
  const own = describeFromHealth(facts.health, facts.models);
  if (own) return { desc: own, passing };
  const profile = matchProfile(speechProfiles(), facts);
  if (profile) return { desc: describeFromProfile(profile, facts), passing };
  const options = optionsFromOpenApi(jsonOf(await speechHttp(server, '/openapi.json').catch(() => null)));
  if (options.length) return { desc: { source: 'openapi', options, languages: reportedLanguages(facts), strict: true }, passing };
  return { desc: { ...NO_DESCRIPTION, languages: reportedLanguages(facts) }, passing };
}

/** What the server takes beyond OpenAI's speech request, and what it speaks — found
 *  once per server (`fresh`: ask again, as Connect does). Rejects only when the server
 *  cannot be reached; then, or when it answered only errors, it is asked again next time. */
export function describeSpeechServer(server: SpeechServer, fresh = false): Promise<SpeechServerDescription> {
  const key = serverKey(server);
  const cached = fresh ? undefined : descriptions.get(key);
  if (cached) return cached;
  const forget = () => { if (descriptions.get(key) === asked) descriptions.delete(key); };
  const asked: Promise<SpeechServerDescription> = findDescription(server).then(({ desc, passing }) => {
    if (passing) forget();
    else knownDescriptions.set(key, desc);
    return desc;
  });
  descriptions.set(key, asked);
  asked.catch(forget);
  return asked;
}
/** The server's description if it is known already (undefined = not asked yet). */
export const knownSpeechDescription = (server: SpeechServer): SpeechServerDescription | undefined =>
  knownDescriptions.get(serverKey(server));

/** The voices the server offers ([] = it has no list). */
export async function listServerVoices(server: SpeechServer): Promise<string[]> {
  return (await listVoices(server)) || [];
}

/** OpenAI's own voices — suggested when a server has no voice list. */
export const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'cedar', 'coral', 'echo', 'fable', 'marin', 'nova', 'onyx', 'sage', 'shimmer', 'verse'];

// The model to ask for when the settings name none. Irodori rejects any but its
// configured name (IRODORI_MODEL_NAME, "irodori-tts" by default) and OpenAI lists
// every model it has, so ask once per server and take its first speech model;
// failing that, OpenAI's 'tts-1', which most compatible servers accept as well.
const defaultModels = new Map<string, string>();
async function defaultModel(server: SpeechServer): Promise<string> {
  const key = serverKey(server);
  const known = defaultModels.get(key);
  if (known) return known;
  let ids: string[];
  try { ids = await listModels(server); } catch { return 'tts-1'; }   // a refused key shows on the speech request
  const pick = ids.find((id) => /tts/i.test(id)) || ids.find((id) => /speech|kokoro|irodori/i.test(id))
    || (ids.length === 1 ? ids[0] : '') || 'tts-1';
  defaultModels.set(key, pick);
  return pick;
}
/** The model a request will use: the configured one, else the server's own. */
export const speechModelFor = (cfg: TtsConfig): Promise<string> =>
  Promise.resolve((cfg.openaiModel || '').trim() || defaultModel(speechServerOf(cfg)));

// ---- speech ----------------------------------------------------------------------------

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

// Irodori: always STREAMED (SSE, one event per text chunk), because that is the only
// mode in which the server notices a client leaving: when a stop/cancel aborts the
// request, a streamed synthesis ends after the chunk in progress, while a plain
// request renders the whole text for nobody (measured on v4-Large: ~3 s of wasted
// GPU time instead of ~48 s for a 6-chunk text). A request still waiting in the
// server's queue is dropped the same way.
async function irodoriStreamedSpeech(server: SpeechServer, json: Record<string, unknown>, signal?: AbortSignal): Promise<Uint8Array> {
  const r = await speechHttp(server, '/v1/audio/speech', { signal, json: { ...json, response_format: 'wav', stream_format: 'sse' } });
  // Errors found before streaming starts (auth, validation, model load) come back
  // as a plain JSON error response.
  if (r.status !== 200) throw new Error(speechError(r));
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

// One /v1/audio/speech call → the audio. The body follows the server's description
// (speechOptions.ts): the description of the voice goes where the server takes it
// (OpenAI's `instructions`; Irodori's Voice Design caption), and only when there is
// one — tts-1 and many servers know no such field; the server's own options are sent
// if it takes them, its language option filled from the line's language. Irodori is
// streamed; any other server gets one plain request asking for WAV (MP3 when it has
// no WAV).
async function serverSpeech(text: string, cfg: TtsConfig, signal?: AbortSignal): Promise<{ bytes: Uint8Array; type: string }> {
  const server = speechServerOf(cfg);
  const [kind, desc] = await Promise.all([serverKind(server), describeSpeechServer(server).catch(() => NO_DESCRIPTION)]);
  const model = await speechModelFor(cfg);
  const json = speechRequestBody(
    {
      model,
      input: text,
      voice: (cfg.openaiVoice || '').trim() || desc.defaultVoice || (kind === 'irodori' ? 'none' : 'alloy'),
      speed: Math.max(0.25, Math.min(4, cfg.rate || 1)),
    },
    { prompt: cfg.openaiInstructions, extra: cfg.openaiExtra, lang: cfg.lang },
    desc,
    kind === 'irodori' ? 'irodori.caption' : 'instructions',   // where the prompt goes when nothing describes the server
  );
  if (kind === 'irodori') {
    return { bytes: await irodoriStreamedSpeech(server, json, signal), type: 'audio/wav' };
  }
  const ask = (format: string) => speechHttp(server, '/v1/audio/speech', { signal, json: { ...json, response_format: format } });
  let r = await ask('wav');
  if ((r.status === 400 || r.status === 422) && /format/i.test(new TextDecoder().decode(r.body))) r = await ask('mp3');
  if (r.status !== 200) throw new Error(speechError(r));
  const type = r.contentType.split(';')[0].trim().toLowerCase();
  if (!r.body.length || /json|^text\//.test(type)) throw new Error('The TTS server sent no audio.');
  return { bytes: r.body, type: type.startsWith('audio/') ? type : 'audio/wav' };
}

// Synthesize with the TTS server WITHOUT playing (same contract as synthVoicevox).
async function synthServer(text: string, cfg: TtsConfig, signal?: AbortSignal): Promise<string> {
  const { bytes, type } = await serverSpeech(text, cfg, signal);
  return URL.createObjectURL(new Blob([bytes.slice()], { type }));
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

/** Speak the reference text in a voice designed from `cfg.openaiInstructions` (no
 *  reference voice, natural speed) → WAV bytes to audition and then register. */
export async function designIrodoriVoice(cfg: TtsConfig, signal?: AbortSignal): Promise<Uint8Array> {
  return (await serverSpeech(IRODORI_REFERENCE_TEXT, { ...cfg, openaiVoice: 'none', rate: 1 }, signal)).bytes;
}

/** Register `wav` on the server as voice `voiceId` (a file in its voices/).
 *  Returns 'exists' when that id is taken and `replace` is false, so the caller
 *  can ask before overwriting. On a shared server every key holder sees — and
 *  can replace — the same set of voices. */
export async function saveIrodoriVoice(server: SpeechServer, voiceId: string, wav: Uint8Array, replace = false): Promise<'saved' | 'exists'> {
  if (!IRODORI_VOICE_ID.test(voiceId)) throw new Error('A voice name may only contain letters, digits, - and _.');
  const upload: VoiceUpload = { filename: `${voiceId}.wav`, data: wav };
  const r = replace
    ? await speechHttp(server, `/v1/audio/voices/${voiceId}`, { upload, method: 'PUT' })
    : await speechHttp(server, '/v1/audio/voices', { upload: { ...upload, voiceId } });
  if (!replace && r.status === 409) return 'exists';
  if (r.status !== 200 && r.status !== 201) throw new Error(speechError(r));
  return 'saved';
}

/** Remove voice `voiceId` (its file in the server's voices/). A voices.json alias
 *  is not a file and cannot be removed this way (the server answers 404). */
export async function deleteIrodoriVoice(server: SpeechServer, voiceId: string): Promise<void> {
  if (!IRODORI_VOICE_ID.test(voiceId)) throw new Error('A voice name may only contain letters, digits, - and _.');
  const r = await speechHttp(server, `/v1/audio/voices/${voiceId}`, { method: 'DELETE' });
  if (r.status !== 200) throw new Error(speechError(r));
}

// Whether the model Irodori has loaded USES a reference voice. Some checkpoints
// were trained without speaker conditioning (caption-only Voice Design ones): they
// accept a registered voice and silently ignore it — no error, a different
// speaker on every line. /health does not tell, and the streamed (SSE) answers
// MDP speaks with carry no messages, so it is asked once per loaded checkpoint
// with one tiny plain request (one character, one sampling step) in a registered
// voice, and read from X-Irodori-Messages ("speaker conditioning is disabled for
// this checkpoint; ignoring reference input"). The reference is resolved before
// any sampling, so the shortcut cannot change the answer.
const referenceUse = new Map<string, Promise<boolean | null>>();

/** Does the loaded Irodori model use reference voices? Asked with `voiceId`, a
 *  voice registered on the server. true / false, or null when it cannot tell: not
 *  Irodori (others keep their own contract), an error, or a header this page may
 *  not read (a web page sees it only if the server exposes it). */
export async function referenceVoicesUsed(server: SpeechServer, voiceId: string): Promise<boolean | null> {
  const { irodori } = await probeHealth(server);
  if (!irodori || !voiceId || voiceId === 'none') return null;
  const key = `${serverKey(server)}|${irodori.checkpoint}`;
  let p = referenceUse.get(key);
  if (!p) {
    const asked: Promise<boolean | null> = (async () => {
      const r = await speechHttp(server, '/v1/audio/speech', {
        json: {
          model: await defaultModel(server), input: 'あ', voice: voiceId, response_format: 'wav',
          irodori: { num_steps: 1 },
        },
      });
      if (r.status !== 200) return null;
      const m = r.messages || '';
      return /speaker conditioning is disabled/i.test(m) ? false : m ? true : null;
    })();
    p = asked.then((used) => {
      if (used === null && referenceUse.get(key) === p) referenceUse.delete(key);   // could not tell: ask again later
      return used;
    }, () => {
      if (referenceUse.get(key) === p) referenceUse.delete(key);
      return null;
    });
    referenceUse.set(key, p);
  }
  return p;
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

// Prepare `text` for the configured engine WITHOUT playing. For VOICEVOX / the TTS server
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
    // The line's language reaches a server whose language option needs it.
    const c = !cfg.lang && sel?.lang ? { ...cfg, lang: sel.lang } : cfg;
    const url = c.engine === 'openai' ? await synthServer(t, c, signal) : await synthVoicevox(t, c, signal);
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
// for VOICEVOX / the TTS server the async synthesis is wrapped so stop() works even
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
