import { getEffect, getEffectHooks, effectParamDefault } from './effectManager';

export type EffectPhase = 'enter' | 'leave' | 'emphasis';

export interface PlayOptions {
  duration?: number;
  easing?: string;
  direction?: 'forward' | 'back';
  args?: Record<string, string>;
}

// Resolve duration (ms) / easing from per-call overrides, then the effect's
// declared parameter defaults, then hard fallbacks.
export const resolveTiming = (
  name: string,
  overrides?: { duration?: string | number; easing?: string },
): { duration: number; easing: string } => {
  const dRaw = overrides?.duration ?? effectParamDefault(name, 'duration') ?? 400;
  const duration = Number(dRaw) || 400;
  const easing = String(overrides?.easing ?? effectParamDefault(name, 'easing') ?? 'ease');
  return { duration, easing };
};

/**
 * Play a single effect phase on an element and resolve when it finishes.
 * Uses the effect's JS hook for the phase if present, otherwise the CSS
 * phase-class convention (`.mdp-effect.<name>[data-mdp-phase="enter"]` …).
 *
 * The caller is responsible for the element's final resting visibility (e.g.
 * hiding it after a `leave`); playEffect only animates and then cleans up the
 * classes/attributes/vars it added.
 */
export const playEffect = (
  el: HTMLElement,
  name: string,
  phase: EffectPhase,
  opts: PlayOptions = {},
): Promise<void> => {
  if (!el) return Promise.resolve();
  const fx = getEffect(name);
  if (!fx || name === 'none') return Promise.resolve();

  const { duration, easing } = resolveTiming(name, { duration: opts.duration, easing: opts.easing });
  const direction = opts.direction || 'forward';
  const ctx = { duration, easing, direction, args: opts.args || {} };

  const hook = getEffectHooks(name)?.[phase];
  if (hook) {
    try {
      return Promise.resolve(hook(el, ctx)).then(() => undefined, () => undefined);
    } catch (e) {
      console.error(`[MDP] Effect hook error (${name}.${phase}):`, e);
      return Promise.resolve();
    }
  }

  return new Promise<void>((resolve) => {
    el.classList.add('mdp-effect', name);
    el.style.setProperty('--mdp-fx-duration', `${duration}ms`);
    el.style.setProperty('--mdp-fx-easing', easing);
    el.setAttribute('data-mdp-dir', direction);
    el.setAttribute('data-mdp-phase', phase);

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.removeEventListener('transitionend', onEnd);
      el.classList.remove('mdp-effect', name);
      el.removeAttribute('data-mdp-phase');
      el.removeAttribute('data-mdp-dir');
      el.style.removeProperty('--mdp-fx-duration');
      el.style.removeProperty('--mdp-fx-easing');
      resolve();
    };
    const onEnd = (e: TransitionEvent) => { if (e.target === el) finish(); };
    el.addEventListener('transitionend', onEnd);

    // Apply the active phase on the next frames so the initial phase paints first.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.setAttribute('data-mdp-phase', `${phase}-active`);
    }));

    // Fallback for keyframe-based or no-op effects where transitionend never fires.
    window.setTimeout(finish, duration + 80);
  });
};
