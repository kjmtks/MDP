/* eslint-disable no-empty */
import React, { useRef, useEffect, useCallback, useState } from 'react';

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
  onUpdateStrokes?: (indices: number[], dx: number, dy: number) => void;
  color?: string;
  lineWidth?: number;
  toolType?: 'pen' | 'eraser' | 'select';
  isInteracting: boolean;
  penOnly?: boolean;
}

export const DrawingOverlay: React.FC<DrawingOverlayProps> = ({
  width, height, data, onAddStroke, onUpdateStrokes,
  color = 'red', lineWidth = 3, toolType = 'pen',
  isInteracting, penOnly = false
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);
  const currentStroke = useRef<Stroke | null>(null);
  const currentPointerId = useRef<number | null>(null);

  const [selectionRect, setSelectionRect] = useState<{ startX: number, startY: number, currentX: number, currentY: number } | null>(null);
  const [selectedStrokeIndices, setSelectedStrokeIndices] = useState<number[]>([]);
  const [dragOffset, setDragOffset] = useState<{ dx: number, dy: number } | null>(null);

  const dragStartPos = useRef<{ x: number, y: number } | null>(null);
  const dragOffsetRef = useRef<{ dx: number, dy: number } | null>(null);

  const [prevToolType, setPrevToolType] = useState(toolType);
  if (toolType !== prevToolType) {
      setPrevToolType(toolType);
      if (toolType !== 'select') {
          setSelectedStrokeIndices([]);
          setSelectionRect(null);
          setDragOffset(null);
      }
  }

  useEffect(() => {
      if (toolType !== 'select') {
          dragStartPos.current = null;
          dragOffsetRef.current = null;
      }
  }, [toolType]);

  const selectionRef = useRef({ rect: selectionRect, indices: selectedStrokeIndices });
  useEffect(() => { selectionRef.current = { rect: selectionRect, indices: selectedStrokeIndices }; }, [selectionRect, selectedStrokeIndices]);

  const propsRef = useRef({ color, lineWidth, toolType, onAddStroke, onUpdateStrokes, isInteracting, width, height, data, penOnly });
  useEffect(() => { propsRef.current = { color, lineWidth, toolType, onAddStroke, onUpdateStrokes, isInteracting, width, height, data, penOnly }; }, [color, lineWidth, toolType, onAddStroke, onUpdateStrokes, isInteracting, width, height, data, penOnly]);

  const draw = useCallback((ctx: CanvasRenderingContext2D, strokes: Stroke[], selIndices: number[], dragDx: number, dragDy: number) => {
    if (width === 0 || height === 0) return;
    ctx.clearRect(0, 0, width, height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    strokes.forEach((stroke, idx) => {
      if (stroke.points.length === 0) return;
      ctx.beginPath();
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;

      const isSelected = selIndices.includes(idx);
      const dx = isSelected ? dragDx : 0;
      const dy = isSelected ? dragDy : 0;

      if (stroke.type === 'eraser') ctx.globalCompositeOperation = 'destination-out';
      else ctx.globalCompositeOperation = 'source-over';

      if (stroke.points.length === 1) {
          ctx.fillStyle = stroke.color;
          ctx.arc(stroke.points[0].x + dx, stroke.points[0].y + dy, stroke.width / 2, 0, Math.PI * 2);
          ctx.fill();
      } else {
          ctx.moveTo(stroke.points[0].x + dx, stroke.points[0].y + dy);
          for (let i = 1; i < stroke.points.length; i++) {
            ctx.lineTo(stroke.points[i].x + dx, stroke.points[i].y + dy);
          }
          ctx.stroke();
      }
    });
    ctx.globalCompositeOperation = 'source-over';
  }, [width, height]);

  const drawRef = useRef(draw);
  useEffect(() => { drawRef.current = draw; }, [draw]);

  const renderCurrentState = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const strokes = [...propsRef.current.data];
        if (currentStroke.current) strokes.push(currentStroke.current);
        const { indices } = selectionRef.current;

        const currentDx = dragStartPos.current && dragOffsetRef.current ? dragOffsetRef.current.dx : 0;
        const currentDy = dragStartPos.current && dragOffsetRef.current ? dragOffsetRef.current.dy : 0;

        requestAnimationFrame(() => drawRef.current(ctx, strokes, indices, currentDx, currentDy));
  }, []);

  useEffect(() => { renderCurrentState(); }, [data, width, height, selectedStrokeIndices, dragOffset, renderCurrentState]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const getPos = (e: PointerEvent) => {
        const rect = canvas.getBoundingClientRect();
        const { width, height } = propsRef.current;
        const scaleX = rect.width > 0 ? width / rect.width : 1;
        const scaleY = rect.height > 0 ? height / rect.height : 1;
        return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
    };

    const preventTouch = (e: TouchEvent) => {
        if (propsRef.current.isInteracting) {
            if (!propsRef.current.penOnly) e.preventDefault();
            else if (e.touches.length === 1) e.preventDefault();
        }
    };

    const start = (e: PointerEvent) => {
        if (!propsRef.current.isInteracting) return;
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        if (propsRef.current.penOnly && e.pointerType !== 'pen' && propsRef.current.toolType !== 'select') return;

        e.preventDefault(); e.stopPropagation();
        try { canvas.setPointerCapture(e.pointerId); } catch {}

        currentPointerId.current = e.pointerId;
        isDrawing.current = true;
        const pos = getPos(e);

        const { color, lineWidth, toolType, data } = propsRef.current;

        if (toolType === 'select') {
            let overallMinX = Infinity, overallMaxX = -Infinity, overallMinY = Infinity, overallMaxY = -Infinity;
            selectionRef.current.indices.forEach(idx => {
                const stroke = data[idx];
                if(stroke) {
                    stroke.points.forEach(p => {
                        if(p.x < overallMinX) overallMinX = p.x;
                        if(p.x > overallMaxX) overallMaxX = p.x;
                        if(p.y < overallMinY) overallMinY = p.y;
                        if(p.y > overallMaxY) overallMaxY = p.y;
                    });
                }
            });

            const margin = 20;
            const hitSelected = selectionRef.current.indices.length > 0 &&
                                pos.x >= overallMinX - margin && pos.x <= overallMaxX + margin &&
                                pos.y >= overallMinY - margin && pos.y <= overallMaxY + margin;

            if (hitSelected) {
                dragStartPos.current = { x: pos.x, y: pos.y };
                setDragOffset({ dx: 0, dy: 0 });
                dragOffsetRef.current = { dx: 0, dy: 0 };
            } else {
                setSelectionRect({ startX: pos.x, startY: pos.y, currentX: pos.x, currentY: pos.y });
                setSelectedStrokeIndices([]);
                dragStartPos.current = null;
                dragOffsetRef.current = null;
            }
        } else {
            currentStroke.current = {
                points: [pos],
                color: toolType === 'eraser' ? 'rgba(0,0,0,1)' : (color || 'red'),
                width: lineWidth || 3,
                type: toolType
            };
            renderCurrentState();
        }
    };

    const move = (e: PointerEvent) => {
        if (!isDrawing.current) return;
        if (e.pointerId !== currentPointerId.current) return;
        e.preventDefault(); e.stopPropagation();

        const { toolType } = propsRef.current;
        const pos = getPos(e);

        if (toolType === 'select') {
            if (dragStartPos.current) {
                 const dx = pos.x - dragStartPos.current.x;
                 const dy = pos.y - dragStartPos.current.y;
                 setDragOffset({ dx, dy });
                 dragOffsetRef.current = { dx, dy };
            } else if (selectionRef.current.rect) {
                 setSelectionRect(prev => prev ? { ...prev, currentX: pos.x, currentY: pos.y } : null);
            }
        } else {
            const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
            events.forEach(ev => {
                const posEv = getPos(ev);
                const lastPoint = currentStroke.current!.points[currentStroke.current!.points.length - 1];
                if (lastPoint && Math.abs(lastPoint.x - posEv.x) < 0.1 && Math.abs(lastPoint.y - posEv.y) < 0.1) return;
                currentStroke.current!.points.push(posEv);
            });
            renderCurrentState();
        }
    };

    const end = (e: PointerEvent) => {
        if (e.pointerId === currentPointerId.current) {
            e.preventDefault(); e.stopPropagation();
            if (isDrawing.current) {
                const { toolType, onAddStroke, onUpdateStrokes, data } = propsRef.current;

                if (toolType === 'select') {
                    if (dragStartPos.current) {
                        const finalDx = dragOffsetRef.current ? dragOffsetRef.current.dx : 0;
                        const finalDy = dragOffsetRef.current ? dragOffsetRef.current.dy : 0;

                        if (onUpdateStrokes && (finalDx !== 0 || finalDy !== 0) && selectionRef.current.indices.length > 0) {
                             onUpdateStrokes(selectionRef.current.indices, finalDx, finalDy);
                        }

                        setDragOffset(null);
                        dragStartPos.current = null;
                        dragOffsetRef.current = null;
                    } else if (selectionRef.current.rect) {
                        const rect = selectionRef.current.rect;
                        const minX = Math.min(rect.startX, rect.currentX);
                        const maxX = Math.max(rect.startX, rect.currentX);
                        const minY = Math.min(rect.startY, rect.currentY);
                        const maxY = Math.max(rect.startY, rect.currentY);

                        const hitIndices: number[] = [];
                        data.forEach((stroke, idx) => {
                            const isHit = stroke.points.some(p => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY);
                            if (isHit) hitIndices.push(idx);
                        });
                        setSelectedStrokeIndices(hitIndices);
                        setSelectionRect(null);
                    }
                } else {
                    if (currentStroke.current && onAddStroke) onAddStroke(currentStroke.current);
                }
            }
            isDrawing.current = false;
            currentStroke.current = null;
            currentPointerId.current = null;
            try { canvas.releasePointerCapture(e.pointerId); } catch {}
            renderCurrentState();
        }
    };

    const cancel = (e: PointerEvent) => {
        if (e.pointerId === currentPointerId.current) end(e);
    };

    canvas.addEventListener('pointerdown', start);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', cancel);
    canvas.addEventListener('pointerleave', cancel);
    canvas.addEventListener('touchstart', preventTouch, { passive: false });

    return () => {
        canvas.removeEventListener('pointerdown', start);
        canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerup', end);
        canvas.removeEventListener('pointercancel', cancel);
        canvas.removeEventListener('pointerleave', cancel);
        canvas.removeEventListener('touchstart', preventTouch);
    };
  }, [isInteracting, renderCurrentState]);

  let overallMinX = Infinity, overallMaxX = -Infinity, overallMinY = Infinity, overallMaxY = -Infinity;
  if (selectedStrokeIndices.length > 0) {
      selectedStrokeIndices.forEach(idx => {
          const stroke = data[idx];
          if(stroke) {
              stroke.points.forEach(p => {
                  if(p.x < overallMinX) overallMinX = p.x;
                  if(p.x > overallMaxX) overallMaxX = p.x;
                  if(p.y < overallMinY) overallMinY = p.y;
                  if(p.y > overallMaxY) overallMaxY = p.y;
              });
          }
      });
  }

  const dx = dragOffset ? dragOffset.dx : 0;
  const dy = dragOffset ? dragOffset.dy : 0;

  return (
    <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 50, pointerEvents: isInteracting ? 'auto' : 'none', touchAction: 'none', overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{
          width: '100%',
          height: '100%',
          cursor: isInteracting ? (toolType === 'eraser' ? 'cell' : toolType === 'select' ? 'default' : 'crosshair') : 'default'
        }}
      />

      {toolType === 'select' && selectionRect && (
          <div style={{
              position: 'absolute',
              left: Math.min(selectionRect.startX, selectionRect.currentX),
              top: Math.min(selectionRect.startY, selectionRect.currentY),
              width: Math.abs(selectionRect.currentX - selectionRect.startX),
              height: Math.abs(selectionRect.currentY - selectionRect.startY),
              border: '1px dashed #3b82f6',
              backgroundColor: 'rgba(59, 130, 246, 0.1)',
              pointerEvents: 'none'
          }} />
      )}

      {toolType === 'select' && selectedStrokeIndices.length > 0 && overallMinX !== Infinity && (
          <div style={{
              position: 'absolute',
              left: overallMinX + dx - 8,
              top: overallMinY + dy - 8,
              width: overallMaxX - overallMinX + 16,
              height: overallMaxY - overallMinY + 16,
              border: '2px dashed rgba(59, 130, 246, 0.8)',
              backgroundColor: 'rgba(59, 130, 246, 0.05)',
              pointerEvents: 'none',
              borderRadius: '6px'
          }} />
      )}
    </div>
  );
};