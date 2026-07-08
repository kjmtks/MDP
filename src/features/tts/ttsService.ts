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

// A running utterance: `done` resolves when speech finishes (or is stopped/errors);
// `stop()` cancels it immediately and resolves `done`.
export interface Utterance { done: Promise<void>; stop: () => void }

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

function speakWebSpeech(text: string, cfg: TtsConfig): Utterance {
  const synth = window.speechSynthesis;
  const u = new SpeechSynthesisUtterance(text);
  if (cfg.webspeechVoiceURI) {
    const v = listWebSpeechVoices().find((x) => x.voiceURI === cfg.webspeechVoiceURI);
    if (v) { u.voice = v; u.lang = v.lang; }
  }
  u.rate = Math.max(0.1, Math.min(10, cfg.rate || 1));
  u.pitch = Math.max(0, Math.min(2, cfg.pitch ?? 1));
  let resolve!: () => void;
  const done = new Promise<void>((r) => { resolve = r; });
  u.onend = () => resolve();
  u.onerror = () => resolve();
  synth.cancel();
  synth.speak(u);
  return { done, stop: () => { try { synth.cancel(); } catch { /* ignore */ } resolve(); } };
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

function playAudioUrl(url: string, revoke: boolean): Utterance {
  const audio = new Audio(url);
  let resolve!: () => void;
  const done = new Promise<void>((r) => { resolve = r; });
  const finish = () => { if (revoke) URL.revokeObjectURL(url); resolve(); };
  audio.onended = finish;
  audio.onerror = finish;
  void audio.play().catch(finish);
  return { done, stop: () => { try { audio.pause(); } catch { /* ignore */ } finish(); } };
}

// ---- Prefetchable clips (for the narrated auto-play) ------------------------

// A prepared utterance: `play()` starts it (returns an Utterance), `dispose()`
// frees any held resources (a VOICEVOX object URL) if it was never played.
export interface Clip { play: () => Utterance; dispose: () => void }

// Prepare `text` for the configured engine WITHOUT playing. For VOICEVOX this does
// the (slow) network synthesis up front, so the caller can prefetch the next unit
// during playback of the current one. For Web Speech there is nothing to
// pre-synthesize, so play() speaks on demand.
export async function synthesize(text: string, cfg: TtsConfig): Promise<Clip> {
  const t = (text || '').trim();
  if (!t) return { play: () => NOOP, dispose: () => {} };
  if (cfg.engine === 'voicevox') {
    const url = await synthVoicevox(t, cfg);
    let used = false;
    return { play: () => { used = true; return playAudioUrl(url, true); }, dispose: () => { if (!used) URL.revokeObjectURL(url); } };
  }
  return { play: () => (webSpeechAvailable() ? speakWebSpeech(t, cfg) : NOOP), dispose: () => {} };
}

// ---- Unified entry point ---------------------------------------------------

// Speak `text` with the configured engine. Returns immediately with an Utterance;
// for VOICEVOX the async network setup is wrapped so stop() works even mid-request.
export function speak(text: string, cfg: TtsConfig): Utterance {
  const t = (text || '').trim();
  if (!t) return NOOP;
  if (cfg.engine === 'voicevox') {
    let stopped = false;
    let inner: Utterance | null = null;
    const done = (async () => {
      const clip = await synthesize(t, cfg); // may throw if the engine is unreachable
      if (stopped) { clip.dispose(); return; }
      inner = clip.play();
      if (stopped) { inner.stop(); return; }
      await inner.done;
    })();
    return { done, stop: () => { stopped = true; inner?.stop(); } };
  }
  if (webSpeechAvailable()) return speakWebSpeech(t, cfg);
  return NOOP;
}
