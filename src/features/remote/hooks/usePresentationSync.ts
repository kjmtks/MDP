import { useEffect, useState, useRef, useCallback } from 'react';
import { useSync, type SyncMessage } from './useSync';
import type { Stroke } from '../../drawing/components/DrawingOverlay';
import { moduleSyncBus } from '../../modules/moduleSyncBus';
import { loadedModules } from '../../modules/moduleManager';
import { loadedEffects } from '../../effects/effectManager';

type Rasterize = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  slide: any,
  opts: { width: number; height: number; basePath?: string; themeCssUrl?: string },
) => Promise<string>;

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

  const sendRef = useRef<((msg: SyncMessage, target?: 'all' | 'local' | 'remote') => void) | null>(null);
  const cacheRef = useRef<Map<string, string>>(new Map());
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());

  // Live presenter state (BroadcastChannel, same machine). The presenter renders
  // live HTML, so `step` (for builds) and `modules` (CSS + scripts) are included.
  // The remote uses the separate image flow below, so this stays 'local'.
  const sendLocalState = useCallback(() => {
    sendRef.current?.({
      type: 'SYNC_STATE',
      payload: { slides, index: currentSlideIndex, step: step ?? 0, slideSize, globalContext, baseUrl, themeCssUrl, lastUpdated, allDrawings: drawings, isOverview: isSlideOverview, modules: Object.values(loadedModules), effects: Object.values(loadedEffects) },
      channelId,
    }, 'local');
  }, [slides, currentSlideIndex, step, slideSize, globalContext, baseUrl, themeCssUrl, lastUpdated, drawings, channelId, isSlideOverview]);

  const nextVisibleIndex = useCallback((from: number) => {
    let n = from + 1;
    while (n < slides.length && slides[n]?.isHidden) n++;
    return n < slides.length ? n : -1;
  }, [slides]);

  const rasterizeSlide = useCallback((i: number): Promise<string | null> => {
    if (!rasterize) return Promise.resolve(null);
    const slide = slides[i];
    if (!slide) return Promise.resolve(null);
    const key = `${i}:${hashStr(slide.html || '')}:${themeCssUrl || ''}:${slideSize.width}x${slideSize.height}`;
    const cached = cacheRef.current.get(key);
    if (cached) return Promise.resolve(cached);
    const run = () => rasterize(slide, { width: slideSize.width, height: slideSize.height, basePath, themeCssUrl })
      .then((dataUrl) => { cacheRef.current.set(key, dataUrl); return dataUrl; });
    const p = queueRef.current.then(run, run) as Promise<string>;
    queueRef.current = p.catch(() => undefined);
    return p;
  }, [rasterize, slides, themeCssUrl, slideSize.width, slideSize.height, basePath]);

  const sendRemoteImages = useCallback(async () => {
    if (!rasterize || !remoteActive) return;
    const ni = nextVisibleIndex(currentSlideIndex);
    const curImage = await rasterizeSlide(currentSlideIndex);
    const nextImage = ni !== -1 ? await rasterizeSlide(ni) : null;
    sendRef.current?.({
      type: 'SYNC_STATE_IMAGE',
      payload: { index: currentSlideIndex, nextIndex: ni, slideCount: slides.length, slideSize, curImage, nextImage, allDrawings: drawings, isOverview: isSlideOverview },
      channelId,
    }, 'remote');
  }, [rasterize, remoteActive, nextVisibleIndex, currentSlideIndex, rasterizeSlide, slides.length, slideSize, drawings, channelId, isSlideOverview]);

  const collectAllImages = useCallback(async (): Promise<(string | null)[]> => {
    const out: (string | null)[] = [];
    for (let i = 0; i < slides.length; i++) out.push(await rasterizeSlide(i));
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
        if (remoteActive) sendRemoteImages();
        break;
      case 'MODULE_STATE':
        moduleSyncBus.receiveState(msg.syncId, msg.state);
        break;
      case 'MODULE_ACTION':
        moduleSyncBus.receiveAction(msg.syncId, msg.actionType, msg.payload);
        break;
      case 'NAV':
        moveSlide(msg.direction);
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
      case 'TOGGLE_OVERVIEW':
        toggleSlideOverview?.();
        break;
      case 'SELECT_SLIDE':
        onSelectSlide?.(msg.index);
        break;
    }
  }, electronWsPort);

  useEffect(() => {
    sendRef.current = send;
    // This window is the host (owner of interactive-module logic). Module state
    // is broadcast to the live presenter over BroadcastChannel ('local'); the
    // remote uses rasterized images and ignores module sync.
    moduleSyncBus.setSender((m) => send(m as SyncMessage, 'local'));
    return () => moduleSyncBus.setSender(null);
  }, [send]);

  // Push the live presenter state.
  useEffect(() => {
    sendLocalState();
  }, [sendLocalState]);

  // Remote image cache invalidation on theme/size change.
  useEffect(() => {
    cacheRef.current.clear();
  }, [themeCssUrl, slideSize.width, slideSize.height]);

  // Pre-render all slides (with progress) once remote becomes active or content changes.
  const prevActive = useRef(false);
  useEffect(() => {
    if (remoteActive && !prevActive.current) {
      prevActive.current = true;
      prerenderAll();
    } else if (!remoteActive) {
      prevActive.current = false;
    }
  }, [remoteActive, prerenderAll]);

  // Push current/next image on navigation, edits, drawing, or overview changes.
  useEffect(() => {
    if (remoteActive) sendRemoteImages();
  }, [remoteActive, currentSlideIndex, slides, drawings, isSlideOverview, sendRemoteImages]);

  // While the overview is active, send the full image grid to remote viewers.
  useEffect(() => {
    if (!remoteActive || !isSlideOverview || !rasterize) return;
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
  }, [remoteActive, isSlideOverview, slides, themeCssUrl, slideSize.width, slideSize.height]);

  return { channelId, token, send, imagePrep };
};
