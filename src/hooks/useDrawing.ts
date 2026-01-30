import { useState, useCallback } from 'react';
import type { Stroke } from '../components/DrawingOverlay';

interface HistoryState {
  past: Stroke[][];
  future: Stroke[][];
}

export const useDrawing = () => {
  const [drawings, setDrawings] = useState<Record<number, Stroke[]>>({});
  const [history, setHistory] = useState<Record<number, HistoryState>>({});

  const addStroke = useCallback((pageIndex: number, stroke: Stroke, addToHistory: boolean = true) => {
    if (stroke.points.length < 2) return;

    setDrawings(prev => {
      const currentStrokes = prev[pageIndex] || [];
      const nextStrokes = [...currentStrokes, stroke];
      
      if (addToHistory) {
        setHistory(h => {
          const pageHistory = h[pageIndex] || { past: [], future: [] };
          return {
            ...h,
            [pageIndex]: {
              past: [...pageHistory.past, currentStrokes], 
              future: [] 
            }
          };
        });
      }
      return { ...prev, [pageIndex]: nextStrokes };
    });
  }, []);

  const syncDrawings = useCallback((newDrawings: Record<number, Stroke[]>) => {
    setDrawings(newDrawings);
    setHistory({});
  }, []);

  const insertPage = useCallback((insertIndex: number) => {
    setDrawings(prev => {
      const next: Record<number, Stroke[]> = {};
      Object.keys(prev).forEach(keyStr => {
        const key = Number(keyStr);
        if (key < insertIndex) {
          next[key] = prev[key];
        } else {
          next[key + 1] = prev[key];
        }
      });
      next[insertIndex] = [];
      return next;
    });
    setHistory({});
  }, []);

  const deletePage = useCallback((deleteIndex: number) => {
     setDrawings(prev => {
      const next: Record<number, Stroke[]> = {};
      Object.keys(prev).forEach(keyStr => {
        const key = Number(keyStr);
        if (key < deleteIndex) {
          next[key] = prev[key];
        } else if (key > deleteIndex) {
          next[key - 1] = prev[key];
        }
      });
      return next;
    });
    setHistory({});
  }, []);

  const undo = useCallback((pageIndex: number) => {
    setHistory(h => {
      const pageHistory = h[pageIndex];
      if (!pageHistory || pageHistory.past.length === 0) return h;

      const current = drawings[pageIndex] || [];
      let previous = pageHistory.past[pageHistory.past.length - 1];
      let newPast = pageHistory.past.slice(0, -1);

      if (newPast.length > 0 && previous.length === current.length) {
          previous = newPast[newPast.length - 1];
          newPast = newPast.slice(0, -1);
      }

      setDrawings(d => ({ ...d, [pageIndex]: previous }));

      return {
        ...h,
        [pageIndex]: {
          past: newPast,
          future: [current, ...pageHistory.future]
        }
      };
    });
  }, [drawings]);

  const redo = useCallback((pageIndex: number) => {
    setHistory(h => {
      const pageHistory = h[pageIndex];
      if (!pageHistory || pageHistory.future.length === 0) return h;

      const current = drawings[pageIndex] || [];
      let next = pageHistory.future[0];
      let newFuture = pageHistory.future.slice(1);

      if (newFuture.length > 0 && next.length === current.length) {
          next = newFuture[0];
          newFuture = newFuture.slice(1);
      }

      setDrawings(d => ({ ...d, [pageIndex]: next }));

      return {
        ...h,
        [pageIndex]: {
          past: [...pageHistory.past, current],
          future: newFuture
        }
      };
    });
  }, [drawings]);

  const clear = useCallback((pageIndex: number) => {
    setDrawings(d => {
        const current = d[pageIndex] || [];
        if (current.length === 0) return d; 

        setHistory(h => {
            const pageHistory = h[pageIndex] || { past: [], future: [] };
            return {
                ...h,
                [pageIndex]: {
                    past: [...pageHistory.past, current],
                    future: []
                }
            };
        });
        
        return { ...d, [pageIndex]: [] };
    });
  }, []);

  return {
    drawings,
    addStroke,
    syncDrawings,
    insertPage,
    deletePage,
    undo,
    redo,
    clear,
    canUndo: (pageIndex: number) => (history[pageIndex]?.past.length || 0) > 0,
    canRedo: (pageIndex: number) => (history[pageIndex]?.future.length || 0) > 0,
  };
};