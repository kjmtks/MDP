import React, { useRef, useEffect, useCallback } from 'react';

export interface Stroke {
  points: { x: number; y: number }[];
  color: string;
  width: number;
  type: 'pen' | 'eraser';
}

interface DrawingOverlayProps {
  width: number;
  height: number;
  data: Stroke[];
  onAddStroke: (stroke: Stroke) => void;
  color: string;
  lineWidth: number;
  toolType: 'pen' | 'eraser';
  isInteracting: boolean;
}

export const DrawingOverlay: React.FC<DrawingOverlayProps> = ({
  width,
  height,
  data,
  onAddStroke,
  color,
  lineWidth,
  toolType,
  isInteracting
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const isDrawing = useRef(false);
  const currentStroke = useRef<Stroke | null>(null);
  
  const propsRef = useRef({ color, lineWidth, toolType, onAddStroke, isInteracting, width, height, data });
  useEffect(() => {
    propsRef.current = { color, lineWidth, toolType, onAddStroke, isInteracting, width, height, data };
  }, [color, lineWidth, toolType, onAddStroke, isInteracting, width, height, data]);

  const draw = useCallback((ctx: CanvasRenderingContext2D, strokes: Stroke[]) => {
    const { width, height } = propsRef.current;
    ctx.clearRect(0, 0, width, height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    strokes.forEach(stroke => {
      if (stroke.points.length === 0) return;
      
      ctx.beginPath();
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      
      if (stroke.type === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
      } else {
        ctx.globalCompositeOperation = 'source-over';
      }
      
      if (stroke.points.length === 1) {
          ctx.fillStyle = stroke.color;
          ctx.arc(stroke.points[0].x, stroke.points[0].y, stroke.width / 2, 0, Math.PI * 2);
          ctx.fill();
      } else {
          ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
          for (let i = 1; i < stroke.points.length; i++) {
            ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
          }
          ctx.stroke();
      }
    });
    
    ctx.globalCompositeOperation = 'source-over';
  }, []);

  const drawRef = useRef(draw);
  useEffect(() => { drawRef.current = draw; }, [draw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const strokesToDraw = [...data];
    if (currentStroke.current) {
        strokesToDraw.push(currentStroke.current);
    }
    
    requestAnimationFrame(() => draw(ctx, strokesToDraw));
  }, [data, draw, width, height]);


  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderCurrentState = () => {
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        const strokes = [...propsRef.current.data];
        if (currentStroke.current) {
            strokes.push(currentStroke.current);
        }
        
        requestAnimationFrame(() => drawRef.current(ctx, strokes));
    };

    const getPos = (e: MouseEvent | TouchEvent) => {
        const rect = canvas.getBoundingClientRect();
        let clientX, clientY;
        
        if (window.TouchEvent && e instanceof TouchEvent) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            clientX = (e as MouseEvent).clientX;
            clientY = (e as MouseEvent).clientY;
        }
        
        const { width, height } = propsRef.current;
        const scaleX = width / rect.width;
        const scaleY = height / rect.height;

        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    };

    const start = (e: MouseEvent | TouchEvent) => {
        if (!propsRef.current.isInteracting) return;
        
        if (e instanceof MouseEvent && e.button !== 0) return;
        
        e.preventDefault();
        e.stopPropagation();

        isDrawing.current = true;
        const pos = getPos(e);
        const { color, lineWidth, toolType } = propsRef.current;
        
        currentStroke.current = {
            points: [pos],
            color: toolType === 'eraser' ? 'rgba(0,0,0,1)' : color,
            width: lineWidth,
            type: toolType
        };
        
        renderCurrentState();
    };

    const move = (e: MouseEvent | TouchEvent) => {
        if (!isDrawing.current || !currentStroke.current) return;
        e.preventDefault();
        e.stopPropagation();

        const pos = getPos(e);
        currentStroke.current.points.push(pos);
        
        renderCurrentState();
    };

    const end = (e: MouseEvent | TouchEvent) => {
        if (!isDrawing.current) return;
        e.preventDefault();
        e.stopPropagation();
        
        isDrawing.current = false;
        
        if (currentStroke.current) {
            propsRef.current.onAddStroke(currentStroke.current);
            currentStroke.current = null;
        }
    };

    canvas.addEventListener('mousedown', start);
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', end);
    
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', end, { passive: false });
    canvas.addEventListener('touchcancel', end, { passive: false });

    return () => {
        canvas.removeEventListener('mousedown', start);
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', end);
        
        canvas.removeEventListener('touchstart', start);
        canvas.removeEventListener('touchmove', move);
        canvas.removeEventListener('touchend', end);
        canvas.removeEventListener('touchcancel', end);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: isInteracting ? 'auto' : 'none',
        zIndex: 50,
        cursor: isInteracting ? (toolType === 'eraser' ? 'cell' : 'crosshair') : 'default',
        touchAction: 'none'
      }}
    />
  );
};