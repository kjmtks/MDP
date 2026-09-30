import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button, Checkbox, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, LinearProgress, MenuItem, TextField,
} from '@mui/material';
import { apiClient } from '../../api/apiClient';
import { useAppSettings } from '../settings/AppSettingsContext';
import type { AppSettings } from '../settings/types';
import {
  IRODORI_REFERENCE_TEXT, IRODORI_VOICE_ID, irodoriServerOf, isAbortError, isLocalIrodoriServer,
  saveIrodoriVoice, speak, type Utterance,
} from './ttsService';
import { MicInput, decodeAudioFile, listMicrophones, type MicDevice } from './micInput';
import {
  REFERENCE_MAX_SEC, TAKE_ISSUE_TEXT, analyzeTake, buildReference, countChars, decodeWav, encodeWav,
  formatSeconds, levelTake, pickSentences, readingCharsPerMin, referenceFromFile, resample, storedZip, takeIssues,
  trainingSetFiles, type TakeAnalysis, type TakeIssue,
} from './voiceAudio';
import { MAKE_MANIFEST_PY, speakerInversionReadme } from './speakerInversionKit';
import {
  deleteRecordingSet, listRecordingSets, newRecordingSet, saveRecordingSet, type VoiceRecordingSet,
} from './voiceStore';

type Tts = AppSettings['tts'];

// Speech to collect in one session: a 25 s reference with room to spare, and
// the start of a training set for a speaker-inversion voice.
const SPEECH_TARGET_SEC = 45;
// Below this the reference is too thin to carry a voice.
const MIN_SPEECH_SEC = 10;
// A take nobody stopped ends by itself.
const MAX_TAKE_SEC = 30;
// The Microphone menu's entry for the system default input (an empty value
// would leave the field looking blank).
const DEFAULT_MIC = 'default';

interface Take {
  text: string;
  analysis: TakeAnalysis | null;
  issues: TakeIssue[];
  wav: Uint8Array | null;
  sampleRate: number;
  url: string | null;
}

interface FileRef { fileName: string; wav: Uint8Array; url: string; sec: number; cut: boolean }

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const speechOf = (set: VoiceRecordingSet | null) => (set ? set.takes.reduce((n, t) => n + t.speechSec, 0) : 0);
const wavUrl = (wav: Uint8Array) => URL.createObjectURL(new Blob([wav.slice()], { type: 'audio/wav' }));

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// A voice id from a file name: "Kojima lecture 2.m4a" → "Kojima-lecture-2".
function idFromFileName(file: string): string {
  const id = file.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return id && id.toLowerCase() !== 'none' ? id : 'my-voice';
}

// Input level with a slow decay, plus the take's running time while recording.
const LevelMeter: React.FC<{ mic: MicInput | null; recording: boolean }> = ({ mic, recording }) => {
  const barRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    let shown = 0;
    const since = performance.now();
    const tick = () => {
      shown = Math.max(mic ? mic.level : 0, shown * 0.92);
      const db = 20 * Math.log10(shown + 1e-6);
      const bar = barRef.current;
      if (bar) {
        bar.style.width = `${Math.max(0, Math.min(1, (db + 60) / 60)) * 100}%`;
        bar.style.background = db > -1.5 ? '#ef4444' : db > -9 ? '#f59e0b' : '#22c55e';
      }
      if (timeRef.current) timeRef.current.textContent = recording ? `● ${((performance.now() - since) / 1000).toFixed(1)} s` : '';
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mic, recording]);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'rgba(127,127,127,0.25)', overflow: 'hidden' }}>
        <div ref={barRef} style={{ height: '100%', width: 0 }} />
      </div>
      <span ref={timeRef} style={{ minWidth: 64, fontFamily: 'monospace', fontSize: 13, color: '#ef4444' }} />
    </div>
  );
};

// Record the presenter's own voice — a few sentences from the deck, one at a
// time — and register it on the Irodori-TTS server as a reference voice
// ('record'); or register an existing recording instead ('file'). The takes are
// kept on this computer only (voiceStore) and can be exported as a training set.
// Mounted only while open, so every opening starts fresh.
export const VoiceCalibrationDialog: React.FC<{
  mode: 'record' | 'file';
  tts: Tts;
  /** The deck's slides (raw markdown): their @script supplies what to read. */
  slideRaws: string[];
  onClose: () => void;
  /** A voice was registered on the server: select it. */
  onRegistered: (voiceId: string) => void;
}> = ({ mode, tts, slideRaws, onClose, onRegistered }) => {
  const { settings, update } = useAppSettings();
  const cpm = settings.readingCharsPerMin || 320;
  const server = useMemo(() => irodoriServerOf(tts), [tts]);
  const shared = !isLocalIrodoriServer(tts.irodoriUrl);

  const [step, setStep] = useState<'setup' | 'record' | 'finish' | 'file'>(mode === 'file' ? 'file' : 'setup');
  const [error, setError] = useState('');
  const [name, setName] = useState('my-voice');
  const nameOk = IRODORI_VOICE_ID.test(name) && name.toLowerCase() !== 'none';

  // ---- playback ------------------------------------------------------------------
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlsRef = useRef<string[]>([]);   // every object URL made here, freed on close
  const keepUrl = (url: string) => { urlsRef.current.push(url); return url; };
  const play = (url: string) => {
    audioRef.current?.pause();
    const a = new Audio(url);
    audioRef.current = a;
    void a.play().catch(() => { /* ignore */ });
  };

  // ---- saved recordings ------------------------------------------------------------
  const [sets, setSets] = useState<VoiceRecordingSet[] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState('');
  const refreshSets = useCallback(() => {
    void listRecordingSets().then(setSets, (e: unknown) => { setSets([]); setError(msg(e)); });
  }, []);
  useEffect(() => { if (mode === 'record') refreshSets(); }, [mode, refreshSets]);

  const [set, setSet] = useState<VoiceRecordingSet | null>(null);

  // ---- microphone ----------------------------------------------------------------
  const [mic, setMic] = useState<MicInput | null>(null);
  const micRef = useRef<MicInput | null>(null);
  const [devices, setDevices] = useState<MicDevice[]>([]);
  const [deviceId, setDeviceId] = useState(DEFAULT_MIC);
  const [micError, setMicError] = useState('');
  const [micBusy, setMicBusy] = useState(false);
  const closeMic = () => { micRef.current?.close(); micRef.current = null; setMic(null); };
  const openMic = async (id: string) => {
    closeMic();
    setMicBusy(true); setMicError('');
    try {
      const m = await MicInput.open(id === DEFAULT_MIC ? undefined : id);
      micRef.current = m;
      setMic(m);
      setDevices(await listMicrophones());   // labels only appear once access is granted
    } catch (e) {
      setMicError(msg(e));
    } finally {
      setMicBusy(false);
    }
  };

  // ---- recording -----------------------------------------------------------------
  const [queue, setQueue] = useState<string[]>([]);
  const [cur, setCur] = useState(0);
  const [goalSec, setGoalSec] = useState(SPEECH_TARGET_SEC);
  const [recording, setRecording] = useState(false);
  const [take, setTake] = useState<Take | null>(null);
  const [storing, setStoring] = useState(false);
  const autoStopRef = useRef(0);
  const stoppingRef = useRef(false);
  const sentence = queue[cur] || '';
  const recordedSec = speechOf(set);

  const begin = (base: VoiceRecordingSet | null) => {
    const done = speechOf(base);
    const goal = Math.max(SPEECH_TARGET_SEC, done + 20);
    setSet(base);
    if (base) setName(base.name);
    setGoalSec(goal);
    setQueue(pickSentences(slideRaws, (cpm * (goal - done)) / 60, settings.readingCalibrationText, base ? base.takes.map((t) => t.text) : []));
    setCur(0);
    setTake(null);
    setError('');
    setStep('record');
    void openMic(deviceId);
  };

  const dropTake = () => { audioRef.current?.pause(); setTake(null); };

  const stopTake = async () => {
    const m = micRef.current;
    clearTimeout(autoStopRef.current);
    if (!m || !m.isRecording || stoppingRef.current) return;
    stoppingRef.current = true;
    let raw;
    try { raw = await m.stop(); } finally { stoppingRef.current = false; }
    setRecording(false);
    const analysis = analyzeTake(raw);
    const issues = takeIssues(analysis, sentence);
    let wav: Uint8Array | null = null;
    // A set keeps one sample rate (its takes are joined); a later session on
    // another microphone is converted to it.
    const rate = set ? set.sampleRate : raw.sampleRate;
    if (analysis) {
      const levelled = levelTake(raw, analysis);
      wav = encodeWav(levelled.sampleRate === rate ? levelled : resample(levelled, rate));
    }
    const url = wav ? keepUrl(wavUrl(wav)) : null;
    setTake({ text: sentence, analysis, issues, wav, sampleRate: rate, url });
    if (url && !issues.length) play(url);
  };

  const startTake = () => {
    if (!mic || recording || storing) return;
    dropTake();
    mic.start();
    setRecording(true);
    clearTimeout(autoStopRef.current);
    autoStopRef.current = window.setTimeout(() => void stopTake(), MAX_TAKE_SEC * 1000);
  };

  const finish = (s: VoiceRecordingSet | null) => {
    clearTimeout(autoStopRef.current);
    closeMic();
    setRecording(false);
    dropTake();
    setSet(s);
    setStep('finish');
  };

  const accept = async () => {
    if (!take?.wav || !take.analysis || storing) return;
    const base = set ?? newRecordingSet(name, take.sampleRate);
    const next: VoiceRecordingSet = {
      ...base, name: nameOk ? name : base.name,
      takes: [...base.takes, { text: take.text, wav: take.wav, speechSec: take.analysis.speechSec }],
    };
    setStoring(true);
    try {
      await saveRecordingSet(next);
    } catch (e) {
      setError(`The take could not be saved: ${msg(e)}`);
      return;
    } finally {
      setStoring(false);
    }
    setSet(next);
    setTake(null);
    if (speechOf(next) >= goalSec || cur + 1 >= queue.length) finish(next);
    else setCur(cur + 1);
  };

  const skip = () => { if (!recording && cur + 1 < queue.length) { dropTake(); setCur(cur + 1); } };

  // Space = record / stop, Enter = keep and go on, R = retake now, P = play back.
  // Captured before the auto-play's own shortcuts, and never while typing.
  const keysRef = useRef<(e: KeyboardEvent) => boolean>(() => false);
  useEffect(() => {
    keysRef.current = (e) => {
      if (step !== 'record' || e.ctrlKey || e.metaKey || e.altKey) return false;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return false;
      const k = e.key.toLowerCase();
      if (k === ' ') { if (recording) void stopTake(); else startTake(); return true; }
      if (k === 'enter') { if (take?.wav && !recording) void accept(); return true; }
      if (k === 'r') { if (!recording) startTake(); return true; }
      if (k === 'p') { if (take?.url && !recording) play(take.url); return true; }
      return false;
    };
  });
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (keysRef.current(e)) { e.preventDefault(); e.stopPropagation(); } };
    // A focused button would also "click" on Space's keyup.
    const up = (e: KeyboardEvent) => { if (e.key === ' ' && step === 'record') { e.preventDefault(); e.stopPropagation(); } };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    return () => { window.removeEventListener('keydown', down, true); window.removeEventListener('keyup', up, true); };
  }, [step]);

  // ---- the reference, registration and a test line ----------------------------------
  const reference = useMemo(() => {
    if (step !== 'finish' || !set?.takes.length) return null;
    try {
      const ref = buildReference(set.takes.map((t) => decodeWav(t.wav)));
      return { wav: encodeWav(ref), sec: ref.samples.length / ref.sampleRate };
    } catch { return null; }
  }, [step, set]);
  const measuredCpm = useMemo(() => (set ? readingCharsPerMin(set.takes) : null), [set]);

  const [file, setFile] = useState<FileRef | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [consentShared, setConsentShared] = useState(false);
  const [consentOwner, setConsentOwner] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [registered, setRegistered] = useState('');

  const register = (wav: Uint8Array, replace: boolean) => {
    if (!nameOk || saving) return;
    setSaving(true); setError('');
    saveIrodoriVoice(server, name, wav, replace).then((res) => {
      if (res === 'exists') { setConfirmReplace(true); return; }
      setConfirmReplace(false);
      setRegistered(name);
      onRegistered(name);
      if (set && step === 'finish') {
        const next = { ...set, name, registered: { server: tts.irodoriUrl, voiceId: name, at: Date.now() } };
        setSet(next);
        void saveRecordingSet(next).catch(() => { /* the voice is registered; the note is cosmetic */ });
      }
    }, (e: unknown) => setError(msg(e))).finally(() => setSaving(false));
  };

  const [testing, setTesting] = useState(false);
  const utteranceRef = useRef<Utterance | null>(null);
  const testVoice = () => {
    utteranceRef.current?.stop();
    audioRef.current?.pause();
    // A sentence of this deck that was NOT recorded: does the clone carry over?
    const text = pickSentences(slideRaws, 1, '', set ? set.takes.map((t) => t.text) : [])[0] || IRODORI_REFERENCE_TEXT;
    setTesting(true); setError('');
    const u = speak(text, { ...tts, engine: 'irodori', irodoriVoice: registered });
    utteranceRef.current = u;
    u.done.catch((e: unknown) => { if (!isAbortError(e)) setError(msg(e)); })
      .finally(() => { if (utteranceRef.current === u) { utteranceRef.current = null; setTesting(false); } });
  };

  const loadFile = async (f: File) => {
    setLoadingFile(true); setError(''); setFile(null); setRegistered(''); setConfirmReplace(false);
    try {
      const r = referenceFromFile(await decodeAudioFile(await f.arrayBuffer()));
      if (!r) throw new Error('No speech was found in this file.');
      const wav = encodeWav(r.ref);
      setFile({
        fileName: f.name, wav, url: keepUrl(wavUrl(wav)),
        sec: r.ref.samples.length / r.ref.sampleRate,
        cut: (r.analysis.end - r.analysis.start) / r.ref.sampleRate > REFERENCE_MAX_SEC + 0.05,
      });
      setName(idFromFileName(f.name));
    } catch (e) {
      setError(msg(e));
    } finally {
      setLoadingFile(false);
    }
  };

  const exportSet = async (s: VoiceRecordingSet) => {
    setError('');
    try {
      const zip = storedZip(trainingSetFiles(s.takes, { 'README.txt': speakerInversionReadme(s), 'make_manifest.py': MAKE_MANIFEST_PY }));
      await apiClient.saveBinaryWithDialog(`${s.name}-voice-recordings.zip`, toBase64(zip),
        { name: 'ZIP archive', ext: 'zip', mime: 'application/zip' }, { outsideWorkspace: true });
    } catch (e) {
      setError(`Export failed: ${msg(e)}`);
    }
  };

  const removeSet = (id: string) => {
    setConfirmDelete('');
    void deleteRecordingSet(id).then(() => {
      if (set?.id === id) setSet(null);
      refreshSets();
    }, (e: unknown) => setError(msg(e)));
  };

  // Everything held open is released when the dialog goes away.
  useEffect(() => () => {
    clearTimeout(autoStopRef.current);
    micRef.current?.close();
    audioRef.current?.pause();
    utteranceRef.current?.stop();
    for (const u of urlsRef.current) URL.revokeObjectURL(u);
  }, []);

  // ---- view --------------------------------------------------------------------------
  const btn = { textTransform: 'none', whiteSpace: 'nowrap' } as const;
  const muted: React.CSSProperties = { fontSize: 13, opacity: 0.75 };
  const warnColor = '#f0a020';
  const errColor = '#f87171';

  const sharedConsent = shared && (
    <FormControlLabel sx={{ alignItems: 'flex-start', mt: 0.5 }}
      control={<Checkbox size="small" checked={consentShared} onChange={(e) => setConsentShared(e.target.checked)} sx={{ pt: 0.25 }} />}
      label={<span style={{ fontSize: 13 }}>
        This server is not on this computer. Everyone who has its API key will be able to speak in this voice,
        and its administrator can read the audio file. Upload it anyway.
      </span>} />
  );

  // Hidden once registered (until the name is changed).
  const registerRow = (wav: Uint8Array, extraOk: boolean) => !registered && (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
      <TextField size="small" label="Voice name" value={name} sx={{ width: 190 }}
        onChange={(e) => { setName(e.target.value.trim()); setConfirmReplace(false); setRegistered(''); }}
        error={!nameOk} helperText={nameOk ? undefined : 'letters, digits, - and _'} />
      {confirmReplace ? (
        <>
          <span style={{ fontSize: 13, color: warnColor }}>“{name}” already exists on the server.</span>
          <Button variant="contained" size="small" sx={btn} disabled={saving} onClick={() => register(wav, true)}>Replace it</Button>
          <Button size="small" sx={btn} disabled={saving} onClick={() => setConfirmReplace(false)}>Cancel</Button>
        </>
      ) : (
        <Button variant="contained" size="small" sx={btn}
          disabled={saving || !nameOk || !extraOk || (shared && !consentShared)}
          onClick={() => register(wav, false)}>
          {saving ? <CircularProgress size={16} /> : 'Register and use this voice'}
        </Button>
      )}
    </div>
  );

  const registeredRow = registered && (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
      <span style={{ fontSize: 13, color: '#22c55e' }}>✓ “{registered}” is on the server and selected.</span>
      <Button size="small" variant="outlined" sx={btn} onClick={testVoice} disabled={testing}>
        {testing ? <><CircularProgress size={14} sx={{ mr: 1 }} />Speaking…</> : '▶ Hear it read a new sentence'}
      </Button>
      {testing && <Button size="small" sx={btn} onClick={() => utteranceRef.current?.stop()}>Stop</Button>}
    </div>
  );

  let title = 'Record your voice';
  let content: React.ReactNode = null;
  let actions: React.ReactNode = <Button sx={btn} onClick={onClose}>Close</Button>;

  if (step === 'setup') {
    const speakSec = Math.round(SPEECH_TARGET_SEC);
    content = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 14, lineHeight: 1.7 }}>
          Read about {speakSec} seconds of sentences from this deck aloud, one at a time. MDP trims each take,
          joins up to {REFERENCE_MAX_SEC} s of them into a reference voice on the Irodori-TTS server, and the narration
          then speaks in your voice.
        </div>
        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.7, opacity: 0.85 }}>
          <li>A quiet room; a headset or USB microphone if you have one, 15–30 cm from your mouth.</li>
          <li>Read in your normal presenting voice and pace. A fluff is fine — retake it.</li>
          <li>The recordings stay on this computer (not in the workspace). You can export them later to train a voice.</li>
        </ul>
        <TextField size="small" label="Voice name" value={name} sx={{ width: 220 }}
          onChange={(e) => setName(e.target.value.trim())}
          error={!nameOk} helperText={nameOk ? 'the name it gets on the server' : 'letters, digits, - and _'} />
        {sets && sets.length > 0 && (
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, margin: '4px 0 6px' }}>Saved on this computer</div>
            {sets.map((s) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '4px 0', borderTop: '1px solid rgba(127,127,127,0.2)' }}>
                <span style={{ fontSize: 13, flex: '1 1 220px' }}>
                  <b>{s.name}</b> · {s.takes.length} sentences · {formatSeconds(speechOf(s))}
                  <span style={muted}> · {new Date(s.updatedAt).toLocaleDateString()}{s.registered ? ` · registered as “${s.registered.voiceId}”` : ''}</span>
                </span>
                {confirmDelete === s.id ? (
                  <>
                    <span style={{ fontSize: 13, color: warnColor }}>Delete these recordings?</span>
                    <Button size="small" color="error" sx={btn} onClick={() => removeSet(s.id)}>Delete</Button>
                    <Button size="small" sx={btn} onClick={() => setConfirmDelete('')}>Keep</Button>
                  </>
                ) : (
                  <>
                    <Button size="small" sx={btn} onClick={() => begin(s)}>Record more</Button>
                    <Button size="small" sx={btn} onClick={() => { setName(s.name); finish(s); }} disabled={!s.takes.length}>Use</Button>
                    <Button size="small" sx={btn} onClick={() => void exportSet(s)} disabled={!s.takes.length}>Export…</Button>
                    <Button size="small" sx={btn} onClick={() => setConfirmDelete(s.id)}>Delete</Button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
    actions = (
      <>
        <Button sx={btn} onClick={onClose}>Cancel</Button>
        <Button variant="contained" sx={btn} disabled={!nameOk} onClick={() => begin(null)}>Start recording</Button>
      </>
    );
  } else if (step === 'record') {
    const bad = take?.issues.includes('empty');
    content = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <TextField select size="small" label="Microphone" value={deviceId} sx={{ minWidth: 260, flex: 1 }}
            disabled={recording || micBusy}
            onChange={(e) => { const id = String(e.target.value); setDeviceId(id); void openMic(id); }}>
            <MenuItem value={DEFAULT_MIC}>System default{mic && deviceId === DEFAULT_MIC ? ` — ${mic.label}` : ''}</MenuItem>
            {devices.filter((d) => d.id && d.id !== DEFAULT_MIC && d.id !== 'communications').map((d) => <MenuItem key={d.id} value={d.id}>{d.label}</MenuItem>)}
          </TextField>
          {micBusy && <CircularProgress size={18} />}
        </div>
        {micError && (
          <div style={{ fontSize: 13, color: errColor }}>
            {micError} <Button size="small" sx={btn} onClick={() => void openMic(deviceId)}>Try again</Button>
          </div>
        )}
        <LevelMeter mic={mic} recording={recording} />
        <div>
          <LinearProgress variant="determinate" value={Math.min(100, (recordedSec / goalSec) * 100)} sx={{ height: 6, borderRadius: 3 }} />
          <div style={{ ...muted, marginTop: 4 }}>
            {formatSeconds(recordedSec)} of about {formatSeconds(goalSec)} recorded · sentence {cur + 1}
            {set ? ` · saved as “${set.name}”` : ''}
          </div>
        </div>
        <div style={{
          fontSize: 24, lineHeight: 1.7, padding: '18px 20px', borderRadius: 8, minHeight: 96,
          border: `2px solid ${recording ? '#ef4444' : 'rgba(127,127,127,0.35)'}`,
        }}>
          {sentence || <span style={muted}>No more sentences — finish below.</span>}
        </div>
        {take && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {take.issues.length === 0
              ? <span style={{ fontSize: 13, color: '#22c55e' }}>✓ Good take ({take.analysis ? `${take.analysis.speechSec.toFixed(1)} s` : ''}). Enter to keep it, R to retake.</span>
              : take.issues.map((i) => <span key={i} style={{ fontSize: 13, color: i === 'empty' ? errColor : warnColor }}>⚠ {TAKE_ISSUE_TEXT[i]}</span>)}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {recording ? (
            <Button variant="contained" color="error" sx={btn} onClick={() => void stopTake()}>■ Stop (Space)</Button>
          ) : (
            <Button variant={take ? 'outlined' : 'contained'} sx={btn} onClick={startTake} disabled={!mic || !sentence || storing}>
              {take ? '↺ Retake (R)' : '● Record (Space)'}
            </Button>
          )}
          {take?.url && !recording && <Button size="small" sx={btn} onClick={() => play(take.url as string)}>▶ Play (P)</Button>}
          {take && !recording && !bad && (
            <Button variant="contained" sx={btn} onClick={() => void accept()} disabled={storing}>
              {storing ? <CircularProgress size={16} /> : 'Keep and continue (Enter)'}
            </Button>
          )}
          <span style={{ flex: 1 }} />
          <Button size="small" sx={btn} onClick={skip} disabled={recording || cur + 1 >= queue.length}>Skip this sentence</Button>
        </div>
      </div>
    );
    actions = (
      <>
        <Button sx={btn} onClick={onClose}>{set ? 'Close (takes are saved)' : 'Cancel'}</Button>
        <Button variant="outlined" sx={btn} disabled={recording || recordedSec < MIN_SPEECH_SEC} onClick={() => finish(set)}>
          {recordedSec < MIN_SPEECH_SEC ? `Finish (after ${MIN_SPEECH_SEC} s)` : 'Finish'}
        </Button>
      </>
    );
  } else if (step === 'finish' && set) {
    title = `Your voice: ${set.name}`;
    content = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 14 }}>
          {set.takes.length} sentences · {formatSeconds(recordedSec)} of speech
          {reference && <> · the reference uses {reference.sec.toFixed(1)} s</>}
        </div>
        {reference && (
          <div>
            <Button size="small" variant="outlined" sx={btn} onClick={() => play(keepUrl(wavUrl(reference.wav)))}>▶ Listen to the reference</Button>
          </div>
        )}
        {measuredCpm && (
          <div style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            You read at about <b>{measuredCpm}</b> characters a minute
            <span style={muted}>(talk-time estimates use {cpm})</span>
            {Math.abs(measuredCpm - cpm) >= 5 && (
              <Button size="small" sx={btn} onClick={() => update({ readingCharsPerMin: measuredCpm })}>Use {measuredCpm}</Button>
            )}
          </div>
        )}
        {sharedConsent}
        {reference && registerRow(reference.wav, true)}
        {registeredRow}
        <div style={{ ...muted, marginTop: 4 }}>
          Unhappy with it? Record more sentences, or retake the session. More speech also makes a better training set.
        </div>
      </div>
    );
    actions = (
      <>
        <Button sx={btn} onClick={() => void exportSet(set)}>Export recordings…</Button>
        <Button sx={btn} onClick={() => begin(set)}>Record more</Button>
        <span style={{ flex: 1 }} />
        <Button variant={registered ? 'contained' : 'text'} sx={btn} onClick={onClose}>{registered ? 'Done' : 'Close'}</Button>
      </>
    );
  } else if (step === 'file') {
    title = 'Use an audio file as the voice';
    content = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 14, lineHeight: 1.7 }}>
          Pick a recording of one speaker — clean speech, no music. MDP trims the silence at both ends and uses
          at most the first {REFERENCE_MAX_SEC} s (10–25 s of steady speech is ideal).
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button variant="outlined" component="label" sx={btn} disabled={loadingFile}>
            {loadingFile ? <CircularProgress size={16} /> : file ? 'Choose another file…' : 'Choose an audio file…'}
            <input hidden type="file" accept="audio/*,.wav,.mp3,.m4a,.flac,.ogg,.opus"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void loadFile(f); }} />
          </Button>
          {file && <span style={{ fontSize: 13 }}>{file.fileName} → {file.sec.toFixed(1)} s{file.cut ? ' (cut)' : ''}</span>}
          {file && <Button size="small" sx={btn} onClick={() => play(file.url)}>▶ Listen</Button>}
        </div>
        {file && file.sec < MIN_SPEECH_SEC && (
          <div style={{ fontSize: 13, color: warnColor }}>Only {file.sec.toFixed(1)} s of audio — the voice may not come through well.</div>
        )}
        {file && (
          <>
            <FormControlLabel sx={{ alignItems: 'flex-start' }}
              control={<Checkbox size="small" checked={consentOwner} onChange={(e) => setConsentOwner(e.target.checked)} sx={{ pt: 0.25 }} />}
              label={<span style={{ fontSize: 13 }}>This is my own voice, or the speaker has agreed to its use for speech synthesis.</span>} />
            {sharedConsent}
            {registerRow(file.wav, consentOwner)}
            {registeredRow}
          </>
        )}
      </div>
    );
    actions = <Button variant={registered ? 'contained' : 'text'} sx={btn} onClick={onClose}>{registered ? 'Done' : 'Close'}</Button>;
  }

  return (
    <Dialog open onClose={recording ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>{title}</DialogTitle>
      <DialogContent sx={{ pt: '4px !important' }}>
        {content}
        {error && <div style={{ fontSize: 13, color: errColor, marginTop: 10 }}>{error}</div>}
        {step === 'record' && countChars(sentence) > 0 && (
          <div style={{ ...muted, marginTop: 12 }}>Space = record / stop · Enter = keep · R = retake · P = play back</div>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>{actions}</DialogActions>
    </Dialog>
  );
};
