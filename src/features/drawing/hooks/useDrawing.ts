import { useState, useCallback } from 'react';
import type { Stroke } from '../components/DrawingOverlay';

export const useDrawing = () => {
  const [drawings, setDrawings] = useState<Record<number, Stroke[]>>({});

  const [history, setHistory] = useState<Record<number, Stroke[][]>>({});
  const [historyStep, setHistoryStep] = useState<Record<number, number>>({});

  const syncDrawings = useCallback((data: Record<number, Stroke[]>) => {
    setDrawings(data);
  }, []);

  const saveHistory = useCallback((pageIndex: number, newStrokes: Stroke[]) => {
    setHistory(prev => {
      const pageHistory = prev[pageIndex] || [[]];
      const step = historyStep[pageIndex] ?? 0;

      const newHistory = [...pageHistory.slice(0, step + 1), newStrokes];
      return { ...prev, [pageIndex]: newHistory };
    });

    setHistoryStep(prev => ({ ...prev, [pageIndex]: (prev[pageIndex] ?? 0) + 1 }));
  }, [historyStep]);

  const addStroke = useCallback((pageIndex: number, stroke: Stroke, isLocal: boolean = true) => {
    setDrawings(prev => {
      const currentStrokes = prev[pageIndex] || [];
      const newStrokes = [...currentStrokes, stroke];

      if (isLocal) {
        saveHistory(pageIndex, newStrokes);
      }
      return { ...prev, [pageIndex]: newStrokes };
    });
  }, [saveHistory]);

  const updateStrokes = useCallback((pageIndex: number, indices: number[], dx: number, dy: number) => {
    setDrawings(prev => {
      const pageStrokes = [...(prev[pageIndex] || [])];

      indices.forEach(idx => {
        if (pageStrokes[idx]) {
          const movedPoints = pageStrokes[idx].points.map(p => ({ x: p.x + dx, y: p.y + dy }));
          pageStrokes[idx] = { ...pageStrokes[idx], points: movedPoints };
        }
      });

      saveHistory(pageIndex, pageStrokes);
      return { ...prev, [pageIndex]: pageStrokes };
    });
  }, [saveHistory]);

  const clear = useCallback((pageIndex: number) => {
    setDrawings(prev => {
      saveHistory(pageIndex, []);
      return { ...prev, [pageIndex]: [] };
    });
  }, [saveHistory]);

  const insertPage = useCallback((insertIndex: number) => {
    setDrawings(prev => {
      const next: Record<number, Stroke[]> = {};
      for (const key in prev) {
        const idx = parseInt(key, 10);
        if (idx >= insertIndex) {
          next[idx + 1] = prev[idx];
        } else {
          next[idx] = prev[idx];
        }
      }
      return next;
    });

    setHistory(prev => {
        const next: Record<number, Stroke[][]> = {};
        for (const key in prev) {
            const idx = parseInt(key, 10);
            if (idx >= insertIndex) next[idx + 1] = prev[idx];
            else next[idx] = prev[idx];
        }
        return next;
    });

    setHistoryStep(prev => {
        const next: Record<number, number> = {};
        for (const key in prev) {
            const idx = parseInt(key, 10);
            if (idx >= insertIndex) next[idx + 1] = prev[idx];
            else next[idx] = prev[idx];
        }
        return next;
    });
  }, []);

  const undo = useCallback((pageIndex: number) => {
    const step = historyStep[pageIndex] ?? 0;
    if (step > 0) {
      const newStep = step - 1;
      setHistoryStep(prev => ({ ...prev, [pageIndex]: newStep }));
      setDrawings(prev => ({
        ...prev,
        [pageIndex]: history[pageIndex][newStep]
      }));
    }
  }, [history, historyStep]);

  const redo = useCallback((pageIndex: number) => {
    const step = historyStep[pageIndex] ?? 0;
    const pageHistory = history[pageIndex] || [[]];
    if (step < pageHistory.length - 1) {
      const newStep = step + 1;
      setHistoryStep(prev => ({ ...prev, [pageIndex]: newStep }));
      setDrawings(prev => ({
        ...prev,
        [pageIndex]: pageHistory[newStep]
      }));
    }
  }, [history, historyStep]);

  const canUndo = useCallback((pageIndex: number) => {
    return (historyStep[pageIndex] ?? 0) > 0;
  }, [historyStep]);

  const canRedo = useCallback((pageIndex: number) => {
    const step = historyStep[pageIndex] ?? 0;
    const pageHistory = history[pageIndex] || [[]];
    return step < pageHistory.length - 1;
  }, [history, historyStep]);

  return {
    drawings,
    addStroke,
    updateStrokes,
    syncDrawings,
    insertPage,
    undo,
    redo,
    clear,
    canUndo,
    canRedo
  };
};