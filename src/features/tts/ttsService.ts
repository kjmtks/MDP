// Text-to-speech for rehearsal read-aloud. Two selectable engines:
//   - 'webspeech' : the browser/OS Web Speech API (SpeechSynthesis). Zero setup,
//     cross-platform; voices come from the OS (and, when online, cloud voices).
//   - 'voicevox'  : a LOCAL VOICEVOX engine (default http://127.0.0.1:50021). The
//     user runs VOICEVOX; we POST /audio_query then /synthesis and play the WAV.
//     CORS is permitted by the engine, so the renderer calls it directly.
// The rehearsal UI is the only consumer; config is persisted in app settings.

export type TtsEngine = 'webspeech' | 'voicevox';

export interface TtsConfig {
  engine: TtsEngine;
  rate: number;              // speaking rate; ~0.5–2.0. Maps to VOICEVOX speedScale.
  pitch: number;             // Web Speech pitch 0–2 (VOICEVOX ignores it).
  webspeechVoiceURI: string; // chosen SpeechSynthesisVoice.voiceURI ('' = default)
  voicevoxUrl: string;       // e.g. http://127.0.0.1:50021
  voicevoxSpeaker: number;   // VOICEVOX style id
}

export const DEFAULT_TTS: TtsConfig = {
  engine: 'webspeech',
  rate: 1,
  pitch: 1,
  webspeechVoiceURI: '',
  voicevoxUrl: 'http://127.0.0.1:50021',
  voicevoxSpeaker: 1,
};

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
// provides it) into the spoken string. VOICEVOX plays a pre-synthesized WAV, so
// it reports only `fraction` (0..1 of playback time) — an approximation.
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

export function resolveWebSpeechVoice(sel: VoiceSelect, cfg: TtsConfig): SpeechSynthesisVoice | undefined {
  const voices = listWebSpeechVoices();
  const wanted = (sel.voice || '').trim().toLowerCase();
  if (wanted) {
    return voices.find((v) => v.voiceURI.toLowerCase() === wanted || v.name.toLowerCase() === wanted)
      || voices.find((v) => v.name.toLowerCase().includes(wanted) || v.voiceURI.toLowerCase().includes(wanted));
  }
  const def = cfg.webspeechVoiceURI ? voices.find((v) => v.voiceURI === cfg.webspeechVoiceURI) : undefined;
  const lang = (sel.lang || '').trim().toLowerCase();
  if (!lang) return def;
  const matches = (v: SpeechSynthesisVoice) => v.lang.toLowerCase().replace(/_/g, '-').startsWith(lang);
  if (def && matches(def)) return def;
  const cand = voices.filter(matches);
  return cand.find((v) => v.localService && v.default) || cand.find((v) => v.localService) || cand[0];
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

// Synthesize VOICEVOX audio WITHOUT playing it yet (so callers can prefetch the
// next segment while the current one plays). Returns an object URL for a WAV blob.
async function synthVoicevox(text: string, cfg: TtsConfig): Promise<string> {
  const base = (cfg.voicevoxUrl || DEFAULT_TTS.voicevoxUrl).replace(/\/+$/, '');
  const speaker = cfg.voicevoxSpeaker || 0;
  const q = await fetch(`${base}/audio_query?speaker=${speaker}&text=${encodeURIComponent(text)}`, { method: 'POST' });
  if (!q.ok) throw new Error(`VOICEVOX /audio_query returned ${q.status}`);
  const query = await q.json();
  query.speedScale = Math.max(0.5, Math.min(2, cfg.rate || 1));
  const s = await fetch(`${base}/synthesis?speaker=${speaker}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(query),
  });
  if (!s.ok) throw new Error(`VOICEVOX /synthesis returned ${s.status}`);
  const blob = await s.blob();
  return URL.createObjectURL(blob);
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
// jumps back. `dispose()` frees the held resources (a VOICEVOX object URL); the clip
// must not be played afterwards. Callers own the lifetime: dispose every clip you
// synthesized once you are done with it.
export interface Clip { play: () => Utterance; dispose: () => void }

// Prepare `text` for the configured engine WITHOUT playing. For VOICEVOX this does
// the (slow) network synthesis up front, so the caller can prefetch the next unit
// during playback of the current one — or pre-generate the WHOLE show before it
// starts (see the auto-play's pre-generate mode). For Web Speech there is nothing
// to pre-synthesize, so play() speaks on demand.
export async function synthesize(text: string, cfg: TtsConfig, sel?: VoiceSelect, onProgress?: SpeakProgressCallback): Promise<Clip> {
  const t = (text || '').trim();
  if (!t) return { play: () => NOOP, dispose: () => {} };
  if (cfg.engine === 'voicevox') {
    const url = await synthVoicevox(t, cfg);
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
// for VOICEVOX the async network setup is wrapped so stop() works even mid-request.
export function speak(text: string, cfg: TtsConfig, sel?: VoiceSelect, onProgress?: SpeakProgressCallback): Utterance {
  const t = (text || '').trim();
  if (!t) return NOOP;
  if (cfg.engine === 'voicevox') {
    let stopped = false;
    let inner: Utterance | null = null;
    const done = (async () => {
      const clip = await synthesize(t, cfg, sel, onProgress); // may throw if the engine is unreachable
      if (stopped) { clip.dispose(); return; }
      try {
        inner = clip.play();
        if (stopped) { inner.stop(); return; }
        await inner.done;
      } finally {
        clip.dispose();  // one-shot playback owns the clip
      }
    })();
    return { done, stop: () => { stopped = true; inner?.stop(); } };
  }
  if (webSpeechAvailable()) return speakWebSpeech(t, cfg, sel, onProgress);
  return NOOP;
}
