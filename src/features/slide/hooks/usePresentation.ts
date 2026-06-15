import { useState, useCallback, useRef, useEffect } from 'react';
import type { AppMode } from '../../drawing/components/SlideControls';

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

  const toggleSlideshow = useCallback(() => {
    if (!document.fullscreenElement) {
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

      setTimeout(() => {
        slideshowRef.current?.requestFullscreen().catch(err => {
          console.error(`Error attempting to enable full-screen mode: ${err.message}`);
          setIsSlideshow(false);
        });
      }, 10);
    } else {
      document.exitFullscreen();
      setMode('view');
    }
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