import { useEffect, useRef } from 'react';
import type { AppMode } from '../features/drawing/components/SlideControls';
import type { SyncMessage } from '../features/remote/hooks/useSync';

export const useShortcuts = (
  isSlideshow: boolean, setIsSlideshow: (val: boolean) => void,
  mode: AppMode, setMode: React.Dispatch<React.SetStateAction<AppMode>>,
  showControls: boolean, setShowControls: React.Dispatch<React.SetStateAction<boolean>>,
  currentSlideIndex: number, moveSlide: (dir: number) => void,
  undo: (pageIndex: number) => void, redo: (pageIndex: number) => void, clear: (pageIndex: number) => void,
  handleAddBlankSlide: (pageIndex: number) => void, send: (msg: SyncMessage) => void, channelId: string
) => {
  const lastWheelTime = useRef(0);

  useEffect(() => {
    const handleFullscreenChange = () => { if (!document.fullscreenElement) setIsSlideshow(false); };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [setIsSlideshow]);

  useEffect(() => {
    if (!isSlideshow) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'p') setShowControls(prev => !prev);
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); undo(currentSlideIndex); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'y') { e.preventDefault(); redo(currentSlideIndex); }
      if (showControls) {
          if (e.key === 'c') { clear(currentSlideIndex); send({ type: 'CLEAR_DRAWING', channelId, pageIndex: currentSlideIndex }); }
          if (e.key === 'n') handleAddBlankSlide(currentSlideIndex);
      }
      if (['ArrowRight', 'ArrowDown', ' ', 'Enter', 'PageDown'].includes(e.key)) { e.preventDefault(); moveSlide(1); }
      else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); moveSlide(-1); }
    };
    const handleWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('.cm-editor')) return;
      const now = Date.now();
      if (now - lastWheelTime.current < 10) return;
      if (e.deltaY > 0) { lastWheelTime.current = now; moveSlide(1); }
      else if (e.deltaY < 0) { lastWheelTime.current = now; moveSlide(-1); }
    };
    const handleClick = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('.slide-controls-container')) return;
      if (e.button === 0 && mode === 'view') { moveSlide(1); }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('wheel', handleWheel);
    window.addEventListener('mousedown', handleClick);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('mousedown', handleClick);
    };
  }, [isSlideshow, moveSlide, undo, redo, currentSlideIndex, mode, clear, send, channelId, handleAddBlankSlide, showControls, setShowControls]);

  useEffect(() => {
    if (isSlideshow) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      if (e.key === 'p') {
          setShowControls(prev => !prev);
          setMode(prev => prev === 'pen' ? 'view' : 'pen');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSlideshow, setMode, setShowControls]);
};