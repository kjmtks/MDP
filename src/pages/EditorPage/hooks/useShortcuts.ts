import { useEffect, useRef } from 'react';
import type { AppMode } from '../../../features/drawing/components/SlideControls';
import type { SyncMessage } from '../../../features/remote/hooks/useSync';
import { useAppSettings } from '../../../features/settings/AppSettingsContext';
import { matchAction } from '../../../features/settings/shortcuts/matcher';
import { ACTIONS_BY_SCOPE, actionById } from '../../../features/settings/shortcuts/registry';

export const useShortcuts = (
  isSlideshow: boolean, setIsSlideshow: (val: boolean) => void,
  mode: AppMode, setMode: React.Dispatch<React.SetStateAction<AppMode>>,
  showControls: boolean, setShowControls: React.Dispatch<React.SetStateAction<boolean>>,
  currentSlideIndex: number, moveSlide: (dir: number) => void,
  undo: (pageIndex: number) => void, redo: (pageIndex: number) => void, clear: (pageIndex: number) => void,
  handleAddBlankSlide: (pageIndex: number) => void, send: (msg: SyncMessage) => void, channelId: string
) => {
  const { settings } = useAppSettings();
  const lastWheelTime = useRef(0);

  useEffect(() => {
    const handleFullscreenChange = () => { if (!document.fullscreenElement) setIsSlideshow(false); };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [setIsSlideshow]);

  useEffect(() => {
    if (!isSlideshow) return;
    // True when the event originates inside an interactive module region, where
    // navigation must be suppressed so the interaction isn't a page turn.
    const inInteractive = (e: Event) => !!(e.target as HTMLElement | null)?.closest?.('.mdp-interactive');

    const handleKeyDown = (e: KeyboardEvent) => {
      const action = matchAction(e, ACTIONS_BY_SCOPE.slideshow, settings);
      switch (action?.id) {
        case 'slideshow.toggleControls': setShowControls(prev => !prev); break;
        case 'slideshow.undo': e.preventDefault(); undo(currentSlideIndex); break;
        case 'slideshow.redo': e.preventDefault(); redo(currentSlideIndex); break;
        case 'slideshow.clear':
          if (showControls) { clear(currentSlideIndex); send({ type: 'CLEAR_DRAWING', channelId, pageIndex: currentSlideIndex }); }
          break;
        case 'slideshow.addSlide':
          if (showControls) handleAddBlankSlide(currentSlideIndex);
          break;
        case 'slideshow.next':
          if (!inInteractive(e)) { e.preventDefault(); moveSlide(1); }
          break;
        case 'slideshow.prev':
          if (!inInteractive(e)) { e.preventDefault(); moveSlide(-1); }
          break;
      }
    };
    const handleWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('.cm-editor') || inInteractive(e)) return;
      const now = Date.now();
      if (now - lastWheelTime.current < 10) return;
      if (e.deltaY > 0) { lastWheelTime.current = now; moveSlide(1); }
      else if (e.deltaY < 0) { lastWheelTime.current = now; moveSlide(-1); }
    };
    const handleClick = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('.slide-controls-container') || inInteractive(e)) return;
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
  }, [isSlideshow, moveSlide, undo, redo, currentSlideIndex, mode, clear, send, channelId, handleAddBlankSlide, showControls, setShowControls, settings]);

  useEffect(() => {
    if (isSlideshow) return;
    const penToggle = actionById('global.previewPenToggle');
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      if (penToggle && matchAction(e, [penToggle], settings)) {
        setShowControls(prev => !prev);
        setMode(prev => prev === 'pen' ? 'view' : 'pen');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSlideshow, setMode, setShowControls, settings]);
};
