import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { SlideView } from './SlideView';
import { SlideScaler } from './SlideScaler';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import RefreshIcon from '@mui/icons-material/Refresh';
import { Panel, Group, Separator } from 'react-resizable-panels';

import { useSync, type SyncMessage } from '../hooks/useSync';
import { useDrawing } from '../hooks/useDrawing';
import { SlideControls, type AppMode } from './SlideControls';
import type { Stroke } from './DrawingOverlay';

import '../App.css';

interface SyncData {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  slides: any[];
  index: number;
  slideSize: { width: number; height: number };
  themeCssUrl?: string;
  lastUpdated: number;
  allDrawings?: Record<number, Stroke[]>; 
}

export const PresenterTool: React.FC = () => {
  const [channelId] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('channel');
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [slides, setSlides] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [slideSize, setSlideSize] = useState({ width: 1280, height: 720 });
  const [themeCssUrl, setThemeCssUrl] = useState<string | undefined>(undefined);
  const [lastUpdated, setLastUpdated] = useState<number>(0);
  
  const [currentTime, setCurrentTime] = useState(new Date());
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  
  const [mode, setMode] = useState<AppMode>('view');
  const { drawings, addStroke, syncDrawings, clear } = useDrawing();
  const [toolType, setToolType] = useState<'pen' | 'eraser'>('pen');
  const [penColor, setPenColor] = useState('#FF0000');
  const [penWidth, setPenWidth] = useState(3);
  const [stylusOnly, setStylusOnly] = useState(false);
  
  const timerStartRef = useRef<number | null>(null);
  const accumulatedTimeRef = useRef<number>(0);
  const animationFrameRef = useRef<number>(0);
  
  const { send } = useSync(channelId, (msg: SyncMessage) => {
    switch (msg.type) {
      case 'SYNC_STATE': {
        const data = msg.payload as SyncData;
        if (data.slides) setSlides(data.slides);
        if (typeof data.index === 'number') setCurrentIndex(data.index);
        if (data.slideSize) setSlideSize(data.slideSize);
        if (data.allDrawings) syncDrawings(data.allDrawings);
        
        setThemeCssUrl(data.themeCssUrl);
        setLastUpdated(data.lastUpdated);
        break;
      }
      case 'DRAW_STROKE':
        addStroke(msg.pageIndex, msg.stroke, false);
        break;
      case 'CLEAR_DRAWING':
        clear(msg.pageIndex);
        break;
    }
  });

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

  const handleAddStroke = useCallback((stroke: Stroke) => {
    if (!channelId) return;
    addStroke(currentIndex, stroke, true);
    send({ type: 'DRAW_STROKE', stroke, pageIndex: currentIndex, channelId });
  }, [channelId, currentIndex, addStroke, send]);

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

  const currentSlide = slides[currentIndex];
  let nextIndex = currentIndex + 1;
  while (nextIndex < slides.length && slides[nextIndex]?.isHidden) {
    nextIndex++;
  }
  const nextSlide = slides[nextIndex];

  if (!channelId) return <div style={{padding:20, color:'white'}}>Invalid Channel ID</div>;
  if (slides.length === 0) return <div style={{padding:20, color:'white'}}>Waiting for connection...</div>;

  return (
    <div className="presenter-container" style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden', touchAction: 'none' }}>
      <div className="presenter-header" style={{ flexShrink: 0 }}>
        <div style={{fontWeight:'bold', fontSize:'1.2rem'}}>Presenter View</div>
        <div style={{fontSize:'1.5rem'}}>{currentTime.toLocaleTimeString()}</div>
      </div>
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        
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
          containerStyle={{ bottom: 30 }}
          stylusOnly={stylusOnly}
          setStylusOnly={setStylusOnly}
        />

        <Group orientation="horizontal">
          
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
                      onAddStroke={handleAddStroke}
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

          <Separator className="resize-handle" />

          <Panel defaultSize={35} minSize={20}>
             <Group orientation="vertical">
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
                              drawings={drawings[currentIndex + 1]}
                          />
                        ) : (
                          <div style={{color:'#666', display:'flex', alignItems:'center', justifyContent:'center', height:'100%'}}>End of Slides</div>
                        )}
                      </SlideScaler>
                    </div>
                  </div>
                </Panel>

                <Separator className="resize-handle" />

                <Panel defaultSize={60} minSize={10}>
                  <div className="presenter-notes" style={{ width: '100%', height: '100%', padding: '15px', boxSizing: 'border-box', overflowY: 'auto', backgroundColor: '#1e1e1e', color: '#ddd' }}>
                    <span className="presenter-label" style={{ display: 'block', marginBottom: '8px' }}>NOTES</span>
                    {currentSlide?.noteHtml ? (
                      <div className="markdown-body" dangerouslySetInnerHTML={{ __html: currentSlide.noteHtml }} />
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '80%', color: '#666', fontStyle: 'italic', border: '1px dashed #444', borderRadius: '4px' }}>
                        No notes for this slide.
                      </div>
                    )}
                  </div>
                </Panel>
             </Group>
          </Panel>
        </Group>
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