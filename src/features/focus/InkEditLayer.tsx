import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FocusCue } from '../autoplay/autoplay';
import { MANIP_DESELECT_EVENT, type ManipRuntime } from '../slide/components/ManipulationLayer';
import { inkAnchor, inkMarkers, inkText, isRoute } from './ink';
import { placeInk, type PlacedInk } from './inkLayout';
import { isHit, listTargets, textLines, unionBox, type FocusBox } from './focusTargets';
import './InkEditLayer.css';

// The edit-layout mode's ink editing (the preview only): every [[ink: …]] of the slide
// drawn whole, picked by its strokes and reshaped with handles — an end dropped on
// another place re-anchors it (inside a picture: the point there, `#fig(62,40)`), the
// middle of an arrow dragged gives the point it passes (`via=`), a mark dragged onto
// another place moves there; a small panel sets the shape and the colour, returns an
// arrow to its own route, takes the ink out. Every change is the cue's TEXT rewritten
// in the editor (ManipRuntime.onInkChange → inkDocEdits: one undoable transaction) —
// the intent, as an author or an AI would write it, never coordinates; the strokes
// are worked out again from it like everywhere else (inkGeometry).

interface Pt { x: number; y: number }
/** A place an end can go to: a target string that resolves to it, and its box. */
interface Spot { target: string; box: FocusBox }
interface Item { nth: number; cue: FocusCue; placed: PlacedInk }
/** `k`: screen px per slide px (the preview is zoomed). */
interface Geo { W: number; H: number; k: number; items: Item[] }
/** An ink being reshaped: the cue as it would be written now, drawn; for an end or a
 *  mark being moved, the places it can go to and the one under the pointer. */
interface Draft { nth: number; cue: FocusCue; placed: PlacedInk | null; spots: Spot[] | null; spot: Spot | null }
/** A change just written (`text`; null = taken out, when the script had `count` inks),
 *  as drawn — until the slide's text has it. */
interface Pending { nth: number; text: string | null; count: number; cue: FocusCue | null; placed: PlacedInk | null }

const ROUTE_SHAPES: [string, string, string][] = [['arrow', '→', 'Arrow'], ['line', '—', 'Line (no head)']];
const MARK_SHAPES: [string, string, string][] = [
  ['circle', '◯', 'Circle'], ['box', '▭', 'Box'], ['underline', '＿', 'Underline'],
  ['cross', '✕', 'Cross out'], ['check', '✓', 'Check mark'], ['bracket', '〕', 'Bracket'],
];
// '' = the theme's pen (no color= written).
const COLORS: [string, string][] = [['', 'The theme\'s pen'], ['#e53935', 'Red'], ['#1e88e5', 'Blue'], ['#2e7d32', 'Green'], ['#6a1b9a', 'Purple']];
const COLOR_RE = /^(#[0-9a-f]{3,8}|[a-z]{3,20}|(?:rgb|rgba|hsl|hsla)\([\d\s.,%/]+\))$/i;
const PEN = 'var(--mdp-ink-color, var(--mdp-focus-pen, #ef6c00))';
const SELECT = '#3b82f6';

const within = (p: Pt, b: FocusBox, pad: number) => p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad;
const centerOf = (b: FocusBox): Pt => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const round2 = (v: number) => Math.round(v * 100) / 100;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The cue with some options set (a value) or taken out (undefined). */
const withOptions = (c: FocusCue, patch: Record<string, string | undefined>): FocusCue => {
  const options = { ...c.options };
  for (const [k, v] of Object.entries(patch)) { if (v === undefined || v === '') delete options[k]; else options[k] = v; }
  return { ...c, options };
};

/** The point at fraction `f` of a polyline's length. */
const along = (pts: Pt[], f: number): Pt => {
  const segs = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y));
  let left = segs.reduce((s, v) => s + v, 0) * f;
  for (let i = 0; i < segs.length; i++) {
    if (left <= segs[i] || i === segs.length - 1) {
      const t = segs[i] ? clamp(left / segs[i], 0, 1) : 0;
      return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, y: pts[i].y + (pts[i + 1].y - pts[i].y) * t };
    }
    left -= segs[i];
  }
  return pts[0];
};

/** The places on the slide an end can go to (named places first, as get_focus_targets
 *  lists them); not the hints ("#…" for an unnamed module, "area:…" for an image). */
const spotsOf = (root: HTMLElement): Spot[] =>
  listTargets(root).filter((t) => !t.target.includes('…') && !t.target.startsWith('area:')).map((t) => ({ target: t.target, box: t.box }));

/** The smallest place under the point (a named one wins a tie). */
const spotAt = (spots: Spot[], p: Pt, pad: number): Spot | null => {
  let best: Spot | null = null;
  for (const s of spots) {
    if (!within(p, s.box, pad)) continue;
    const a = s.box.w * s.box.h;
    const b = best ? best.box.w * best.box.h : Infinity;
    if (a < b - 1e-6 || (Math.abs(a - b) <= 1e-6 && s.target.startsWith('#') && !best?.target.startsWith('#'))) best = s;
  }
  return best;
};

export const InkEditLayer: React.FC<{
  root: HTMLElement | null;
  content: HTMLElement | null;
  /** The slide's markdown — its script's [[ink]] markers are what is edited. */
  raw: string;
  slide: number;
  runtime: ManipRuntime;
}> = ({ root, content, raw, slide, runtime }) => {
  const markers = useMemo(() => inkMarkers(raw), [raw]);
  const [geo, setGeo] = useState<Geo | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  // Picking an ink takes the keyboard (Delete, Escape) from the editor, whose caret
  // now sits on the ink's marker: a Delete there would cut the marker's first "[".
  const layerRef = useRef<HTMLDivElement>(null);
  const { onInkChange, onInkSelect, onInkUndo } = runtime;

  const measure = useCallback(() => {
    if (!root) return;
    const W = root.offsetWidth;
    const H = root.offsetHeight;
    const r = root.getBoundingClientRect();
    if (!W || !H || !r.width) return;
    const obstacles = textLines(root);
    setGeo({ W, H, k: r.width / W, items: markers.map((m, nth) => ({ nth, cue: m.cue, placed: placeInk(m.cue, root, obstacles) })) });
  }, [root, markers]);

  // Measure once the slide has painted, and again when it changes (a module moved by
  // the layout editing, fonts, a resize) — as FocusLayer does.
  useEffect(() => {
    if (!root) return undefined;
    let timer = 0;
    const soon = () => { if (!timer) timer = window.setTimeout(() => { timer = 0; measure(); }, 120); };
    const frame = requestAnimationFrame(() => measure());
    const late = window.setTimeout(measure, 450);
    const ro = new ResizeObserver(soon);
    ro.observe(root);
    if (content) ro.observe(content);
    const mo = content ? new MutationObserver(soon) : null;
    mo?.observe(content!, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
    document.fonts?.addEventListener?.('loadingdone', soon);
    window.addEventListener('resize', soon);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(late);
      if (timer) window.clearTimeout(timer);
      ro.disconnect();
      mo?.disconnect();
      document.fonts?.removeEventListener?.('loadingdone', soon);
      window.removeEventListener('resize', soon);
    };
  }, [root, content, measure]);

  // What was just written: the preview parses the new text a moment later, and until
  // then the ink is drawn — and changed further — as written, not as it was (no flash
  // back to the old shape; a second change right after builds on the first).
  const [pending, setPending] = useState<Pending | null>(null);
  useEffect(() => {
    if (!pending) return undefined;
    const t = window.setTimeout(() => setPending(null), 2500);
    return () => window.clearTimeout(t);
  }, [pending]);
  const live = pending && (pending.text === null
    ? markers.length === pending.count
    : !!markers[pending.nth] && inkText(markers[pending.nth].cue) !== pending.text) ? pending : null;
  /** An ink as it is now: as just written, else as the slide's text has it; null while
   *  it is being taken out. */
  const now = (it: Item): { cue: FocusCue; placed: PlacedInk } | null => {
    if (live && live.nth === it.nth) return live.cue ? { cue: live.cue, placed: live.placed || it.placed } : null;
    return { cue: it.cue, placed: it.placed };
  };

  const commit = useCallback((nth: number, cue: FocusCue | null, placed?: PlacedInk | null) => {
    const before = markers[nth]?.cue;
    if (!before) return;
    const was = live && live.nth === nth ? live.text : inkText(before);
    const text = cue ? inkText(cue) : null;
    if (text === was) return;
    const drawn = cue ? (placed !== undefined ? placed : root ? placeInk(cue, root, textLines(root)) : null) : null;
    setPending({ nth, text, count: markers.length, cue, placed: drawn });
    onInkChange?.(slide, nth, text);
  }, [markers, live, root, onInkChange, slide]);

  const pick = useCallback((nth: number) => {
    setSel(nth);
    window.dispatchEvent(new Event(MANIP_DESELECT_EVENT));
    onInkSelect?.(slide, nth);
    layerRef.current?.focus({ preventScroll: true });
  }, [onInkSelect, slide]);
  // The picked ink — none once it is gone from the script.
  const selected = sel !== null && sel < markers.length ? sel : null;

  // A click anywhere else (a module, the empty slide, the editor) lets the ink go.
  useEffect(() => {
    if (selected === null) return undefined;
    const away = (e: PointerEvent) => { if (!(e.target as Element | null)?.closest?.('[data-ink-ui]')) setSel(null); };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [selected]);

  // The keys, while the layer has them (from the pick on): Delete / Backspace takes the
  // picked ink out, Escape lets it go; Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z) are the editor's
  // undo / redo — a reshaped ink comes back as it was.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (k === 'z' || k === 'y')) {
      e.preventDefault();
      onInkUndo?.(k === 'y' || e.shiftKey);
      return;
    }
    if (selected === null) return;
    if (e.key === 'Escape') { setSel(null); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); commit(selected, null); setSel(null); }
  };

  // ---- dragging ----------------------------------------------------------------------
  const toSlide = useCallback((clientX: number, clientY: number): Pt => {
    const r = root!.getBoundingClientRect();
    const k = r.width / (root!.offsetWidth || 1) || 1;
    return { x: (clientX - r.left) / k, y: (clientY - r.top) / k };
  }, [root]);

  // Whether the point is on a picture (an inline SVG, an image, a canvas) of the slide.
  const onPicture = useCallback((clientX: number, clientY: number): boolean => {
    if (!content) return false;
    return Array.from(content.querySelectorAll('svg, img, canvas')).some((el) => {
      if (el.parentElement?.closest('svg') || el.closest('.katex')) return false;
      const b = el.getBoundingClientRect();
      return clientX >= b.left && clientX <= b.right && clientY >= b.top && clientY <= b.bottom;
    });
  }, [content]);

  const begin = (e: React.PointerEvent, nth: number, kind: 'end' | 'bend' | 'move', end = 0) => {
    if (e.button !== 0 || !root || !geo) return;
    e.preventDefault();
    e.stopPropagation();
    const it = geo.items[nth];
    const cur = it ? now(it) : null;
    if (!it || !cur) return;
    if (selected !== nth) pick(nth);
    const obstacles = textLines(root);
    const cue = cur.cue;
    // A bend: from the anchors as the route takes them (a point inside one, else its
    // middle). An end / a mark: the places it can go to.
    const anchors = cur.placed.ends.map(({ target, res }) => {
      const box = isHit(res) ? res.box : { x: 0, y: 0, w: 0, h: 0 };
      const pt = inkAnchor(target).point;
      return pt ? { x: box.x + (box.w * pt.x) / 100, y: box.y + (box.h * pt.y) / 100 } : centerOf(box);
    });
    if (kind === 'bend' && anchors.length !== 2) return;
    const spots = kind === 'bend' ? null : spotsOf(root);
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moved = false;
    let frame = 0;
    let last: PointerEvent | null = null;
    let current: Draft | null = null;
    const show = (d: Draft) => { current = d; setDraft(d); };
    const step = () => {
      frame = 0;
      const ev = last;
      if (!ev || !root) return;
      const p = toSlide(ev.clientX, ev.clientY);
      if (kind === 'bend') {
        // The route passes through the pointer: one point t along a → b, s across it
        // (+ = the arrow's left), in fractions of its length — inkGeometry's via.
        const [a, b] = anchors;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const L2 = dx * dx + dy * dy;
        if (!L2) return;
        const L = Math.sqrt(L2);
        const t = round2(clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / L2, 0.05, 0.95));
        const s = round2(((p.x - a.x) * (dy / L) + (p.y - a.y) * (-dx / L)) / L);
        const next = withOptions(cue, { via: `${t}/${s}`, side: undefined, bend: undefined });
        show({ nth, cue: next, placed: placeInk(next, root, obstacles), spots: null, spot: null });
        return;
      }
      const spot = spotAt(spots || [], p, 4 / geo.k);
      if (!spot) { show({ nth, cue, placed: null, spots, spot: null }); return; }
      let next: FocusCue;
      if (kind === 'end') {
        const was = inkAnchor(cue.targets[end] || '');
        // Into a picture (or where the end already pointed inside this place): the
        // point there, in % of the place's box; Shift: the place itself.
        const big = spot.box.w * spot.box.h >= 0.01 * geo.W * geo.H;
        const point = !ev.shiftKey && ((was.point && was.base === spot.target) || (big && onPicture(ev.clientX, ev.clientY)));
        const anchor = point
          ? `${spot.target}(${Math.round(clamp(((p.x - spot.box.x) / (spot.box.w || 1)) * 100, 0, 100))},${Math.round(clamp(((p.y - spot.box.y) / (spot.box.h || 1)) * 100, 0, 100))})`
          : spot.target;
        const targets = [...cue.targets];
        targets[end] = anchor;
        next = { ...cue, targets };
      } else {
        next = { ...cue, targets: [spot.target] };
      }
      show({ nth, cue: next, placed: placeInk(next, root, obstacles), spots, spot });
    };
    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 3) return;
      moved = true;
      last = ev;
      if (!frame) frame = requestAnimationFrame(step);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (frame) { cancelAnimationFrame(frame); step(); }
      const done = current as Draft | null;
      setDraft(null);
      // Only an ink that can be drawn is written (not one whose ends meet, not an end
      // dropped where there is nothing to point at).
      if (moved && done && done.placed && done.placed.plan.strokes.length) commit(nth, done.cue, done.placed);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  if (!geo || !root) return null;
  const { W, H, k } = geo;
  const u = H / 540;
  const hs = 6 / k;            // a handle's radius: 6 screen px
  const picked = selected === null ? null : geo.items[selected] ?? null;
  const shown = (it: Item): { cue: FocusCue; placed: PlacedInk | null } | null =>
    (draft && draft.nth === it.nth ? { cue: draft.cue, placed: draft.placed } : now(it));
  const colorOf = (c: FocusCue) => (COLOR_RE.test(c.options.color || '') ? c.options.color! : PEN);
  const missing = geo.items.filter((it) => it.placed.missing);

  const layer: React.ReactNode[] = [];
  geo.items.forEach((it) => {
    const sh = shown(it);
    if (!sh) return;
    const { cue, placed } = sh;
    const strokes = (placed || it.placed).plan.strokes;
    if (!strokes.length) return;
    const isSel = selected === it.nth;
    const route = isRoute(cue.style);
    layer.push(
      <svg key={`ink-${it.nth}`} width={W} height={H} viewBox={`0 0 ${W} ${H}`} className={`mdp-ink-edit-ink${placed ? '' : ' mdp-ink-edit-faint'}`}
        stroke={colorOf(cue)} strokeWidth={2.6 * u} fill="none" strokeLinecap="round" strokeLinejoin="round">
        {isSel && strokes.map((s, j) => <path key={`h${j}`} d={s.d} stroke={SELECT} strokeWidth={2.6 * u + 5 / k} opacity={0.35} />)}
        {strokes.map((s, j) => <path key={j} d={s.d} />)}
        {/* what a click takes: a wide, unseen band along every stroke */}
        {strokes.map((s, j) => (
          <path key={`hit${j}`} data-ink-ui className="mdp-ink-hit" d={s.d} stroke="transparent" strokeWidth={14 / k}
            onPointerDown={(e) => begin(e, it.nth, route ? 'bend' : 'move')} />
        ))}
      </svg>,
    );
  });

  // The picked ink: what it is attached to, its handles.
  const pickedNow = picked ? now(picked) : null;
  const pickedShown = picked ? shown(picked) : null;
  if (picked && pickedNow && pickedShown) {
    const { cue, placed } = pickedShown;
    const plan = (placed || pickedNow.placed).plan;
    const route = isRoute(cue.style);
    const boxes = pickedNow.placed.ends.map((e) => (isHit(e.res) ? e.res.box : null)).filter(Boolean) as FocusBox[];
    const ui: React.ReactNode[] = [];
    if (!draft) boxes.forEach((b, i) => ui.push(<rect key={`b${i}`} x={b.x - 2 / k} y={b.y - 2 / k} width={b.w + 4 / k} height={b.h + 4 / k} className="mdp-ink-edit-anchor" strokeWidth={1.2 / k} strokeDasharray={`${4 / k} ${3 / k}`} />));
    if (route && plan.endsAt) {
      const ends = [plan.endsAt.from, plan.endsAt.to];
      ends.forEach((p, i) => ui.push(
        <circle key={`e${i}`} data-ink-ui className="mdp-ink-handle" cx={p.x} cy={p.y} r={hs} strokeWidth={1.5 / k}
          onPointerDown={(e) => begin(e, picked.nth, 'end', i)}>
          <title>{i ? 'Drag onto what the arrow points at (in a picture: the point there; Shift: the whole place)' : 'Drag onto where the arrow starts'}</title>
        </circle>,
      ));
      if (plan.shaft && plan.shaft.length > 1) {
        const m = along(plan.shaft, 0.5);
        ui.push(
          <rect key="mid" data-ink-ui className="mdp-ink-handle mdp-ink-handle-mid" x={m.x - hs * 0.85} y={m.y - hs * 0.85} width={hs * 1.7} height={hs * 1.7}
            transform={`rotate(45 ${m.x} ${m.y})`} strokeWidth={1.5 / k}
            onPointerDown={(e) => begin(e, picked.nth, 'bend')}
            onDoubleClick={(e) => { e.stopPropagation(); commit(picked.nth, withOptions(pickedNow.cue, { via: undefined, side: undefined, bend: undefined })); }}>
            <title>Drag: the arrow passes here (via) · double-click: its own route again</title>
          </rect>,
        );
      }
    } else if (!route && boxes.length) {
      const c = centerOf(unionBox(boxes));
      ui.push(
        <rect key="move" data-ink-ui className="mdp-ink-handle" x={c.x - hs} y={c.y - hs} width={hs * 2} height={hs * 2} strokeWidth={1.5 / k}
          onPointerDown={(e) => begin(e, picked.nth, 'move')}>
          <title>Drag onto another place</title>
        </rect>,
      );
    }
    // While an end is dragged: where it can go, and where it would.
    if (draft && draft.spots) {
      draft.spots.forEach((s, i) => ui.push(<rect key={`s${i}`} x={s.box.x} y={s.box.y} width={s.box.w} height={s.box.h} className="mdp-ink-edit-spot" strokeWidth={1 / k} />));
      if (draft.spot) {
        // Red: no line can be drawn to it from the other end (they meet) — a drop
        // there is not written.
        const b = draft.spot.box;
        const bad = !draft.placed || !draft.placed.plan.strokes.length;
        ui.push(<rect key="hot" x={b.x - 2 / k} y={b.y - 2 / k} width={b.w + 4 / k} height={b.h + 4 / k} className={bad ? 'mdp-ink-edit-bad' : 'mdp-ink-edit-hot'} strokeWidth={2 / k} />);
      }
    }
    layer.push(<svg key="ui" width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="mdp-ink-edit-ui">{ui}</svg>);
  }

  // The panel by the picked ink: its shape, colour, route; take it out.
  let panel: React.ReactNode = null;
  if (picked && pickedNow && !draft) {
    const cue = pickedNow.cue;
    const route = isRoute(cue.style);
    const plan = pickedNow.placed.plan;
    const pts = route && plan.shaft ? plan.shaft : null;
    const boxes = pickedNow.placed.ends.map((e) => (isHit(e.res) ? e.res.box : null)).filter(Boolean) as FocusBox[];
    const area = pts && pts.length
      ? unionBox(pts.map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 })))
      : boxes.length ? unionBox(boxes) : null;
    if (area) {
      // On the slide: above the ink, else below it, else at the slide's top.
      const r = root.getBoundingClientRect();
      const top = r.top + area.y * k;
      const bottom = r.top + (area.y + area.h) * k;
      const left = clamp(r.left + (area.x + area.w / 2) * k, r.left + 8, r.right - 8);
      const room = 46;
      const above = top - room >= r.top;
      const y = above ? top - 8 : bottom + room <= r.bottom ? bottom + 8 : r.top + 6;
      const shapes = route ? ROUTE_SHAPES : MARK_SHAPES;
      const sideable = cue.style === 'check' || cue.style === 'bracket';
      const set = (next: FocusCue) => commit(picked.nth, next);
      const shapeTo = (style: string) => {
        // A side is kept where the new shape has one (an arrow's, a check's left / right).
        const keep = isRoute(style) || ((style === 'check' || style === 'bracket') && /^(left|right)$/.test(cue.options.side || ''));
        set(withOptions({ ...cue, style }, keep ? {} : { side: undefined }));
      };
      const routed = route && (cue.options.via || cue.options.side || cue.options.bend);
      const color = cue.options.color || '';
      panel = createPortal(
        <div data-ink-ui className="mdp-ink-toolbar" title={inkText(cue)}
          style={{ left, top: y, transform: `translate(-50%, ${above ? '-100%' : '0'})` }}
          onMouseDown={(e) => e.preventDefault()}>
          {shapes.map(([s, icon, label]) => (
            <button key={s} type="button" className={cue.style === s ? 'on' : ''} title={label} onClick={() => shapeTo(s)}>{icon}</button>
          ))}
          {sideable && <span className="sep" />}
          {sideable && (['left', 'right'] as const).map((sd) => (
            <button key={sd} type="button" className={(cue.options.side || (cue.style === 'bracket' ? 'right' : 'left')) === sd ? 'on' : ''}
              title={`On the ${sd}`} onClick={() => set(withOptions(cue, { side: sd }))}>{sd === 'left' ? '◧' : '◨'}</button>
          ))}
          <span className="sep" />
          {COLORS.map(([c, label]) => (
            <button key={c || 'pen'} type="button" className={`swatch${color === c ? ' on' : ''}`} title={label}
              onClick={() => set(withOptions(cue, { color: c || undefined }))}>
              <span style={{ background: c || PEN }} />
            </button>
          ))}
          {routed && <span className="sep" />}
          {routed && (
            <button type="button" title="Its own route again (forget the side / bend / points it passes)"
              onClick={() => set(withOptions(cue, { via: undefined, side: undefined, bend: undefined }))}>↺</button>
          )}
          <span className="sep" />
          <button type="button" className="danger" title="Take this ink out of the script (Delete)" onClick={() => { commit(picked.nth, null); setSel(null); }}>🗑</button>
        </div>,
        document.body,
      );
    }
  }

  return (
    <div ref={layerRef} tabIndex={-1} className="mdp-ink-edit" style={{ '--u': `${u}px` } as React.CSSProperties} onKeyDown={onKeyDown}>
      {layer}
      {missing.length > 0 && (
        <div className="mdp-ink-edit-missing">
          {missing.map((it) => {
            const lost = it.placed.ends.find((e) => !isHit(e.res));
            return <div key={it.nth}>🖊 {it.nth + 1}: {lost ? `${lost.target} — ${(lost.res as { error: string }).error}` : 'not drawn'}</div>;
          })}
        </div>
      )}
      {panel}
    </div>
  );
};
