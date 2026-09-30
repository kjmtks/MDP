// Module-facing TTS API, exposed as `window.mdpTts` (installed from main.tsx the
// same way `window.renderMathInElement` is). Module <script>s call it to speak
// text with the user's configured engine/narrator, optionally overridden per call:
//
//   window.mdpTts.speak('Water boils at 100 degrees.', { lang: 'en' })
//   window.mdpTts.speak('Hello', { voice: 'Zira', rate: 0.9 })
//   window.mdpTts.speak('こんにちは', { engine: 'voicevox', speaker: 3 })
//   window.mdpTts.speak('やったね！', { caption: '明るく弾んだ若い女性の声' })  // Irodori
//   window.mdpTts.stop()
//   await window.mdpTts.voices()            // installed Web Speech narrators
//   await window.mdpTts.voicevoxSpeakers()  // VOICEVOX styles (engine must run)
//   await window.mdpTts.irodoriVoices()     // Irodori-TTS voice ids (server must run)
//
// Defaults track the app's TTS settings live: AppSettingsContext mirrors every
// settings change here via setModuleTtsDefaults(). Engine auto-selection: VOICEVOX
// and Irodori are Japanese-only engines, so a call with a non-Japanese `lang` (and
// no explicit engine) always uses Web Speech; and if either is configured but
// unreachable, speak() falls back to Web Speech so a presentation never goes silent.
import {
  DEFAULT_TTS,
  irodoriServerOf,
  listIrodoriVoices,
  listVoicevoxSpeakers,
  loadWebSpeechVoices,
  speak as ttsSpeak,
  synthesizesAudio,
  ttsLog,
  webSpeechAvailable,
  type SpeakProgressCallback,
  type TtsConfig,
  type TtsEngine,
  type Utterance,
  type VoiceSelect,
  type VoicevoxStyle,
} from './ttsService';

export interface MdpTtsSpeakOptions {
  engine?: TtsEngine;   // omit = auto (settings default; non-ja lang forces webspeech)
  voice?: string;       // Web Speech narrator by name/URI, substring ok (e.g. 'Zira')
  lang?: string;        // language hint for narrator pick: 'en', 'en-US', 'ja', …
  rate?: number;        // speaking rate (default: settings)
  pitch?: number;       // Web Speech pitch (default: settings)
  speaker?: number;     // VOICEVOX style id (default: settings)
  irodoriVoice?: string; // Irodori-TTS voice id, or 'none' (default: settings)
  caption?: string;     // Irodori-TTS Voice Design text: the voice / delivery wanted
  url?: string;         // URL of the chosen engine — VOICEVOX or Irodori (default: settings)
  exclusive?: boolean;  // default true: stop the previous mdpTts utterance first
  // Spoken-position callback for read-along highlighting. Web Speech reports
  // { charIndex, charLength? } per word; VOICEVOX / Irodori report { fraction }
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
  irodoriVoices(url?: string): Promise<string[]>;
  config(): TtsConfig;
}

let defaults: TtsConfig = { ...DEFAULT_TTS };

/** Mirror the app's TTS settings into the module API's defaults. */
export function setModuleTtsDefaults(cfg: TtsConfig): void {
  defaults = { ...cfg };
}

const NOOP: Utterance = { done: Promise.resolve(), stop: () => {} };

// The one utterance the module API is currently playing (exclusive by default —
// a lecture slide should not layer two narrations).
let current: Utterance | null = null;

// Normalized "which server" of an Irodori URL (scheme, host, port, path).
const serverKey = (url: string): string | null => {
  try { const u = new URL(url.trim()); return `${u.origin}${u.pathname.replace(/\/+$/, '')}`; } catch { return null; }
};
/** The Irodori API key to send for a module-supplied `url`: the user's key when
 *  that URL is the server the user configured (or none was given), else nothing. */
function keyFor(url: string | undefined): string {
  if (!url) return defaults.irodoriApiKey;
  const mine = serverKey(defaults.irodoriUrl);
  return mine !== null && serverKey(url) === mine ? defaults.irodoriApiKey : '';
}

function pickEngine(opts: MdpTtsSpeakOptions): TtsEngine {
  if (opts.engine) return opts.engine;
  // An explicit Web-Speech narrator implies webspeech; an explicit VOICEVOX
  // speaker implies voicevox; an Irodori voice or caption implies irodori
  // (whichever the settings default is).
  if (opts.voice) return 'webspeech';
  if (typeof opts.speaker === 'number') return 'voicevox';
  if (opts.irodoriVoice || opts.caption) return 'irodori';
  // VOICEVOX and Irodori only speak Japanese — any other language hint means Web Speech.
  if (opts.lang && !/^ja\b|^ja[-_]/i.test(opts.lang.trim())) return 'webspeech';
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
      const cfg: TtsConfig = {
        ...defaults,
        engine,
        rate: typeof opts.rate === 'number' ? opts.rate : defaults.rate,
        pitch: typeof opts.pitch === 'number' ? opts.pitch : defaults.pitch,
        voicevoxUrl: (engine === 'voicevox' && opts.url) || defaults.voicevoxUrl,
        voicevoxSpeaker: typeof opts.speaker === 'number' ? opts.speaker : defaults.voicevoxSpeaker,
        irodoriUrl: (engine === 'irodori' && opts.url) || defaults.irodoriUrl,
        // The user's API key only ever goes to the server the USER configured: a
        // module script (possibly from someone else's shared `.mdp`) that names
        // its own `url` must not be able to collect the key from its requests.
        irodoriApiKey: keyFor(opts.url),
        irodoriVoice: opts.irodoriVoice || defaults.irodoriVoice,
        irodoriCaption: typeof opts.caption === 'string' ? opts.caption : defaults.irodoriCaption,
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
        // VOICEVOX / Irodori unreachable → Web Speech fallback (same text, language hint).
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

  irodoriVoices(url?: string): Promise<string[]> {
    // Same rule as speak(): the key goes only to the configured server.
    return listIrodoriVoices(url ? { url, apiKey: keyFor(url) } : irodoriServerOf(defaults));
  },

  config(): TtsConfig {
    // Module scripts may read the settings, but never the Irodori API key.
    return { ...defaults, irodoriApiKey: '' };
  },
};

/** Install the API on window (called once from main.tsx). */
export function installModuleTtsApi(): void {
  (window as unknown as { mdpTts?: MdpTtsApi }).mdpTts = api;
}
