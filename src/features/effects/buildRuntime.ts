import { playEffect } from './effectRuntime';
import { resolveTiming } from './effectRuntime';

// Drives in-slide build elements (`.mdp-build` wrappers produced by the build
// processor) for a given build step. Used only in the slideshow.
//
// Visibility is class-based (`mdp-build-shown`) rather than inline style, so the
// default-hidden state is applied by CSS at render time (timing-independent) —
// the runtime only adds/removes `mdp-build-shown` and plays effects.

const SHOWN = 'mdp-build-shown';

interface BuildEl {
  el: HTMLElement;
  enter: number;
  emphasis?: number;
  exit?: number;
  effect: string;
  emphasisEffect: string;
  exitEffect: string;
  duration?: number;
  easing?: string;
  stagger: number;
  auto?: number;
}

const numAttr = (el: HTMLElement, name: string): number | undefined => {
  const v = el.getAttribute(name);
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
};

const readBuilds = (container: HTMLElement): BuildEl[] =>
  Array.from(container.querySelectorAll<HTMLElement>('.mdp-build')).map((el) => ({
    el,
    enter: numAttr(el, 'data-mdp-enter') ?? 1,
    emphasis: numAttr(el, 'data-mdp-emphasis'),
    exit: numAttr(el, 'data-mdp-exit'),
    effect: el.getAttribute('data-mdp-effect') || 'fade',
    emphasisEffect: el.getAttribute('data-mdp-emphasis-effect') || 'pulse',
    exitEffect: el.getAttribute('data-mdp-exit-effect') || el.getAttribute('data-mdp-effect') || 'fade',
    duration: numAttr(el, 'data-mdp-duration'),
    easing: el.getAttribute('data-mdp-easing') || undefined,
    stagger: numAttr(el, 'data-mdp-stagger') ?? 0,
    auto: numAttr(el, 'data-mdp-auto'),
  }));

const visibleAt = (b: BuildEl, step: number): boolean =>
  step >= b.enter && (b.exit == null || step < b.exit);

const setShown = (b: BuildEl, shown: boolean) => {
  b.el.classList.toggle(SHOWN, shown);
};

/** Snap all builds to their correct visibility for `step`, without animating. */
export const applyBuildStepInstant = (container: HTMLElement, step: number): void => {
  for (const b of readBuilds(container)) setShown(b, visibleAt(b, step));
};

/**
 * Transition builds from `prevStep` to `step`. Forward steps animate the builds
 * whose enter/emphasis/exit matches the new step (with optional stagger);
 * backward steps snap. Returns the auto-advance delay (ms) if any build that
 * entered at this step requests automatic advance, else null.
 */
export const applyBuildStep = (
  container: HTMLElement,
  step: number,
  prevStep: number,
): { autoAdvanceMs: number | null } => {
  const builds = readBuilds(container);
  const forward = step > prevStep;
  let staggerIndex = 0;
  let autoAdvanceMs: number | null = null;

  for (const b of builds) {
    if (!forward) {
      setShown(b, visibleAt(b, step));
      continue;
    }

    const opts = { duration: b.duration, easing: b.easing, direction: 'forward' as const };

    if (b.enter === step) {
      const delay = b.stagger ? staggerIndex * b.stagger : 0;
      staggerIndex++;
      const run = () => { setShown(b, true); playEffect(b.el, b.effect, 'enter', opts); };
      if (delay) window.setTimeout(run, delay); else run();

      if (b.auto != null) {
        const { duration } = resolveTiming(b.effect, { duration: b.duration, easing: b.easing });
        const total = delay + duration + b.auto;
        if (autoAdvanceMs == null || total > autoAdvanceMs) autoAdvanceMs = total;
      }
    } else if (b.emphasis === step) {
      const delay = b.stagger ? staggerIndex * b.stagger : 0;
      staggerIndex++;
      setShown(b, true);
      const run = () => playEffect(b.el, b.emphasisEffect, 'emphasis', opts);
      if (delay) window.setTimeout(run, delay); else run();
    } else if (b.exit === step) {
      const delay = b.stagger ? staggerIndex * b.stagger : 0;
      staggerIndex++;
      const run = () => playEffect(b.el, b.exitEffect, 'leave', opts).then(() => setShown(b, false));
      if (delay) window.setTimeout(run, delay); else run();
    } else {
      setShown(b, visibleAt(b, step));
    }
  }

  return { autoAdvanceMs };
};
