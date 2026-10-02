// Module-facing TTS API, exposed as `window.mdpTts` (installed from main.tsx the
// same way `window.renderMathInElement` is). Module <script>s call it to speak
// text with the user's configured engine/narrator, optionally overridden per call:
//
//   window.mdpTts.speak('Water boils at 100 degrees.', { lang: 'en' })
//   window.mdpTts.speak('Hello', { voice: 'Zira', rate: 0.9 })
//   window.mdpTts.speak('こんにちは', { engine: 'voicevox', speaker: 3,
//                                     voicevox: { pitch: 0.05, intonation: 1.3 } })
//   window.mdpTts.speak('やったね！', { instructions: '明るく弾んだ若い女性の声' })  // TTS server
//   window.mdpTts.speak('Hello', { engine: 'server', serverVoice: 'my-voice',
//                                  extra: { cfg_weight: 0.5 } })                  // the server's own option
//   // a speaker as a deck writes it (module args) → speak() options:
//   window.mdpTts.speak(text, window.mdpTts.speakerOptions({ engine: 'voicevox', voice: '3', lang: 'ja-JP' }))
//   window.mdpTts.speak(text, window.mdpTts.speakerOptions({ voice: '@lecturer', lang: 'en-US' }))  // a preset
//   window.mdpTts.stop()
//   await window.mdpTts.voices()            // installed Web Speech narrators
//   await window.mdpTts.voicevoxSpeakers()  // VOICEVOX styles (engine must run)
//   await window.mdpTts.serverVoices()      // the TTS server's voice ids (server must run)
//   await window.mdpTts.serverOptions()     // what the TTS server takes beyond OpenAI's request
//
// Defaults track the app's TTS settings live: AppSettingsContext mirrors every
// settings change here via setModuleTtsDefaults(). Engine names: 'webspeech',
// 'voicevox', and the TTS server as 'openai' / 'server' / 'tts' (old: 'irodori');
// none or 'auto' = auto-selection — by language: VOICEVOX speaks only Japanese; a TTS
// server speaks what its description says (speechOptions.ts), else Irodori-TTS — the
// usual one — is taken to speak only Japanese and an OpenAI-type server everything.
// When the engine cannot speak (not running, not configured, an unknown voice…),
// speak() falls back — by default to the app's own narrator (when that is another
// engine able to speak the language), then to Web Speech — so a presentation never
// goes silent; `fallback: 'webspeech'` skips the app narrator, `'none'` stays silent.
// `onEngine` reports which engine is speaking (and why a fallback happened).
// Old names still accepted: irodoriVoice (= serverVoice), caption (= instructions),
// irodoriVoices() (= serverVoices()).
import {
  DEFAULT_SSH_BASTION,
  DEFAULT_TTS,
  describeSpeechServer,
  engineFromName,
  engineLabel,
  isAbortError,
  knownServerKind,
  knownSpeechDescription,
  listServerVoices,
  listVoicevoxSpeakers,
  loadWebSpeechVoices,
  speak as ttsSpeak,
  speechProfileKey,
  speechServerOf,
  synthesizesAudio,
  ttsLog,
  warmUpSpeechServer,
  webSpeechAvailable,
  type SpeechConnection,
  type SpeechProfile,
  type SpeechServer,
  type SshBastion,
  type SpeakProgressCallback,
  type TtsConfig,
  type TtsEngine,
  type Utterance,
  type VoicePreset,
  type VoiceSelect,
  type VoicevoxShape,
  type VoicevoxStyle,
} from './ttsService';
import { mergeOptions, parseExtra, speaksLanguage, type SpeechServerDescription } from './speechOptions';

/** An engine as a call names it (see engineFromName); 'auto' = pick automatically. */
export type MdpTtsEngineName = TtsEngine | 'server' | 'tts' | 'irodori' | 'auto';

/** What to do when the engine cannot speak: 'auto' = the app's narrator (if it is
 *  another engine that speaks the language), then Web Speech; 'webspeech' = Web
 *  Speech only; 'none' = stay silent. */
export type MdpTtsFallback = 'auto' | 'webspeech' | 'none';

/** Reported through `onEngine` before each attempt, and once more (engine null)
 *  when nothing could speak. */
export interface MdpTtsEngineInfo {
  engine: TtsEngine | null; // the engine about to speak; null = none could
  fallback: boolean;        // not the speaker that was asked for
  failed?: TtsEngine;       // the engine that just failed
  error?: string;           // why it failed
  message?: string;         // on a fallback: what happened, ready to show (e.g. in a tooltip)
}

export interface MdpTtsSpeakOptions {
  engine?: MdpTtsEngineName; // omit / 'auto' = settings default (a non-ja lang may force webspeech)
  voice?: string;       // Web Speech narrator by name/URI, substring ok (e.g. 'Zira')
  lang?: string;        // the text's language: narrator pick, and a TTS server's language option
  rate?: number;        // speaking rate (default: settings)
  pitch?: number;       // Web Speech pitch (default: settings)
  speaker?: number;     // VOICEVOX style id (default: settings)
  voicevox?: VoicevoxShape; // VOICEVOX pitch -0.15–0.15, intonation 0–2, volume 0–2
  serverVoice?: string; // the TTS server's voice id (Irodori: 'none' = no reference voice)
  instructions?: string; // how the TTS server should speak (Irodori Voice Design / OpenAI instructions)
  extra?: Record<string, unknown>; // the TTS server's own options (sent only if it takes them)
  connection?: string;  // the TTS server: one of the user's saved connections, by name
  irodoriVoice?: string; // old name of serverVoice
  caption?: string;     // old name of instructions
  url?: string;         // URL of the chosen engine — VOICEVOX or the TTS server (default: settings)
  fallback?: MdpTtsFallback; // when the engine cannot speak (default 'auto', see above)
  onEngine?: (info: MdpTtsEngineInfo) => void;
  notice?: string;      // something to report with the first onEngine (e.g. a missing preset)
  exclusive?: boolean;  // default true: stop the previous mdpTts utterance first
  // Spoken-position callback for read-along highlighting. Web Speech reports
  // { charIndex, charLength? } per word; VOICEVOX / the TTS server report { fraction }
  // (0..1 of playback time). Indices refer to the trimmed text passed to speak().
  onProgress?: SpeakProgressCallback;
}

/** A speaker as a deck writes it (module args, read as strings): the engine, ONE
 *  `voice` of that engine's kind (a Web Speech narrator name, the server's voice
 *  id, a VOICEVOX style id — or `@name`, a voice preset), the server's `prompt` and
 *  own options (`extra`, "k=v, k2=v2"), VOICEVOX shaping, plus lang / rate / fallback
 *  and the older `speaker` (VOICEVOX style for a Japanese line left on auto). */
export interface SpeakerSpec {
  engine?: string; voice?: string; prompt?: string; extra?: string | Record<string, unknown>;
  pitch?: string | number; intonation?: string | number; volume?: string | number;
  lang?: string; rate?: string | number; fallback?: string; speaker?: string | number;
}

export interface MdpTtsVoice {
  name: string; lang: string; uri: string; localService: boolean; default: boolean;
}

export interface MdpTtsApi {
  speak(text: string, opts?: MdpTtsSpeakOptions): Utterance;
  /** speak() options for a speaker as a deck writes it (see SpeakerSpec). */
  speakerOptions(spec: SpeakerSpec): MdpTtsSpeakOptions;
  stop(): void;
  voices(): Promise<MdpTtsVoice[]>;
  voicevoxSpeakers(url?: string): Promise<VoicevoxStyle[]>;
  serverVoices(url?: string): Promise<string[]>;
  irodoriVoices(url?: string): Promise<string[]>;
  /** What the TTS server (or a saved connection's) takes beyond OpenAI's request. */
  serverOptions(connection?: string): Promise<SpeechServerDescription>;
  config(): TtsConfig;
}

/** What the module API mirrors from the settings: the narrator, and — kept here,
 *  never handed to a script — the saved connections, each server's choices, and the
 *  voice presets. */
export type ModuleTtsSettings = TtsConfig & {
  openaiProfiles?: Record<string, SpeechProfile>;
  openaiConnections?: SpeechConnection[];
  voicePresets?: VoicePreset[];
};

let defaults: ModuleTtsSettings = { ...DEFAULT_TTS };

/** Mirror the app's TTS settings into the module API's defaults. */
export function setModuleTtsDefaults(cfg: ModuleTtsSettings): void {
  defaults = { ...cfg };
  // Learn early which kind the TTS server is and what it takes (which languages it speaks).
  if (cfg.engine === 'openai') {
    const server = speechServerOf(cfg);
    warmUpSpeechServer(server);
    describeSpeechServer(server).catch(() => { /* not running */ });
  }
}

/** The narrator's own settings — only TtsConfig's fields (with the key: internal use). */
const narrator = (): TtsConfig => ({
  engine: defaults.engine, rate: defaults.rate, pitch: defaults.pitch, webspeechVoiceURI: defaults.webspeechVoiceURI,
  voicevoxUrl: defaults.voicevoxUrl, voicevoxSpeaker: defaults.voicevoxSpeaker,
  openaiUrl: defaults.openaiUrl, openaiApiKey: defaults.openaiApiKey, openaiModel: defaults.openaiModel,
  openaiVoice: defaults.openaiVoice, openaiInstructions: defaults.openaiInstructions,
  openaiExtra: defaults.openaiExtra, openaiSsh: defaults.openaiSsh,
});

const NOOP: Utterance = { done: Promise.resolve(), stop: () => {} };

// The one utterance the module API is currently playing (exclusive by default —
// a lecture slide should not layer two narrations).
let current: Utterance | null = null;

// Normalized "which server" of a URL (scheme, host, port, path).
const serverKey = (url: string): string | null => {
  try { const u = new URL(url.trim()); return `${u.origin}${u.pathname.replace(/\/+$/, '').replace(/\/v1$/i, '')}`; } catch { return null; }
};
/** Is a module-supplied `url` the TTS server the user configured (or none given)? */
function isUsersServer(url: string | undefined): boolean {
  if (!url) return true;
  const mine = serverKey(defaults.openaiUrl);
  return mine !== null && serverKey(url) === mine;
}
/** The API key to send for a module-supplied `url`: the user's key only for the
 *  server the user configured. */
const keyFor = (url: string | undefined): string => (isUsersServer(url) ? defaults.openaiApiKey : '');
/** Same rule for the user's SSH bastion: it carries only requests to the server
 *  the user configured, so a module cannot use the user's SSH login to reach
 *  other hosts behind the bastion. */
const sshFor = (url: string | undefined): SshBastion =>
  (isUsersServer(url) ? defaults.openaiSsh : { ...defaults.openaiSsh, enabled: false });

/** One of the user's saved connections, by name (case-insensitive). A deck can only
 *  NAME it — its URL, key and bastion stay here. */
const connectionNamed = (name: string | undefined): SpeechConnection | undefined => {
  const n = (name || '').trim().toLowerCase();
  return n ? (defaults.openaiConnections || []).find((c) => c.name.toLowerCase() === n) : undefined;
};
const serverOfConnection = (c: SpeechConnection): SpeechServer =>
  speechServerOf({ ...narrator(), openaiUrl: c.url, openaiApiKey: c.apiKey, openaiSsh: c.ssh });

const isJapanese = (lang: string): boolean => /^ja\b|^ja[-_]/i.test(lang.trim());

/** Can `engine` speak `lang`? VOICEVOX: Japanese only. The TTS server: what its
 *  description says; when it does not say, Irodori-TTS — the usual one, and what a
 *  server not yet known to be another kind is taken for — speaks only Japanese. */
function speaksLang(engine: TtsEngine, lang?: string): boolean {
  if (!lang || isJapanese(lang)) return true;
  if (engine === 'voicevox') return false;
  if (engine === 'openai') {
    const server = speechServerOf(defaults);
    const desc = knownSpeechDescription(server);
    const says = desc ? speaksLanguage(desc, lang) : undefined;
    if (says !== undefined) return says;
    return knownServerKind(server) === 'openai';
  }
  return true;
}

/** A finite number from a number or a numeric string; anything else → undefined. */
const numberOf = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const extraOf = (v: unknown): Record<string, unknown> =>
  (typeof v === 'string' ? parseExtra(v) : v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
// A VOICEVOX shape from a spec, without the fields it leaves blank.
const shapeOf = (spec: SpeakerSpec): VoicevoxShape => {
  const s: VoicevoxShape = {};
  const p = numberOf(spec.pitch); if (p !== undefined) s.pitch = p;
  const i = numberOf(spec.intonation); if (i !== undefined) s.intonation = i;
  const v = numberOf(spec.volume); if (v !== undefined) s.volume = v;
  return s;
};
// What every speaker carries: the language, the rate, what to do on failure.
const commonOptions = (spec: SpeakerSpec): MdpTtsSpeakOptions => {
  const o: MdpTtsSpeakOptions = {};
  const lang = (spec.lang || '').trim();
  const rate = numberOf(spec.rate);
  const fallback = (spec.fallback || '').trim();
  if (lang) o.lang = lang;
  if (rate !== undefined && rate > 0) o.rate = rate;
  if (fallback === 'auto' || fallback === 'webspeech' || fallback === 'none') o.fallback = fallback;
  return o;
};

// A preset, with the deck's own prompt / options / VOICEVOX shaping on top.
function presetOptions(name: string, spec: SpeakerSpec): MdpTtsSpeakOptions {
  const o = commonOptions(spec);
  const p = (defaults.voicePresets || []).find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!p) {
    // Not on this computer: read by the line's language, and say so.
    o.notice = `No voice preset “@${name}” on this computer — read by its language`;
    return o;
  }
  o.engine = p.engine;
  if (p.engine === 'openai') {
    if (p.voice) o.serverVoice = p.voice;
    const prompt = (spec.prompt || '').trim() || p.prompt || '';
    if (prompt) o.instructions = prompt;
    const extra = mergeOptions(p.extra, extraOf(spec.extra));
    if (Object.keys(extra).length) o.extra = extra;
    if (p.connection) o.connection = p.connection;
  } else if (p.engine === 'voicevox') {
    const id = numberOf(p.voice);
    if (id !== undefined && Number.isInteger(id) && id >= 0) o.speaker = id;
    o.voicevox = { ...(p.voicevox || {}), ...shapeOf(spec) };
  } else if (p.voice) {
    o.voice = p.voice;
  }
  return o;
}

/** speak() options for a speaker as a deck writes it — the one mapping behind the
 *  speech modules (window.mdpTts.speakerOptions) and the module settings dialog. */
export function speakerOptions(spec: SpeakerSpec): MdpTtsSpeakOptions {
  const voice = (spec.voice || '').trim();
  if (voice.startsWith('@')) return presetOptions(voice.slice(1).trim(), spec);
  const o = commonOptions(spec);
  const engine = engineFromName(spec.engine);
  if (engine === 'openai') {
    o.engine = 'openai';
    if (voice) o.serverVoice = voice;
    const prompt = (spec.prompt || '').trim();
    if (prompt) o.instructions = prompt;
    const extra = extraOf(spec.extra);
    if (Object.keys(extra).length) o.extra = extra;
  } else if (engine === 'voicevox') {
    o.engine = 'voicevox';
    const id = numberOf(voice);
    if (id !== undefined && Number.isInteger(id) && id >= 0) o.speaker = id;
    o.voicevox = shapeOf(spec);
  } else if (engine === 'webspeech') {
    o.engine = 'webspeech';
    if (voice) o.voice = voice;
  } else {
    const older = numberOf(spec.speaker);
    if (isJapanese(o.lang || '') && older !== undefined && older >= 0) o.speaker = older;
    else if (voice) o.voice = voice;
  }
  return o;
}

function pickEngine(opts: MdpTtsSpeakOptions): TtsEngine {
  const named = engineFromName(opts.engine);
  if (named) return named;
  // An explicit Web-Speech narrator implies webspeech; an explicit VOICEVOX
  // speaker implies voicevox; a server voice, voice description or server option
  // implies the TTS server (whichever the settings default is).
  if (opts.voice) return 'webspeech';
  if (typeof opts.speaker === 'number') return 'voicevox';
  if (opts.serverVoice || opts.irodoriVoice || opts.instructions || opts.caption || opts.connection) return 'openai';
  // A language the configured engine cannot speak means Web Speech.
  if (opts.lang && !speaksLang(defaults.engine, opts.lang)) return 'webspeech';
  return defaults.engine;
}

const promptOf = (opts: MdpTtsSpeakOptions, otherwise: string): string =>
  (typeof opts.instructions === 'string' ? opts.instructions : typeof opts.caption === 'string' ? opts.caption : otherwise);

/** The settings with one call's overrides, for `engine`. */
function configFor(engine: TtsEngine, opts: MdpTtsSpeakOptions): TtsConfig {
  const base: TtsConfig = {
    ...narrator(),
    engine,
    rate: numberOf(opts.rate) ?? defaults.rate,
    pitch: numberOf(opts.pitch) ?? defaults.pitch,
    voicevoxUrl: (engine === 'voicevox' && opts.url) || defaults.voicevoxUrl,
    voicevoxSpeaker: numberOf(opts.speaker) ?? defaults.voicevoxSpeaker,
    voicevoxShape: opts.voicevox,
    lang: opts.lang,
  };
  const conn = engine === 'openai' ? connectionNamed(opts.connection) : undefined;
  if (conn) {
    // One of the user's own saved connections: its key and bastion, and what was
    // chosen on that server before.
    const prof = defaults.openaiProfiles?.[speechProfileKey(serverOfConnection(conn))];
    return {
      ...base,
      openaiUrl: conn.url, openaiApiKey: conn.apiKey, openaiSsh: conn.ssh,
      openaiModel: prof?.model ?? '',
      openaiVoice: opts.serverVoice || opts.irodoriVoice || prof?.voice || '',
      openaiInstructions: promptOf(opts, prof?.instructions ?? ''),
      openaiExtra: mergeOptions(prof?.extra, opts.extra),
    };
  }
  const mine = isUsersServer(opts.url);
  return {
    ...base,
    openaiUrl: (engine === 'openai' && opts.url) || defaults.openaiUrl,
    // The user's API key only ever goes to the server the USER configured: a
    // module script (possibly from someone else's shared `.mdp`) that names its
    // own `url` must not be able to collect the key from its requests.
    openaiApiKey: keyFor(opts.url),
    openaiSsh: sshFor(opts.url),
    // Another server has other models and options: let it use its own.
    openaiModel: mine ? defaults.openaiModel : '',
    openaiVoice: opts.serverVoice || opts.irodoriVoice || defaults.openaiVoice,
    openaiInstructions: promptOf(opts, defaults.openaiInstructions),
    openaiExtra: mergeOptions(mine ? defaults.openaiExtra : undefined, opts.extra),
  };
}

/** What a fallback did, in words (shown by the modules' tooltips and the dialog). */
const fallbackMessage = (failed: TtsEngine, error: string | undefined, next: TtsEngine | null): string =>
  `${engineLabel(failed)} could not speak${error ? ` (${error})` : ''} — `
  + (next ? `used ${engineLabel(next)}` : 'nothing else to use');

interface Attempt { cfg: TtsConfig; sel: VoiceSelect }

/** The engine asked for, then — when it cannot speak, as `fallback` says — the app's
 *  narrator (another engine that speaks the language, with the app's OWN voice
 *  settings, never those meant for the failed engine) and Web Speech (the call's
 *  narrator / language). */
function attemptsFor(engine: TtsEngine, opts: MdpTtsSpeakOptions): Attempt[] {
  const cfg = configFor(engine, opts);
  const sel: VoiceSelect = { voice: opts.voice, lang: opts.lang };
  const out: Attempt[] = [{ cfg, sel }];
  const mode: MdpTtsFallback = opts.fallback === 'webspeech' || opts.fallback === 'none' ? opts.fallback : 'auto';
  if (mode === 'none' || !synthesizesAudio(engine)) return out;
  const app = defaults.engine;
  const appIsOther = app !== engine || (engine === 'openai' && !!connectionNamed(opts.connection));
  if (mode === 'auto' && appIsOther && synthesizesAudio(app) && speaksLang(app, opts.lang)) {
    out.push({ cfg: { ...narrator(), rate: cfg.rate, lang: opts.lang }, sel: { lang: opts.lang } });
  }
  if (webSpeechAvailable()) out.push({ cfg: { ...cfg, engine: 'webspeech' }, sel });
  return out;
}

const api: MdpTtsApi = {
  speak(text: string, opts: MdpTtsSpeakOptions = {}): Utterance {
    const t = String(text ?? '').trim();
    if (!t) return NOOP;
    let stopped = false;
    let inner: Utterance | null = null;
    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : undefined;
    const report = (info: MdpTtsEngineInfo) => {
      try { opts.onEngine?.(info); } catch { /* a module's own callback failing is not ours */ }
    };
    const run = async (): Promise<void> => {
      ttsLog('mdpTts.speak', { text: t.slice(0, 40), opts: { ...opts, onProgress: !!opts.onProgress, onEngine: !!opts.onEngine } });
      if (opts.exclusive !== false) api.stop();
      const attempts = attemptsFor(pickEngine(opts), opts);
      let failed: TtsEngine | undefined;
      let error: string | undefined;
      for (let i = 0; i < attempts.length && !stopped; i++) {
        const { cfg, sel } = attempts[i];
        report(failed
          ? { engine: cfg.engine, fallback: true, failed, error, message: fallbackMessage(failed, error, cfg.engine) }
          : opts.notice ? { engine: cfg.engine, fallback: true, message: opts.notice } : { engine: cfg.engine, fallback: false });
        // Narrator matching needs the voice list, which loads async on first use.
        if (cfg.engine === 'webspeech') await loadWebSpeechVoices();
        if (stopped) return;
        try {
          inner = current = ttsSpeak(t, cfg, sel, onProgress);
          await inner.done;
          return;
        } catch (err) {
          if (stopped || isAbortError(err)) return;
          failed = cfg.engine;
          error = String((err as Error)?.message || err);
          ttsLog('speak: engine failed', { engine: failed, error });
        }
      }
      if (failed && !stopped) report({ engine: null, fallback: true, failed, error, message: fallbackMessage(failed, error, null) });
    };
    // `done` never rejects: an unexpected failure is logged rather than swallowed
    // by a caller's `.then(done, done)`.
    const done = run().catch((err) => { ttsLog('speak: UNEXPECTED ERROR', String((err as Error)?.stack || err)); });
    return { done, stop: () => { stopped = true; inner?.stop(); } };
  },

  speakerOptions,

  stop(): void {
    const u = current;
    if (u) ttsLog('mdpTts.stop (had a current utterance)');
    current = null;
    try { u?.stop(); } catch { /* ignore */ }
  },

  async voices(): Promise<MdpTtsVoice[]> {
    const vs = await loadWebSpeechVoices();
    return vs.map((v) => ({ name: v.name, lang: v.lang, uri: v.voiceURI, localService: v.localService, default: v.default }));
  },

  voicevoxSpeakers(url?: string): Promise<VoicevoxStyle[]> {
    return listVoicevoxSpeakers(url || defaults.voicevoxUrl);
  },

  serverVoices(url?: string): Promise<string[]> {
    // Same rule as speak(): the key and the bastion serve only the configured server.
    return listServerVoices(speechServerOf({
      ...narrator(), openaiUrl: url || defaults.openaiUrl, openaiApiKey: keyFor(url), openaiSsh: sshFor(url),
    }));
  },

  irodoriVoices(url?: string): Promise<string[]> {
    return api.serverVoices(url);
  },

  serverOptions(connection?: string): Promise<SpeechServerDescription> {
    const conn = connectionNamed(connection);
    return describeSpeechServer(conn ? serverOfConnection(conn) : speechServerOf(defaults));
  },

  config(): TtsConfig {
    // Module scripts may read the narrator's settings — only those: never an API key
    // (the server's, or a saved connection's), nor the bastion's account and key
    // file (only whether it is in use), nor the presets' and connections' lists.
    return {
      ...narrator(),
      openaiApiKey: '',
      openaiExtra: mergeOptions(undefined, defaults.openaiExtra),   // a copy: never the settings' own objects
      openaiSsh: { ...DEFAULT_SSH_BASTION, enabled: defaults.openaiSsh.enabled },
    };
  },
};

/** The API itself, for app UI that offers the same choices as module scripts (the
 *  module settings dialog lists voices and auditions them through it). */
export function getModuleTtsApi(): MdpTtsApi {
  return api;
}

/** Install the API on window (called once from main.tsx). */
export function installModuleTtsApi(): void {
  (window as unknown as { mdpTts?: MdpTtsApi }).mdpTts = api;
}
