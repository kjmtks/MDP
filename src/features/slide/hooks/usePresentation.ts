import { useState, useCallback, useRef, useEffect } from 'react';
import type { AppMode } from '../../drawing/components/SlideControls';
import { choiceDialog } from '../../../components/error/errorReporter';

interface DisplayInfo {
  id: number; label: string; width: number; height: number;
  primary: boolean; current: boolean;
}

// Electron only: which display should host the slideshow? The show is an
// HTML-fullscreen overlay in the main window, so it lands on the window's
// display — asking up front (and moving the window there) means a laptop +
// HDMI dummy plug can keep the presenter tool on the visible screen while the
// shared show runs on the dummy display. Resolves to:
//   null      — user cancelled; don't start the show.
//   'stay'    — nothing to pick (web build, one display, or the picker failed).
//   'moved'   — window parked on the chosen display; restore when the show ends.
const pickSlideshowDisplay = async (): Promise<null | 'stay' | 'moved'> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = (window as any).electronAPI;
  if (!api?.getDisplays) return 'stay';
  let displays: DisplayInfo[];
  try { displays = await api.getDisplays(); } catch { return 'stay'; }
  if (!Array.isArray(displays) || displays.length < 2) return 'stay';

  const last = localStorage.getItem('mdp_slideshow_display');
  const options = displays.map((d) => {
    const notes = [d.primary && 'primary', d.current && 'current'].filter(Boolean).join(', ');
    return {
      value: String(d.id),
      label: `${d.label} — ${d.width}×${d.height}${notes ? ` (${notes})` : ''}`,
      variant: (last ? String(d.id) === last : d.current) ? 'contained' as const : 'outlined' as const,
    };
  });
  const choice = await choiceDialog('Which display should show the slideshow?', {
    title: 'Start Slideshow', options,
  });
  if (choice === null) return null;
  localStorage.setItem('mdp_slideshow_display', choice);
  try {
    const res = await api.moveToDisplay(Number(choice));
    return res?.moved ? 'moved' : 'stay';
  } catch { return 'stay'; }
};

export const usePresentation = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  slides: any[],
  currentSlideIndex: number,
  setCurrentSlideIndex: (idx: number | ((prev: number) => number)) => void
) => {
  const [isSlideshow, setIsSlideshow] = useState(false);
  const [isSlideOverview, setIsSlideOverview] = useState(false);
  const [mode, setMode] = useState<AppMode>('view');

  // In-slide build step (only meaningful during the slideshow). 0 = nothing
  // built yet beyond the slide's base content.
  const [step, setStep] = useState(0);
  const stepRef = useRef(0);
  useEffect(() => { stepRef.current = step; }, [step]);
  const isSlideshowRef = useRef(isSlideshow);
  useEffect(() => { isSlideshowRef.current = isSlideshow; }, [isSlideshow]);

  const [isTouchDevice] = useState<boolean>(() => {
    if (typeof navigator !== 'undefined') return navigator.maxTouchPoints > 0;
    return false;
  });

  const [showControls, setShowControls] = useState<boolean>(() => {
    if (typeof navigator !== 'undefined') return navigator.maxTouchPoints > 0;
    return false;
  });

  const slideshowRef = useRef<HTMLDivElement>(null);

  const moveSlide = useCallback((direction: number) => {
    const inShow = isSlideshowRef.current;
    if (direction > 0) {
      // Advance: consume in-slide build steps first, then move to the next slide.
      const stepCount = inShow ? (slides[currentSlideIndex]?.stepCount || 0) : 0;
      if (stepRef.current < stepCount) { setStep(stepRef.current + 1); return; }
      let next = currentSlideIndex + 1;
      while (next < slides.length && slides[next].isHidden) next++;
      if (next < slides.length) { setStep(0); setCurrentSlideIndex(next); }
    } else if (direction < 0) {
      // Retreat: step back through builds within the slide; once at 0, move to
      // the previous slide and start it fresh (all builds hidden, step 0) — the
      // same as arriving forward. Every slide change starts at step 0.
      if (inShow && stepRef.current > 0) { setStep(stepRef.current - 1); return; }
      let prev = currentSlideIndex - 1;
      while (prev >= 0 && slides[prev].isHidden) prev--;
      if (prev >= 0) {
        setStep(0);
        setCurrentSlideIndex(prev);
      }
    }
  }, [currentSlideIndex, slides, setCurrentSlideIndex]);

  const toggleSlideOverview = useCallback(() => {
    setIsSlideOverview(prev => !prev);
  }, []);

  // True while the main window has been parked on a picked display for the
  // running show; the effect below puts it back once the show ends, whatever
  // ended it (Esc, the close button, a fullscreen error).
  const movedForShowRef = useRef(false);
  useEffect(() => {
    if (!isSlideshow && movedForShowRef.current) {
      movedForShowRef.current = false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).electronAPI?.restoreWindowPlacement?.().catch(() => {});
    }
  }, [isSlideshow]);

  const toggleSlideshow = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
      setMode('view');
      return;
    }
    const start = async () => {
      const placement = await pickSlideshowDisplay();
      if (placement === null) return;   // cancelled from the display picker
      movedForShowRef.current = placement === 'moved';

      setIsSlideshow(true);
      setMode('view');
      setShowControls(isTouchDevice);
      setStep(0);

      if (slides[currentSlideIndex]?.isHidden) {
        let nextIndex = currentSlideIndex + 1;
        while (nextIndex < slides.length && slides[nextIndex].isHidden) {
          nextIndex++;
        }
        if (nextIndex < slides.length) setCurrentSlideIndex(nextIndex);
      }

      // After a cross-display move, give the OS a beat to settle the window
      // before fullscreening, or the show can land on the old display.
      setTimeout(() => {
        slideshowRef.current?.requestFullscreen().catch(err => {
          console.error(`Error attempting to enable full-screen mode: ${err.message}`);
          setIsSlideshow(false);
        });
      }, placement === 'moved' ? 150 : 10);
    };
    void start();
  }, [currentSlideIndex, slides, isTouchDevice, setIsSlideshow, setMode, setShowControls, setCurrentSlideIndex]);

  return {
    currentSlideIndex, setCurrentSlideIndex,
    isSlideshow, setIsSlideshow, slideshowRef,
    isSlideOverview, setIsSlideOverview, toggleSlideOverview,
    mode, setMode,
    showControls, setShowControls,
    isTouchDevice,
    step, setStep,
    moveSlide, toggleSlideshow
  };
};