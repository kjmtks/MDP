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
  onAddStroke?: (stroke: Stroke) => void;
  color?: string;
  lineWidth?: number;
  toolType?: 'pen' | 'eraser';
  isInteracting: boolean;
  penOnly?: boolean;
}

export const DrawingOverlay: React.FC<DrawingOverlayProps> = ({
  width,
  height,
  data,
  onAddStroke,
  color = 'red',
  lineWidth = 3,
  toolType = 'pen',
  isInteracting,
  penOnly = false 
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const isDrawing = useRef(false);
  const currentStroke = useRef<Stroke | null>(null);
  const currentPointerId = useRef<number | null>(null);
  
  const propsRef = useRef({ color, lineWidth, toolType, onAddStroke, isInteracting, width, height, data, penOnly });
  useEffect(() => {
    propsRef.current = { color, lineWidth, toolType, onAddStroke, isInteracting, width, height, data, penOnly };
  }, [color, lineWidth, toolType, onAddStroke, isInteracting, width, height, data, penOnly]);

  const draw = useCallback((ctx: CanvasRenderingContext2D, strokes: Stroke[]) => {
    if (width === 0 || height === 0) return;

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
  }, [width, height]);

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
    requestAnimationFrame(() => drawRef.current(ctx, strokesToDraw));
  }, [data, width, height]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!isInteracting) return;
    const renderCurrentState = () => {
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const strokes = [...propsRef.current.data];
        if (currentStroke.current) {
            strokes.push(currentStroke.current);
        }
        requestAnimationFrame(() => drawRef.current(ctx, strokes));
    };

    const getPos = (e: PointerEvent) => {
        const rect = canvas.getBoundingClientRect();
        const { width, height } = propsRef.current;
        const scaleX = rect.width > 0 ? width / rect.width : 1;
        const scaleY = rect.height > 0 ? height / rect.height : 1;
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    };

    const start = (e: PointerEvent) => {
        if (!propsRef.current.isInteracting) return;
        if (e.button !== 0) return;
        if (propsRef.current.penOnly && e.pointerType !== 'pen') {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        try {
          canvas.setPointerCapture(e.pointerId);
        } catch (err) {
          console.warn("Failed to capture pointer", err);
        }
        currentPointerId.current = e.pointerId;
        isDrawing.current = true;
        const pos = getPos(e);
        const { color, lineWidth, toolType } = propsRef.current;
        currentStroke.current = {
            points: [pos],
            color: toolType === 'eraser' ? 'rgba(0,0,0,1)' : (color || 'red'),
            width: lineWidth || 3,
            type: toolType || 'pen'
        };
        renderCurrentState();
    };

    const move = (e: PointerEvent) => {
        if (!isDrawing.current || !currentStroke.current) return;
        if (e.pointerId !== currentPointerId.current) return;
        e.preventDefault();
        e.stopPropagation();
        const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
        events.forEach(ev => {
            const pos = getPos(ev);
            const lastPoint = currentStroke.current!.points[currentStroke.current!.points.length - 1];
            if (lastPoint && Math.abs(lastPoint.x - pos.x) < 0.1 && Math.abs(lastPoint.y - pos.y) < 0.1) return;
            currentStroke.current!.points.push(pos);
        });
        renderCurrentState();
    };

    const end = (e: PointerEvent) => {
        if (e.pointerId === currentPointerId.current) {
            e.preventDefault();
            e.stopPropagation();
            if (isDrawing.current) {
                if (currentStroke.current && propsRef.current.onAddStroke) {
                    propsRef.current.onAddStroke(currentStroke.current);
                }
            }
            isDrawing.current = false;
            currentStroke.current = null;
            currentPointerId.current = null;
            try {
               if (canvas.hasPointerCapture(e.pointerId)) {
                   canvas.releasePointerCapture(e.pointerId);
               }
            } catch { /* ignore */ }
        }
    };
    
    // 画面外に出た場合などのキャンセル処理
    const cancel = (e: PointerEvent) => {
        if (e.pointerId === currentPointerId.current) {
             end(e);
        }
    };

    canvas.addEventListener('pointerdown', start);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', cancel);
    canvas.addEventListener('pointerleave', cancel);

    return () => {
        canvas.removeEventListener('pointerdown', start);
        canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerup', end);
        canvas.removeEventListener('pointercancel', cancel);
        canvas.removeEventListener('pointerleave', cancel);
    };
  }, [isInteracting]); 

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