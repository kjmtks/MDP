import React from 'react';
import { IconButton, Tooltip, Popover } from '@mui/material';
import CreateIcon from '@mui/icons-material/Create';
import AutoFixNormalIcon from '@mui/icons-material/AutoFixNormal';
import UndoIcon from '@mui/icons-material/Undo';
import RedoIcon from '@mui/icons-material/Redo';
import DeleteIcon from '@mui/icons-material/Delete';
import LensIcon from '@mui/icons-material/Lens';
import FingerprintIcon from '@mui/icons-material/Fingerprint';
import DoNotTouchIcon from '@mui/icons-material/DoNotTouch';

interface DrawingPaletteProps {
  toolType: 'pen' | 'eraser';
  setToolType: (type: 'pen' | 'eraser') => void;
  color: string;
  setColor: (color: string) => void;
  lineWidth: number;
  setLineWidth: (width: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  container?: HTMLElement | null;
  style?: React.CSSProperties;
  className?: string;
  stylusOnly?: boolean;
  setStylusOnly?: (val: boolean) => void;
}

const COLORS = ['#FF0000', '#0000FF', '#000000', '#008000', '#FFA500', '#b200b2', '#00b2b2', '#FFFFFF'];
const WIDTHS = [2, 4, 8, 12];

export const DrawingPalette: React.FC<DrawingPaletteProps> = ({
  toolType, setToolType,
  color, setColor,
  lineWidth, setLineWidth,
  canUndo, canRedo, onUndo, onRedo, onClear,
  container,
  style,
  className,
  stylusOnly,
  setStylusOnly
}) => {
  const [anchorEl, setAnchorEl] = React.useState<HTMLButtonElement | null>(null);

  const handleColorClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
  };
  const handleColorClose = () => {
    setAnchorEl(null);
  };
  const selectColor = (c: string) => {
    setColor(c);
    setToolType('pen');
    handleColorClose();
  };

  const targetContainer = container || document.fullscreenElement || document.body;

  return (
    <div 
      className={`drawing-palette ${className || ''}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        backgroundColor: 'rgba(30, 30, 30, 0.9)',
        padding: '8px 16px',
        borderRadius: '50px',
        backdropFilter: 'blur(5px)',
        border: '1px solid #444',
        pointerEvents: 'auto',
        ...style 
      }}
    >
      <Tooltip title="Pen">
        <IconButton 
          color={toolType === 'pen' ? "primary" : "default"} 
          onClick={() => setToolType('pen')}
          style={{
            backgroundColor: toolType === 'pen' ? 'rgba(25, 118, 210, 0.2)' : 'transparent'
          }}
        >
          <CreateIcon />
        </IconButton>
      </Tooltip>

      <Tooltip title="Color">
        <IconButton onClick={handleColorClick}>
          <LensIcon style={{ color: color, border: '1px solid #ccc', borderRadius: '50%' }} />
        </IconButton>
      </Tooltip>

      <Tooltip title="Eraser">
        <IconButton 
          color={toolType === 'eraser' ? "secondary" : "default"} 
          onClick={() => setToolType('eraser')}
          style={{
            backgroundColor: toolType === 'eraser' ? 'rgba(156, 39, 176, 0.2)' : 'transparent'
          }}
        >
          <AutoFixNormalIcon />
        </IconButton>
      </Tooltip>

      <div className="palette-separator" style={{ width: 1, height: 24, backgroundColor: '#555', margin: '0 4px' }} />

      <div className="width-selector" style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        {WIDTHS.map(w => (
          <button 
            key={w}
            onClick={() => setLineWidth(w)}
            type="button"
            className="palette-control"
            style={{
              width: w + 8, height: w + 8,
              borderRadius: '50%',
              backgroundColor: lineWidth === w ? '#1976d2' : '#999',
              cursor: 'pointer',
              margin: '0 2px',
              border: lineWidth === w ? '2px solid white' : 'none',
              boxShadow: lineWidth === w ? '0 0 0 1px #1976d2' : 'none',
              padding: 0,
              outline: 'none',
              appearance: 'none',
              WebkitAppearance: 'none',
            }}
            title={`Width: ${w}px`}
          />
        ))}
      </div>

      <div className="palette-separator" style={{ width: 1, height: 24, backgroundColor: '#555', margin: '0 4px' }} />

      {setStylusOnly && (
        <>
          <Tooltip title={stylusOnly ? "Stylus Only (Touch disabled)" : "Touch Drawing Enabled"}>
            <IconButton 
              onClick={() => setStylusOnly(!stylusOnly)}
              style={{ color: stylusOnly ? '#ff6600' : '#888' }}
            >
              {stylusOnly ? <DoNotTouchIcon /> : <FingerprintIcon />}
            </IconButton>
          </Tooltip>
          <div className="palette-separator" style={{ width: 1, height: 24, backgroundColor: '#555', margin: '0 4px' }} />
        </>
      )}

      <Tooltip title="Undo (Ctrl+Z)">
        <span>
          <IconButton disabled={!canUndo} onClick={onUndo} style={{ color: '#888' }} >
            <UndoIcon />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title="Redo (Ctrl+Y)">
        <span>
          <IconButton disabled={!canRedo} onClick={onRedo} style={{ color: '#888' }}>
            <RedoIcon />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title="Clear All">
        <IconButton color="error" onClick={onClear}>
          <DeleteIcon />
        </IconButton>
      </Tooltip>

      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={handleColorClose}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        container={targetContainer}
        sx={{ zIndex: 11000 }}
      >
        <div className="palette-popover-content" style={{ padding: 10, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, backgroundColor: '#333' }}>
          {COLORS.map(c => (
            <button
              key={c} 
              onClick={() => selectColor(c)}
              type="button"
              className="palette-control"
              style={{ 
                width: 32, height: 32, 
                backgroundColor: c, 
                borderRadius: '50%', 
                cursor: 'pointer', 
                border: '1px solid #666',
                padding: 0,
                outline: 'none',
                appearance: 'none',
                WebkitAppearance: 'none',
              }}
            />
          ))}
          <input 
            type="color" 
            value={color} 
            onChange={(e) => { setColor(e.target.value); setToolType('pen'); }}
            style={{ width: 32, height: 32, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }} 
          />
        </div>
      </Popover>
    </div>
  );
};