// How a focus cue looks (FocusLayer draws them).
import type { FocusCue } from '../autoplay/autoplay';

/** The editor preview's target marks: every cue of the slide, numbered. */
export interface FocusOutlineItem { n: number; cue: FocusCue }

export const FOCUS_STYLES = ['pointer', 'ring', 'arrow', 'marker', 'underline', 'circle', 'box', 'spotlight', 'blur'] as const;
export type FocusStyle = typeof FOCUS_STYLES[number];

/** A cue's style, or the default for its kind (look: pointer, mark: marker). */
export const styleOf = (c: FocusCue): FocusStyle =>
  ((FOCUS_STYLES as readonly string[]).includes(c.style) ? c.style : c.kind === 'mark' ? 'marker' : 'pointer') as FocusStyle;
