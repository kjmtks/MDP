import React, { useState, useEffect, useRef } from 'react';
import { useSync, type SyncMessage } from '../hooks/useSync';
import { SlideView } from './SlideView';
import { SlideScaler } from './SlideScaler';
import { type Stroke } from './DrawingOverlay';
import { useDrawing } from '../hooks/useDrawing'; 
import { SlideControls, type AppMode } from './SlideControls';

import { Button, TextField, Paper, Typography, Box, Dialog, IconButton } from '@mui/material';
import LinkIcon from '@mui/icons-material/Link';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import CloseIcon from '@mui/icons-material/Close';

import jsQR from 'jsqr';

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

export const RemoteControl: React.FC = () => {
  const [channelId, setChannelId] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('channel');
  });
  const [inputToken, setInputToken] = useState('');

  const [isScanning, setIsScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>(0);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [slides, setSlides] = useState<any[]>([]);
  const [index, setIndex] = useState(0);
  const [slideSize, setSlideSize] = useState({ width: 1280, height: 720 });
  
  const { drawings, addStroke, syncDrawings, clear } = useDrawing();
  
  const [mode, setMode] = useState<AppMode>('view');
  const [stylusOnly, setStylusOnly] = useState(false);
  
  const [toolType, setToolType] = useState<'pen' | 'eraser'>('pen');
  const [penColor, setPenColor] = useState('#FF0000');
  const [penWidth, setPenWidth] = useState(3);
  
  const [themeCssUrl, setThemeCssUrl] = useState<string | undefined>();
  const [lastUpdated, setLastUpdated] = useState(0);
  
  const { send } = useSync(channelId, (msg: SyncMessage) => {
    switch (msg.type) {
      case 'SYNC_STATE': {
        const p = msg.payload as SyncData;
        if (p.slides) setSlides(p.slides);
        if (typeof p.index === 'number') setIndex(p.index);
        if (p.slideSize) setSlideSize(p.slideSize);
        if (p.allDrawings) syncDrawings(p.allDrawings);
        if (p.themeCssUrl) setThemeCssUrl(p.themeCssUrl);
        if (p.lastUpdated) setLastUpdated(p.lastUpdated);
        break;
      }
      case 'NAV': break;
      case 'DRAW_STROKE':
        addStroke(msg.pageIndex, msg.stroke, false);
        break;
      case 'CLEAR_DRAWING':
        clear(msg.pageIndex);
        break;
    }
  });

  useEffect(() => {
    const linkId = 'mdp-remote-theme';
    let link = document.getElementById(linkId) as HTMLLinkElement;
    if (themeCssUrl) {
      if (!link) {
        link = document.createElement('link');
        link.id = linkId;
        link.rel = 'stylesheet';
        document.head.appendChild(link);
      }
      link.href = `${themeCssUrl}?t=${lastUpdated}`;
    }
  }, [themeCssUrl, lastUpdated]);

  useEffect(() => {
    const preventDefault = (e: TouchEvent) => {
      if (mode === 'pen' && stylusOnly) {
         e.preventDefault();
         return;
      }
      if (mode === 'pen' || mode === 'laser') {
        const target = e.target as HTMLElement;
        const isControl = 
          target.tagName === 'BUTTON' || 
          target.tagName === 'INPUT' || 
          target.closest('button') || 
          target.closest('.drawing-palette') ||  
          target.closest('.MuiPopover-root') ||
          target.closest('.slide-controls-container');    
        if (!isControl) e.preventDefault();
      }
    };
    document.body.addEventListener('touchmove', preventDefault, { passive: false });
    document.body.addEventListener('touchstart', preventDefault, { passive: false });
    document.body.addEventListener('touchend', preventDefault, { passive: false });
    return () => {
      document.body.removeEventListener('touchmove', preventDefault);
      document.body.removeEventListener('touchstart', preventDefault);
      document.body.removeEventListener('touchend', preventDefault);
    };
  }, [mode, stylusOnly]);

  const startScan = () => {
    setIsScanning(true);
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
      .then(stream => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.setAttribute("playsinline", "true");
          videoRef.current.play();
          requestRef.current = requestAnimationFrame(tick);
        }
      })
      .catch(err => {
        console.error(err);
        setIsScanning(false);
        alert("Camera access denied or not supported.");
      });
  };

  const stopScan = () => {
    setIsScanning(false);
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    if (requestRef.current) cancelAnimationFrame(requestRef.current);
  };

  const tick = () => {
    if (videoRef.current && videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: "dontInvert",
          });

          if (code) {
            try {
              if (code.data.startsWith('http')) {
                const url = new URL(code.data);
                const channel = url.searchParams.get('channel');
                if (channel) {
                  setChannelId(channel);
                  stopScan();
                  return;
                }
              } else if (code.data.startsWith('mdp-')) {
                  setChannelId(code.data);
                  stopScan();
                  return;
              }
            } catch { /* ignore */ }
          }
        }
      }
    }
    requestRef.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    return () => {
        stopScan();
    };
  }, []);

  const handleConnect = () => {
    if (inputToken.trim()) setChannelId(inputToken.trim());
  };

  const handleNav = (dir: number) => {
    if (!channelId) return;
    const newIndex = index + dir;
    if (newIndex >= 0 && newIndex < slides.length) {
      setIndex(newIndex);
      send({ type: 'NAV', direction: dir, channelId });
    }
  };

  const handleAddStroke = (stroke: Stroke) => {
    if (!channelId) return;
    addStroke(index, stroke, true);
    send({ type: 'DRAW_STROKE', stroke, pageIndex: index, channelId });
  };

  const handleClear = () => {
    if (!channelId) return;
    clear(index);
    send({ type: 'CLEAR_DRAWING', pageIndex: index, channelId });
  };
  
  const handleAddSlide = () => {
    if (channelId) send({ type: 'ADD_BLANK_SLIDE', pageIndex: index, channelId });
  };

  const handleUndo = () => { if (channelId) send({ type: 'UNDO', pageIndex: index, channelId }); };
  const handleRedo = () => { if (channelId) send({ type: 'REDO', pageIndex: index, channelId }); };
  
  const touchStartPos = useRef<{ x: number, y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    if (mode !== 'view') return; 
    if (e.touches.length > 1) return;
    touchStartPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartPos.current) return;
    if (mode !== 'view' && !(mode === 'pen' && stylusOnly)) return;
    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;
    const diffX = endX - touchStartPos.current.x;
    const diffY = endY - touchStartPos.current.y;
    if (Math.abs(diffX) > 50 && Math.abs(diffY) < 100) {
      if (diffX > 0) handleNav(-1);
      else handleNav(1);
    }
    touchStartPos.current = null;
  };

  if (!channelId) {
    return (
      <div style={{ width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#222' }}>
        <Paper sx={{ p: 4, width: '90%', maxWidth: 400, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <Typography variant="h5" align="center">Remote Control</Typography>
          <TextField label="Connection Token" value={inputToken} onChange={e => setInputToken(e.target.value)} variant="outlined" fullWidth />
          <Button variant="contained" size="large" onClick={handleConnect} startIcon={<LinkIcon />}>Connect</Button>
          <Button variant="outlined" size="large" onClick={startScan} startIcon={<QrCodeScannerIcon />}>Scan QR Code</Button>
        </Paper>
        
        <Dialog open={isScanning} onClose={stopScan} maxWidth="sm" fullWidth>
            <Box sx={{ position: 'relative', bgcolor: 'black', height: '400px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <video ref={videoRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                <canvas ref={canvasRef} style={{ display: 'none' }} />
                <IconButton onClick={stopScan} sx={{ position: 'absolute', top: 10, right: 10, color: 'white', bgcolor: 'rgba(0,0,0,0.5)' }}><CloseIcon /></IconButton>
                <Typography sx={{ position: 'absolute', bottom: 20, color: 'white', bgcolor: 'rgba(0,0,0,0.5)', px: 2, borderRadius: 1 }}>Scanning...</Typography>
            </Box>
        </Dialog>
      </div>
    );
  }

  if (slides.length === 0) {
    return (
      <div style={{ width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#222', color: 'white' }}>
        <Typography>Connecting to Host...</Typography>
        <Button sx={{ml:2}} onClick={() => setChannelId(null)}>Cancel</Button>
      </div>
    );
  }

  const currentSlide = slides[index];

  return (
    <div style={{ 
      width: '100vw', height: '100vh', background: '#222', 
      display: 'flex', flexDirection: 'column',
      touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none', overscrollBehavior: 'none' 
    }}>
      
      <div style={{ height: 40, background: '#333', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', color: 'white', flexShrink: 0 }}>
        <div style={{ fontWeight: 'bold' }}>Remote</div>
        <Button size="small" onClick={() => setChannelId(null)} sx={{ color: 'white' }}>Disconnect</Button>
      </div>

      <div 
        style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000', touchAction: 'none' }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
         <SlideControls 
            mode={mode} setMode={setMode}
            pageIndex={index} totalSlides={slides.length}
            visible={true}
            onNav={handleNav}
            onAddSlide={handleAddSlide}
            onClearDrawing={handleClear}
            
            toolType={toolType} setToolType={setToolType}
            penColor={penColor} setPenColor={setPenColor}
            penWidth={penWidth} setPenWidth={setPenWidth}
            canUndo={true} canRedo={true}
            onUndo={handleUndo} onRedo={handleRedo}

            stylusOnly={stylusOnly}
            setStylusOnly={setStylusOnly}
            containerStyle={{ bottom: 30 }}
         />

         <SlideScaler width={slideSize.width} height={slideSize.height}>
             <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                <SlideView 
                  html={currentSlide.html}
                  slideSize={slideSize}
                  isActive={true}
                  className={currentSlide.className}
                  header={currentSlide.header}
                  footer={currentSlide.footer}
                  isEnabledPointerEvents={mode === 'view'}
                  
                  drawings={drawings[index] || []}
                  onAddStroke={handleAddStroke}
                  isInteracting={mode === 'pen'}
                  toolType={toolType}
                  color={penColor}
                  lineWidth={penWidth}
                  penOnly={stylusOnly}
                />
             </div>
         </SlideScaler>
      </div>
    </div>
  );
};