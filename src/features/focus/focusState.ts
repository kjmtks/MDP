// What a slide is pointing at, as its narration goes on (the focus cues of
// autoplay.ts). Pure, so every surface — the auto-play, the video export, the
// slideshow a presenter drives with chips — computes the same thing.
//
//   look  — the one moving attention: a line's looks REPLACE the previous ones (all
//           of a line's looks show together; the line is the unit of time);
//   mark  — stays, like chalk on a board, until a clear or the next slide;
//   clear — [[clear]] takes everything away, [[clear: TARGET]] that target.
import type { FocusCue } from '../autoplay/autoplay';

export interface FocusState {
  looks: FocusCue[];
  marks: FocusCue[];
  /** Bumped by every change (a repeated look restarts its animation). */
  seq: number;
}

export const NO_FOCUS: FocusState = { looks: [], marks: [], seq: 0 };

const sameCue = (a: FocusCue, b: FocusCue): boolean =>
  a.kind === b.kind && a.style === b.style && a.targets.join('\u0001') === b.targets.join('\u0001')
  && JSON.stringify(a.options) === JSON.stringify(b.options);

/** `cue` without `target` — the cue goes when nothing is left. */
const without = (cues: FocusCue[], target: string): FocusCue[] => cues
  .map((c) => (c.targets.includes(target) ? { ...c, targets: c.targets.filter((t) => t !== target) } : c))
  .filter((c) => c.targets.length > 0);

/** The state after a line's cues (in lineCues order: its clears, then its emphases). */
export function applyCues(state: FocusState, cues: readonly FocusCue[] | undefined): FocusState {
  if (!cues || !cues.length) return state;
  let { looks, marks } = state;
  const lineLooks: FocusCue[] = [];
  for (const c of cues) {
    if (c.kind === 'clear') {
      if (!c.targets.length) { looks = []; marks = []; continue; }
      for (const t of c.targets) { looks = without(looks, t); marks = without(marks, t); }
    } else if (c.kind === 'look') {
      if (!lineLooks.some((l) => sameCue(l, c))) lineLooks.push(c);
    } else if (!marks.some((m) => sameCue(m, c))) {
      marks = [...marks, c];      // a mark already there stays (a replayed line adds nothing)
    }
  }
  if (lineLooks.length) looks = lineLooks;
  return { looks, marks, seq: state.seq + 1 };
}

/** Whether this look / mark is shown now (a presenter's chip toggles it). */
export const cueInForce = (state: FocusState, cue: FocusCue): boolean =>
  (cue.kind === 'look' ? state.looks : cue.kind === 'mark' ? state.marks : []).some((c) => sameCue(c, cue));

/** The state without this one look / mark (other cues on the same target stay). */
export function removeCue(state: FocusState, cue: FocusCue): FocusState {
  const keep = (list: FocusCue[]) => list.filter((c) => !sameCue(c, cue));
  return { looks: keep(state.looks), marks: keep(state.marks), seq: state.seq + 1 };
}

/** A cue that came from outside (the app bus): only the known shape, or nothing. */
export function cleanCue(raw: unknown): FocusCue | null {
  const c = raw as Partial<FocusCue> | null;
  if (!c || typeof c !== 'object' || !['look', 'mark', 'clear'].includes(c.kind as string)) return null;
  const targets = Array.isArray(c.targets) ? c.targets.filter((t): t is string => typeof t === 'string').slice(0, 20) : [];
  const options: Record<string, string> = {};
  if (c.options && typeof c.options === 'object') {
    for (const [k, v] of Object.entries(c.options)) if (typeof v === 'string' && /^[A-Za-z][\w-]{0,30}$/.test(k)) options[k] = v;
  }
  return { kind: c.kind as FocusCue['kind'], targets, style: typeof c.style === 'string' ? c.style : '', options };
}

/** A short fingerprint of what is shown (the video's capture key). */
export const focusSignature = (s: FocusState | null | undefined): string => (s && (s.looks.length || s.marks.length)
  ? JSON.stringify([s.looks, s.marks].map((list) => list.map((c) => [c.kind, c.targets, c.style, c.options])))
  : '');

export const isEmptyFocus = (s: FocusState | null | undefined): boolean => !s || (!s.looks.length && !s.marks.length);
