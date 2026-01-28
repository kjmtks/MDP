import React, { useState, useEffect, useRef } from 'react';
import { SlideView } from './SlideView';
import { SlideScaler } from './SlideScaler';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import RefreshIcon from '@mui/icons-material/Refresh';
import { Panel, Group, Separator } from 'react-resizable-panels';

interface SyncData {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  slides: any[];
  index: number;
  slideSize: { width: number; height: number };
  themeCssUrl?: string;
  lastUpdated: number;
}

export const PresenterTool: React.FC = () => {
  const params = new URLSearchParams(window.location.search);
  const channelId = params.get('channel');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [slides, setSlides] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [slideSize, setSlideSize] = useState({ width: 1280, height: 720 });
  const [themeCssUrl, setThemeCssUrl] = useState<string | undefined>(undefined);
  const [lastUpdated, setLastUpdated] = useState<number>(0);
  
  const [currentTime, setCurrentTime] = useState(new Date());
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  
  const timerStartRef = useRef<number | null>(null);
  const accumulatedTimeRef = useRef<number>(0);
  const animationFrameRef = useRef<number>(0);
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    if (!channelId) return;
    const ch = new BroadcastChannel(channelId);
    channelRef.current = ch;
    ch.onmessage = (event) => {
      const { type, payload } = event.data;
      if (type === 'SYNC_STATE') {
        const data = payload as SyncData;
        setSlides(data.slides);
        setCurrentIndex(data.index);
        if (data.slideSize) setSlideSize(data.slideSize);
        setThemeCssUrl(data.themeCssUrl);
        setLastUpdated(data.lastUpdated);
      }
    };
    ch.postMessage({ type: 'PRESENTER_READY' });
    return () => {
      ch.close();
    };
  }, [channelId]);

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
      const href = `${themeCssUrl}${separator}t=${lastUpdated}`;

      if (link.getAttribute('href') !== href) {
        link.href = href;
      }
    } else {
      if (link) document.head.removeChild(link);
    }
  }, [themeCssUrl, lastUpdated]);

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

  const sendNav = (direction: number) => {
    channelRef.current?.postMessage({ type: 'NAV', direction });
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
  }, []);

  const currentSlide = slides[currentIndex];
  let nextIndex = currentIndex + 1;
  while (nextIndex < slides.length && slides[nextIndex]?.isHidden) {
    nextIndex++;
  }
  const nextSlide = slides[nextIndex];
  if (!channelId) return <div style={{padding:20, color:'white'}}>Invalid Channel ID</div>;
  if (slides.length === 0) return <div style={{padding:20, color:'white'}}>Waiting for connection...</div>;

  return (
    <div className="presenter-container" style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden' }}>
      <div className="presenter-header" style={{ flexShrink: 0 }}>
        <div style={{fontWeight:'bold', fontSize:'1.2rem'}}>Presenter View</div>
        <div style={{fontSize:'1.5rem'}}>{currentTime.toLocaleTimeString()}</div>
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <Group orientation="horizontal">
          
          <Panel>
            <Group orientation="vertical">
              <Panel defaultSize={400} minSize={200}>
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
                          isEnabledPointerEvents={false}
                          slideSize={slideSize}
                      />
                    )}
                  </SlideScaler>
                </div>
              </Panel>

              <Separator className="resize-handle-row" />

              <Panel defaultSize={100} minSize={100}>
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
                            isEnabledPointerEvents={false}
                            slideSize={slideSize}
                        />
                      ) : (
                        <div style={{color:'#666', display:'flex', alignItems:'center', justifyContent:'center', height:'100%'}}>End of Slides</div>
                      )}
                    </SlideScaler>
                  </div>
                </div>
              </Panel>
            </Group>
          </Panel>
          
          <Separator className="resize-handle" />

          <Panel minSize={10}>
            <div className="presenter-notes" style={{ width: '100%', height: '100%', padding: '15px', boxSizing: 'border-box', overflowY: 'auto', backgroundColor: '#1e1e1e', color: '#ddd' }}>
              <span className="presenter-label" style={{ display: 'block', marginBottom: '8px' }}>NOTES</span>
              {currentSlide?.noteHtml ? (
                <div className="markdown-body" dangerouslySetInnerHTML={{ __html: currentSlide.noteHtml }} />
              ) : (
                <div style={{
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  height: '80%', 
                  color: '#666', 
                  fontStyle: 'italic',
                  border: '1px dashed #444',
                  borderRadius: '4px'
                }}>
                  No notes for this slide.
                </div>
              )}
            </div>
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
        <div style={{display:'flex', gap:'10px'}}>
           <button className="presenter-nav-button" onClick={() => sendNav(-1)}>◀ Prev</button>
           <button className="presenter-nav-button" onClick={() => sendNav(1)}>Next ▶</button>
        </div>
      </div>
    </div>
  );
};