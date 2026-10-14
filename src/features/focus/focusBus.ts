import { useEffect, useState } from 'react';
import { mdpBus } from '../bus/mdpBus';
import type { FocusCue } from '../autoplay/autoplay';
import { applyCues, cleanCue, isEmptyFocus, NO_FOCUS, removeCue, type FocusState } from './focusState';

// A presentation given by hand: the focus chips of the presenter's script pane
// (renderScriptChips) send their cue over the app bus (one hop over the sync
// channel) to every surface showing the slideshow — the main window's slideshow,
// the output window, the presenter's own current slide. Each applies it to the
// slide it shows (a cue for another slide is ignored); a new slide starts with
// none, as in the auto-play. A module may send cues the same way.
export const FOCUS_TOPIC = 'focus:cue';

/** `cues`: act as a narration line would (lineCues order); `remove`: take that one
 *  look / mark away (a chip clicked again); `replay`: start from nothing and act
 *  these steps in order (the presenter's Shift+Tab: the state before the last step,
 *  exact whatever was clicked in between — [] = nothing pointed at). */
export interface FocusCueEvent { slide: number; cues?: FocusCue[]; remove?: FocusCue; replay?: FocusCue[][] }

export const sendFocus = (ev: FocusCueEvent): void => mdpBus.emit(FOCUS_TOPIC, ev);

/** The focus the bus has set on `slideIndex` (null: none) — for a slideshow surface. */
export function useBusFocus(slideIndex: number): FocusState | null {
  const [state, setState] = useState({ slide: slideIndex, focus: NO_FOCUS });
  // A new slide starts with nothing pointed at.
  if (state.slide !== slideIndex) setState({ slide: slideIndex, focus: NO_FOCUS });
  useEffect(() => mdpBus.on(FOCUS_TOPIC, (p: FocusCueEvent) => {
    if (!p || p.slide !== slideIndex) return;
    const clean = (list: unknown): FocusCue[] => (Array.isArray(list) ? list.map(cleanCue).filter((c): c is FocusCue => !!c) : []);
    const cues = clean(p.cues);
    const remove = p.remove ? cleanCue(p.remove) : null;
    if (Array.isArray(p.replay)) {
      let focus = NO_FOCUS;
      for (const step of p.replay.slice(0, 200)) focus = applyCues(focus, clean(step));
      setState((s) => ({ slide: slideIndex, focus: { ...focus, seq: (s.focus.seq || 0) + 1 } }));
      return;
    }
    if (!cues.length && !remove) return;
    setState((s) => {
      let focus = s.slide === slideIndex ? s.focus : NO_FOCUS;
      if (remove) focus = removeCue(focus, remove);
      if (cues.length) focus = applyCues(focus, cues);
      return { slide: slideIndex, focus };
    });
  }), [slideIndex]);
  return state.slide === slideIndex && !isEmptyFocus(state.focus) ? state.focus : null;
}
