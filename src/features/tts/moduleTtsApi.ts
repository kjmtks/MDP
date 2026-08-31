// Module-facing TTS API, exposed as `window.mdpTts` (installed from main.tsx the
// same way `window.renderMathInElement` is). Module <script>s call it to speak
// text with the user's configured engine/narrator, optionally overridden per call:
//
//   window.mdpTts.speak('Water boils at 100 degrees.', { lang: 'en' })
//   window.mdpTts.speak('Hello', { voice: 'Zira', rate: 0.9 })
//   window.mdpTts.speak('こんにちは', { engine: 'voicevox', speaker: 3 })
//   window.mdpTts.stop()
//   await window.mdpTts.voices()            // installed Web Speech narrators
//   await window.mdpTts.voicevoxSpeakers()  // VOICEVOX styles (engine must run)
//
// Defaults track the app's TTS settings live: AppSettingsContext mirrors every
// settings change here via setModuleTtsDefaults(). Engine auto-selection: VOICEVOX
// is a Japanese-only engine, so a call with a non-Japanese `lang` (and no explicit
// engine) always uses Web Speech; and if VOICEVOX is configured but unreachable,
// speak() falls back to Web Speech so a presentation never goes silent.
import {
  DEFAULT_TTS,
  listVoicevoxSpeakers,
  loadWebSpeechVoices,
  speak as ttsSpeak,
  webSpeechAvailable,
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
  url?: string;         // VOICEVOX engine URL (default: settings)
  exclusive?: boolean;  // default true: stop the previous mdpTts utterance first
}

export interface MdpTtsVoice {
  name: string; lang: string; uri: string; localService: boolean; default: boolean;
}

export interface MdpTtsApi {
  speak(text: string, opts?: MdpTtsSpeakOptions): Utterance;
  stop(): void;
  voices(): Promise<MdpTtsVoice[]>;
  voicevoxSpeakers(url?: string): Promise<VoicevoxStyle[]>;
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

function pickEngine(opts: MdpTtsSpeakOptions): TtsEngine {
  if (opts.engine) return opts.engine;
  // An explicit Web-Speech narrator implies webspeech; an explicit VOICEVOX
  // speaker implies voicevox (whichever the settings default is).
  if (opts.voice) return 'webspeech';
  if (typeof opts.speaker === 'number') return 'voicevox';
  // VOICEVOX only speaks Japanese — any other language hint means Web Speech.
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
      if (opts.exclusive !== false) api.stop();
      const engine = pickEngine(opts);
      const cfg: TtsConfig = {
        ...defaults,
        engine,
        rate: typeof opts.rate === 'number' ? opts.rate : defaults.rate,
        pitch: typeof opts.pitch === 'number' ? opts.pitch : defaults.pitch,
        voicevoxUrl: opts.url || defaults.voicevoxUrl,
        voicevoxSpeaker: typeof opts.speaker === 'number' ? opts.speaker : defaults.voicevoxSpeaker,
      };
      const sel: VoiceSelect = { voice: opts.voice, lang: opts.lang };
      // Narrator matching needs the voice list, which loads async on first use.
      if (engine === 'webspeech') await loadWebSpeechVoices();
      if (stopped) return;
      try {
        inner = ttsSpeak(t, cfg, sel);
        current = inner;
        await inner.done;
      } catch {
        // VOICEVOX unreachable → Web Speech fallback (same text, language hint).
        if (cfg.engine === 'voicevox' && webSpeechAvailable() && !stopped) {
          await loadWebSpeechVoices();
          if (stopped) return;
          inner = ttsSpeak(t, { ...cfg, engine: 'webspeech' }, sel);
          current = inner;
          await inner.done;
        }
      }
    })();
    return { done, stop: () => { stopped = true; inner?.stop(); } };
  },

  stop(): void {
    const u = current;
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

  config(): TtsConfig {
    return { ...defaults };
  },
};

/** Install the API on window (called once from main.tsx). */
export function installModuleTtsApi(): void {
  (window as unknown as { mdpTts?: MdpTtsApi }).mdpTts = api;
}
