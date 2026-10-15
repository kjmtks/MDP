import { useState, useCallback, useRef, useEffect } from 'react';
import type { AppMode } from '../../drawing/components/SlideControls';
import { choiceDialog } from '../../../components/error/errorReporter';
import { focusStepsAt, lineCues, posAfterChip, presentMarkers, pressEnd, pressStart, slideScript, stepsAt } from '../../autoplay/autoplay';
import { sendFocus } from '../../focus/focusBus';
import { mdpBus } from '../../bus/mdpBus';

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

  // How far → has gone on this slide: the script's markers done (presentMarkers —
  // its [[step]]s, focus cues and events, in order), then its extra builds.
  const [cuePos, setCuePos] = useState(0);
  const cuePosRef = useRef(0);
  useEffect(() => { cuePosRef.current = cuePos; }, [cuePos]);

  // Every slide change starts at step 0, however it came about — the editor's caret
  // moves the slide too, and the step the presenter left on the old slide must not
  // reveal the new slide's builds in the presenter / output windows.
  const [stepSlide, setStepSlide] = useState(currentSlideIndex);
  if (stepSlide !== currentSlideIndex) {
    setStepSlide(currentSlideIndex);
    if (step !== 0) setStep(0);
    if (cuePos !== 0) setCuePos(0);
  }

  const go = useCallback((pos: number, s: number) => {
    cuePosRef.current = pos; setCuePos(pos);
    stepRef.current = s; setStep(s);
  }, []);
  const markersOf = useCallback((i: number) => {
    const slide = slides[i];
    const stepCount = slide?.stepCount || 0;
    return { stepCount, ...presentMarkers(slideScript(slide?.raw || ''), stepCount) };
  }, [slides]);

  // → / ←. In a show, → goes through the slide's script in its order — each press
  // the next group of markers: its builds ([[step]]), the emphases written there
  // (focus cues, sent to every surface over the app bus), its events ([[emit]],
  // fired as their chips would — never waited for) — then the builds the script
  // never reveals, then the next slide; ← back one press (builds and emphases
  // rebuilt from the slide's start; an event is not taken back), then the previous
  // slide, fresh. `builds`: a show even though this window shows no slideshow — a
  // presentation given from the presenter view (or a remote device) with the
  // output window, while this one keeps the editor. Outside a show → just turns
  // the slide. `whole` (↑ / ↓): straight to the next / previous slide, fresh —
  // its builds, emphases and events skipped.
  const moveSlide = useCallback((direction: number, builds = false, whole = false) => {
    const inShow = (isSlideshowRef.current || builds) && !whole;
    const { stepCount, markers, extra } = inShow ? markersOf(currentSlideIndex) : { stepCount: 0, markers: [], extra: 0 };
    const p = cuePosRef.current;
    if (direction > 0) {
      if (inShow && p < markers.length + extra) {
        const q = pressEnd(markers, p);
        go(q, Math.max(stepRef.current, stepsAt(markers, q, stepCount)));
        const done = markers.slice(p, Math.min(q, markers.length));
        const cues = done.flatMap((m) => (m.kind === 'cue' && m.cue ? [m.cue] : []));
        if (cues.length) sendFocus({ slide: currentSlideIndex, cues: lineCues(cues) });
        for (const m of done) if (m.kind === 'event' && m.action?.topic) mdpBus.emit(m.action.topic, { args: m.action.args || [] });
        return;
      }
      if (inShow && stepRef.current < stepCount) { go(p, stepRef.current + 1); return; }
      let next = currentSlideIndex + 1;
      while (next < slides.length && slides[next].isHidden) next++;
      if (next < slides.length) { go(0, 0); setCurrentSlideIndex(next); }
    } else if (direction < 0) {
      if (inShow && p > 0) {
        const s = pressStart(markers, p);
        go(s, stepsAt(markers, s, stepCount));
        if (markers.slice(0, p).some((m) => m.kind === 'cue')) sendFocus({ slide: currentSlideIndex, replay: focusStepsAt(markers, s) });
        return;
      }
      if (inShow && stepRef.current > 0) { go(0, stepRef.current - 1); return; }
      // The previous slide starts fresh (no build, nothing pointed at) — the same
      // as arriving forward.
      let prev = currentSlideIndex - 1;
      while (prev >= 0 && slides[prev].isHidden) prev--;
      if (prev >= 0) { go(0, 0); setCurrentSlideIndex(prev); }
    }
  }, [currentSlideIndex, slides, setCurrentSlideIndex, go, markersOf]);

  /** A chip clicked in the presenter's script (its own emphasis / event already
   *  done there): → goes on right after it, and the builds up to it are shown (what
   *  it points at may be in one). `chip`: its place among the pane's chips. */
  const cueAt = useCallback((slide: number, chip: number) => {
    if (slide !== currentSlideIndex) return;
    const { stepCount, markers } = markersOf(currentSlideIndex);
    const pos = posAfterChip(markers, chip);
    go(pos, Math.max(stepRef.current, stepsAt(markers, pos, stepCount)));
  }, [currentSlideIndex, go, markersOf]);

  /** A build's own `auto:` timer: the next build only — no emphasis, never the next
   *  slide (the presenter's → stays where it was in the script). */
  const advanceBuild = useCallback(() => {
    const stepCount = slides[currentSlideIndex]?.stepCount || 0;
    if (stepRef.current < stepCount) { stepRef.current += 1; setStep(stepRef.current); }
  }, [currentSlideIndex, slides]);

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
    step, setStep, cuePos, cueAt,
    moveSlide, advanceBuild, toggleSlideshow
  };
};