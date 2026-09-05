import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { SlideView } from '../../features/slide/components/SlideView';
import { SlideScaler } from '../../features/slide/components/SlideScaler';
import { SlideEffectLayer } from '../../features/slide/components/SlideEffectLayer';
import { SlideOverviewGrid } from '../../features/slide/components/SlideOverviewGrid';

import { useSync, type SyncMessage } from '../../features/remote/hooks/useSync';
import { moduleSyncBus } from '../../features/modules/moduleSyncBus';
import { mdpBus } from '../../features/bus/mdpBus';
import { registerParsedModule, clearAllModules } from '../../features/modules/moduleManager';
import { registerParsedEffect, clearAllEffects } from '../../features/effects/effectManager';
import { useDrawing } from '../../features/drawing/hooks/useDrawing';
import { useAppSettings } from '../../features/settings/AppSettingsContext';
import { matchAction } from '../../features/settings/shortcuts/matcher';
import { ACTIONS_BY_SCOPE } from '../../features/settings/shortcuts/registry';
import { isElectron } from '../../api/apiClient';
import type { ModuleData } from '../../utils/moduleParser';
import type { EffectData } from '../../utils/effectParser';
import type { Stroke } from '../../features/drawing/components/DrawingOverlay';
import type { MotionSpec } from '../../features/slide/parser/SlideContext';

import '../../App.css';

// The OUTPUT WINDOW: a chrome-less, aspect-locked mirror of the presentation, meant
// to be the thing an audience sees — a screen-share region, a capture source for
// OBS, or a window dragged onto a second display. It carries NOTHING but the slide:
// no labels, no controls, no notes. The presenter tool (`#/presenter`) stays on the
// operator's side of the screen, outside the shared region.
//
// It is a MIRROR: the main window owns the deck and the interactive-module logic,
// and this window renders what arrives over the sync channel — including slide
// transitions and in-slide builds (SlideEffectLayer), pen strokes and the overview.

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
  basePath?: string;
  globalContext?: { transition?: MotionSpec };
}

export default function OutputPage() {
  const { settings: appSettings } = useAppSettings();
  const [channelId] = useState<string | null>(() => {
    const query = window.location.hash.split('?')[1] || window.location.search;
    return new URLSearchParams(query).get('channel');
  });
  const [token] = useState<string | null>(() => {
    const query = window.location.hash.split('?')[1] || window.location.search;
    return new URLSearchParams(query).get('token');
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [slides, setSlides] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [step, setStep] = useState(0);
  const [slideSize, setSlideSize] = useState({ width: 1280, height: 720 });
  const [themeCssUrl, setThemeCssUrl] = useState<string | undefined>(undefined);
  const [lastUpdated, setLastUpdated] = useState<number>(0);
  const [isOverview, setIsOverview] = useState(false);
  const [basePath, setBasePath] = useState<string | undefined>(undefined);
  const [globalTransition, setGlobalTransition] = useState<MotionSpec | undefined>(undefined);

  // Signatures of the registered module / effect sets, so a SYNC_STATE broadcast
  // doesn't tear down and re-register everything on every keystroke upstream.
  const moduleSigRef = useRef<string>('');
  const effectSigRef = useRef<string>('');

  const { drawings, addStroke, updateStrokes, syncDrawings, clear } = useDrawing();

  const { send } = useSync(channelId, token, (msg: SyncMessage) => {
    switch (msg.type) {
      case 'SYNC_STATE': {
        const data = msg.payload as SyncData;
        if (data.modules) {
          const sig = data.modules.map((m) => `${m.config?.name}:${(m.style || '').length}:${(m.script || '').length}`).join('|');
          if (sig !== moduleSigRef.current) {
            moduleSigRef.current = sig;
            clearAllModules();
            data.modules.forEach(registerParsedModule);
          }
        }
        if (data.effects) {
          const sig = data.effects.map((e) => `${e.config?.name}:${(e.style || '').length}:${(e.script || '').length}`).join('|');
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
        setBasePath(data.basePath);
        setGlobalTransition(data.globalContext?.transition);
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
      case 'UPDATE_STROKES':
        if (msg.indices && msg.dx !== undefined && msg.dy !== undefined) {
          updateStrokes(msg.pageIndex, msg.indices, msg.dx, msg.dy);
        }
        break;
      case 'CLEAR_DRAWING':
        clear(msg.pageIndex);
        break;
    }
  });

  // Name the window so it is identifiable in a screen-share / capture picker.
  useEffect(() => { document.title = 'MDP — Output'; }, []);

  // The theme stylesheet the deck is rendered with (re-fetched when it changes).
  useEffect(() => {
    const linkId = 'mdp-output-theme';
    let link = document.getElementById(linkId) as HTMLLinkElement;
    if (!themeCssUrl) return;
    if (!link) {
      link = document.createElement('link');
      link.id = linkId;
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    }
    const sep = themeCssUrl.includes('?') ? '&' : '?';
    link.href = `${themeCssUrl}${sep}t=${lastUpdated}`;
  }, [themeCssUrl, lastUpdated]);

  // Keep the WINDOW's aspect ratio locked to the deck's, so a drag-resize can never
  // letterbox the output: Electron constrains the drag itself; on the web (no such
  // API) the height is corrected once the user stops dragging.
  const ratio = slideSize.width / slideSize.height;
  const resizeTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!Number.isFinite(ratio) || ratio <= 0) return;
    const el = window as unknown as { electronAPI?: { setWindowAspectRatio?: (r: number) => void } };
    if (isElectron() && el.electronAPI?.setWindowAspectRatio) {
      el.electronAPI.setWindowAspectRatio(ratio);
      return;
    }
    const fix = () => {
      // Only the height moves: the width is what the user is aiming at.
      const want = Math.round(window.innerWidth / ratio);
      const delta = want - window.innerHeight;
      if (Math.abs(delta) > 2) window.resizeBy(0, delta);
    };
    const onResize = () => {
      if (resizeTimer.current) window.clearTimeout(resizeTimer.current);
      resizeTimer.current = window.setTimeout(fix, 220);
    };
    fix();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (resizeTimer.current) window.clearTimeout(resizeTimer.current);
    };
  }, [ratio]);

  // This window is a mirror: a module's actions go back to the host (owner), which
  // runs the logic and broadcasts the resulting state to every surface.
  useEffect(() => {
    moduleSyncBus.setSender((m) => send(m as SyncMessage, 'all'));
    mdpBus.setSender((m) => send(m as SyncMessage, 'all'));
    return () => { moduleSyncBus.setSender(null); mdpBus.setSender(null); };
  }, [send]);

  const slideStyles = useMemo(() => ({
    '--slide-width': `${slideSize.width}px`,
    '--slide-height': `${slideSize.height}px`,
    '--slide-aspect-ratio': `${slideSize.width}/${slideSize.height}`,
  } as React.CSSProperties), [slideSize]);

  const selectSlide = useCallback((idx: number) => {
    if (channelId) send({ type: 'SELECT_SLIDE', index: idx, channelId });
  }, [channelId, send]);

  // The output window DRIVES the show as well as displaying it: keys, clicks and
  // the wheel move the host (which then broadcasts the new state back here), so the
  // deck can be run from this window alone — no need to reach for the main window.
  const sendNav = useCallback((direction: number) => {
    if (channelId) send({ type: 'NAV', direction, channelId });
  }, [channelId, send]);
  const sendLinkNav = useCallback((target: string) => {
    if (channelId) send({ type: 'LINK_NAV', target, channelId });
  }, [channelId, send]);

  // A click inside an interactive module is the module's, never a page turn — the
  // same `.mdp-interactive` convention the fullscreen slideshow uses.
  const inInteractive = (e: Event) => !!(e.target as HTMLElement | null)?.closest?.('.mdp-interactive');

  // Mirrored into a ref so the window-level listeners (registered once) always see
  // the current mode without being torn down and re-added on every state change.
  const overviewRef = useRef(isOverview);
  useEffect(() => { overviewRef.current = isOverview; }, [isOverview]);
  const wheelAtRef = useRef(0);
  const focusedAtRef = useRef(0);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      // A module may put a real text field on the slide — typing in it is not
      // "next slide".
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const action = matchAction(e, ACTIONS_BY_SCOPE.slideshow, appSettings);
      if (action?.id === 'slideshow.next' && !inInteractive(e)) { e.preventDefault(); sendNav(1); }
      else if (action?.id === 'slideshow.prev' && !inInteractive(e)) { e.preventDefault(); sendNav(-1); }
    };
    // Click / wheel advance only while a slide is shown: in the overview a click
    // means "jump to THIS slide" (handled by the grid).
    const onMouseDown = (e: MouseEvent) => {
      if (overviewRef.current || e.button !== 0 || inInteractive(e)) return;
      // The click that brings this window to the front is a focus click, not a
      // page turn — otherwise every trip back from the presenter tool skips a slide.
      if (Date.now() - focusedAtRef.current < 400) return;
      sendNav(1);
    };
    const onWheel = (e: WheelEvent) => {
      if (overviewRef.current || inInteractive(e)) return;
      const now = Date.now();
      if (now - wheelAtRef.current < 120) return;
      if (e.deltaY > 0) { wheelAtRef.current = now; sendNav(1); }
      else if (e.deltaY < 0) { wheelAtRef.current = now; sendNav(-1); }
    };
    const onFocus = () => { focusedAtRef.current = Date.now(); };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('focus', onFocus);
    };
  }, [appSettings, sendNav]);

  // Hide the pointer while it rests (this is what an audience sees) and bring it
  // back the moment it moves, so the slide stays clickable.
  const [pointerIdle, setPointerIdle] = useState(true);
  useEffect(() => {
    let timer = 0;
    const onMove = () => {
      setPointerIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setPointerIdle(true), 2000);
    };
    window.addEventListener('mousemove', onMove);
    return () => { window.removeEventListener('mousemove', onMove); window.clearTimeout(timer); };
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderSlide = useCallback((slide: any, idx: number, opts: { buildStep: number }) => (
    <SlideScaler width={slideSize.width} height={slideSize.height} marginRate={1}>
      {slide && !slide.isHidden && (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
          <SlideView
            html={slide.html}
            raw={slide.raw}
            basePath={basePath}
            pageNumber={slide.pageNumber}
            className={slide.className}
            isActive={true}
            style={slideStyles}
            slideSize={slideSize}
            isEnabledPointerEvents={true}
            header={slide.header}
            footer={slide.footer}
            drawings={drawings[idx] || []}
            buildStep={opts.buildStep}
            slideIndex={idx}
            moduleRole="mirror"
            presenting={true}
            onSlideLink={sendLinkNav}
          />
        </div>
      )}
    </SlideScaler>
  ), [slideSize, basePath, slideStyles, drawings, sendLinkNav]);

  if (!channelId) return <div style={{ padding: 20, color: '#888', background: '#000', height: '100vh' }}>Invalid channel</div>;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#000', overflow: 'hidden',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      cursor: (pointerIdle && !isOverview) ? 'none' : 'default',
    }}>
      {slides.length === 0 ? (
        <div style={{ color: '#444', font: '13px system-ui, sans-serif', cursor: 'default' }}>Waiting for the presentation…</div>
      ) : isOverview ? (
        <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
          <SlideOverviewGrid slides={slides} currentSlideIndex={currentIndex} slideSize={slideSize} drawings={drawings} onSelectSlide={selectSlide} />
        </div>
      ) : (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <SlideEffectLayer
            slides={slides}
            index={currentIndex}
            step={step}
            globalTransition={globalTransition}
            renderSlide={renderSlide}
          />
        </div>
      )}
    </div>
  );
}
