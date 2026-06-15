import React, { useLayoutEffect, useRef, useState } from 'react';
import type { MotionSpec } from '../parser/SlideContext';
import { getEffect } from '../../effects/effectManager';
import { resolveTiming } from '../../effects/effectRuntime';

interface RenderOpts {
  interactive: boolean;
  buildStep: number;
  onStepAutoAdvance?: () => void;
}

interface SlideEffectLayerProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  slides: any[];
  index: number;
  step: number;
  globalTransition?: MotionSpec;
  onStepAutoAdvance?: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  renderSlide: (slide: any, index: number, opts: RenderOpts) => React.ReactNode;
}

interface Tx {
  name: string;
  dir: 'forward' | 'back';
  durationMs: number;
  easing: string;
  fromIndex: number;
  key: number;
  active: boolean;
}

const frameStyle: React.CSSProperties = {
  position: 'absolute', inset: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

/**
 * Slideshow-only layer that plays slide transitions. The transition is fully
 * STATE-DRIVEN (declarative): the effect phase classes/attributes are rendered
 * from React state, so a parent re-render mid-animation can't wipe them (which
 * is what caused the flicker). The outgoing slide stays mounted until the
 * transition ends. In-slide builds are driven by SlideView via `buildStep`.
 *
 * Note: transitions use the CSS phase-class convention. (Build effects still
 * support JS hooks; transition JS hooks are not used by this declarative path.)
 */
export const SlideEffectLayer: React.FC<SlideEffectLayerProps> = ({
  slides, index, step, globalTransition, onStepAutoAdvance, renderSlide,
}) => {
  const [shownIndex, setShownIndex] = useState(index);
  const [tx, setTx] = useState<Tx | null>(null);
  const shownRef = useRef(index);
  const keyRef = useRef(0);

  const resolveSpec = (toIndex: number): MotionSpec | null => {
    const spec: MotionSpec | undefined = slides[toIndex]?.transition ?? globalTransition;
    if (!spec || spec.name === 'none' || !getEffect(spec.name)) return null;
    return spec;
  };

  // Detect a slide change and start (or skip) a transition — before paint.
  useLayoutEffect(() => {
    if (index === shownRef.current) return;
    const from = shownRef.current;
    const to = index;
    shownRef.current = to;

    const spec = resolveSpec(to);
    if (!spec) {
      setTx(null);
      setShownIndex(to);
      return;
    }
    const { duration, easing } = resolveTiming(spec.name, { duration: spec.args.duration, easing: spec.args.easing });
    keyRef.current += 1;
    setTx({
      name: spec.name,
      dir: to >= from ? 'forward' : 'back',
      durationMs: duration,
      easing,
      fromIndex: from,
      key: keyRef.current,
      active: false,
    });
    setShownIndex(to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // Flip to the active phase a frame after the initial phase has painted.
  useLayoutEffect(() => {
    if (!tx || tx.active) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => {
      setTx((cur) => (cur && cur.key === tx.key && !cur.active ? { ...cur, active: true } : cur));
    }));
    return () => cancelAnimationFrame(id);
  }, [tx]);

  // End the transition (drop the outgoing frame) after its duration.
  useLayoutEffect(() => {
    if (!tx || !tx.active) return;
    const t = window.setTimeout(() => {
      setTx((cur) => (cur && cur.key === tx.key ? null : cur));
    }, tx.durationMs + 80);
    return () => window.clearTimeout(t);
  }, [tx]);

  const phaseProps = (kind: 'enter' | 'leave'): React.HTMLAttributes<HTMLDivElement> => {
    if (!tx) return { style: frameStyle };
    return {
      className: `mdp-effect ${tx.name}`,
      'data-mdp-phase': tx.active ? `${kind}-active` : kind,
      'data-mdp-dir': tx.dir,
      style: {
        ...frameStyle,
        ['--mdp-fx-duration' as string]: `${tx.durationMs}ms`,
        ['--mdp-fx-easing' as string]: tx.easing,
      } as React.CSSProperties,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  };

  // Frames are keyed by SLIDE INDEX (not role): when the current slide becomes
  // the outgoing one during a transition it keeps the same key, so React reuses
  // its DOM node instead of re-mounting it (re-mounting flashed/flickered).
  const frames: { idx: number; role: 'enter' | 'leave' }[] =
    tx && tx.fromIndex !== shownIndex
      ? [{ idx: tx.fromIndex, role: 'leave' }, { idx: shownIndex, role: 'enter' }]
      : [{ idx: shownIndex, role: 'enter' }];

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      {frames.map((f) => (
        slides[f.idx] ? (
          <div key={`slide-${f.idx}`} {...(tx ? phaseProps(f.role) : { style: frameStyle })}>
            {renderSlide(slides[f.idx], f.idx, {
              interactive: f.role === 'enter',
              // Leave frame keeps the step it had on departure (forward = fully
              // built, back = none) so its reused node's builds don't re-animate.
              buildStep: f.role === 'enter'
                ? step
                : (tx && tx.dir === 'forward' ? (slides[f.idx].stepCount || 0) : 0),
              onStepAutoAdvance: f.role === 'enter' ? onStepAutoAdvance : undefined,
            })}
          </div>
        ) : null
      ))}
    </div>
  );
};
