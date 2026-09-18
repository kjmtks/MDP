import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { SlideView } from '../../features/slide/components/SlideView';
import { SlideScaler } from '../../features/slide/components/SlideScaler';
import { SlideOverviewGrid } from '../../features/slide/components/SlideOverviewGrid';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import RefreshIcon from '@mui/icons-material/Refresh';
import { Panel, Group, Separator } from 'react-resizable-panels';

import { useSync, type SyncMessage } from '../../features/remote/hooks/useSync';
import { useAppSettings } from '../../features/settings/AppSettingsContext';
import { matchAction } from '../../features/settings/shortcuts/matcher';
import { ACTIONS_BY_SCOPE } from '../../features/settings/shortcuts/registry';
import { moduleSyncBus } from '../../features/modules/moduleSyncBus';
import { mdpBus } from '../../features/bus/mdpBus';
import { registerParsedModule, clearAllModules } from '../../features/modules/moduleManager';
import { registerParsedEffect, clearAllEffects } from '../../features/effects/effectManager';
import type { ModuleData } from '../../utils/moduleParser';
import type { EffectData } from '../../utils/effectParser';
import { useDrawing } from '../../features/drawing/hooks/useDrawing';
import { estimateDeckSeconds, slideSeconds, explicitSlideSeconds, formatClock } from '../../features/slide/talkTime';
import { firstHeading, newRunId, type RehearsalRun } from '../../features/rehearsal/rehearsalStore';
import { SlideControls, type AppMode } from '../../features/drawing/components/SlideControls';
import type { Stroke } from '../../features/drawing/components/DrawingOverlay';

import EditIcon from '@mui/icons-material/Edit';
import SaveIcon from '@mui/icons-material/Save';
import GridViewIcon from '@mui/icons-material/GridView';
import { Button, TextField } from '@mui/material';

import '../../App.css';
import './PresenterPage.css';

interface SyncData {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  slides: any[];
  index: number;
  step?: number;
  slideSize: { width: number; height: number };
  themeCssUrl?: string;
  lastUpdated: number;
  allDrawings?: Record<number, Stroke[]>;
  isOverview?: boolean;
  modules?: ModuleData[];
  effects?: EffectData[];
  // The deck's most recent saved rehearsal run (host-side sidecar), for the
  // "last time" marks on the countdowns.
  lastRehearsal?: RehearsalRun | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const extractNoteText = (slide: any) => {
  if (!slide) return '';
  if (slide.noteRaw) return slide.noteRaw;
  if (!slide.noteHtml) return '';

  const noteRegex = new RegExp('<' + '!--\\s*@note:([\\s\\S]*?)--' + '>');
  const match = slide.noteHtml.match(noteRegex);
  if (match) return match[1].trim();

  let text = slide.noteHtml.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n');
  text = text.replace(/<[^>]*>?/gm, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

  return text.trim();
};

// The raw `<!-- @script: … -->` blocks of a slide, in document order. Editing
// works on the RAW text (the rendered scriptHtml has its control markers turned
// into chips / stripped), so `[[step]]`, `[[emit: …]]` etc. survive a round-trip.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const extractScriptBlocks = (slide: any): string[] =>
  [...String(slide?.raw || '').matchAll(/<!--\s*@script:\s*([\s\S]*?)\s*-->/g)].map((m) => m[1].trim());

export default function PresenterPage() {
  const { settings: appSettings } = useAppSettings();
  const [channelId] = useState<string | null>(() => {
    const query = window.location.hash.split('?')[1] || window.location.search;
    const params = new URLSearchParams(query);
    return params.get('channel');
  });
  const [token] = useState<string | null>(() => {
    const query = window.location.hash.split('?')[1] || window.location.search;
    const params = new URLSearchParams(query);
    return params.get('token');
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [slides, setSlides] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [step, setStep] = useState(0);
  // Signatures of the currently-registered module / effect sets, to avoid
  // re-registering on every SYNC_STATE broadcast.
  const moduleSigRef = useRef<string>('');
  const effectSigRef = useRef<string>('');

  const currentSlide = slides[currentIndex];
  const nextIndex = useMemo(() => {
    if (!slides || slides.length === 0) return -1;
    let next = currentIndex + 1;
    while (next < slides.length && slides[next]?.isHidden) {
      next++;
    }
    return next < slides.length ? next : -1;
  }, [currentIndex, slides]);

  const nextSlide = nextIndex !== -1 ? slides[nextIndex] : null;

  const [slideSize, setSlideSize] = useState({ width: 1280, height: 720 });
  const [themeCssUrl, setThemeCssUrl] = useState<string | undefined>(undefined);
  const [lastUpdated, setLastUpdated] = useState<number>(0);
  const [isOverview, setIsOverview] = useState(false);

  const [currentTime, setCurrentTime] = useState(new Date());
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isTimerRunning, setIsTimerRunning] = useState(false);

  const [mode, setMode] = useState<AppMode>('view');
  const { drawings, addStroke, updateStrokes, syncDrawings, clear } = useDrawing();
  const [toolType, setToolType] = useState<'pen' | 'eraser' | 'select'>('pen');
  const [penColor, setPenColor] = useState('#FF0000');
  const [penWidth, setPenWidth] = useState(3);
  const [stylusOnly, setStylusOnly] = useState(false);

  const [isEditingNote, setIsEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [isEditingScript, setIsEditingScript] = useState(false);
  const [scriptDrafts, setScriptDrafts] = useState<string[]>([]);
  const [prevIndex, setPrevIndex] = useState(currentIndex);

  const timerStartRef = useRef<number | null>(null);
  const accumulatedTimeRef = useRef<number>(0);
  const animationFrameRef = useRef<number>(0);
  // Elapsed-timer value (ms) captured when the CURRENT slide was entered, so the
  // per-slide countdown measures time spent on THIS slide.
  const slideBaselineMsRef = useRef<number>(0);

  // ---- Rehearsal recorder ----------------------------------------------------
  // While the stopwatch runs, the time spent on each slide is accumulated (summed
  // over revisits) and the run is sent to the host — which owns the deck path and
  // writes the `.rehearsals.json` sidecar — every time the timer pauses (same run
  // id → the saved run is updated), on reset, and when this window closes.
  const recMsRef = useRef<number[]>([]);          // ms spent per slide index
  const recVisitsRef = useRef<number[]>([]);      // visits per slide index
  const recSegmentStartRef = useRef<number>(0);   // elapsed ms when the current slide's segment began
  const recRunRef = useRef<{ id: string; startedAt: string } | null>(null);
  const [recStatus, setRecStatus] = useState<'idle' | 'recording' | 'paused' | 'saved'>('idle');
  const [lastRehearsal, setLastRehearsal] = useState<RehearsalRun | null>(null);
  // Latest render values for handlers that must not go stale (beforeunload).
  const latestRef = useRef({ elapsedTime: 0, currentIndex: 0, slides: [] as any[], readingCpm: 320, deckSeconds: 0 }); // eslint-disable-line @typescript-eslint/no-explicit-any

  // Speaking-time budgets (seconds): whole deck + the current slide. From each
  // slide's `<!-- @time … -->` when set, else `@script` read time, else estimate.
  const readingCpm = appSettings.readingCharsPerMin;
  const deckSeconds = useMemo(() => estimateDeckSeconds(slides, readingCpm), [slides, readingCpm]);
  const currentBudgetSec = useMemo(() => (currentSlide ? slideSeconds(currentSlide, readingCpm) : 0), [currentSlide, readingCpm]);
  const currentHasExplicit = !!(currentSlide && explicitSlideSeconds(currentSlide.raw || '') != null);
  // Budget of everything BEFORE the current slide — the schedule the elapsed timer
  // is compared against to say whether the talk is running ahead or behind.
  const budgetBeforeSec = useMemo(() => {
    let s = 0;
    for (let i = 0; i < currentIndex && i < slides.length; i++) {
      const sl = slides[i];
      if (sl && !sl.isHidden) s += slideSeconds(sl, readingCpm);
    }
    return s;
  }, [slides, currentIndex, readingCpm]);

  const { send } = useSync(channelId, token, (msg: SyncMessage) => {
    switch (msg.type) {
      case 'SYNC_STATE': {
        const data = msg.payload as SyncData;
        // Register module definitions (CSS + scripts) shipped from the host so
        // that styling and interactive modules work on this mirror surface.
        if (data.modules) {
          const sig = data.modules.map(m => `${m.config?.name}:${(m.style || '').length}:${(m.script || '').length}`).join('|');
          if (sig !== moduleSigRef.current) {
            moduleSigRef.current = sig;
            clearAllModules();
            data.modules.forEach(registerParsedModule);
          }
        }
        // Register effect definitions (build/transition CSS + JS hooks) so in-slide
        // builds and transitions actually run on this mirror surface.
        if (data.effects) {
          const sig = data.effects.map(e => `${e.config?.name}:${(e.style || '').length}:${(e.script || '').length}`).join('|');
          if (sig !== effectSigRef.current) {
            effectSigRef.current = sig;
            clearAllEffects();
            data.effects.forEach(registerParsedEffect);
          }
        }
        if (data.slides) setSlides(data.slides);
        if (typeof data.index === 'number') setCurrentIndex(data.index);
        if (typeof data.step === 'number') setStep(data.step);
        if (data.slideSize) setSlideSize(data.slideSize);
        if (data.allDrawings) syncDrawings(data.allDrawings);
        setIsOverview(!!data.isOverview);
        if ('lastRehearsal' in data) setLastRehearsal(data.lastRehearsal ?? null);

        setThemeCssUrl(data.themeCssUrl);
        setLastUpdated(data.lastUpdated);
        break;
      }
      case 'MODULE_STATE':
        moduleSyncBus.receiveState(msg.syncId, msg.state);
        break;
      case 'MODULE_ACTION':
        moduleSyncBus.receiveAction(msg.syncId, msg.actionType, msg.payload);
        break;
      case 'BUS_EVENT':
        mdpBus.receiveRemote(msg.topic, msg.payload);
        break;
      case 'DRAW_STROKE':
        addStroke(msg.pageIndex, msg.stroke, false);
        break;
      case 'CLEAR_DRAWING':
        clear(msg.pageIndex);
        break;
    }
  });

  // This window is a mirror: interactive modules dispatch actions back to the
  // host (owner), which runs the logic and broadcasts state to all surfaces.
  useEffect(() => {
    moduleSyncBus.setSender((m) => send(m as SyncMessage, 'all'));
    mdpBus.setSender((m) => send(m as SyncMessage, 'all'));
    return () => { moduleSyncBus.setSender(null); mdpBus.setSender(null); };
  }, [send]);

  if (currentIndex !== prevIndex) {
    setPrevIndex(currentIndex);
    setIsEditingNote(false);
    setNoteDraft(extractNoteText(currentSlide));
    setIsEditingScript(false);
    setScriptDrafts(extractScriptBlocks(currentSlide));
    // Restart the per-slide countdown from the current elapsed value.
    slideBaselineMsRef.current = elapsedTime;
    // Book the time spent on the slide we are leaving to the recorder.
    if (recRunRef.current) {
      recMsRef.current[prevIndex] = (recMsRef.current[prevIndex] || 0) + Math.max(0, elapsedTime - recSegmentStartRef.current);
      recVisitsRef.current[currentIndex] = (recVisitsRef.current[currentIndex] || 0) + 1;
    }
    recSegmentStartRef.current = elapsedTime;
  }
  latestRef.current = { elapsedTime, currentIndex, slides, readingCpm, deckSeconds };

  const handleToggleEditNote = useCallback(() => {
    if (isEditingNote) {
      if (channelId) {
        send({ type: 'UPDATE_NOTE', pageIndex: currentIndex, note: noteDraft, channelId });
      }
    } else {
      setNoteDraft(extractNoteText(currentSlide));
    }
    setIsEditingNote(!isEditingNote);
  }, [isEditingNote, channelId, currentIndex, noteDraft, send, currentSlide]);

  const handleToggleEditScript = useCallback(() => {
    if (isEditingScript) {
      if (channelId) {
        send({ type: 'UPDATE_SCRIPT', pageIndex: currentIndex, scripts: scriptDrafts, channelId });
      }
    } else {
      // A slide with no script yet starts with one empty block to type into.
      const blocks = extractScriptBlocks(currentSlide);
      setScriptDrafts(blocks.length ? blocks : ['']);
    }
    setIsEditingScript(!isEditingScript);
  }, [isEditingScript, channelId, currentIndex, scriptDrafts, send, currentSlide]);

  useEffect(() => {
    const linkId = 'mdp-presenter-theme';
    let link = document.getElementById(linkId) as HTMLLinkElement;
    if (themeCssUrl) {
      if (!link) {
        link = document.createElement('link');
        link.id = linkId;
        link.rel = 'stylesheet';
        document.head.appendChild(link);
      }
      const separator = themeCssUrl.includes('?') ? '&' : '?';
      link.href = `${themeCssUrl}${separator}t=${lastUpdated}`;
    }
  }, [themeCssUrl, lastUpdated]);

  const slideStyles = useMemo(() => ({
    '--slide-width': `${slideSize.width}px`,
    '--slide-height': `${slideSize.height}px`,
    '--slide-aspect-ratio': `${slideSize.width}/${slideSize.height}`,
  } as React.CSSProperties), [slideSize]);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const updateTimer = () => {
      if (isTimerRunning && timerStartRef.current) {
        setElapsedTime(accumulatedTimeRef.current + (Date.now() - timerStartRef.current));
        animationFrameRef.current = requestAnimationFrame(updateTimer);
      }
    };
    if (isTimerRunning) {
      if (!timerStartRef.current) timerStartRef.current = Date.now();
      animationFrameRef.current = requestAnimationFrame(updateTimer);
    } else {
      cancelAnimationFrame(animationFrameRef.current);
      timerStartRef.current = null;
    }
    return () => cancelAnimationFrame(animationFrameRef.current);
  }, [isTimerRunning]);

  // Book the current slide's open segment into the recorder (idempotent).
  const flushSegment = useCallback(() => {
    const { elapsedTime: el, currentIndex: idx } = latestRef.current;
    if (!recRunRef.current) return;
    recMsRef.current[idx] = (recMsRef.current[idx] || 0) + Math.max(0, el - recSegmentStartRef.current);
    recSegmentStartRef.current = el;
  }, []);

  // Snapshot the run so far: only slides that were visited, each with the budget
  // that applied at the time, so the comparison survives later @time edits.
  const buildRun = useCallback((): RehearsalRun | null => {
    const run = recRunRef.current;
    if (!run) return null;
    const { elapsedTime: el, slides: sl, readingCpm: cpm, deckSeconds: total } = latestRef.current;
    let lastSlide = 0;
    const recs = sl.map((s, i) => {
      const actual = (recMsRef.current[i] || 0) / 1000;
      const visits = recVisitsRef.current[i] || 0;
      if (visits > 0 || actual > 0) lastSlide = i + 1;
      return {
        slide: i + 1, heading: firstHeading(s?.raw || '') || undefined,
        plannedSec: s?.isHidden ? 0 : Math.round(slideSeconds(s, cpm)),
        actualSec: Math.round(actual * 10) / 10, visits,
      };
    }).filter((r) => r.visits > 0 || r.actualSec > 0);
    let lastVisible = sl.length;
    while (lastVisible > 0 && sl[lastVisible - 1]?.isHidden) lastVisible--;
    return {
      id: run.id, source: 'presenter', startedAt: run.startedAt, endedAt: new Date().toISOString(),
      totalSec: Math.round(el / 100) / 10, plannedTotalSec: Math.round(total),
      slideCount: sl.length, lastSlide, complete: lastVisible > 0 && lastSlide >= lastVisible,
      readingCpm: cpm, slides: recs,
    };
  }, []);

  const sendRun = useCallback(() => {
    flushSegment();
    const run = buildRun();
    if (run && run.slides.length && channelId) send({ type: 'REHEARSAL_RUN', run, channelId });
    return !!run;
  }, [flushSegment, buildRun, channelId, send]);

  const toggleTimer = () => {
    if (isTimerRunning) {
      accumulatedTimeRef.current = elapsedTime;
      // Pause = a checkpoint: the run so far is saved (updated on later pauses).
      if (recRunRef.current) { sendRun(); setRecStatus('paused'); }
    } else {
      if (!recRunRef.current) {
        // A fresh run starts with the stopwatch: from now on every slide change
        // books time to the slide being left.
        recRunRef.current = { id: newRunId(), startedAt: new Date().toISOString() };
        recMsRef.current = [];
        recVisitsRef.current = [];
        recVisitsRef.current[currentIndex] = 1;
      }
      recSegmentStartRef.current = elapsedTime;
      setRecStatus('recording');
    }
    setIsTimerRunning(!isTimerRunning);
  };

  const resetTimer = () => {
    // Reset ends the run: save its final state, then start a clean slate.
    if (recRunRef.current) {
      const saved = elapsedTime > 0 && sendRun();
      recRunRef.current = null;
      recMsRef.current = [];
      recVisitsRef.current = [];
      setRecStatus(saved ? 'saved' : 'idle');
    }
    setIsTimerRunning(false);
    timerStartRef.current = null;
    accumulatedTimeRef.current = 0;
    setElapsedTime(0);
  };

  // Closing the presenter mid-run must not lose the measurement: the message is
  // posted synchronously over the BroadcastChannel before the window unloads.
  useEffect(() => {
    const onUnload = () => { if (recRunRef.current && latestRef.current.elapsedTime > 0) sendRun(); };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [sendRun]);

  const formatTime = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const sendNav = useCallback((direction: number) => {
    if (channelId) {
      send({ type: 'NAV', direction, channelId });
    }
  }, [channelId, send]);

  const sendToggleOverview = useCallback(() => {
    if (channelId) send({ type: 'TOGGLE_OVERVIEW', channelId });
  }, [channelId, send]);

  const sendSelectSlide = useCallback((idx: number) => {
    if (channelId) send({ type: 'SELECT_SLIDE', index: idx, channelId });
  }, [channelId, send]);

  const sendLinkNav = useCallback((target: string) => {
    if (channelId) send({ type: 'LINK_NAV', target, channelId });
  }, [channelId, send]);

  const sendHistoryNav = useCallback((dir: 1 | -1) => {
    if (channelId) send({ type: 'HISTORY_NAV', dir, channelId });
  }, [channelId, send]);

  const handleAddStroke = useCallback((stroke: Stroke) => {
    if (!channelId) return;
    addStroke(currentIndex, stroke, true);
    send({ type: 'DRAW_STROKE', stroke, pageIndex: currentIndex, channelId });
  }, [channelId, currentIndex, addStroke, send]);

  const handleUpdateStrokes = useCallback((pageIndex: number, indices: number[], dx: number, dy: number) => {
    if (updateStrokes) updateStrokes(pageIndex, indices, dx, dy);
    if (channelId) send({ type: 'UPDATE_STROKES', pageIndex, indices, dx, dy, channelId });
  }, [updateStrokes, channelId, send]);

  const handleClear = useCallback(() => {
    if (!channelId) return;
    clear(currentIndex);
    send({ type: 'CLEAR_DRAWING', pageIndex: currentIndex, channelId });
  }, [channelId, currentIndex, clear, send]);

  const handleAddSlide = useCallback(() => {
    if (channelId) send({ type: 'ADD_BLANK_SLIDE', pageIndex: currentIndex, channelId });
  }, [channelId, currentIndex, send]);

  const handleUndo = useCallback(() => { if (channelId) send({ type: 'UNDO', pageIndex: currentIndex, channelId }); }, [channelId, currentIndex, send]);
  const handleRedo = useCallback(() => { if (channelId) send({ type: 'REDO', pageIndex: currentIndex, channelId }); }, [channelId, currentIndex, send]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      const action = matchAction(e, ACTIONS_BY_SCOPE.presenter, appSettings);
      switch (action?.id) {
        case 'presenter.penToggle': setMode(prev => prev === 'pen' ? 'view' : 'pen'); break;
        case 'presenter.undo': e.preventDefault(); handleUndo(); break;
        case 'presenter.redo': e.preventDefault(); handleRedo(); break;
        case 'presenter.clear': handleClear(); break;
        case 'presenter.addSlide': handleAddSlide(); break;
        case 'presenter.next': e.preventDefault(); sendNav(1); break;
        case 'presenter.prev': e.preventDefault(); sendNav(-1); break;
        case 'presenter.historyBack': e.preventDefault(); sendHistoryNav(-1); break;
        case 'presenter.historyForward': e.preventDefault(); sendHistoryNav(1); break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sendNav, handleUndo, handleRedo, handleClear, handleAddSlide, sendHistoryNav, appSettings]);

  useEffect(() => {
    const handleTouch = (e: TouchEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.closest('button') ||
        target.closest('input') ||
        target.closest('textarea') ||
        target.closest('.drawing-palette') ||
        target.closest('.slide-controls-container') ||
        target.closest('.MuiPopover-root')
      ) {
        return;
      }
      if (mode === 'laser') e.preventDefault();
      if (mode === 'pen' && !stylusOnly) e.preventDefault();
    };

    document.body.addEventListener('touchmove', handleTouch, { passive: false });
    document.body.addEventListener('touchstart', handleTouch, { passive: false });
    return () => {
      document.body.removeEventListener('touchmove', handleTouch);
      document.body.removeEventListener('touchstart', handleTouch);
    };
  }, [mode, stylusOnly]);

  if (!channelId) return <div style={{padding:20, color:'white'}}>Invalid Channel ID</div>;
  if (slides.length === 0) return <div style={{padding:20, color:'white'}}>Waiting for connection...</div>;

  // ---- Speaking-time bookkeeping for the footer + the shrinking bars ----------
  const elapsedSec = elapsedTime / 1000;
  const onSlideSec = Math.max(0, (elapsedTime - slideBaselineMsRef.current) / 1000);
  const slideRemain = currentBudgetSec - onSlideSec;
  const totalRemain = deckSeconds - elapsedSec;
  // Pace: elapsed vs. where the schedule says we should be — every earlier
  // slide's budget, plus the part of THIS slide's budget already consumed
  // (capped, so lingering past the budget counts as falling behind, and
  // simply being on this slide does not).
  const plannedElapsedSec = budgetBeforeSec + Math.min(onSlideSec, currentBudgetSec);
  const paceSec = elapsedSec - plannedElapsedSec;
  const behind = paceSec > 0;
  const onTime = Math.abs(paceSec) < 5;
  const col = (rem: number, budget: number) => rem < 0 ? '#f04747' : (budget > 0 && rem < budget * 0.2) ? '#f0a020' : '#4caf50';
  const paceCol = elapsedTime === 0 ? '#666' : onTime ? '#8a8a8a' : behind ? '#f0a020' : '#4caf50';
  const frac = (v: number, of: number) => (of > 0 ? Math.max(0, Math.min(1, v / of)) : 0);
  // "Last time" marks from the deck's most recent saved run (this slide, whole
  // deck). The record is matched by position when the headings agree, else by a
  // unique heading — so a slide inserted since the run gets no stale mark.
  const lastSlideRec = (() => {
    const recs = lastRehearsal?.slides || [];
    const h = firstHeading(currentSlide?.raw || '');
    const at = recs.find((r) => r.slide === currentIndex + 1);
    if (at && (!h || !at.heading || at.heading === h)) return at;
    if (h) { const same = recs.filter((r) => r.heading === h); if (same.length === 1) return same[0]; }
    return undefined;
  })();
  const lastSlideSec = lastSlideRec ? lastSlideRec.actualSec : null;
  const lastTotalSec = lastRehearsal ? lastRehearsal.totalSec : null;

  return (
    <div className="presenter-container" style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden', touchAction: 'none' }}>
      <div className="presenter-header" style={{ flexShrink: 0 }}>
        <div style={{ fontWeight: 'bold', fontSize: '1.2rem' }}>Presenter View</div>
        <Button
          size="small"
          startIcon={<GridViewIcon fontSize="small" />}
          onClick={sendToggleOverview}
          sx={{ color: isOverview ? '#fff' : '#aaa', bgcolor: isOverview ? 'rgba(59,130,246,0.4)' : 'transparent', textTransform: 'none', '&:hover': { color: '#fff' } }}
        >
          Overview
        </Button>
        <div style={{fontSize:'1.5rem'}}>{currentTime.toLocaleTimeString()}</div>
      </div>

      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {isOverview ? (
          <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
            <SlideOverviewGrid slides={slides} currentSlideIndex={currentIndex} slideSize={slideSize} drawings={drawings} onSelectSlide={sendSelectSlide} />
          </div>
        ) : (
        <>
        <SlideControls
          mode={mode} setMode={setMode}
          pageIndex={currentIndex} totalSlides={slides.length}
          visible={true}
          onNav={sendNav}
          onAddSlide={handleAddSlide}
          onClearDrawing={handleClear}
          toolType={toolType} setToolType={setToolType}
          penColor={penColor} setPenColor={setPenColor}
          penWidth={penWidth} setPenWidth={setPenWidth}
          canUndo={true} canRedo={true}
          onUndo={handleUndo} onRedo={handleRedo}
          containerStyle={{ position: 'absolute', bottom: 30, zIndex: 100 }}
          stylusOnly={stylusOnly}
          setStylusOnly={setStylusOnly}
          onHistoryBack={() => sendHistoryNav(-1)} onHistoryForward={() => sendHistoryNav(1)} canHistoryBack canHistoryForward
        />

        <Group orientation="horizontal" style={{ height: '100%' }}>

          <Panel defaultSize={65} minSize={20}>
            <div className="presenter-main-view" style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: '#000', position: 'relative' }}>
              <span className="presenter-label" style={{position:'absolute', top:10, left:20, zIndex:10}}>
                CURRENT: {currentIndex + 1} / {slides.length}
              </span>
              <SlideScaler width={slideSize.width} height={slideSize.height}>
                {currentSlide && (
                  <SlideView
                      html={currentSlide.html}
                      pageNumber={currentSlide.pageNumber}
                      isActive={true}
                      className={currentSlide.className}
                      style={slideStyles}
                      isEnabledPointerEvents={mode === 'view'}
                      slideSize={slideSize}
                      header={currentSlide.header}
                      footer={currentSlide.footer}
                      drawings={drawings[currentIndex]}
                      buildStep={step}
                      slideIndex={currentIndex}
                      moduleRole="mirror"
                      presenting={true}
                      onSlideLink={sendLinkNav}
                      onAddStroke={handleAddStroke}
                      onUpdateStrokes={(indices, dx, dy) => handleUpdateStrokes(currentIndex, indices, dx, dy)}
                      isInteracting={mode === 'pen'}
                      toolType={toolType}
                      color={penColor}
                      lineWidth={penWidth}
                      penOnly={stylusOnly}
                  />
                )}
              </SlideScaler>
            </div>
          </Panel>

          <Separator className="resize-handle" style={{ width: '6px', background: '#333', cursor: 'col-resize' }} />

          <Panel defaultSize={35} minSize={20}>
             <Group orientation="vertical" style={{ height: '100%' }}>
                <Panel defaultSize={40} minSize={10}>
                  <div className="presenter-next-preview" style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: '#2a2a2a', padding: '15px', boxSizing: 'border-box' }}>
                    <span className="presenter-label">NEXT SLIDE</span>
                    <div style={{ flex: 1, position: 'relative', background: '#000', borderRadius:'4px', overflow:'hidden' }}>
                      <SlideScaler width={slideSize.width} height={slideSize.height}>
                        {nextSlide ? (
                          <SlideView
                              html={nextSlide.html}
                              pageNumber={nextSlide.pageNumber}
                              isActive={true}
                              className={nextSlide.className}
                              style={slideStyles}
                              isEnabledPointerEvents={false}
                              slideSize={slideSize}
                              header={nextSlide.header}
                              footer={nextSlide.footer}
                              drawings={drawings[nextIndex]}
                              slideIndex={nextIndex}
                              moduleRole="mirror"
                          />
                        ) : (
                          <div style={{color:'#666', display:'flex', alignItems:'center', justifyContent:'center', height:'100%'}}>End of Slides</div>
                        )}
                      </SlideScaler>
                    </div>
                  </div>
                </Panel>

                <Separator className="resize-handle" style={{ height: '6px', background: '#333', cursor: 'row-resize' }} />

                <Panel defaultSize={60} minSize={10}>
                  <div className="presenter-notes" style={{ width: '100%', height: '100%', padding: '15px', boxSizing: 'border-box', overflowY: 'auto', backgroundColor: '#1e1e1e', color: '#ddd', display: 'flex', flexDirection: 'column' }}>
                    {/* Read-aloud @script manuscript, shown prominently above notes.
                        Script markers ([[step]], [[emit…]]) render as inline CHIPS:
                        clicking one fires the same event the narrated auto-play
                        would fire at that point (step-advance / mdpBus emit). */}
                    <div style={{ flexShrink: 0, marginBottom: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="presenter-label" style={{ color: '#8ab4f8' }}>SCRIPT — read aloud</span>
                        <Button
                          size="small"
                          startIcon={isEditingScript ? <SaveIcon /> : <EditIcon />}
                          onClick={handleToggleEditScript}
                          sx={{ color: '#7f93ad', textTransform: 'none', '&:hover': { color: '#8ab4f8' } }}
                        >
                          {isEditingScript ? 'Save' : 'Edit'}
                        </Button>
                      </div>
                      {isEditingScript ? (
                        /* Edit the RAW `@script` blocks, one textarea per source block
                           (a slide often interleaves several with its content), so the
                           write-back keeps each block where the author put it. */
                        <div style={{ maxHeight: '45vh', overflowY: 'auto', marginTop: 6 }}>
                          {scriptDrafts.map((draft, i) => (
                            <div key={i} style={{ marginBottom: 8 }}>
                              {scriptDrafts.length > 1 && (
                                <div style={{ fontSize: '0.62rem', color: '#777', letterSpacing: 1, marginBottom: 2 }}>
                                  BLOCK {i + 1} / {scriptDrafts.length}
                                </div>
                              )}
                              <TextField
                                multiline
                                fullWidth
                                minRows={3}
                                value={draft}
                                onChange={(e) => setScriptDrafts((prev) => prev.map((d, j) => (j === i ? e.target.value : d)))}
                                variant="outlined"
                                placeholder="Read-aloud manuscript… ([[step]] / [[emit: …]] markers are kept)"
                                sx={{
                                  '& .MuiInputBase-root': { color: '#ddd', padding: '8px', fontFamily: 'monospace', fontSize: '0.9rem', background: '#232a36' },
                                  '& fieldset': { borderColor: '#3b5170' },
                                  '& .MuiInputBase-root:hover fieldset': { borderColor: '#5b7fae' },
                                  '& .MuiInputBase-root.Mui-focused fieldset': { borderColor: '#3b82f6' },
                                }}
                              />
                            </div>
                          ))}
                        </div>
                      ) : currentSlide?.scriptHtml ? (
                        <div
                          className="markdown-body presenter-script"
                          style={{ marginTop: 6, padding: '10px 12px', background: '#232a36', borderLeft: '3px solid #3b82f6', borderRadius: 4, fontSize: '1.05rem', lineHeight: 1.7 }}
                          onClick={(e) => {
                            const chip = (e.target as HTMLElement).closest?.('.mdp-script-chip[data-chip]') as HTMLElement | null;
                            if (!chip) return;
                            e.preventDefault(); e.stopPropagation();
                            const kind = chip.dataset.chip;
                            if (kind === 'step') { sendNav(1); }
                            else if (kind === 'emit') {
                              const topic = chip.dataset.topic || '';
                              const args = (chip.dataset.args || '').split(' ').filter(Boolean);
                              if (topic) mdpBus.emit(topic, { args });
                            }
                            chip.classList.add('mdp-chip-used');
                          }}
                          dangerouslySetInnerHTML={{ __html: currentSlide.scriptHtml }}
                        />
                      ) : (
                        <div style={{ marginTop: 6, fontSize: '0.85rem', color: '#666', fontStyle: 'italic' }}>
                          No script for this slide.
                        </div>
                      )}
                      <style>{`
                          .presenter-script .mdp-script-chip { display:inline-flex; align-items:center; gap:4px; margin:0 3px; padding:1px 8px; border-radius:999px; font-size:0.85em; line-height:1.5; vertical-align:baseline; border:1px solid #3b82f6; background:rgba(59,130,246,0.15); color:#8ab4f8; cursor:pointer; user-select:none; }
                          .presenter-script .mdp-script-chip:hover { background:rgba(59,130,246,0.35); }
                          .presenter-script .mdp-script-chip.mdp-chip-passive { border-color:#555; background:rgba(255,255,255,0.06); color:#999; cursor:default; }
                          .presenter-script .mdp-script-chip.mdp-chip-used { opacity:0.45; }
                        .presenter-script .mdp-script-chip.mdp-chip-used::after { content:' ✓'; }
                      `}</style>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', borderBottom: '1px solid #444', paddingBottom: '8px', flexShrink: 0 }}>
                      <span className="presenter-label">NOTES</span>
                      <Button
                        size="small"
                        startIcon={isEditingNote ? <SaveIcon /> : <EditIcon />}
                        onClick={handleToggleEditNote}
                        sx={{ color: '#aaa', textTransform: 'none', '&:hover': { color: '#fff' } }}
                      >
                        {isEditingNote ? 'Save' : 'Edit'}
                      </Button>
                    </div>

                    {isEditingNote ? (
                      <TextField
                        multiline
                        fullWidth
                        value={noteDraft}
                        onChange={(e) => setNoteDraft(e.target.value)}
                        variant="outlined"
                        placeholder="Type your notes here... (Markdown is supported)"
                        sx={{
                          flex: 1,
                          overflowY: 'auto',
                          '& .MuiInputBase-root': { height: '100%', color: '#ddd', alignItems: 'flex-start', padding: '8px', fontFamily: 'monospace' },
                          '& fieldset': { borderColor: '#555' },
                          '& .MuiInputBase-root:hover fieldset': { borderColor: '#888' },
                          '& .MuiInputBase-root.Mui-focused fieldset': { borderColor: '#3b82f6' }
                        }}
                      />
                    ) : currentSlide?.noteHtml ? (
                      <div className="markdown-body" style={{ flex: 1, overflowY: 'auto' }} dangerouslySetInnerHTML={{ __html: currentSlide.noteHtml }} />
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: '#666', fontStyle: 'italic', border: '1px dashed #444', borderRadius: '4px' }}>
                        No notes for this slide.
                      </div>
                    )}
                  </div>
                </Panel>
             </Group>
          </Panel>
        </Group>
        </>
        )}
      </div>

      {/* Shrinking time bars: the budget of THIS SLIDE and of the WHOLE TALK,
          drawn as the fraction still left (each bar empties as time passes; over
          budget it turns red). The TOTAL bar carries a white tick at the point
          the plan says you should be at right now — bar ending right of the tick
          = ahead of schedule, left of it = behind. A blue tick marks how much
          was left at this point in the last saved rehearsal. */}
      <div className="presenter-timebars" style={{ flexShrink: 0, padding: '5px 20px 3px', background: '#2b2b2b', borderTop: '1px solid #444', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {([
          { label: 'SLIDE', remain: slideRemain, budget: currentBudgetSec, plan: undefined,
            last: lastSlideSec != null && currentBudgetSec > 0 ? frac(currentBudgetSec - lastSlideSec, currentBudgetSec) : undefined },
          { label: 'TOTAL', remain: totalRemain, budget: deckSeconds, plan: frac(deckSeconds - plannedElapsedSec, deckSeconds),
            last: lastTotalSec != null && deckSeconds > 0 ? frac(deckSeconds - lastTotalSec, deckSeconds) : undefined },
        ] as { label: string; remain: number; budget: number; plan?: number; last?: number }[]).map((b) => {
          const over = b.remain < 0;
          const width = frac(b.remain, b.budget) * 100;
          const color = col(b.remain, b.budget);
          return (
            <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: '0.62rem', color: '#888', letterSpacing: 1, width: 44, textAlign: 'right', flexShrink: 0 }}>{b.label}</span>
              <div style={{ position: 'relative', flex: 1, height: 7, borderRadius: 4, background: over ? 'rgba(240,71,71,0.35)' : 'rgba(255,255,255,0.10)', overflow: 'visible' }}>
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${width}%`, borderRadius: 4, background: color, transition: 'width 0.25s linear' }} />
                {b.plan != null && b.budget > 0 && elapsedTime > 0 && (
                  <div title="Where the plan says you should be" style={{ position: 'absolute', left: `${b.plan * 100}%`, top: -3, width: 2, height: 13, background: '#fff', transform: 'translateX(-1px)' }} />
                )}
                {b.last != null && (
                  <div title="Time left at this point in the last rehearsal" style={{ position: 'absolute', left: `${b.last * 100}%`, top: -2, width: 2, height: 11, background: '#5ea0ff', transform: 'translateX(-1px)' }} />
                )}
              </div>
              <span style={{ fontSize: '0.68rem', fontFamily: 'monospace', color, width: 58, flexShrink: 0, textAlign: 'right' }}>{formatClock(b.remain)}</span>
            </div>
          );
        })}
      </div>

      <div className="presenter-footer" style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="presenter-timer-controls" style={{display:'flex', alignItems:'center'}}>
          <span style={{fontSize:'2rem', fontWeight:'bold', color: isTimerRunning ? '#4caf50' : '#eee', width:'160px', fontFamily:'monospace'}}>
            {formatTime(elapsedTime)}
          </span>
          <button onClick={toggleTimer} title={isTimerRunning ? "Pause (saves the rehearsal so far)" : "Start (records a rehearsal run)"}>
            {isTimerRunning ? <PauseIcon /> : <PlayArrowIcon />}
          </button>
          <button onClick={resetTimer} title="Reset (ends and saves the run)">
            <RefreshIcon />
          </button>
          {/* Recorder state: every timed run is saved next to the deck as a
              rehearsal (per-slide seconds vs. budget) for later adjustment. */}
          <span style={{ marginLeft: 10, fontSize: '0.66rem', letterSpacing: 1, whiteSpace: 'nowrap',
            color: recStatus === 'recording' ? '#f04747' : recStatus === 'idle' ? '#555' : '#8a8a8a' }}>
            {recStatus === 'recording' ? '● REC' : recStatus === 'paused' ? '‖ PAUSED · saved' : recStatus === 'saved' ? '✓ RUN SAVED' : 'REHEARSAL: press ▶'}
          </span>
        </div>

        {/* Speaking-time countdowns: this slide's remaining budget + the whole
            deck's remaining. Green → amber (<20% left) → red (over). A third,
            smaller column says how far AHEAD/BEHIND schedule the talk is. */}
        {(() => {
          const Cell = ({ label, value, valueColor, valueSize, sub, width }: { label: string; value: string; valueColor: string; valueSize: string; sub: string; width: number }) => (
            <div style={{ textAlign: 'center', minWidth: width }}>
              <div style={{ fontSize: '0.68rem', color: '#888', letterSpacing: 1 }}>{label}</div>
              {/* Fixed row height so the smaller PACE value keeps its sub-line
                  aligned with the two clocks next to it. */}
              <div style={{ fontSize: valueSize, fontFamily: 'monospace', fontWeight: 'bold', color: valueColor, lineHeight: 1.1, whiteSpace: 'nowrap', height: '1.95rem', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                {value}
              </div>
              <div style={{ fontSize: '0.62rem', color: '#666', whiteSpace: 'nowrap' }}>{sub}</div>
            </div>
          );
          return (
            <div style={{ display: 'flex', gap: 24, alignItems: 'center', paddingRight: 12 }}>
              <Cell label="THIS SLIDE" value={formatClock(slideRemain)} valueColor={col(slideRemain, currentBudgetSec)} valueSize="1.7rem" width={110}
                sub={`${currentHasExplicit ? '' : '≈ '}budget ${formatClock(currentBudgetSec)}${lastSlideSec != null ? ` · last ${formatClock(Math.round(lastSlideSec))}` : ''}`} />
              <Cell label="TOTAL LEFT" value={formatClock(totalRemain)} valueColor={col(totalRemain, deckSeconds)} valueSize="1.7rem" width={110}
                sub={`of ${formatClock(deckSeconds)}${lastTotalSec != null ? ` · last ${formatClock(Math.round(lastTotalSec))}` : ''}`} />
              {/* Pace sits BESIDE the deck clock (its own column), a size down, so
                  the footer keeps its three-line height. */}
              <Cell label="PACE" valueColor={paceCol} valueSize="1.2rem" width={96}
                value={elapsedTime === 0 ? '—' : onTime ? '±0:00' : `${behind ? '▲' : '▼'} ${formatClock(Math.abs(paceSec))}`}
                sub={elapsedTime === 0 ? 'not started' : onTime ? 'on schedule' : behind ? 'behind' : 'ahead'} />
            </div>
          );
        })()}
      </div>
    </div>
  );
};