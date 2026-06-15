import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { SlideView } from '../../features/slide/components/SlideView';
import { SlideScaler } from '../../features/slide/components/SlideScaler';
import { SlideOverviewGrid } from '../../features/slide/components/SlideOverviewGrid';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import RefreshIcon from '@mui/icons-material/Refresh';
import { Panel, Group, Separator } from 'react-resizable-panels';

import { useSync, type SyncMessage } from '../../features/remote/hooks/useSync';
import { moduleSyncBus } from '../../features/modules/moduleSyncBus';
import { registerParsedModule, clearAllModules } from '../../features/modules/moduleManager';
import { registerParsedEffect, clearAllEffects } from '../../features/effects/effectManager';
import type { ModuleData } from '../../utils/moduleParser';
import type { EffectData } from '../../utils/effectParser';
import { useDrawing } from '../../features/drawing/hooks/useDrawing';
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

export default function PresenterPage() {
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
  const [prevIndex, setPrevIndex] = useState(currentIndex);

  const timerStartRef = useRef<number | null>(null);
  const accumulatedTimeRef = useRef<number>(0);
  const animationFrameRef = useRef<number>(0);

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
    return () => moduleSyncBus.setSender(null);
  }, [send]);

  if (currentIndex !== prevIndex) {
    setPrevIndex(currentIndex);
    setIsEditingNote(false);
    setNoteDraft(extractNoteText(currentSlide));
  }

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

  const toggleTimer = () => {
    if (isTimerRunning) {
      accumulatedTimeRef.current = elapsedTime;
    }
    setIsTimerRunning(!isTimerRunning);
  };

  const resetTimer = () => {
    setIsTimerRunning(false);
    timerStartRef.current = null;
    accumulatedTimeRef.current = 0;
    setElapsedTime(0);
  };

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

      if (e.key === 'p') setMode(prev => prev === 'pen' ? 'view' : 'pen');
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); handleUndo(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'y') { e.preventDefault(); handleRedo(); }
      if (e.key === 'c') handleClear();
      if (e.key === 'n') handleAddSlide();

      if (['ArrowRight', 'ArrowDown', ' ', 'Enter', 'PageDown'].includes(e.key)) {
        e.preventDefault();
        sendNav(1);
      } else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) {
        e.preventDefault();
        sendNav(-1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sendNav, handleUndo, handleRedo, handleClear, handleAddSlide]);

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

      <div className="presenter-footer" style={{ flexShrink: 0 }}>
        <div className="presenter-timer-controls" style={{display:'flex', alignItems:'center'}}>
          <span style={{fontSize:'2rem', fontWeight:'bold', color: isTimerRunning ? '#4caf50' : '#eee', width:'160px', fontFamily:'monospace'}}>
            {formatTime(elapsedTime)}
          </span>
          <button onClick={toggleTimer} title={isTimerRunning ? "Pause" : "Start"}>
            {isTimerRunning ? <PauseIcon /> : <PlayArrowIcon />}
          </button>
          <button onClick={resetTimer} title="Reset">
            <RefreshIcon />
          </button>
        </div>
      </div>
    </div>
  );
};