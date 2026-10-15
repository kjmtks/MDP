// An ink cue (ink.ts) on a rendered slide: its anchors found where they are now
// (focusTargets), the text its strokes should keep off, and the strokes themselves
// (inkGeometry). FocusLayer draws the result; the checks report it.
import type { FocusCue } from '../autoplay/autoplay';
import { inkAnchor, inkText } from './ink';
import { planInk, type InkEnd, type InkPlan } from './inkGeometry';
import { isHit, resolveTarget, textLines, type FocusBox, type FocusResolution } from './focusTargets';

export interface PlacedInk {
  cue: FocusCue;
  plan: InkPlan;
  /** Each anchor as written, and what it resolved to. */
  ends: { target: string; res: FocusResolution }[];
  /** An anchor is not on the slide: nothing is drawn. */
  missing: boolean;
  /** An anchor is not visible now (an unrevealed build): nothing is drawn. */
  hidden: boolean;
}

const NOTHING: InkPlan = { strokes: [], overlap: 0, off: false, problems: [] };

/** Plan one ink cue on the slide `root` (SlideView's wrapper). `obstacles`: the
 *  slide's text (textLines) when the caller already has it. */
export function placeInk(cue: FocusCue, root: HTMLElement, obstacles?: FocusBox[]): PlacedInk {
  const W = root.offsetWidth || 1;
  const H = root.offsetHeight || 1;
  const ends = cue.targets.map((target) => {
    const anchor = inkAnchor(target);
    return { target, anchor, res: resolveTarget(anchor.base, root) };
  });
  const missing = !ends.length || ends.some((e) => !isHit(e.res));
  const hidden = ends.some((e) => isHit(e.res) && !!e.res.hidden);
  const out = ends.map(({ target, res }) => ({ target, res }));
  if (missing || hidden) return { cue, plan: NOTHING, ends: out, missing, hidden };
  const inkEnds: InkEnd[] = ends.map(({ anchor, res }) => {
    const hit = res as Extract<FocusResolution, { box: FocusBox }>;
    const b = hit.box;
    const point = anchor.point ? { x: b.x + (b.w * anchor.point.x) / 100, y: b.y + (b.h * anchor.point.y) / 100 } : undefined;
    return { box: b, lines: hit.boxes, ...(point ? { point } : {}) };
  });
  const plan = planInk({
    shape: cue.style, ends: inkEnds, options: cue.options, W, H, u: H / 540,
    obstacles: obstacles ?? textLines(root), seed: inkText(cue),
  });
  return { cue, plan, ends: out, missing: false, hidden: false };
}
