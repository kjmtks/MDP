import { useEffect, useState, useRef, useCallback, useSyncExternalStore } from 'react';
import { getFontState, subscribeFontState } from '../../fonts/fontRuntime';
import { useSync, type SyncMessage } from './useSync';
import type { Stroke } from '../../drawing/components/DrawingOverlay';
import { moduleSyncBus } from '../../modules/moduleSyncBus';
import { mdpBus } from '../../bus/mdpBus';
import { loadedModules } from '../../modules/moduleManager';
import { loadedEffects } from '../../effects/effectManager';
import type { RasterizeResult } from '../capture/captureTypes';
import type { RehearsalRun } from '../../rehearsal/rehearsalStore';
import { forDevice, grantRemoteFiles, remoteAssetPaths, remoteSlide, type RemoteDeck, type RemoteView } from '../liveRemote';
import type { LayoutReport } from '../layoutCheck';

type Rasterize = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  slide: any,
  opts: { width: number; height: number; basePath?: string; themeCssUrl?: string },
) => Promise<RasterizeResult>;

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

export const usePresentationSync = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  slides: any[], currentSlideIndex: number, slideSize: any, globalContext: any, baseUrl: string, themeCssUrl: string | undefined, lastUpdated: number, drawings: Record<number, Stroke[]>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  moveSlide: any, addStroke: any, clear: any, undo: any, redo: any, handleAddBlankSlide: any, updateStrokes: any,
  handleUpdateNote?: (pageIndex: number, note: string) => void,
  electronWsPort?: number | null,
  rasterize?: Rasterize,
  remoteActive?: boolean,
  basePath?: string,
  isSlideOverview?: boolean,
  toggleSlideOverview?: () => void,
  onSelectSlide?: (index: number) => void,
  step?: number,
  // Hyperlink nav from mirrors (presenter/remote): host resolves relative to its
  // current deck, navigates, and re-syncs.
  onSlideLink?: (target: string) => void,
  historyBack?: () => void,
  historyForward?: () => void,
  handleUpdateScript?: (pageIndex: number, scripts: string[]) => void,
  // Rehearsal runs measured on the presenter come back here to be persisted; the
  // latest saved run travels to the presenter so it can show "last time" marks.
  onRehearsalRun?: (run: RehearsalRun) => void,
  lastRehearsal?: RehearsalRun | null,
  // REC from the presenter view: the host records (it owns the deck path).
  onRecordCommand?: (action: 'start' | 'stop', micId?: string) => void,
  // What remote devices show: pictures of the slides, or the live deck (HTML).
  remoteView: RemoteView = 'image',
  // A live remote measured where its lines break (layoutCheck.ts): compare here.
  onLayoutReport?: (report: LayoutReport) => void,
  // How far → has gone through the slide's script (usePresentation): the presenter
  // view rings what the next → shows.
  cuePos = 0,
  // A chip clicked in the presenter's script: → goes on right after it.
  onCueAt?: (slide: number, chip: number) => void,
) => {
  const [channelId] = useState<string>(() => {
    const query = window.location.hash.split('?')[1] || window.location.search;
    const params = new URLSearchParams(query);
    return params.get('channel') || Math.random().toString(36).substring(2, 9);
  });
  const [token] = useState<string>(() => {
    const query = window.location.hash.split('?')[1] || window.location.search;
    const params = new URLSearchParams(query);
    return params.get('token')
      || `${Math.random().toString(36).substring(2)}${Math.random().toString(36).substring(2)}`;
  });

  const [imagePrep, setImagePrep] = useState<{ done: number; total: number } | null>(null);
  // Workspace-font CSS: the presenter / output windows are separate documents and
  // render live HTML, so it travels with the state (like the theme URL).
  const fontCss = useSyncExternalStore(subscribeFontState, () => getFontState().css);

  const sendRef = useRef<((msg: SyncMessage, target?: 'all' | 'local' | 'remote') => void) | null>(null);
  const cacheRef = useRef<Map<string, RasterizeResult>>(new Map());
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  // Remote devices: the live deck, or pictures of the slides (imageRemote).
  const live = !!remoteActive && remoteView === 'live';
  const imageRemote = !!remoteActive && !live;

  // Live presenter state (BroadcastChannel, same machine). The presenter renders
  // live HTML, so `step` (for builds) and `modules` (CSS + scripts) are included.
  // The remote uses the separate image flow below, so this stays 'local'.
  const sendLocalState = useCallback(() => {
    sendRef.current?.({
      type: 'SYNC_STATE',
      // `basePath` travels too: a mirror needs it to resolve a slide's drawio/SVG
      // and image paths (SlideView builds those from `raw` + basePath).
      payload: { slides, index: currentSlideIndex, step: step ?? 0, cuePos, slideSize, globalContext, baseUrl, basePath, themeCssUrl, fontCss, lastUpdated, allDrawings: drawings, isOverview: isSlideOverview, modules: Object.values(loadedModules), effects: Object.values(loadedEffects), lastRehearsal: lastRehearsal ?? null },
      channelId,
    }, 'local');
  }, [slides, currentSlideIndex, step, cuePos, slideSize, globalContext, baseUrl, basePath, themeCssUrl, fontCss, lastUpdated, drawings, channelId, isSlideOverview, lastRehearsal]);

  const nextVisibleIndex = useCallback((from: number) => {
    let n = from + 1;
    while (n < slides.length && slides[n]?.isHidden) n++;
    return n < slides.length ? n : -1;
  }, [slides]);

  const rasterizeSlide = useCallback((i: number): Promise<RasterizeResult | null> => {
    if (!rasterize) return Promise.resolve(null);
    const slide = slides[i];
    if (!slide) return Promise.resolve(null);
    const key = `${i}:${hashStr(slide.html || '')}:${themeCssUrl || ''}:${hashStr(fontCss)}:${slideSize.width}x${slideSize.height}`;
    const cached = cacheRef.current.get(key);
    if (cached) return Promise.resolve(cached);
    const run = () => rasterize(slide, { width: slideSize.width, height: slideSize.height, basePath, themeCssUrl })
      .then((res) => { cacheRef.current.set(key, res); return res; });
    const p = queueRef.current.then(run, run) as Promise<RasterizeResult>;
    queueRef.current = p.catch(() => undefined);
    return p;
  }, [rasterize, slides, themeCssUrl, fontCss, slideSize.width, slideSize.height, basePath]);

  // Whether pictures are wanted NOW — the pictures take a while to draw, and the
  // remote may have been switched to the live deck meanwhile (a late picture would
  // pull the devices out of it).
  const imageRemoteRef = useRef(imageRemote);
  useEffect(() => { imageRemoteRef.current = imageRemote; }, [imageRemote]);

  const sendRemoteImages = useCallback(async () => {
    if (!rasterize || !imageRemote) return;
    const ni = nextVisibleIndex(currentSlideIndex);
    const cur = await rasterizeSlide(currentSlideIndex);
    const next = ni !== -1 ? await rasterizeSlide(ni) : null;
    if (!imageRemoteRef.current) return;
    sendRef.current?.({
      type: 'SYNC_STATE_IMAGE',
      payload: { index: currentSlideIndex, nextIndex: ni, slideCount: slides.length, slideSize, curImage: cur?.dataUrl ?? null, nextImage: next?.dataUrl ?? null, links: cur?.links ?? [], allDrawings: drawings, isOverview: isSlideOverview },
      channelId,
    }, 'remote');
  }, [rasterize, imageRemote, nextVisibleIndex, currentSlideIndex, rasterizeSlide, slides.length, slideSize, drawings, channelId, isSlideOverview]);

  // The live remote: the deck as the device renders it (what is shown, nothing
  // more — liveRemote.ts), sent when it changes; a page turn sends the position.
  // Its URLs are the device's (the desktop app's mdp-file:// / app-asset:// are not),
  // and the files it needs are granted to this presentation's devices first — the
  // server hands a device those and nothing else.
  const deckRevRef = useRef(0);
  const sendRemoteDeck = useCallback(async () => {
    const deck: Omit<RemoteDeck, 'rev'> = {
      slides: slides.map((sl) => {
        const r = remoteSlide(sl);
        return { ...r, html: forDevice(r.html), ...(r.header ? { header: forDevice(r.header) } : {}), ...(r.footer ? { footer: forDevice(r.footer) } : {}) };
      }),
      slideSize, transition: globalContext?.transition, basePath,
      themeCssUrl: themeCssUrl ? forDevice(themeCssUrl) : themeCssUrl,
      fontCss: forDevice(fontCss),
      modules: Object.values(loadedModules).map((m) => (m.style ? { ...m, style: forDevice(m.style) } : m)),
      effects: Object.values(loadedEffects),
    };
    try { await grantRemoteFiles(channelId, token, await remoteAssetPaths(deck)); } catch { /* sent anyway */ }
    deckRevRef.current += 1;
    sendRef.current?.({ type: 'REMOTE_DECK', payload: { rev: deckRevRef.current, ...deck }, channelId }, 'remote');
  }, [slides, slideSize, globalContext, basePath, themeCssUrl, fontCss, channelId, token]);
  const sendRemotePos = useCallback(() => {
    sendRef.current?.({
      type: 'REMOTE_POS',
      payload: { rev: deckRevRef.current, index: currentSlideIndex, step: step ?? 0, isOverview: !!isSlideOverview, allDrawings: drawings },
      channelId,
    }, 'remote');
  }, [currentSlideIndex, step, isSlideOverview, drawings, channelId]);
  const sendPosRef = useRef(sendRemotePos);
  useEffect(() => { sendPosRef.current = sendRemotePos; }, [sendRemotePos]);

  const collectAllImages = useCallback(async (): Promise<(string | null)[]> => {
    const out: (string | null)[] = [];
    // rasterizeSlide returns {dataUrl, links} — the grid payload carries only
    // the image, so unwrap it here (an object here reaches the remote as
    // `<img src="[object Object]">`).
    for (let i = 0; i < slides.length; i++) out.push((await rasterizeSlide(i))?.dataUrl ?? null);
    return out;
  }, [slides.length, rasterizeSlide]);

  const prerenderAll = useCallback(async () => {
    if (!rasterize) return;
    setImagePrep({ done: 0, total: slides.length });
    for (let i = 0; i < slides.length; i++) {
      await rasterizeSlide(i);
      setImagePrep({ done: i + 1, total: slides.length });
    }
    setImagePrep(null);
    await sendRemoteImages();
  }, [rasterize, slides.length, rasterizeSlide, sendRemoteImages]);

  const { send } = useSync(channelId, token, (msg: SyncMessage) => {
    switch (msg.type) {
      case 'REQUEST_SYNC':
        sendLocalState();
        moduleSyncBus.rebroadcastAll();
        if (live) void sendRemoteDeck().then(() => sendPosRef.current()); else if (imageRemote) sendRemoteImages();
        break;
      case 'MODULE_STATE':
        moduleSyncBus.receiveState(msg.syncId, msg.state);
        break;
      case 'MODULE_ACTION':
        moduleSyncBus.receiveAction(msg.syncId, msg.actionType, msg.payload);
        break;
      case 'BUS_EVENT':
        mdpBus.receiveRemote(msg.topic, msg.payload);
        break;
      case 'NAV':
        // From the presenter view / a remote: a presentation, builds included —
        // even when this window keeps the editor (the show is in the output window);
        // `whole`: straight to the next / previous slide (↑ / ↓).
        moveSlide(msg.direction, true, !!msg.whole);
        break;
      case 'CUE_AT':
        if (typeof msg.slide === 'number' && typeof msg.chip === 'number') onCueAt?.(msg.slide, msg.chip);
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
      case 'UNDO':
        undo(msg.pageIndex);
        break;
      case 'REDO':
        redo(msg.pageIndex);
        break;
      case 'ADD_BLANK_SLIDE':
        handleAddBlankSlide(msg.pageIndex);
        break;
      case 'UPDATE_NOTE':
        if (handleUpdateNote && msg.note !== undefined) {
          handleUpdateNote(msg.pageIndex, msg.note);
        }
        break;
      case 'UPDATE_SCRIPT':
        if (handleUpdateScript && Array.isArray(msg.scripts)) {
          handleUpdateScript(msg.pageIndex, msg.scripts);
        }
        break;
      case 'REHEARSAL_RUN':
        if (onRehearsalRun && msg.run && Array.isArray(msg.run.slides)) onRehearsalRun(msg.run);
        break;
      case 'TOGGLE_OVERVIEW':
        toggleSlideOverview?.();
        break;
      case 'SELECT_SLIDE':
        onSelectSlide?.(msg.index);
        break;
      case 'LINK_NAV':
        onSlideLink?.(msg.target);
        break;
      case 'HISTORY_NAV':
        if (msg.dir === 1) historyForward?.(); else historyBack?.();
        break;
      case 'REC_COMMAND':
        if (msg.action === 'start' || msg.action === 'stop') onRecordCommand?.(msg.action, msg.micId);
        break;
      case 'LAYOUT_REPORT':
        if (live && msg.payload && Array.isArray(msg.payload.pages)) onLayoutReport?.(msg.payload);
        break;
    }
  }, electronWsPort);

  useEffect(() => {
    sendRef.current = send;
    // This window is the host (owner of interactive-module logic). Module state
    // goes to the live presenter / output over BroadcastChannel ('local') — and to
    // the remote devices too while they show the live deck (their modules are
    // mirrors of these); picture remotes have no modules to tell.
    moduleSyncBus.setSender((m) => send(m as SyncMessage, live ? 'all' : 'local'));
    // App-wide bus events reach every surface (incl. remote controllers).
    mdpBus.setSender((m) => send(m as SyncMessage, 'all'));
    return () => { moduleSyncBus.setSender(null); mdpBus.setSender(null); };
  }, [send, live]);

  // The live remote: the deck once its content settles (an edit, a theme or font
  // change, the remote just switched on), then where the show is; every page turn,
  // build step or stroke sends the position alone.
  useEffect(() => {
    if (!live) return undefined;
    const t = window.setTimeout(() => {
      void sendRemoteDeck().then(() => {
        sendPosRef.current();
        moduleSyncBus.rebroadcastAll();
      });
    }, 400);
    return () => window.clearTimeout(t);
  }, [live, sendRemoteDeck, lastUpdated]);
  useEffect(() => {
    if (live) sendRemotePos();
  }, [live, sendRemotePos]);

  // Push the live presenter state.
  useEffect(() => {
    sendLocalState();
  }, [sendLocalState]);

  // Remote image cache invalidation on theme/font/size change.
  useEffect(() => {
    cacheRef.current.clear();
  }, [themeCssUrl, fontCss, slideSize.width, slideSize.height]);

  // Pre-render all slides (with progress) once picture remotes are on.
  const prevActive = useRef(false);
  useEffect(() => {
    if (imageRemote && !prevActive.current) {
      prevActive.current = true;
      prerenderAll();
    } else if (!imageRemote) {
      prevActive.current = false;
    }
  }, [imageRemote, prerenderAll]);

  // Push current/next image on navigation, edits, drawing, or overview changes.
  useEffect(() => {
    if (imageRemote) sendRemoteImages();
  }, [imageRemote, currentSlideIndex, slides, drawings, isSlideOverview, sendRemoteImages]);

  // While the overview is active, send the full image grid to remote viewers.
  useEffect(() => {
    if (!imageRemote || !isSlideOverview || !rasterize) return;
    let cancelled = false;
    (async () => {
      const images = await collectAllImages();
      if (cancelled) return;
      sendRef.current?.({
        type: 'OVERVIEW_GRID',
        payload: { images, slideSize, index: currentSlideIndex },
        channelId,
      }, 'remote');
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageRemote, isSlideOverview, slides, themeCssUrl, fontCss, slideSize.width, slideSize.height]);

  return { channelId, token, send, imagePrep };
};
