import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ToggleButton, ToggleButtonGroup, IconButton, Stack, Tooltip, Divider } from '@mui/material';
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew';
import ArrowForwardIosIcon from '@mui/icons-material/ArrowForwardIos';
import NoteAddIcon from '@mui/icons-material/NoteAdd';
import SaveIcon from '@mui/icons-material/Save';
import VisibilityIcon from '@mui/icons-material/Visibility';
import EditIcon from '@mui/icons-material/Edit';
import HighlightAltIcon from '@mui/icons-material/HighlightAlt';
import CloseIcon from '@mui/icons-material/Close';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'; 

import { DrawingPalette } from './DrawingPalette';

export type AppMode = 'view' | 'pen' | 'laser';

interface SlideControlsProps {
  mode: AppMode;
  setMode: (mode: AppMode) => void;
  pageIndex: number;
  totalSlides: number;
  visible: boolean;
  onNav: (dir: number) => void;
  onAddSlide?: () => void;
  onSave?: () => void;
  onClearDrawing?: () => void;
  onClose?: () => void;
  toolType: 'pen' | 'eraser';
  setToolType: (t: 'pen' | 'eraser') => void;
  penColor: string;
  setPenColor: (c: string) => void;
  penWidth: number;
  setPenWidth: (w: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  containerStyle?: React.CSSProperties;
  useLaserPointerMode?: boolean;
  stylusOnly?: boolean;
  setStylusOnly?: (val: boolean) => void;
}

export const SlideControls: React.FC<SlideControlsProps> = ({
  mode, setMode,
  pageIndex, totalSlides, visible,
  onNav, onAddSlide, onSave, onClearDrawing, onClose,
  toolType, setToolType, penColor, setPenColor, penWidth, setPenWidth,
  canUndo, canRedo, onUndo, onRedo,
  containerStyle, useLaserPointerMode,
  stylusOnly, setStylusOnly
}) => {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const isDragging = useRef(false);
  const dragStartPos = useRef({ x: 0, y: 0 });
  const currentPosRef = useRef({ x: 0, y: 0 });

  const dragEndRef = useRef<((e: MouseEvent | TouchEvent) => void) | null>(null);

  const handleDragMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (!isDragging.current) return;
    
    if (e.type === 'touchmove') {
       e.preventDefault();
    }

    const clientX = 'touches' in e ? (e as TouchEvent).touches[0].clientX : (e as MouseEvent).clientX;
    const clientY = 'touches' in e ? (e as TouchEvent).touches[0].clientY : (e as MouseEvent).clientY;

    const dx = clientX - dragStartPos.current.x;
    const dy = clientY - dragStartPos.current.y;

    setPosition({
      x: currentPosRef.current.x + dx,
      y: currentPosRef.current.y + dy
    });
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleDragEnd = useCallback((_e: MouseEvent | TouchEvent) => {
    isDragging.current = false;
    document.removeEventListener('mousemove', handleDragMove);
    if (dragEndRef.current) {
        document.removeEventListener('mouseup', dragEndRef.current);
        document.removeEventListener('touchend', dragEndRef.current);
    }
    document.removeEventListener('touchmove', handleDragMove);
  }, [handleDragMove]);

  useEffect(() => {
    dragEndRef.current = handleDragEnd;
  }, [handleDragEnd]);

  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', handleDragMove);
      document.removeEventListener('touchmove', handleDragMove);
      if (dragEndRef.current) {
          document.removeEventListener('mouseup', dragEndRef.current);
          document.removeEventListener('touchend', dragEndRef.current);
      }
    };
  }, [handleDragMove]);

  const handleDragStart = (e: React.MouseEvent | React.TouchEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('input') || target.closest('.MuiSlider-root') || target.closest('.drawing-palette')) {
      return;
    }
    
    if ('button' in e && (e as React.MouseEvent).button !== 0) return;

    isDragging.current = true;
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;

    dragStartPos.current = { x: clientX, y: clientY };
    currentPosRef.current = { ...position };

    document.addEventListener('mousemove', handleDragMove);
    document.addEventListener('touchmove', handleDragMove, { passive: false });
    
    document.addEventListener('mouseup', handleDragEnd);
    document.addEventListener('touchend', handleDragEnd);
  };

  if (!visible) return null;

  return (
    <div 
      className="slide-controls-container"
      onMouseDown={handleDragStart}
      onTouchStart={handleDragStart}
      style={{
        position: 'absolute',
        bottom: 24,
        left: '50%',
        transform: `translate(calc(-50% + ${position.x}px), ${position.y}px)`,
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column', 
        alignItems: 'center',
        gap: 12,
        pointerEvents: 'none',
        width: 'max-content',
        maxWidth: '98vw',
        cursor: 'move',
        ...containerStyle
      }}
    >
      {mode === 'pen' && (
        <div style={{ pointerEvents: 'auto' }}>
          <DrawingPalette 
            toolType={toolType} setToolType={setToolType}
            color={penColor} setColor={setPenColor}
            lineWidth={penWidth} setLineWidth={setPenWidth}
            canUndo={canUndo} canRedo={canRedo}
            onUndo={onUndo} onRedo={onRedo}
            onClear={onClearDrawing || (() => {})}
            stylusOnly={stylusOnly}
            setStylusOnly={setStylusOnly}
            style={{ 
              pointerEvents: 'auto',
              backgroundColor: 'rgba(30, 30, 30, 0.9)',
              borderRadius: '24px',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              padding: '4px 12px',
              position: 'relative',
              transform: 'none',
              bottom: 'auto',
              left: 'auto',
            }}
          />
        </div>
      )}

      <div 
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          backgroundColor: 'rgba(30, 30, 30, 0.9)',
          padding: '6px 6px 6px 16px',
          borderRadius: '24px',
          backdropFilter: 'blur(5px)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          pointerEvents: 'auto',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          whiteSpace: 'nowrap',
          height: '48px',
          boxSizing: 'border-box'
        }}
      >
        <ToggleButtonGroup
          value={mode}
          exclusive
          onChange={(_, newMode) => { if (newMode) setMode(newMode); }}
          size="small"
          sx={{ 
            bgcolor: 'rgba(255,255,255,0.05)', 
            mr: 1,
            height: '32px',
            '& .MuiToggleButton-root': { border: 'none', px: 1.5 }
          }}
        >
          <ToggleButton value="view" title="View"><VisibilityIcon fontSize="small" sx={{color:'white'}} /></ToggleButton>
          <ToggleButton value="pen" title="Pen"><EditIcon fontSize="small" sx={{color:'white'}} /></ToggleButton>
          { useLaserPointerMode && (
            <ToggleButton value="laser" title="Laser"><HighlightAltIcon fontSize="small" sx={{color:'white'}} /></ToggleButton>
          )}
        </ToggleButtonGroup>

        <Stack direction="row" spacing={0.5} alignItems="center">
          <IconButton onClick={() => onNav(-1)} color="primary" size="small"><ArrowBackIosNewIcon fontSize="small" /></IconButton>
          <div style={{ color: 'white', minWidth: 40, textAlign: 'center', userSelect: 'none', fontSize: '0.85rem', fontFamily: 'monospace' }}>
            {pageIndex + 1}/{totalSlides}
          </div>
          <IconButton onClick={() => onNav(1)} color="primary" size="small"><ArrowForwardIosIcon fontSize="small" /></IconButton>
        </Stack>

        {(onAddSlide || onSave || onClearDrawing) && (
           <Divider orientation="vertical" flexItem sx={{ bgcolor: 'rgba(255,255,255,0.2)', mx: 1, my: 1 }} />
        )}

        <Stack direction="row" spacing={0.5}>
          {onAddSlide && (
            <Tooltip title="Add Blank Slide (N)">
              <IconButton onClick={onAddSlide} size="small" sx={{ color: '#aaa', '&:hover': { color: '#fff' } }}><NoteAddIcon fontSize="small" /></IconButton>
            </Tooltip>
          )}
          {onSave && (
            <Tooltip title="Save Drawings">
              <IconButton onClick={onSave} size="small" sx={{ color: '#aaa', '&:hover': { color: '#fff' } }}><SaveIcon fontSize="small" /></IconButton>
            </Tooltip>
          )}
        </Stack>

        {onClose && (
           <>
             <Divider orientation="vertical" flexItem sx={{ bgcolor: 'rgba(255,255,255,0.2)', mx: 1, my: 1 }} />
             <Tooltip title="Exit">
                <IconButton onClick={onClose} color="error" size="small"><CloseIcon fontSize="small" /></IconButton>
             </Tooltip>
           </>
        )}
        
        <div 
          style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            width: '24px', 
            height: '100%', 
            cursor: 'move', 
            opacity: 0.5,
            marginLeft: '4px'
          }}
        >
          <DragIndicatorIcon fontSize="small" sx={{ color: 'white', fontSize: '1rem' }} />
        </div>
      </div>
    </div>
  );
};