import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSync, type SyncMessage, type ImageSyncPayload, type OverviewGridPayload } from '../../features/remote/hooks/useSync';
import type { SlideLinkRect } from '../../features/remote/capture/captureTypes';
import { SlideScaler } from '../../features/slide/components/SlideScaler';
import { DrawingOverlay, type Stroke } from '../../features/drawing/components/DrawingOverlay';
import { useDrawing } from '../../features/drawing/hooks/useDrawing';
import { SlideControls, type AppMode } from '../../features/drawing/components/SlideControls';
import { reportError } from '../../components/error/errorReporter';

import { Button, TextField, Paper, Typography, Box, Dialog, IconButton } from '@mui/material';
import LinkIcon from '@mui/icons-material/Link';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import CloseIcon from '@mui/icons-material/Close';
import GridViewIcon from '@mui/icons-material/GridView';

import jsQR from 'jsqr';

import '../../App.css';

export default function RemotePage() {
  const [channelId, setChannelId] = useState<string | null>(() => {
    const query = window.location.hash.split('?')[1] || window.location.search;
    const params = new URLSearchParams(query);
    return params.get('channel');
  });
  const [token, setToken] = useState<string | null>(() => {
    const query = window.location.hash.split('?')[1] || window.location.search;
    const params = new URLSearchParams(query);
    return params.get('token');
  });
  const [inputToken, setInputToken] = useState('');

  const [isScanning, setIsScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>(0);

  const [curImage, setCurImage] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [slideCount, setSlideCount] = useState(0);
  const [slideSize, setSlideSize] = useState({ width: 1280, height: 720 });
  const [isOverview, setIsOverview] = useState(false);
  const [gridImages, setGridImages] = useState<(string | null)[]>([]);
  const [links, setLinks] = useState<SlideLinkRect[]>([]);

  const { drawings, addStroke, updateStrokes, syncDrawings, clear } = useDrawing();

  const [mode, setMode] = useState<AppMode>('view');
  const [stylusOnly, setStylusOnly] = useState(false);

  const [toolType, setToolType] = useState<'pen' | 'eraser' | 'select'>('pen');
  const [penColor, setPenColor] = useState('#FF0000');
  const [penWidth, setPenWidth] = useState(3);

  const { send } = useSync(channelId, token, (msg: SyncMessage) => {
    switch (msg.type) {
      case 'SYNC_STATE_IMAGE': {
        const p = msg.payload as ImageSyncPayload;
        setCurImage(p.curImage);
        if (typeof p.index === 'number') setIndex(p.index);
        if (typeof p.slideCount === 'number') setSlideCount(p.slideCount);
        if (p.slideSize) setSlideSize(p.slideSize);
        if (p.allDrawings) syncDrawings(p.allDrawings as Record<number, Stroke[]>);
        setLinks(p.links || []);
        setIsOverview(!!p.isOverview);
        break;
      }
      case 'OVERVIEW_GRID': {
        const p = msg.payload as OverviewGridPayload;
        setGridImages(p.images);
        if (p.slideSize) setSlideSize(p.slideSize);
        if (typeof p.index === 'number') setIndex(p.index);
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
    const handleTouch = (e: TouchEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.closest('button') ||
        target.closest('a') ||
        target.closest('input') ||
        target.closest('.drawing-palette') ||
        target.closest('.slide-controls-container') ||
        target.closest('.MuiPopover-root') ||
        target.closest('.MuiModal-root')
      ) {
        return;
      }

      if (mode === 'laser') {
        e.preventDefault();
      } else if (mode === 'pen') {
        if (!stylusOnly) {
          e.preventDefault();
        }
      } else if (mode === 'view') {
         e.preventDefault()
      }
    };
    document.body.addEventListener('touchmove', handleTouch, { passive: false });
    document.body.addEventListener('touchstart', handleTouch, { passive: false });
    return () => {
      document.body.removeEventListener('touchmove', handleTouch);
      document.body.removeEventListener('touchstart', handleTouch);
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
        setIsScanning(false);
        reportError('Camera access denied or not supported.', { detail: err, severity: 'warning' });
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
                  setToken(url.searchParams.get('token'));
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
    // The host is authoritative for the target index (it respects hidden slides);
    // it echoes back a SYNC_STATE_IMAGE with the new index + image.
    send({ type: 'NAV', direction: dir, channelId });
  };

  const handleAddStroke = (stroke: Stroke) => {
    if (!channelId) return;
    addStroke(index, stroke, true);
    send({ type: 'DRAW_STROKE', stroke, pageIndex: index, channelId });
  };

  const handleUpdateStrokes = useCallback((pageIndex: number, indices: number[], dx: number, dy: number) => {
    if (updateStrokes) updateStrokes(pageIndex, indices, dx, dy);
    if (channelId) send({ type: 'UPDATE_STROKES', pageIndex, indices, dx, dy, channelId });
  }, [updateStrokes, channelId, send]);

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
  const handleToggleOverview = () => { if (channelId) send({ type: 'TOGGLE_OVERVIEW', channelId }); };
  const handleSelectSlide = (i: number) => { if (channelId) send({ type: 'SELECT_SLIDE', index: i, channelId }); };
  const handleLinkNav = (target: string) => { if (channelId) send({ type: 'LINK_NAV', target, channelId }); };
  const handleHistoryNav = (dir: 1 | -1) => { if (channelId) send({ type: 'HISTORY_NAV', dir, channelId }); };

  const touchStartPos = useRef<{ x: number, y: number } | null>(null);

  const onTouchStart = (e: React.TouchEvent) => {
    if (mode !== 'view' && !(mode === 'pen' && stylusOnly)) return;
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
          <Button variant="text" onClick={() => { window.location.href = window.location.href.split('#')[0] + '#/'; }} sx={{ mt: 1, color: '#888' }}>Back to Editor</Button>
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

  if (!curImage) {
    return (
      <div style={{ width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#222', color: 'white' }}>
        <Typography>Connecting to Host...</Typography>
        <Button sx={{ml:2}} onClick={() => setChannelId(null)}>Cancel</Button>
      </div>
    );
  }

  return (
    <div style={{
      width: '100vw', height: '100vh', background: '#222',
      display: 'flex', flexDirection: 'column',
      touchAction: (mode === 'pen' && stylusOnly) ? 'pan-x pan-y' : 'none',
      userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none', overscrollBehavior: 'none'
    }}>

      <div style={{ height: 40, background: '#333', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', color: 'white', flexShrink: 0 }}>
        <div style={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '12px' }}>
          Remote
          <Button size="small" onClick={() => { window.location.href = window.location.href.split('#')[0] + '#/'; }} sx={{ color: '#aaa', minWidth: 'auto', p: 0, textTransform: 'none', '&:hover': { color: '#fff' } }}>← Editor</Button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Button size="small" onClick={handleToggleOverview} startIcon={<GridViewIcon fontSize="small" />} sx={{ color: isOverview ? '#fff' : '#aaa', bgcolor: isOverview ? 'rgba(59,130,246,0.4)' : 'transparent', textTransform: 'none', minWidth: 'auto', '&:hover': { color: '#fff' } }}>Overview</Button>
          <Button size="small" onClick={() => setChannelId(null)} sx={{ color: 'white' }}>Disconnect</Button>
        </div>
      </div>

      {isOverview ? (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', background: '#202020', padding: '16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '14px', alignContent: 'flex-start' }}>
          {gridImages.map((img, i) => (
            <div
              key={i}
              onClick={() => handleSelectSlide(i)}
              style={{ position: 'relative', cursor: 'pointer', borderRadius: 6, overflow: 'hidden', border: i === index ? '3px solid #3b82f6' : '3px solid transparent', background: '#fff', aspectRatio: `${slideSize.width} / ${slideSize.height}` }}
            >
              <div style={{ position: 'absolute', top: 2, left: 2, zIndex: 2, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 11, padding: '0 6px', borderRadius: 8 }}>{i + 1}</div>
              {img ? (
                <img src={img} alt={`slide ${i + 1}`} draggable={false} style={{ width: '100%', height: '100%', objectFit: 'fill', display: 'block' }} />
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontSize: 12 }}>…</div>
              )}
            </div>
          ))}
        </div>
      ) : (
      <div
        style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000', touchAction: 'none' }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
         <SlideControls
            mode={mode} setMode={setMode}
            pageIndex={index} totalSlides={slideCount}
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
            onHistoryBack={() => handleHistoryNav(-1)} onHistoryForward={() => handleHistoryNav(1)} canHistoryBack canHistoryForward
         />

         <SlideScaler width={slideSize.width} height={slideSize.height}>
             <div style={{ position: 'relative', width: `${slideSize.width}px`, height: `${slideSize.height}px` }}>
                <img src={curImage} alt="slide" draggable={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'fill', pointerEvents: 'none', userSelect: 'none' }} />
                <DrawingOverlay
                  width={slideSize.width}
                  height={slideSize.height}
                  data={drawings[index] || []}
                  isInteracting={mode === 'pen'}
                  onAddStroke={handleAddStroke}
                  onUpdateStrokes={(indices, dx, dy) => handleUpdateStrokes(index, indices, dx, dy)}
                  toolType={toolType}
                  color={penColor}
                  lineWidth={penWidth}
                  penOnly={stylusOnly}
                />
                {/* Hyperlink hotspots — clickable only in view mode (pen mode draws). */}
                {mode === 'view' && links.map((lk, i) => (
                  <div
                    key={i}
                    onClick={() => handleLinkNav(lk.target)}
                    title={lk.target}
                    style={{ position: 'absolute', left: `${lk.x * 100}%`, top: `${lk.y * 100}%`, width: `${lk.w * 100}%`, height: `${lk.h * 100}%`, cursor: 'pointer', pointerEvents: 'auto', zIndex: 5 }}
                  />
                ))}
             </div>
         </SlideScaler>
      </div>
      )}
    </div>
  );
};