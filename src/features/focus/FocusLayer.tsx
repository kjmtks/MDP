import React, { useCallback, useEffect, useState } from 'react';
import type { FocusCue } from '../autoplay/autoplay';
import type { FocusState } from './focusState';
import { isHit, resolveTarget, type FocusBox, type FocusHit } from './focusTargets';
import { styleOf, type FocusOutlineItem, type FocusStyle } from './focusStyles';
import { registerFocusLayer } from './focusSettle';
import './FocusLayer.css';

interface Placed { cue: FocusCue; style: FocusStyle; hits: FocusHit[] }
interface Geometry {
  W: number; H: number;
  looks: Placed[];
  marks: Placed[];
  outline: { n: number; cue: FocusCue; hits: FocusHit[] }[];
  misses: { n: number; target: string; error: string }[];
}

// What is not visible now (a build step still to come) is not pointed at.
const place = (cue: FocusCue, root: HTMLElement): Placed => ({
  cue, style: styleOf(cue), hits: cue.targets.map((t) => resolveTarget(t, root)).filter(isHit).filter((h) => !h.hidden),
});

// A cue's color=… — a colour, nothing else (it lands in CSS).
const COLOR = /^(#[0-9a-f]{3,8}|[a-z]{3,20}|(?:rgb|rgba|hsl|hsla)\([\d\s.,%/]+\))$/i;

// Over a slide (inside SlideView's wrapper): the focus cues in force — the moving
// attention (looks) and what stays marked (marks) — or, in the editor preview, every
// cue's target outlined and numbered. Never touches the slide's own layout; places
// itself by measuring the rendered slide (focusTargets), again whenever the slide
// changes (a build step, fonts, a module redrawing, a resize).
export const FocusLayer: React.FC<{
  root: HTMLElement | null;
  content: HTMLElement | null;
  focus?: FocusState | null;
  outline?: FocusOutlineItem[] | null;
  /** false: a still picture — the end state at once (video frames, MCP renders). */
  animate?: boolean;
}> = ({ root, content, focus, outline, animate = true }) => {
  const [geo, setGeo] = useState<Geometry | null>(null);

  const measure = useCallback(() => {
    if (!root) return;
    const W = root.offsetWidth;
    const H = root.offsetHeight;
    const outlined = (outline || []).map(({ n, cue }) => {
      const res = cue.targets.map((t) => ({ t, r: resolveTarget(t, root) }));
      return { n, cue, hits: res.map((x) => x.r).filter(isHit), misses: res.filter((x) => !isHit(x.r)).map((x) => ({ n, target: x.t, error: (x.r as { error: string }).error })) };
    });
    setGeo({
      W, H,
      looks: (focus?.looks || []).map((c) => place(c, root)),
      marks: (focus?.marks || []).map((c) => place(c, root)),
      outline: outlined.map(({ n, cue, hits }) => ({ n, cue, hits })),
      misses: outlined.flatMap((o) => o.misses),
    });
  }, [root, focus, outline]);

  // Measure once the slide has painted, and again when it changes.
  useEffect(() => {
    if (!root) return undefined;
    let timer = 0;
    const soon = () => { if (!timer) timer = window.setTimeout(() => { timer = 0; measure(); }, 120); };
    const frame = requestAnimationFrame(() => measure());
    const late = window.setTimeout(measure, 450);          // a build's entrance, KaTeX, inline SVGs
    const ro = new ResizeObserver(soon);
    ro.observe(root);
    if (content) ro.observe(content);
    const mo = content ? new MutationObserver(soon) : null;
    mo?.observe(content!, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'data-mdp-phase', 'hidden'] });
    document.fonts?.addEventListener?.('loadingdone', soon);
    window.addEventListener('resize', soon);
    const unregister = registerFocusLayer(root, measure);
    return () => {
      unregister();
      cancelAnimationFrame(frame);
      window.clearTimeout(late);
      if (timer) window.clearTimeout(timer);
      ro.disconnect();
      mo?.disconnect();
      document.fonts?.removeEventListener?.('loadingdone', soon);
      window.removeEventListener('resize', soon);
    };
  }, [root, content, measure]);

  if (!geo) return null;
  const { W, H } = geo;
  const u = H / 540;
  const colorOf = (c: FocusCue, fallback: string) => (COLOR.test(c.options.color || '') ? c.options.color : fallback);
  // The moving attention (look) is red; the annotations that stay (mark) are a pen
  // of another colour, so a mark is never taken for a look where they meet (an
  // underline under a boxed row) — and the highlighter is yellow.
  const stroke = 'var(--mdp-focus-color, #e53935)';
  const pen = 'var(--mdp-focus-pen, #ef6c00)';
  const markerColor = 'var(--mdp-focus-marker, rgba(255, 214, 0, .55))';
  const items: React.ReactNode[] = [];
  const holes: { box: FocusBox; spot: boolean }[] = [];

  const draw = (p: Placed, key: string, moving: boolean) => {
    const c = colorOf(p.cue, p.style === 'marker' ? markerColor : p.style === 'pointer' ? 'var(--mdp-focus-color, #ff2d2d)'
      : p.style === 'underline' || p.style === 'circle' ? pen : stroke);
    const vars = { '--c': c } as React.CSSProperties;
    p.hits.forEach((h, i) => {
      // A look that moves keeps its element (it slides to the new place); the rest
      // are drawn anew where they land.
      const k = moving && ['pointer', 'ring', 'arrow', 'box'].includes(p.style) ? `${key}-${i}` : `${key}-${i}-${h.box.x | 0}-${h.box.y | 0}-${p.cue.targets[i] ?? ''}`;
      const b = h.box;
      const first = h.boxes[0];
      const ax = h.kind === 'area' ? b.x + b.w / 2 : first.x;
      const ay = h.kind === 'area' ? b.y + b.h / 2 : first.y + first.h / 2;
      switch (p.style) {
        case 'pointer': {
          const d = 14 * u;
          const x = h.kind === 'area' ? ax - d / 2 : ax - d * 1.25;
          items.push(<div key={k} className="mdp-focus-pointer" style={{ ...vars, left: x, top: ay - d / 2, width: d, height: d }} />);
          break;
        }
        case 'ring': case 'box':
          // On the target itself; the frame around it, and how far out, is the
          // stylesheet's (a theme's) — a phrase among other words gets less room.
          items.push(<div key={k} className={`mdp-focus-${p.style}${h.kind === 'text' ? ' mdp-focus-inline' : ''}`} style={{ ...vars, left: b.x, top: b.y, width: b.w, height: b.h }} />);
          break;
        case 'arrow': {
          const tipX = (h.kind === 'area' ? b.x : ax) - 5 * u;
          const tipY = h.kind === 'area' ? b.y + b.h / 2 : ay;
          // The tail sits up-left of the tip: a target near the slide's left edge (a
          // bullet) gets a shorter arrow, so the tail is not cut off by the edge.
          const w = Math.max(28 * u, Math.min(74 * u, tipX - 4 * u));
          const hgt = 44 * u;
          items.push(
            <svg key={k} className="mdp-focus-arrow" width={w} height={hgt} viewBox={`0 0 ${w} ${hgt}`} style={{ ...vars, left: tipX - w, top: tipY - hgt }}>
              <path d={`M ${3 * u} ${3 * u} Q ${w * 0.55} ${3 * u} ${w - 2 * u} ${hgt - 2 * u}`} fill="none" stroke={c} strokeLinecap="round" />
              <path d={`M ${w - 2 * u} ${hgt - 2 * u} l ${-13 * u} ${-3 * u} M ${w - 2 * u} ${hgt - 2 * u} l ${-1 * u} ${-13 * u}`} fill="none" stroke={c} strokeLinecap="round" />
            </svg>,
          );
          break;
        }
        case 'marker':
          h.boxes.forEach((l, j) => items.push(
            <div key={`${k}-${j}`} className="mdp-focus-marker" style={{ ...vars, left: l.x - 2 * u, top: l.y + l.h * 0.1, width: l.w + 4 * u, height: l.h * 0.84, animationDelay: animate ? `${j * 0.3}s` : undefined }} />,
          ));
          break;
        case 'underline':
          h.boxes.forEach((l, j) => items.push(
            <div key={`${k}-${j}`} className="mdp-focus-underline" style={{ ...vars, left: l.x, top: l.y + l.h, width: l.w, animationDelay: animate ? `${j * 0.25}s` : undefined }} />,
          ));
          break;
        case 'circle': {
          const pad = 9 * u;
          const w = b.w + 2 * pad;
          const hgt = b.h + 2 * pad;
          // A hand-drawn loop: once round the ellipse and 20° past its start, the
          // second half a little wider — as a pen would.
          const cx = w / 2;
          const cy = hgt / 2;
          const rx = cx - 2 * u;
          const ry = cy - 2 * u;
          const at = (deg: number, kx = 1, ky = 1) => {
            const t = (deg * Math.PI) / 180;
            return `${cx + rx * kx * Math.cos(t)} ${cy + ry * ky * Math.sin(t)}`;
          };
          const path = `M ${at(-35)} A ${rx} ${ry} 0 0 1 ${at(145)} A ${rx * 1.04} ${ry * 1.06} 0 1 1 ${at(-15, 1.04, 1.06)}`;
          items.push(
            <svg key={k} className="mdp-focus-circle" width={w} height={hgt} viewBox={`0 0 ${w} ${hgt}`} style={{ ...vars, left: b.x - pad, top: b.y - pad, transform: 'rotate(-2deg)' }}>
              <path d={path} pathLength={1} fill="none" stroke={c} strokeLinecap="round" />
            </svg>,
          );
          break;
        }
        case 'spotlight': case 'blur':
          holes.push({ box: b, spot: p.style === 'spotlight' });
          break;
      }
    });
  };

  geo.marks.forEach((p, i) => draw(p, `mark-${i}`, false));
  geo.looks.forEach((p, i) => draw(p, `look-${p.style}-${i}`, true));

  // Dimming / blurring everything but the holes: one layer each.
  const holePath = (list: FocusBox[], pad: number) => {
    const r = 8 * u;
    return list.map((b) => {
      const x = b.x - pad; const y = b.y - pad; const w = b.w + 2 * pad; const h = b.h + 2 * pad;
      return `M ${x + r} ${y} H ${x + w - r} Q ${x + w} ${y} ${x + w} ${y + r} V ${y + h - r} Q ${x + w} ${y + h} ${x + w - r} ${y + h} H ${x + r} Q ${x} ${y + h} ${x} ${y + h - r} V ${y + r} Q ${x} ${y} ${x + r} ${y} Z`;
    }).join(' ');
  };
  const spots = holes.filter((h) => h.spot).map((h) => h.box);
  const blurs = holes.filter((h) => !h.spot).map((h) => h.box);
  const frame = `M 0 0 H ${W} V ${H} H 0 Z`;
  const layers: React.ReactNode[] = [];
  if (spots.length) {
    layers.push(
      <svg key="dim" className="mdp-focus-dim" width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <path d={`${frame} ${holePath(spots, 7 * u)}`} fillRule="evenodd" />
      </svg>,
    );
  }
  if (blurs.length) {
    const mask = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}'><path d='${frame} ${holePath(blurs, 7 * u)}' fill-rule='evenodd'/></svg>`)}")`;
    layers.push(
      <div key="blur" className="mdp-focus-blur" style={{
        maskImage: mask, WebkitMaskImage: mask, maskSize: '100% 100%', WebkitMaskSize: '100% 100%',
      } as React.CSSProperties} />,
    );
  }

  // The preview's marks: each target outlined and numbered; what is not found, listed.
  const marks: React.ReactNode[] = [];
  geo.outline.forEach(({ n, cue, hits }) => {
    const c = cue.kind === 'mark' ? '#ea580c' : cue.kind === 'look' ? '#2563eb' : '#64748b';
    hits.forEach((h, i) => {
      const b = h.box;
      marks.push(<div key={`o-${n}-${i}`} className="mdp-focus-outline" style={{ '--c': c, left: b.x - 3, top: b.y - 3, width: b.w + 6, height: b.h + 6, boxSizing: 'border-box' } as React.CSSProperties} />);
      marks.push(<div key={`b-${n}-${i}`} className="mdp-focus-badge" style={{ '--c': c, left: Math.max(0, b.x - 10), top: Math.max(0, b.y - 12) } as React.CSSProperties}>{n}</div>);
    });
  });
  if (geo.misses.length) {
    marks.push(
      <div key="problems" className="mdp-focus-problems">
        {geo.misses.map((m, i) => <div key={i}>{m.n}. {m.target}: {m.error}</div>)}
      </div>,
    );
  }

  return (
    <div data-mdp-focus-layer className={`mdp-focus-layer${animate ? '' : ' mdp-focus-static'}`}
      style={{ '--u': `${u}px` } as React.CSSProperties}>
      {layers}
      {items}
      {marks}
    </div>
  );
};
