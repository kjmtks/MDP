// Module-facing TTS API, exposed as `window.mdpTts` (installed from main.tsx the
// same way `window.renderMathInElement` is). Module <script>s call it to speak
// text with the user's configured engine/narrator, optionally overridden per call:
//
//   window.mdpTts.speak('Water boils at 100 degrees.', { lang: 'en' })
//   window.mdpTts.speak('Hello', { voice: 'Zira', rate: 0.9 })
//   window.mdpTts.speak('こんにちは', { engine: 'voicevox', speaker: 3 })
//   window.mdpTts.speak('やったね！', { instructions: '明るく弾んだ若い女性の声' })  // TTS server
//   window.mdpTts.speak('はじめます', { serverVoice: 'narrator' })                   // TTS server
//   window.mdpTts.stop()
//   await window.mdpTts.voices()            // installed Web Speech narrators
//   await window.mdpTts.voicevoxSpeakers()  // VOICEVOX styles (engine must run)
//   await window.mdpTts.serverVoices()      // the TTS server's voice ids (server must run)
//
// Defaults track the app's TTS settings live: AppSettingsContext mirrors every
// settings change here via setModuleTtsDefaults(). Engine auto-selection: VOICEVOX
// (and Irodori-TTS, the usual TTS server) speak only Japanese, so a call with a
// non-Japanese `lang` (and no explicit engine) uses Web Speech — unless the TTS
// server is known to be another kind (OpenAI's voices speak many languages); and
// if the engine is configured but unreachable, speak() falls back to Web Speech so
// a presentation never goes silent.
// Old names still accepted: engine 'irodori' (= 'openai'), irodoriVoice (=
// serverVoice), caption (= instructions), irodoriVoices() (= serverVoices()).
import {
  DEFAULT_SSH_BASTION,
  DEFAULT_TTS,
  knownServerKind,
  listServerVoices,
  listVoicevoxSpeakers,
  loadWebSpeechVoices,
  speak as ttsSpeak,
  speechServerOf,
  synthesizesAudio,
  ttsLog,
  warmUpSpeechServer,
  webSpeechAvailable,
  type SshBastion,
  type SpeakProgressCallback,
  type TtsConfig,
  type TtsEngine,
  type Utterance,
  type VoiceSelect,
  type VoicevoxStyle,
} from './ttsService';

export interface MdpTtsSpeakOptions {
  engine?: TtsEngine | 'irodori'; // omit = auto (settings default; non-ja lang may force webspeech)
  voice?: string;       // Web Speech narrator by name/URI, substring ok (e.g. 'Zira')
  lang?: string;        // language hint for narrator pick: 'en', 'en-US', 'ja', …
  rate?: number;        // speaking rate (default: settings)
  pitch?: number;       // Web Speech pitch (default: settings)
  speaker?: number;     // VOICEVOX style id (default: settings)
  serverVoice?: string; // the TTS server's voice id (Irodori: 'none' = no reference voice)
  instructions?: string; // how the TTS server should speak (Irodori Voice Design / OpenAI instructions)
  irodoriVoice?: string; // old name of serverVoice
  caption?: string;     // old name of instructions
  url?: string;         // URL of the chosen engine — VOICEVOX or the TTS server (default: settings)
  exclusive?: boolean;  // default true: stop the previous mdpTts utterance first
  // Spoken-position callback for read-along highlighting. Web Speech reports
  // { charIndex, charLength? } per word; VOICEVOX / the TTS server report { fraction }
  // (0..1 of playback time). Indices refer to the trimmed text passed to speak().
  onProgress?: SpeakProgressCallback;
}

export interface MdpTtsVoice {
  name: string; lang: string; uri: string; localService: boolean; default: boolean;
}

export interface MdpTtsApi {
  speak(text: string, opts?: MdpTtsSpeakOptions): Utterance;
  stop(): void;
  voices(): Promise<MdpTtsVoice[]>;
  voicevoxSpeakers(url?: string): Promise<VoicevoxStyle[]>;
  serverVoices(url?: string): Promise<string[]>;
  irodoriVoices(url?: string): Promise<string[]>;
  config(): TtsConfig;
}

let defaults: TtsConfig = { ...DEFAULT_TTS };

/** Mirror the app's TTS settings into the module API's defaults. */
export function setModuleTtsDefaults(cfg: TtsConfig): void {
  defaults = { ...cfg };
  // Learn early which kind the TTS server is (which languages it speaks).
  if (cfg.engine === 'openai') warmUpSpeechServer(speechServerOf(cfg));
}

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

const isJapanese = (lang: string): boolean => /^ja\b|^ja[-_]/i.test(lang.trim());

function pickEngine(opts: MdpTtsSpeakOptions): TtsEngine {
  if (opts.engine) return opts.engine === 'irodori' ? 'openai' : opts.engine;
  // An explicit Web-Speech narrator implies webspeech; an explicit VOICEVOX
  // speaker implies voicevox; a server voice or voice description implies the
  // TTS server (whichever the settings default is).
  if (opts.voice) return 'webspeech';
  if (typeof opts.speaker === 'number') return 'voicevox';
  if (opts.serverVoice || opts.irodoriVoice || opts.instructions || opts.caption) return 'openai';
  // VOICEVOX speaks only Japanese, and so does Irodori-TTS — a server not yet known
  // to be another kind is taken for it. Any other language hint means Web Speech.
  if (opts.lang && !isJapanese(opts.lang)) {
    if (defaults.engine === 'voicevox') return 'webspeech';
    if (defaults.engine === 'openai' && knownServerKind(speechServerOf(defaults)) !== 'openai') return 'webspeech';
  }
  return defaults.engine;
}

const api: MdpTtsApi = {
  speak(text: string, opts: MdpTtsSpeakOptions = {}): Utterance {
    const t = String(text ?? '').trim();
    if (!t) return NOOP;
    let stopped = false;
    let inner: Utterance | null = null;
    const done = (async () => {
      try {
      ttsLog('mdpTts.speak', { text: t.slice(0, 40), opts: { ...opts, onProgress: !!opts.onProgress } });
      if (opts.exclusive !== false) api.stop();
      const engine = pickEngine(opts);
      ttsLog('speak: engine =', engine);
      const mine = isUsersServer(opts.url);
      const instructions = typeof opts.instructions === 'string' ? opts.instructions
        : typeof opts.caption === 'string' ? opts.caption : defaults.openaiInstructions;
      const cfg: TtsConfig = {
        ...defaults,
        engine,
        rate: typeof opts.rate === 'number' ? opts.rate : defaults.rate,
        pitch: typeof opts.pitch === 'number' ? opts.pitch : defaults.pitch,
        voicevoxUrl: (engine === 'voicevox' && opts.url) || defaults.voicevoxUrl,
        voicevoxSpeaker: typeof opts.speaker === 'number' ? opts.speaker : defaults.voicevoxSpeaker,
        openaiUrl: (engine === 'openai' && opts.url) || defaults.openaiUrl,
        // The user's API key only ever goes to the server the USER configured: a
        // module script (possibly from someone else's shared `.mdp`) that names
        // its own `url` must not be able to collect the key from its requests.
        openaiApiKey: keyFor(opts.url),
        openaiSsh: sshFor(opts.url),
        // Another server has other models: let it name its own.
        openaiModel: mine ? defaults.openaiModel : '',
        openaiVoice: opts.serverVoice || opts.irodoriVoice || defaults.openaiVoice,
        openaiInstructions: instructions,
      };
      const sel: VoiceSelect = { voice: opts.voice, lang: opts.lang };
      const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : undefined;
      // Narrator matching needs the voice list, which loads async on first use.
      if (engine === 'webspeech') await loadWebSpeechVoices();
      ttsLog('speak: voices ready, stopped =', stopped);
      if (stopped) return;
      try {
        inner = ttsSpeak(t, cfg, sel, onProgress);
        current = inner;
        await inner.done;
      } catch (err) {
        ttsLog('engine error → fallback?', { engine: cfg.engine, err: String(err) });
        // VOICEVOX / the TTS server unreachable → Web Speech fallback (same text, language hint).
        if (synthesizesAudio(cfg.engine) && webSpeechAvailable() && !stopped) {
          await loadWebSpeechVoices();
          if (stopped) return;
          inner = ttsSpeak(t, { ...cfg, engine: 'webspeech' }, sel, onProgress);
          current = inner;
          await inner.done;
        }
      }
      } catch (err) {
        // Surface unexpected failures instead of letting the rejected promise be
        // swallowed by a caller's `.then(done, done)`.
        ttsLog('speak: UNEXPECTED ERROR', String(err && (err as Error).stack || err));
      }
    })();
    return { done, stop: () => { stopped = true; inner?.stop(); } };
  },

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
      ...defaults, openaiUrl: url || defaults.openaiUrl, openaiApiKey: keyFor(url), openaiSsh: sshFor(url),
    }));
  },

  irodoriVoices(url?: string): Promise<string[]> {
    return api.serverVoices(url);
  },

  config(): TtsConfig {
    // Module scripts may read the settings, but never the server's API key — nor
    // the bastion's account and key file (only whether it is in use).
    return { ...defaults, openaiApiKey: '', openaiSsh: { ...DEFAULT_SSH_BASTION, enabled: defaults.openaiSsh.enabled } };
  },
};

/** Install the API on window (called once from main.tsx). */
export function installModuleTtsApi(): void {
  (window as unknown as { mdpTts?: MdpTtsApi }).mdpTts = api;
}
