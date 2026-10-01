import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconButton, Tooltip, Slider, LinearProgress } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import SkipNextIcon from '@mui/icons-material/SkipNext';
import SkipPreviousIcon from '@mui/icons-material/SkipPrevious';
import ReplayIcon from '@mui/icons-material/Replay';
import SubtitlesIcon from '@mui/icons-material/Subtitles';
import SubtitlesOffIcon from '@mui/icons-material/SubtitlesOff';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import CloseIcon from '@mui/icons-material/Close';
import SmartDisplayIcon from '@mui/icons-material/SmartDisplay';
import { SlideView } from '../slide/components/SlideView';
import { SlideEffectLayer } from '../slide/components/SlideEffectLayer';
import type { MotionSpec } from '../slide/parser/SlideContext';
import { useAppSettings } from '../settings/AppSettingsContext';
import renderMathInElement from 'katex/contrib/auto-render';
import {
  synthesize, type Clip, type TtsConfig, type Utterance,
  webSpeechAvailable, loadWebSpeechVoices, listVoicevoxSpeakers, type VoicevoxStyle,
  synthesizesAudio, engineLabel,
} from '../tts/ttsService';
import { buildPlaylist, scriptSegments, type PlayItem, type ScriptAction } from './autoplay';
import { mdpBus } from '../bus/mdpBus';
import { SpeechServerControls } from '../tts/SpeechServerControls';

// KaTeX delimiters for rendering a caption's inline/display math.
const KATEX_DELIMS = [
  { left: '\\(', right: '\\)', display: false },
  { left: '\\[', right: '\\]', display: true },
];

export interface AutoPlaySlide {
  html: string; raw: string; className?: string; header?: string; footer?: string; stepCount: number;
  pageNumber?: number;        // the number the slide shows (hidden slides are not played)
  transition?: MotionSpec;    // its own @transition
}

/** What the auto-play tells the "exact" video export while it is being recorded. */
export type AutoPlayExportEvent =
  | { type: 'prep'; done: number; total: number }       // synthesizing the narration
  | { type: 'armed'; items: number }                    // ready: the first slide is on screen
  | { type: 'item'; index: number; total: number; caption: string }
  | { type: 'finished' }
  | { type: 'error'; message: string };

/** Export mode: the auto-play runs in the hidden window of an "exact" video export
 *  — no setup screen, no controls, the narrator as it was when the job was queued.
 *  It synthesizes every line first, says 'armed', and starts when `go` turns true. */
export interface AutoPlayExportMode {
  tts: TtsConfig;
  cpm: number;
  captions: boolean;
  go: boolean;
  onEvent: (e: AutoPlayExportEvent) => void;
}

// A standalone, full-screen NARRATED auto-slideshow: reads each slide's @script
// aloud (TTS) and auto-advances, with the slideshow's own slide transitions. On
// slides with in-slide builds, `[[step]]` markers in the @script split the
// narration so each segment is read, then the build steps once, keeping the words
// in sync with the reveals. The "exact" video export records this very view.
export const AutoPlayView: React.FC<{
  open: boolean;
  onClose: () => void;
  slides: AutoPlaySlide[];
  slideSize: { width: number; height: number };
  basePath?: string;
  globalTransition?: MotionSpec;
  exportMode?: AutoPlayExportMode;
}> = ({ open, onClose, slides, slideSize, basePath, globalTransition, exportMode }) => {
  const { settings, update } = useAppSettings();
  // Human reading speed → only the script-less dwell.
  const cpm = exportMode?.cpm ?? (settings.readingCharsPerMin || 320);
  const slideRaws = useMemo(() => slides.map((s) => s.raw), [slides]);   // what to read when recording a voice
  // The synthesized-voice speed is its OWN setting (settings.tts.rate), independent of
  // the human reading speed — a synthetic narrator can run faster/slower than a person.
  const exportTts = exportMode?.tts;
  const ttsCfg = useMemo(() => ({ ...(exportTts ?? settings.tts) }), [exportTts, settings.tts]);
  const patchTts = (p: Partial<typeof settings.tts>) => update({ tts: { ...settings.tts, ...p } });
  // Pre-generate the whole show before starting it? Only meaningful for engines
  // that return audio (VOICEVOX / a TTS server): Web Speech exposes no audio data — it
  // synthesizes while it speaks, so there is nothing to prepare in advance. An
  // export always does: a line that is late would be a silent gap in the video.
  const canPregen = synthesizesAudio(ttsCfg.engine);
  const pregenMode = canPregen && (!!exportMode || settings.tts.pregenerate);

  // Flatten the deck into narration steps (shared with the video export).
  const playlist = useMemo<PlayItem[]>(() => buildPlaylist(slides, cpm), [slides, cpm]);
  const firstItemOfSlide = (si: number) => { const i = playlist.findIndex((it) => it.slideIdx === si); return i < 0 ? 0 : i; };

  const [slideIdx, setSlideIdx] = useState(0);
  const [buildStep, setBuildStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState('');
  const [scale, setScale] = useState(1);
  const [caption, setCaption] = useState('');       // the segment currently being spoken
  const [showCaptions, setShowCaptions] = useState(exportMode ? exportMode.captions : true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Control-bar visibility, chosen on the setup screen. `false` = a CLEAN frame for
  // video recording (OBS/screen capture): the bar unmounts (the slide gets the full
  // height), and can still be PEEKED by moving the mouse (auto-hides again) — plus
  // Space always toggles play/pause, so the recording never needs the bar at all.
  const [showBar, setShowBar] = useState(true);
  const [barPeek, setBarPeek] = useState(false);
  const peekTimer = useRef<number | null>(null);
  const peekBar = () => {
    if (showBar || !started) return;
    setBarPeek(true);
    if (peekTimer.current) window.clearTimeout(peekTimer.current);
    peekTimer.current = window.setTimeout(() => setBarPeek(false), 2500);
  };
  // Pre-flight setup gate: while false, show the "configure & start" screen instead
  // of the player, so the voice/engine/speed are chosen BEFORE going fullscreen.
  const [started, setStarted] = useState(false);
  // Pre-generation (opt-in, VOICEVOX only): all of the show's audio is synthesized
  // BEFORE it starts, so a machine too slow to synthesize in real time still plays
  // back smoothly. `prep` drives the progress bar; `usingPregen` says the current
  // run is playing from that cache (its speed is baked into the audio).
  const [prep, setPrep] = useState<{ done: number; total: number; etaSec: number | null } | null>(null);
  const [usingPregen, setUsingPregen] = useState(false);
  const clipsRef = useRef<(Clip | null)[]>([]);   // playlist index -> pre-generated clip
  const prepTokenRef = useRef(0);                 // bumped to cancel a preparation run
  const prepErrorRef = useRef('');                // why the last preparation failed
  const [webVoices, setWebVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [vvSpeakers, setVvSpeakers] = useState<VoicevoxStyle[]>([]);
  const [vvStatus, setVvStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const rootRef = useRef<HTMLDivElement>(null);
  const captionRef = useRef<HTMLDivElement>(null);

  // Render the caption's `\(…\)` / `\[…\]` math with KaTeX. textContent first (so any
  // markup is safely escaped), then auto-render math in place; on any KaTeX error the
  // caption simply stays as plain text — never throws into the render.
  useEffect(() => {
    const el = captionRef.current;
    if (!el) return;
    el.textContent = caption;
    try { renderMathInElement(el, { delimiters: KATEX_DELIMS, throwOnError: false }); }
    catch { /* keep the plain-text caption */ }
  }, [caption, showCaptions]);

  // Export mode's listener, read when an event happens (the loop outlives renders).
  const exportRef = useRef(exportMode);
  useEffect(() => { exportRef.current = exportMode; });
  const emitExport = (e: AutoPlayExportEvent) => {
    try { exportRef.current?.onEvent(e); } catch { /* the recorder's problem, not the show's */ }
  };

  const tokenRef = useRef(0);       // bumped to cancel the running loop
  // Aborts the running loop's syntheses (the line being made + the prefetched next
  // one) so pause / skip / close stop the TTS server too, not just the playback.
  const runAbortRef = useRef<AbortController | null>(null);
  const pregenAbortRef = useRef<AbortController | null>(null);
  const itemIdxRef = useRef(0);     // current playlist index (for resume)
  const utterRef = useRef<Utterance | null>(null);
  const sleepCtl = useRef<{ id: number; resolve: () => void } | null>(null);

  // Fit the fixed-size slide into the viewport (minus the control bar; an export has
  // none — its window is the slide's size, so the slide fills the frame).
  const barSpace = exportMode ? 0 : 76;
  useEffect(() => {
    if (!open) return;
    const fit = () => {
      const s = Math.min(window.innerWidth / slideSize.width, (window.innerHeight - barSpace) / slideSize.height);
      setScale(s > 0 && Number.isFinite(s) ? s : 1);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [open, slideSize.width, slideSize.height, barSpace]);

  const stopAll = () => {
    tokenRef.current++;
    runAbortRef.current?.abort(); runAbortRef.current = null;
    utterRef.current?.stop(); utterRef.current = null;
    if (sleepCtl.current) { window.clearTimeout(sleepCtl.current.id); const r = sleepCtl.current.resolve; sleepCtl.current = null; r(); }
  };

  // Fullscreen (on the player root, so it fills the display while playing).
  useEffect(() => {
    const onFs = () => setIsFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) { void document.exitFullscreen().catch(() => {}); }
    else if (rootRef.current) { void rootRef.current.requestFullscreen().catch(() => {}); }
  };
  // Leaving the player should also leave fullscreen.
  const closeAll = () => { if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); stopAll(); onClose(); };

  // Free every pre-generated clip (each holds a WAV object URL).
  const disposeCache = () => {
    clipsRef.current.forEach((c) => { try { c?.dispose(); } catch { /* ignore */ } });
    clipsRef.current = [];
  };

  // Reset when (re)opened.
  useEffect(() => {
    if (open) { setStarted(false); setSlideIdx(0); setBuildStep(0); setFinished(false); setError(''); setCaption(''); itemIdxRef.current = 0; }
    // Closing frees the pre-generated audio: it is the only place the cache can
    // outlive the playlist it was built for (the view is modal — the deck cannot
    // be edited while it is open).
    else { stopAll(); setPlaying(false); prepTokenRef.current++; pregenAbortRef.current?.abort(); setPrep(null); setUsingPregen(false); disposeCache(); }
  }, [open]);
  useEffect(() => () => { stopAll(); pregenAbortRef.current?.abort(); disposeCache(); }, []);

  // On the setup screen, populate the Web Speech voice list (loads asynchronously).
  useEffect(() => {
    if (!open || started) return;
    let alive = true;
    void loadWebSpeechVoices().then((v) => { if (alive) setWebVoices(v); });
    return () => { alive = false; };
  }, [open, started]);

  // Fetch the running VOICEVOX engine's speakers (on demand — needs the local engine).
  const refreshVvSpeakers = async () => {
    setVvStatus('loading');
    try {
      const list = await listVoicevoxSpeakers(settings.tts.voicevoxUrl);
      setVvSpeakers(list);
      setVvStatus('ok');
      // Default to the first speaker if the saved one isn't offered by this engine.
      if (list.length && !list.some((s) => s.id === settings.tts.voicevoxSpeaker)) {
        patchTts({ voicevoxSpeaker: list[0].id });
      }
    } catch { setVvSpeakers([]); setVvStatus('error'); }
  };
  // When VOICEVOX is selected on the setup screen, try to load its speakers once.
  useEffect(() => {
    if (open && !started && settings.tts.engine === 'voicevox' && vvStatus === 'idle') void refreshVvSpeakers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, started, settings.tts.engine]);

  // Wait `ms`, but resolve early if stopAll() is called (so Pause/Next interrupt a dwell).
  const sleep = (ms: number) => new Promise<void>((res) => {
    const id = window.setTimeout(() => { sleepCtl.current = null; res(); }, ms);
    sleepCtl.current = { id, resolve: res };
  });

  // Wait for a bus topic — interruptible via stopAll(), like sleep(). Resolves
  // `true` when the event arrived, `false` when the wait ran out (or was cut).
  const waitForTopic = (topic: string, timeoutMs: number) => new Promise<boolean>((res) => {
    let settled = false;
    const finish = (arrived: boolean) => {
      if (settled) return; settled = true;
      off(); window.clearTimeout(id);
      if (sleepCtl.current && sleepCtl.current.resolve === cut) sleepCtl.current = null;
      res(arrived);
    };
    const cut = () => finish(false);
    const off = mdpBus.on(topic, () => finish(true));
    const id = window.setTimeout(cut, timeoutMs);
    sleepCtl.current = { id, resolve: cut };
  });

  const warnNoReply = (kind: string, topic: string, ms: number) => {
    const msg = `[[${kind}: ${topic}]] — no reply within ${Math.round(ms / 1000)}s; the narration continued.`;
    console.warn(`[MDP narration] ${msg} Check the \`tag:\` name, and that this workspace's module `
      + 'definition supports ctx.onCommand (re-sync the official assets if it is an old copy).');
    setError(msg);
  };

  // Execute a [[emit…]]/[[wait…]]/[[pause…]] script action at its position.
  const runAction = async (a: ScriptAction) => {
    if (a.kind === 'pause') { await sleep(a.timeoutMs ?? 1000); return; }
    if (!a.topic) return;
    const payload: Record<string, unknown> = { args: a.args || [] };
    if (a.kind === 'emit') { mdpBus.emit(a.topic, payload); return; }
    const timeoutMs = a.timeoutMs ?? 30000;
    if (a.kind === 'wait') {
      if (!await waitForTopic(a.topic, timeoutMs)) warnNoReply('wait', a.topic, timeoutMs);
      return;
    }
    // emit-wait: fire, then hold the narration until the reply (or timeout).
    const replyTo = `reply:${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    const wait = waitForTopic(replyTo, timeoutMs);
    mdpBus.emit(a.topic, { ...payload, replyTo });
    // A timed-out emit-wait is the single most confusing failure in the field: the
    // show simply stalls and then carries on, with nothing played. It means NOBODY
    // answered `cmd:<tag>` — usually a tag typo, a module whose definition in this
    // workspace's `.mdp/modules/` predates ctx.onCommand, or an instance that is
    // not the owner. Say so instead of failing silently.
    if (!await wait) warnNoReply('emit-wait', a.topic, timeoutMs);
  };

  // Kick off synthesis for one item (empty text → an instant no-op clip), abortable
  // with the running loop.
  const synthClip = (item: PlayItem): Promise<Clip> =>
    synthesize(item?.text || '', ttsCfg, undefined, undefined, runAbortRef.current?.signal);
  // The clip for playlist index `i`: the PRE-GENERATED one when the show was
  // prepared up front, else a fresh synthesis (streamed during the previous item).
  const clipFor = (i: number): Promise<Clip> | null => {
    if (i < 0 || i >= playlist.length) return null;
    const cached = clipsRef.current[i];
    return cached ? Promise.resolve(cached) : synthClip(playlist[i]);
  };
  // Free a clip that was synthesized on the fly. Pre-generated ones stay alive — the
  // show can be restarted or jumped back through without synthesizing again.
  const releaseTemp = async (i: number, p: Promise<Clip> | null) => {
    if (!p || clipsRef.current[i]) return;
    try { (await p).dispose(); } catch { /* ignore */ }
  };

  const run = async (fromItem: number) => {
    const my = ++tokenRef.current;
    runAbortRef.current?.abort();
    runAbortRef.current = new AbortController();
    setPlaying(true); setFinished(false); setError('');
    // Prefetch the first item's audio; thereafter each iteration hands its
    // prefetched-next clip to the following one, so VOICEVOX synthesis of the NEXT
    // segment overlaps playback of the current one (no silent gap between segments).
    // With a pre-generated show every lookup is an instant cache hit instead.
    let curClip: Promise<Clip> | null = clipFor(fromItem);
    for (let i = fromItem; i < playlist.length; i++) {
      if (tokenRef.current !== my) { await releaseTemp(i, curClip); return; }
      itemIdxRef.current = i;
      const item = playlist[i];
      setSlideIdx(item.slideIdx); setBuildStep(item.buildStep); setCaption(item.caption || '');
      emitExport({ type: 'item', index: i, total: playlist.length, caption: item.caption || '' });
      const nextClip = clipFor(i + 1);
      if (item.action) {
        await runAction(item.action);
        if (tokenRef.current !== my) { await releaseTemp(i, curClip); await releaseTemp(i + 1, nextClip); return; }
      } else if (item.text) {
        let clip: Clip;
        try { clip = await (curClip ?? synthClip(item)); }
        catch (e) {
          // Paused / skipped / closed while this line was being synthesized: the
          // abort is ours, not a failure to report.
          if (tokenRef.current !== my) { await releaseTemp(i + 1, nextClip); return; }
          setError(e instanceof Error ? e.message : 'Speech failed.');
          emitExport({ type: 'error', message: e instanceof Error ? e.message : 'Speech failed.' });
          setPlaying(false); tokenRef.current++;
          await releaseTemp(i + 1, nextClip); return;
        }
        if (tokenRef.current !== my) {
          if (!clipsRef.current[i]) clip.dispose();
          await releaseTemp(i + 1, nextClip); return;
        }
        const u = clip.play(); utterRef.current = u;
        await u.done;
        if (!clipsRef.current[i]) clip.dispose();   // streamed clip: free its WAV
        if (tokenRef.current !== my) { await releaseTemp(i + 1, nextClip); return; }
        await sleep(item.dwellMs);
      } else {
        await sleep(item.dwellMs);
        if (tokenRef.current !== my) { await releaseTemp(i + 1, nextClip); return; }
      }
      curClip = nextClip;
    }
    if (tokenRef.current === my) { setPlaying(false); setFinished(true); emitExport({ type: 'finished' }); }
  };

  // Synthesize the WHOLE show before it starts. Resolves true when every clip is
  // ready, false if the user cancelled or the engine failed (the caller then stays
  // on the setup screen). Cancelling aborts the line in progress at once.
  const pregenAll = async (): Promise<boolean> => {
    const targets: { i: number; text: string }[] = [];
    playlist.forEach((it, i) => { if (it.text) targets.push({ i, text: it.text }); });
    const my = ++prepTokenRef.current;
    pregenAbortRef.current?.abort();
    const ac = new AbortController();
    pregenAbortRef.current = ac;
    disposeCache();
    setError('');
    setPrep({ done: 0, total: targets.length, etaSec: null });
    const t0 = Date.now();
    for (let k = 0; k < targets.length; k++) {
      if (prepTokenRef.current !== my) { disposeCache(); setPrep(null); return false; }
      try {
        clipsRef.current[targets[k].i] = await synthesize(targets[k].text, ttsCfg, undefined, undefined, ac.signal);
      } catch (e) {
        disposeCache();
        setPrep(null);
        // Cancelled (or the view closed): our own abort, not an error to show.
        if (prepTokenRef.current !== my) return false;
        prepErrorRef.current = e instanceof Error ? e.message : 'Speech synthesis failed.';
        setError(prepErrorRef.current);
        return false;
      }
      if (prepTokenRef.current !== my) { disposeCache(); setPrep(null); return false; }
      // ETA from the average cost so far — the only honest estimate we have, and
      // the one thing that makes a multi-minute wait bearable.
      const avgMs = (Date.now() - t0) / (k + 1);
      setPrep({ done: k + 1, total: targets.length, etaSec: Math.round((avgMs * (targets.length - k - 1)) / 1000) });
    }
    setPrep(null);
    setUsingPregen(true);
    return true;
  };
  const cancelPregen = () => { prepTokenRef.current++; pregenAbortRef.current?.abort(); };

  const play = () => { if (finished) { itemIdxRef.current = 0; setSlideIdx(0); run(0); } else run(itemIdxRef.current); };
  // Leave the setup screen: go TRUE fullscreen (ignored if the browser refuses) and
  // start the narrated show from the first slide. Fullscreen is requested FIRST —
  // it needs the click's user activation, which a long pre-generation would consume.
  const startShow = async () => {
    if (rootRef.current && !document.fullscreenElement) void rootRef.current.requestFullscreen().catch(() => {});
    if (pregenMode) {
      const ok = await pregenAll();
      if (!ok) return;   // cancelled / engine failure → stay on the setup screen
    }
    setStarted(true);
    run(0);
  };
  const pause = () => { stopAll(); setPlaying(false); };
  const restart = () => { stopAll(); setFinished(false); setSlideIdx(0); setBuildStep(0); itemIdxRef.current = 0; run(0); };
  const jump = (delta: number) => {
    const ni = Math.max(0, Math.min(slides.length - 1, slideIdx + delta));
    const wasPlaying = playing;
    stopAll();
    const it = firstItemOfSlide(ni);
    itemIdxRef.current = it;
    setSlideIdx(ni); setBuildStep(0); setFinished(false);
    if (wasPlaying) run(it); else setPlaying(false);
  };

  // Export mode: no setup screen. Synthesize every line, put the first slide on
  // screen, say 'armed'; the recorder starts and then sets `go` — the show runs
  // from the top.
  const exportOn = !!exportMode;
  useEffect(() => {
    if (!open || !exportOn) return undefined;
    let alive = true;
    void (async () => {
      if (!canPregen) {
        emitExport({ type: 'error', message: 'Web Speech gives no audio data — choose VOICEVOX or a TTS server to make a narrated video.' });
        return;
      }
      prepErrorRef.current = '';
      const ok = await pregenAll();
      if (!alive) return;
      if (!ok) { emitExport({ type: 'error', message: prepErrorRef.current || 'The narration could not be prepared.' }); return; }
      setStarted(true);
      try { await document.fonts.ready; } catch { /* draw with what there is */ }
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      if (alive) emitExport({ type: 'armed', items: playlist.length });
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, exportOn]);
  // Synthesis progress, for the export queue's panel.
  useEffect(() => {
    if (exportOn && prep) emitExport({ type: 'prep', done: prep.done, total: prep.total });
  }, [exportOn, prep]);
  const wentRef = useRef(false);
  const exportGo = !!exportMode?.go;
  useEffect(() => {
    if (!exportGo || !started || wentRef.current) return;
    wentRef.current = true;
    void run(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportGo, started]);

  // App-wide narration control: any module (or the presenter) can pause/resume/
  // skip the narrated auto-play by emitting `narration:*` bus events. Not in an
  // export: a video has nobody to resume a paused narration.
  const controlRef = useRef({ play, pause, jump, playing });
  controlRef.current = { play, pause, jump, playing };
  useEffect(() => {
    if (!open || exportOn) return;
    const offs = [
      mdpBus.on('narration:pause', () => { if (controlRef.current.playing) controlRef.current.pause(); }),
      mdpBus.on('narration:resume', () => { if (!controlRef.current.playing) controlRef.current.play(); }),
      mdpBus.on('narration:skip', () => controlRef.current.jump(1)),
    ];
    return () => offs.forEach((f) => f());
  }, [open, exportOn]);

  // Keyboard transport (works with the control bar hidden — essential for clean
  // recording): Space = play/pause, ←/→ = previous/next slide. Active only during
  // playback (not on the setup screen, where inputs need their keys).
  useEffect(() => {
    if (!open || !started || exportOn) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') { e.preventDefault(); if (playing) pause(); else play(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); jump(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); jump(-1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, started, playing, finished, slideIdx, exportOn]);

  // One slide inside the transition layer — during a transition the outgoing one
  // keeps rendering, as in the slideshow itself. Both frames stay `presenting`: a
  // change of it re-runs the slide's module scripts, which would restart the
  // outgoing slide's modules just as it leaves.
  const renderSlide = useCallback((s: AutoPlaySlide, idx: number, o: { buildStep: number }) => (
    <SlideView
      html={s.html} raw={s.raw} slideSize={slideSize} basePath={basePath}
      buildStep={o.buildStep} presenting isActive slideIndex={idx} moduleRole="owner"
      header={s.header} footer={s.footer} className={s.className} pageNumber={s.pageNumber ?? idx + 1}
    />
  ), [slideSize, basePath]);

  if (!open) return null;

  const engine = settings.tts.engine;
  const jaFirstVoices = [...webVoices].sort((a, b) => (a.lang.startsWith('ja') ? 0 : 1) - (b.lang.startsWith('ja') ? 0 : 1));
  const selectStyle: React.CSSProperties = {
    width: '100%', padding: '8px 10px', borderRadius: 6, fontSize: 14,
    background: '#1b1d22', color: '#eee', border: '1px solid #3a3d44',
  };
  const scriptedCount = slides.filter((s) => scriptSegments(s.raw).length > 0).length;

  return (
    <div ref={rootRef} onMouseMove={exportOn ? undefined : peekBar} style={{ position: 'fixed', inset: 0, zIndex: 3000, background: '#000', display: 'flex', flexDirection: 'column' }}>
      {!started && !exportOn && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 10, display: 'flex', alignItems: 'center',
          justifyContent: 'center', padding: 20, background: 'radial-gradient(circle at 50% 35%, #23262e, #0c0d10)',
          overflow: 'auto',
        }}>
          <div style={{
            width: 'min(560px, 94vw)', background: '#16181d', color: '#e8e8ea', borderRadius: 14,
            border: '1px solid #2c2f37', boxShadow: '0 20px 60px rgba(0,0,0,.5)', padding: '22px 24px',
            font: '14px/1.55 system-ui, sans-serif',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <SmartDisplayIcon style={{ color: '#8ab4f8' }} />
              <div style={{ fontSize: 19, fontWeight: 800 }}>Auto-narration slideshow</div>
              <div style={{ flex: 1 }} />
              <Tooltip title="Close"><IconButton size="small" onClick={closeAll} sx={{ color: '#aab' }}><CloseIcon fontSize="small" /></IconButton></Tooltip>
            </div>
            <div style={{ color: '#9aa0aa', fontSize: 12.5, marginBottom: 18 }}>
              Reads each slide’s <code style={{ color: '#c7d2fe' }}>@script</code> aloud and auto-advances, in full screen.
              {' '}{slides.length} slides · {scriptedCount} with a script.
            </div>

            {/* While pre-generating, the settings are frozen: the clips already made
                use the values as they were when Start was pressed. */}
            <div style={{ pointerEvents: prep ? 'none' : 'auto', opacity: prep ? 0.5 : 1 }}>
            {/* Engine */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 700, marginBottom: 7 }}>Voice engine</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {([
                  ['webspeech', 'Web Speech', 'Built-in OS voices · no setup'],
                  ['voicevox', 'VOICEVOX', 'Local engine · natural JP voices'],
                  ['openai', 'TTS server', 'OpenAI-compatible · Irodori-TTS, OpenAI…'],
                ] as const).map(([id, label, sub]) => {
                  const sel = engine === id;
                  const avail = id === 'webspeech' ? webSpeechAvailable() : true;
                  return (
                    <button key={id} type="button" disabled={!avail}
                      onClick={() => { patchTts({ engine: id }); if (id === 'voicevox') setVvStatus('idle'); }}
                      style={{
                        flex: 1, textAlign: 'left', padding: '10px 12px', borderRadius: 9, cursor: avail ? 'pointer' : 'not-allowed',
                        border: `1.5px solid ${sel ? '#4f8cf7' : '#33363e'}`, background: sel ? 'rgba(79,140,247,.14)' : '#1b1d22',
                        color: '#e8e8ea', opacity: avail ? 1 : 0.5,
                      }}>
                      <div style={{ fontWeight: 700 }}>{label}</div>
                      <div style={{ fontSize: 11.5, color: '#9aa0aa', marginTop: 2 }}>{sub}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Voice / speaker */}
            {engine === 'openai' ? (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontWeight: 700, marginBottom: 9 }}>TTS server (OpenAI-compatible)</div>
                <SpeechServerControls tts={settings.tts} patchTts={patchTts} dark slideRaws={slideRaws} />
              </div>
            ) : engine === 'webspeech' ? (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontWeight: 700, marginBottom: 7 }}>Voice</div>
                <select style={selectStyle} value={settings.tts.webspeechVoiceURI}
                  onChange={(e) => patchTts({ webspeechVoiceURI: e.target.value })}>
                  <option value="">System default</option>
                  {jaFirstVoices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>)}
                </select>
                {!jaFirstVoices.length && <div style={{ fontSize: 12, color: '#9aa0aa', marginTop: 6 }}>Loading voices… (uses the system default if none appear)</div>}
              </div>
            ) : (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontWeight: 700, marginBottom: 7 }}>VOICEVOX engine</div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <input style={{ ...selectStyle, flex: 1 }} value={settings.tts.voicevoxUrl}
                    onChange={(e) => patchTts({ voicevoxUrl: e.target.value })} placeholder="http://127.0.0.1:50021" />
                  <button type="button" onClick={() => void refreshVvSpeakers()} style={{
                    padding: '0 14px', borderRadius: 6, cursor: 'pointer', border: '1px solid #3a3d44',
                    background: '#242730', color: '#e8e8ea', whiteSpace: 'nowrap',
                  }}>{vvStatus === 'loading' ? '…' : 'Connect'}</button>
                </div>
                {vvStatus === 'error' && <div style={{ fontSize: 12, color: '#f87171', marginBottom: 8 }}>Couldn’t reach the engine. Start the VOICEVOX app, then Connect.</div>}
                <select style={selectStyle} value={settings.tts.voicevoxSpeaker} disabled={!vvSpeakers.length}
                  onChange={(e) => patchTts({ voicevoxSpeaker: Number(e.target.value) })}>
                  {vvSpeakers.length
                    ? vvSpeakers.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)
                    : <option value={settings.tts.voicevoxSpeaker}>Connect to list speakers…</option>}
                </select>
              </div>
            )}

            {/* Speed + captions */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 22, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 700, marginBottom: 2 }}>Speed <span style={{ color: '#9aa0aa', fontWeight: 400 }}>{settings.tts.rate.toFixed(1)}×</span></div>
                <Slider size="small" min={0.5} max={2} step={0.1} value={settings.tts.rate}
                  onChange={(_, v) => patchTts({ rate: v as number })} sx={{ color: '#8ab4f8' }} />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
                <input type="checkbox" checked={showCaptions} onChange={(e) => setShowCaptions(e.target.checked)} />
                Subtitles
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }} title="Uncheck for a clean frame when recording the show as a video (OBS / screen capture). Move the mouse to peek at the controls; Space pauses.">
                <input type="checkbox" checked={showBar} onChange={(e) => setShowBar(e.target.checked)} />
                Control bar
              </label>
              <label
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, userSelect: 'none',
                  cursor: canPregen ? 'pointer' : 'not-allowed', opacity: canPregen ? 1 : 0.5,
                }}
                title={canPregen
                  ? 'Synthesize every line BEFORE the show starts, then play from memory. Slower to start, but no stutter on machines that cannot synthesize in real time.'
                  : 'VOICEVOX / TTS server only — Web Speech synthesizes while it speaks, so there is nothing to prepare in advance.'}>
                <input type="checkbox" disabled={!canPregen}
                  checked={pregenMode}
                  onChange={(e) => patchTts({ pregenerate: e.target.checked })} />
                Pre-generate audio
              </label>
            </div>
            {pregenMode && (
              <div style={{ margin: '-14px 0 18px', fontSize: 12, color: '#9aa0aa' }}>
                ⏳ All {playlist.filter((it) => it.text).length} lines are synthesized before the show starts (progress is shown);
                playback then runs from memory — for machines that stutter on real-time synthesis.
                The speed is baked in, so it can’t be changed during the show.
              </div>
            )}
            {!showBar && (
              <div style={{ margin: '-14px 0 18px', fontSize: 12, color: '#9aa0aa' }}>
                🎬 Clean-recording mode: no control bar in the frame. Space = pause/resume, ←/→ = slides, mouse move = peek controls, Esc = exit fullscreen.
              </div>
            )}
            </div>

            {prep ? (
              /* Pre-generation in progress: the show waits here until every line is
                 synthesized, so playback afterwards never has to wait for the engine. */
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 7 }}>
                  <span style={{ fontWeight: 700 }}>Generating audio…</span>
                  <span style={{ color: '#9aa0aa', fontVariantNumeric: 'tabular-nums' }}>
                    {prep.done} / {prep.total}
                    {prep.etaSec != null && prep.etaSec > 0
                      ? ` · ~${Math.floor(prep.etaSec / 60)}:${String(prep.etaSec % 60).padStart(2, '0')} left`
                      : ''}
                  </span>
                </div>
                <LinearProgress
                  variant="determinate"
                  value={prep.total ? (prep.done / prep.total) * 100 : 0}
                  sx={{ height: 10, borderRadius: 999, backgroundColor: '#242730', '& .MuiLinearProgress-bar': { backgroundColor: '#4f8cf7', borderRadius: 999 } }}
                />
                <button type="button" onClick={cancelPregen} style={{
                  width: '100%', marginTop: 14, padding: '10px 0', borderRadius: 10, cursor: 'pointer',
                  border: '1px solid #3a3d44', background: '#1b1d22', color: '#e8e8ea', fontSize: 14, fontWeight: 700,
                }}>
                  Cancel
                </button>
                <div style={{ textAlign: 'center', color: '#787e88', fontSize: 11.5, marginTop: 10 }}>
                  Cancel stops the synthesis right away
                </div>
              </div>
            ) : (
              <>
                <button type="button" onClick={() => void startShow()} style={{
                  width: '100%', padding: '13px 0', borderRadius: 10, cursor: 'pointer', border: 'none',
                  background: 'linear-gradient(90deg,#4f8cf7,#6aa1ff)', color: '#fff', fontSize: 16, fontWeight: 800,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}>
                  <PlayArrowIcon /> {pregenMode ? 'Generate audio & start' : 'Start in full screen'}
                </button>
                {error && <div style={{ color: '#f87171', fontSize: 12.5, marginTop: 10, textAlign: 'center' }}>{error}</div>}
                <div style={{ textAlign: 'center', color: '#787e88', fontSize: 11.5, marginTop: 10 }}>
                  Esc exits full screen · Space/▶ pause · these settings are saved
                </div>
              </>
            )}
          </div>
        </div>
      )}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative' }}>
        {slides.length > 0 && (
          <div style={{ width: slideSize.width, height: slideSize.height, flexShrink: 0, position: 'relative', transform: `scale(${scale})`, transformOrigin: 'center' }}>
            <SlideEffectLayer
              slides={slides}
              index={Math.min(slideIdx, slides.length - 1)}
              step={buildStep}
              globalTransition={globalTransition}
              renderSlide={renderSlide}
            />
          </div>
        )}
        {showCaptions && caption && (
          <div ref={captionRef} style={{
            position: 'absolute', left: '50%', bottom: 'clamp(16px, 4vh, 48px)', transform: 'translateX(-50%)',
            maxWidth: 'min(90%, 1100px)', padding: '8px 18px', borderRadius: 10,
            background: 'rgba(0,0,0,.72)', color: '#fff', textAlign: 'center',
            fontSize: 'clamp(16px, 2.4vw, 30px)', lineHeight: 1.35, fontWeight: 600,
            textShadow: '0 1px 3px rgba(0,0,0,.6)', pointerEvents: 'none', whiteSpace: 'pre-wrap',
          }} />
        )}
      </div>

      {/* Control bar. Hidden in clean-recording mode while PLAYING (the slide gets
          the full height); pausing, finishing, or moving the mouse (peek) brings it
          back — as a bottom OVERLAY so the recorded layout doesn't reflow. */}
      {!exportOn && (showBar || barPeek || !playing) && (
      <div style={{
        height: 60, display: 'flex', alignItems: 'center', gap: 6, padding: '0 14px', background: 'rgba(20,20,22,.92)', color: '#eee',
        ...(showBar ? {} : { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 5 }),
      }}>
        <Tooltip title="Previous slide"><span><IconButton size="small" onClick={() => jump(-1)} sx={{ color: '#ddd' }} disabled={slideIdx <= 0}><SkipPreviousIcon /></IconButton></span></Tooltip>
        {playing
          ? <Tooltip title="Pause"><IconButton onClick={pause} sx={{ color: '#fff' }}><PauseIcon /></IconButton></Tooltip>
          : <Tooltip title={finished ? 'Play from start' : 'Play'}><IconButton onClick={play} sx={{ color: '#fff' }}><PlayArrowIcon /></IconButton></Tooltip>}
        <Tooltip title="Next slide"><span><IconButton size="small" onClick={() => jump(1)} sx={{ color: '#ddd' }} disabled={slideIdx >= slides.length - 1}><SkipNextIcon /></IconButton></span></Tooltip>
        <Tooltip title="Restart"><IconButton size="small" onClick={restart} sx={{ color: '#ddd' }}><ReplayIcon /></IconButton></Tooltip>
        <Tooltip title={showCaptions ? 'Hide subtitles' : 'Show subtitles'}><IconButton size="small" onClick={() => setShowCaptions((v) => !v)} sx={{ color: showCaptions ? '#fff' : '#889' }}>{showCaptions ? <SubtitlesIcon /> : <SubtitlesOffIcon />}</IconButton></Tooltip>

        <div style={{ fontVariantNumeric: 'tabular-nums', marginLeft: 8, fontSize: 14 }}>
          {slideIdx + 1} / {slides.length}
        </div>
        <div style={{ fontSize: 12, color: '#9aa', marginLeft: 12 }}>
          {engineLabel(settings.tts.engine)}
          {usingPregen ? <span style={{ color: '#86efac', marginLeft: 8 }}>· pre-generated</span> : null}
          {error ? <span style={{ color: '#f87171', marginLeft: 10 }}>{error}</span> : null}
          {finished && !error ? <span style={{ color: '#86efac', marginLeft: 10 }}>Finished</span> : null}
        </div>

        <div style={{ flex: 1 }} />

        {/* Voice playback speed (independent of the talk-time reading speed). Locked
            for a pre-generated show — the speed is already baked into the audio. */}
        <Tooltip title={usingPregen ? 'Speed is fixed: the audio was pre-generated at this rate' : 'Voice speed'}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 150, opacity: usingPregen ? 0.55 : 1 }}>
            <span style={{ fontSize: 12, color: '#9aa' }}>Speed</span>
            <Slider size="small" min={0.5} max={2} step={0.1} value={settings.tts.rate} disabled={usingPregen}
              onChange={(_, v) => patchTts({ rate: v as number })} sx={{ width: 90, color: '#8ab4f8' }} />
            <span style={{ fontSize: 12, width: 30 }}>{settings.tts.rate.toFixed(1)}×</span>
          </div>
        </Tooltip>

        <Tooltip title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}><IconButton size="small" onClick={toggleFullscreen} sx={{ color: '#ddd' }}>{isFullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}</IconButton></Tooltip>
        <Tooltip title="Close"><IconButton onClick={closeAll} sx={{ color: '#ddd' }}><CloseIcon /></IconButton></Tooltip>
      </div>
      )}
    </div>
  );
};
