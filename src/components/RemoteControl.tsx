import React, { useState, useEffect } from 'react';
import { useSync, type SyncMessage } from '../hooks/useSync';
import { SlideView } from './SlideView';
import { SlideScaler } from './SlideScaler';
import { DrawingOverlay, type Stroke } from './DrawingOverlay';
import { DrawingPalette } from './DrawingPalette';
import { useDrawing } from '../hooks/useDrawing';

import { Button, IconButton, TextField, Paper, Typography } from '@mui/material';
import ArrowBackIosIcon from '@mui/icons-material/ArrowBackIos';
import ArrowForwardIosIcon from '@mui/icons-material/ArrowForwardIos';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import LinkIcon from '@mui/icons-material/Link';

import '../App.css';

interface SyncData {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  slides: any[];
  index: number;
  slideSize: { width: number; height: number };
  themeCssUrl?: string;
  lastUpdated: number;
  allDrawings?: Record<number, Stroke[]>; // ★追加: 全描画データ
}

export const RemoteControl: React.FC = () => {
  const [channelId, setChannelId] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('channel');
  });
  const [inputToken, setInputToken] = useState('');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [slides, setSlides] = useState<any[]>([]);
  const [index, setIndex] = useState(0);
  const [slideSize, setSlideSize] = useState({ width: 1280, height: 720 });
  const { drawings, addStroke, syncDrawings, undo, redo, clear, canUndo, canRedo } = useDrawing();
  const [isDrawingMode, setIsDrawingMode] = useState(false);
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
        if (p.allDrawings) {
            syncDrawings(p.allDrawings);
        }
        if (p.themeCssUrl) setThemeCssUrl(p.themeCssUrl);
        if (p.lastUpdated) setLastUpdated(p.lastUpdated);
        break;
      }
        
      case 'NAV':
        break;

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

  const handleConnect = () => {
    if (inputToken.trim()) {
      setChannelId(inputToken.trim());
    }
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

  if (!channelId) {
    return (
      <div style={{ width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#222' }}>
        <Paper sx={{ p: 4, width: '90%', maxWidth: 400, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <Typography variant="h5" align="center">Remote Control</Typography>
          <TextField 
            label="Connection Token" 
            value={inputToken} 
            onChange={e => setInputToken(e.target.value)} 
            variant="outlined" 
            fullWidth
          />
          <Button variant="contained" size="large" onClick={handleConnect} startIcon={<LinkIcon />}>
            Connect
          </Button>
        </Paper>
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
    <div style={{ width: '100vw', height: '100vh', background: '#222', display: 'flex', flexDirection: 'column' }}>
      
      <div style={{ height: 60, background: '#333', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', color: 'white', flexShrink: 0 }}>
        <div style={{ fontWeight: 'bold' }}>Remote</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Button 
            variant={isDrawingMode ? "contained" : "outlined"} 
            color={isDrawingMode ? "primary" : "inherit"}
            onClick={() => setIsDrawingMode(!isDrawingMode)}
            startIcon={<EditIcon />}
          >
            {isDrawingMode ? "Drawing" : "View"}
          </Button>
          
          <IconButton onClick={handleClear} color="error">
            <DeleteIcon />
          </IconButton>
        </div>
      </div>

      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000' }}>
         {isDrawingMode && (
            <DrawingPalette 
              toolType={toolType} setToolType={setToolType}
              color={penColor} setColor={setPenColor}
              lineWidth={penWidth} setLineWidth={setPenWidth}
              canUndo={canUndo(index)}
              canRedo={canRedo(index)}
              onUndo={() => undo(index)}
              onRedo={() => redo(index)}
              onClear={handleClear}
              container={document.body}
            />
         )}

         <SlideScaler width={slideSize.width} height={slideSize.height}>
             <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                <SlideView 
                  html={currentSlide.html}
                  slideSize={slideSize}
                  isActive={true}
                  className={currentSlide.className}
                  header={currentSlide.header}
                  footer={currentSlide.footer}
                  isEnabledPointerEvents={false}
                />
                
                <DrawingOverlay 
                  width={slideSize.width} 
                  height={slideSize.height}
                  data={drawings[index] || []}
                  onAddStroke={handleAddStroke}
                  color={penColor}
                  lineWidth={penWidth}
                  toolType={toolType}
                  isInteracting={isDrawingMode}
                />
             </div>
         </SlideScaler>
      </div>

      <div style={{ height: 80, background: '#333', display: 'flex', alignItems: 'center', justifyContent: 'space-around', padding: '10px', flexShrink: 0 }}>
          <Button 
            variant="contained" 
            sx={{ height: '100%', flex: 1, mr: 1, fontSize: '1.2rem' }} 
            onClick={() => handleNav(-1)}
          >
            <ArrowBackIosIcon />
          </Button>
          <Typography color="white" sx={{ mx: 2 }}>
            {index + 1} / {slides.length}
          </Typography>
          <Button 
            variant="contained" 
            sx={{ height: '100%', flex: 1, ml: 1, fontSize: '1.2rem' }} 
            onClick={() => handleNav(1)}
          >
             <ArrowForwardIosIcon />
          </Button>
      </div>
    </div>
  );
};