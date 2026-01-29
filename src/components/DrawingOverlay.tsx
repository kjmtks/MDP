import React, { useRef, useEffect, useState, useCallback } from 'react';

// ストロークデータの定義
export interface Stroke {
  points: { x: number; y: number }[];
  color: string;
  width: number;
  type: 'pen' | 'eraser'; // 描画タイプ
}

interface DrawingOverlayProps {
  width: number;
  height: number;
  data: Stroke[];
  onAddStroke: (stroke: Stroke) => void;
  color: string;
  lineWidth: number;
  toolType: 'pen' | 'eraser';
  isInteracting: boolean; // 描画可能かどうか（パレット表示中など）
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
  const [isDrawing, setIsDrawing] = useState(false);
  const currentStroke = useRef<Stroke | null>(null);

  // 描画関数
  const draw = useCallback((ctx: CanvasRenderingContext2D, strokes: Stroke[]) => {
    ctx.clearRect(0, 0, width, height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    strokes.forEach(stroke => {
      if (stroke.points.length < 2) return;
      
      ctx.beginPath();
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      
      // 消しゴムの場合は合成モードを変更
      if (stroke.type === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
      } else {
        ctx.globalCompositeOperation = 'source-over';
      }
      
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        // 簡易的な平滑化（二次ベジェ曲線）を入れるとより滑らかになりますが、今回は直線で実装
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      ctx.stroke();
    });
    
    // 描画後は合成モードを戻す
    ctx.globalCompositeOperation = 'source-over';
  }, [width, height]);

  // データ更新時の再描画
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const strokesToDraw = [...data];
    // 描画中のストロークがあればそれも描画
    if (currentStroke.current) {
      strokesToDraw.push(currentStroke.current);
    }

    draw(ctx, strokesToDraw);
  }, [data, width, height, draw]); // currentStroke.currentの変更はイベントハンドラ内で再描画を呼ぶ

  // --- イベントハンドラ ---

  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    
    let clientX, clientY;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = (e as React.MouseEvent).clientX;
      clientY = (e as React.MouseEvent).clientY;
    }

    const scaleX = width / rect.width;
    const scaleY = height / rect.height;

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isInteracting) return;
    // 左クリックのみ
    if ('button' in e && (e as React.MouseEvent).button !== 0) return;

    e.preventDefault();
    setIsDrawing(true);
    
    const pos = getPos(e);
    currentStroke.current = {
      points: [pos],
      color: toolType === 'eraser' ? 'rgba(0,0,0,1)' : color, // 消しゴムの色は何でも良い(合成で消える)
      width: lineWidth,
      type: toolType
    };
  };

  const drawMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing || !currentStroke.current) return;
    e.preventDefault();

    const pos = getPos(e);
    currentStroke.current.points.push(pos);

    // リアルタイム反映
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (ctx) {
       draw(ctx, [...data, currentStroke.current]);
    }
  };

  const endDrawing = () => {
    if (!isDrawing || !currentStroke.current) return;
    setIsDrawing(false);
    
    // 確定データを親へ送る
    onAddStroke(currentStroke.current);
    currentStroke.current = null;
  };

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
        pointerEvents: isInteracting ? 'auto' : 'none', // 描画モードでないときは透過
        zIndex: 50,
        cursor: isInteracting ? (toolType === 'eraser' ? 'cell' : 'crosshair') : 'default',
        touchAction: 'none' // タッチデバイスでのスクロール防止
      }}
      onMouseDown={startDrawing}
      onMouseMove={drawMove}
      onMouseUp={endDrawing}
      onMouseLeave={endDrawing}
      onTouchStart={startDrawing}
      onTouchMove={drawMove}
      onTouchEnd={endDrawing}
    />
  );
};