import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FocusCue } from '../autoplay/autoplay';
import { MANIP_DESELECT_EVENT, type ManipRuntime } from '../slide/components/ManipulationLayer';
import { inkAnchor, inkMarkers, inkText, isRoute } from './ink';
import { placeInk, type PlacedInk } from './inkLayout';
import { setInkTool, useInkTool } from './inkTool';
import { isHit, listTargets, textLines, unionBox, type FocusBox } from './focusTargets';
import './InkEditLayer.css';

// The edit-layout mode's ink editing (the preview only): every [[ink: …]] of the slide
// drawn whole, picked by its strokes and reshaped with handles — an end dropped on
// another place re-anchors it (inside a picture: the point there, `#fig(62,40)`), the
// middle of an arrow dragged gives the point it passes (`via=`), a mark dragged onto
// another place moves there; a small panel sets the shape and the colour, returns an
// arrow to its own route, takes the ink out. New ink is made here too: a shape from
// the toolbar's "add ink" tool (inkTool) or a place's right-click menu, drawn on the
// slide, then the narration line it goes with picked from the slide's lines. Every
// change is the cue's TEXT written in the editor (ManipRuntime.onInkChange /
// onInkCreate → inkDocEdits: one undoable transaction) — the intent, as an author or
// an AI would write it, never coordinates; the strokes are worked out again from it
// like everywhere else (inkGeometry).

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
/** A new ink being made with `tool`: an arrow's / a line's ends set so far — `from`
 *  (pressed or clicked first, or the menu's "from here"), `to` (the menu's "to here");
 *  `pressed`: the start was pressed and the button is still down (release = the end);
 *  `box`: the place of the end set. */
interface Ends { tool: string; from: string | null; to: string | null; pressed: boolean; box: FocusBox | null }
/** While making: the places, the one under the pointer, the ink as it would be
 *  (`bad`: no line can be drawn there). */
interface MakeHover { spots: Spot[]; spot: Spot | null; draft: { cue: FocusCue; placed: PlacedInk } | null; bad: boolean }
type Lines = { n: number; caption: string; emphases: number }[];
/** A new ink drawn: the narration line it goes with is being picked. */
interface Choose { cue: FocusCue; placed: PlacedInk; lines: Lines; pick: number }
/** A new ink written (the script had `count` inks), drawn until the slide's text has it. */
interface Fresh { count: number; cue: FocusCue; placed: PlacedInk }
/** A place's right-click menu (at x, y on the screen). */
interface Menu { x: number; y: number; spot: Spot; anchor: string }

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
const inkOf = (style: string, targets: string[]): FocusCue => ({ kind: 'ink', style, targets, options: {} });

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

/** An end's anchor at a place under the pointer: the place itself — or, on a picture
 *  (the place 1 % of the slide or more), or where the end already pointed inside this
 *  place (`was`), the point there in % of the place's box. Shift: the place itself. */
const anchorFor = (spot: Spot, p: Pt, picture: boolean, shift: boolean, W: number, H: number, was?: string): string => {
  const prev = was ? inkAnchor(was) : null;
  const big = spot.box.w * spot.box.h >= 0.01 * W * H;
  if (shift || !((prev?.point && prev.base === spot.target) || (big && picture))) return spot.target;
  const x = Math.round(clamp(((p.x - spot.box.x) / (spot.box.w || 1)) * 100, 0, 100));
  const y = Math.round(clamp(((p.y - spot.box.y) / (spot.box.h || 1)) * 100, 0, 100));
  return `${spot.target}(${x},${y})`;
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
  const { onInkChange, onInkSelect, onInkUndo, onInkLines, onInkCreate } = runtime;

  const measure = useCallback(() => {
    if (!root) return;
    const W = root.offsetWidth;
    const H = root.offsetHeight;
    const r = root.getBoundingClientRect();
    if (!W || !H || !r.width) return;
    const obstacles = markers.length ? textLines(root) : [];
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
  // …and a new one, until the slide's text has it.
  const [freshState, setFresh] = useState<Fresh | null>(null);
  useEffect(() => {
    if (!freshState) return undefined;
    const t = window.setTimeout(() => setFresh(null), 2500);
    return () => window.clearTimeout(t);
  }, [freshState]);
  const fresh = freshState && markers.length === freshState.count ? freshState : null;

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
  // The picked ink — none once it is gone from the script (or while a new one is not
  // in it yet: its place is not known until then).
  const selected = !fresh && sel !== null && sel < markers.length ? sel : null;

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

  // ---- the slide's coordinates -----------------------------------------------------------
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

  // ---- reshaping ---------------------------------------------------------------------------
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
        const targets = [...cue.targets];
        targets[end] = anchorFor(spot, p, onPicture(ev.clientX, ev.clientY), ev.shiftKey, geo.W, geo.H, cue.targets[end]);
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

  // ---- making a new ink --------------------------------------------------------------------
  const tool = useInkTool();
  const [ends, setEnds] = useState<Ends | null>(null);
  const [hover, setHover] = useState<MakeHover | null>(null);
  const [choose, setChoose] = useState<Choose | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const mine = ends?.tool === tool ? ends : null;
  const making = tool ? { shape: tool, from: mine?.from ?? null, to: mine?.to ?? null, pressed: !!mine?.pressed, box: mine?.box ?? null } : null;
  // The places and the text, once per measurement (listing the places is not cheap).
  const cache = useRef<{ geo: Geo; spots: Spot[]; obstacles: FocusBox[] } | null>(null);
  const placesNow = () => {
    if (!root || !geo) return null;
    if (cache.current?.geo !== geo) cache.current = { geo, spots: spotsOf(root), obstacles: textLines(root) };
    return cache.current;
  };
  const pressAt = useRef<{ x: number; y: number } | null>(null);
  const moveAt = useRef<{ x: number; y: number; shift: boolean } | null>(null);
  const moveFrame = useRef(0);

  const stopMaking = useCallback(() => {
    setInkTool(null);
    setEnds(null);
    setHover(null);
  }, []);
  // The tool goes with the layer (the edit-layout mode ended, another slide shown).
  useEffect(() => () => setInkTool(null), []);

  /** A new ink drawn: if it can be drawn, the narration line it goes with is picked next. */
  const finish = (cue: FocusCue): boolean => {
    const c = placesNow();
    if (!c || !root) return false;
    const placed = placeInk(cue, root, c.obstacles);
    if (!placed.plan.strokes.length) { setHover((h) => (h ? { ...h, bad: true } : h)); return false; }
    if (moveFrame.current) { cancelAnimationFrame(moveFrame.current); moveFrame.current = 0; }
    const info = onInkLines?.(slide) || { lines: [], suggest: 0 };
    setChoose({ cue, placed, lines: info.lines, pick: info.lines.length ? clamp(info.suggest, 0, info.lines.length - 1) : -1 });
    stopMaking();
    return true;
  };

  /** Where the pointer is while making: the place under it and the end's anchor there. */
  const makeAt = (clientX: number, clientY: number, shift: boolean) => {
    const c = placesNow();
    if (!c || !geo || !making) return null;
    const p = toSlide(clientX, clientY);
    const spot = spotAt(c.spots, p, 4 / geo.k);
    const route = isRoute(making.shape);
    const anchor = spot ? (route ? anchorFor(spot, p, onPicture(clientX, clientY), shift, geo.W, geo.H) : spot.target) : null;
    return { c, p, spot, anchor, route };
  };
  const hoverAt = (clientX: number, clientY: number, shift: boolean) => {
    const at = makeAt(clientX, clientY, shift);
    if (!at || !making || !root) return;
    let cue: FocusCue | null = null;
    if (at.anchor) {
      if (!at.route) cue = inkOf(making.shape, [at.anchor]);
      else if (making.from && at.anchor !== making.from) cue = inkOf(making.shape, [making.from, at.anchor]);
      else if (making.to && at.anchor !== making.to) cue = inkOf(making.shape, [at.anchor, making.to]);
    }
    const placed = cue ? placeInk(cue, root, at.c.obstacles) : null;
    const drawn = !!placed && placed.plan.strokes.length > 0;
    setHover({ spots: at.c.spots, spot: at.spot, draft: cue && placed && drawn ? { cue, placed } : null, bad: !!cue && !drawn });
  };
  const onMakeMove = (e: React.PointerEvent) => {
    moveAt.current = { x: e.clientX, y: e.clientY, shift: e.shiftKey };
    if (!moveFrame.current) {
      moveFrame.current = requestAnimationFrame(() => {
        moveFrame.current = 0;
        const m = moveAt.current;
        if (m) hoverAt(m.x, m.y, m.shift);
      });
    }
  };
  const onMakeDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !making) return;
    e.preventDefault();
    e.stopPropagation();
    const at = makeAt(e.clientX, e.clientY, e.shiftKey);
    if (!at || !at.anchor) return;
    if (!at.route) { finish(inkOf(making.shape, [at.anchor])); return; }
    // The second click (or, for "to here", the start).
    if (making.from && at.anchor !== making.from) { finish(inkOf(making.shape, [making.from, at.anchor])); return; }
    if (making.to && at.anchor !== making.to) { finish(inkOf(making.shape, [at.anchor, making.to])); return; }
    if (!making.from && !making.to) {
      pressAt.current = { x: e.clientX, y: e.clientY };
      setEnds({ tool: making.shape, from: at.anchor, to: null, pressed: true, box: at.spot ? at.spot.box : null });
    }
  };
  const onMakeUp = (e: React.PointerEvent) => {
    if (!making || !making.pressed || !making.from) return;
    // Released elsewhere: the end (press-drag-release); on the start: a click — the end
    // is clicked next.
    const p0 = pressAt.current;
    const far = p0 ? Math.hypot(e.clientX - p0.x, e.clientY - p0.y) >= 6 : true;
    const at = far ? makeAt(e.clientX, e.clientY, e.shiftKey) : null;
    if (at && at.anchor && at.anchor !== making.from && finish(inkOf(making.shape, [making.from, at.anchor]))) return;
    setEnds({ tool: making.shape, from: making.from, to: null, pressed: false, box: making.box });
  };

  // Escape gives up making.
  useEffect(() => {
    if (!tool) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      stopMaking();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [tool, stopMaking]);

  /** The new ink written for line `line` (-1: the slide has no narration). */
  const create = useCallback((c: Choose, line: number) => {
    setChoose(null);
    const nth = onInkCreate?.(slide, line, inkText(c.cue));
    if (nth === null || nth === undefined) return;
    setFresh({ count: markers.length, cue: c.cue, placed: c.placed });
    setSel(nth);
    window.dispatchEvent(new Event(MANIP_DESELECT_EVENT));
    onInkSelect?.(slide, nth);
    layerRef.current?.focus({ preventScroll: true });
  }, [onInkCreate, onInkSelect, slide, markers.length]);

  // The line list's keys: ↑ / ↓ move, Enter writes, Escape gives up (before the editor
  // sees them — an Enter there would break the line).
  useEffect(() => {
    if (!choose) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setChoose(null); return; }
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && choose.lines.length) {
        e.preventDefault();
        e.stopPropagation();
        setChoose({ ...choose, pick: clamp(choose.pick + (e.key === 'ArrowDown' ? 1 : -1), 0, choose.lines.length - 1) });
        return;
      }
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); create(choose, choose.lines.length ? choose.pick : -1); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [choose, create]);
  // A click outside the list or the menu gives it up.
  useEffect(() => {
    if (!choose && !menu) return undefined;
    const away = (e: PointerEvent) => {
      if ((e.target as Element | null)?.closest?.('.mdp-ink-lines, .mdp-ink-menu')) return;
      setChoose(null);
      setMenu(null);
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [choose, menu]);

  // A right-click on a place of the slide (not on a module — that keeps its own menu):
  // what to draw there — also where an ink's stroke passes over it (a click picks the
  // ink); on an ink's stroke over no place, the ink is picked (its panel is its menu).
  useEffect(() => {
    if (!root || !content || !geo) return undefined;
    const onCtx = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (target?.closest?.('.mdp-ink-make')) { e.preventDefault(); e.stopPropagation(); stopMaking(); return; }
      const hit = target?.closest?.('[data-ink-nth]');
      const onModule = !hit && Array.from(content.querySelectorAll<HTMLElement>('.mdp-manip')).some((el) => {
        const b = (el.getAttribute('data-lifted') === '1' ? el : (el.firstElementChild as HTMLElement | null) || el).getBoundingClientRect();
        return e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom;
      });
      if (onModule) return;
      const p = toSlide(e.clientX, e.clientY);
      const spot = spotAt(spotsOf(root), p, 4 / geo.k);
      if (!spot) {
        if (hit) { e.preventDefault(); e.stopPropagation(); pick(Number(hit.getAttribute('data-ink-nth'))); }
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      setMenu({ x: e.clientX, y: e.clientY, spot, anchor: anchorFor(spot, p, onPicture(e.clientX, e.clientY), e.shiftKey, geo.W, geo.H) });
    };
    root.addEventListener('contextmenu', onCtx, true);
    return () => root.removeEventListener('contextmenu', onCtx, true);
  }, [root, content, geo, toSlide, onPicture, pick, stopMaking]);
  const fromMenu = (shape: string, end: 'from' | 'to') => {
    if (!menu) return;
    setInkTool(shape);
    setEnds({ tool: shape, from: end === 'from' ? menu.anchor : null, to: end === 'to' ? menu.anchor : null, pressed: false, box: menu.spot.box });
    setMenu(null);
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
  const r = root.getBoundingClientRect();
  const strokesOf = (cue: FocusCue, placed: PlacedInk, key: string, faint = false) => (
    <svg key={key} width={W} height={H} viewBox={`0 0 ${W} ${H}`} className={`mdp-ink-edit-ink${faint ? ' mdp-ink-edit-faint' : ''}`}
      stroke={colorOf(cue)} strokeWidth={2.6 * u} fill="none" strokeLinecap="round" strokeLinejoin="round">
      {placed.plan.strokes.map((s, j) => <path key={j} d={s.d} />)}
    </svg>
  );

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
          <path key={`hit${j}`} data-ink-ui data-ink-nth={it.nth} className="mdp-ink-hit" d={s.d} stroke="transparent" strokeWidth={14 / k}
            onPointerDown={(e) => begin(e, it.nth, route ? 'bend' : 'move')} />
        ))}
      </svg>,
    );
  });
  // A new ink: while its line is picked, and once written until the text has it.
  if (choose) layer.push(strokesOf(choose.cue, choose.placed, 'choose'));
  if (fresh) layer.push(strokesOf(fresh.cue, fresh.placed, 'fresh'));

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
      const ends2 = [plan.endsAt.from, plan.endsAt.to];
      ends2.forEach((p, i) => ui.push(
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

  // Making: the places, the one under the pointer, the ink as it would be, the end set.
  let make: React.ReactNode = null;
  if (making && !choose) {
    const ui: React.ReactNode[] = [];
    (hover?.spots || []).forEach((s, i) => ui.push(<rect key={`s${i}`} x={s.box.x} y={s.box.y} width={s.box.w} height={s.box.h} className="mdp-ink-edit-spot" strokeWidth={1 / k} />));
    if (hover?.spot) {
      const b = hover.spot.box;
      ui.push(<rect key="hot" x={b.x - 2 / k} y={b.y - 2 / k} width={b.w + 4 / k} height={b.h + 4 / k} className={hover.bad ? 'mdp-ink-edit-bad' : 'mdp-ink-edit-hot'} strokeWidth={2 / k} />);
    }
    const fixed = making.from || making.to;
    if (fixed && making.box) {
      const a = inkAnchor(fixed);
      const b = making.box;
      const pt = a.point ? { x: b.x + (b.w * a.point.x) / 100, y: b.y + (b.h * a.point.y) / 100 } : null;
      ui.push(<rect key="fixed" x={b.x - 2 / k} y={b.y - 2 / k} width={b.w + 4 / k} height={b.h + 4 / k} className="mdp-ink-edit-anchor" strokeWidth={1.5 / k} />);
      if (pt) ui.push(<circle key="fixedpt" cx={pt.x} cy={pt.y} r={hs * 0.6} className="mdp-ink-handle" strokeWidth={1.5 / k} />);
    }
    const route = isRoute(making.shape);
    const label = [...ROUTE_SHAPES, ...MARK_SHAPES].find(([s]) => s === making.shape)?.[2] || making.shape;
    const hint = !route ? `${label}: click a place`
      : making.to ? `${label}: click where it starts`
        : making.from ? `${label}: click (or release on) what it points at`
          : `${label}: press where it starts and release on what it points at — or click one, then the other`;
    make = (
      <>
        {hover?.draft && strokesOf(hover.draft.cue, hover.draft.placed, 'making')}
        <svg key="make-ui" width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="mdp-ink-edit-ui">{ui}</svg>
        <div data-ink-ui className="mdp-ink-make" onPointerMove={onMakeMove} onPointerDown={onMakeDown} onPointerUp={onMakeUp} />
        <div className="mdp-ink-make-hint">{hint} · Esc: stop</div>
      </>
    );
  }

  // The panel by the picked ink: its shape, colour, route; take it out.
  let panel: React.ReactNode = null;
  if (picked && pickedNow && !draft && !making && !choose) {
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

  // The new ink's line: the slide's narration lines, the one offered first marked; on
  // the half of the slide away from the ink.
  let lines: React.ReactNode = null;
  if (choose) {
    const area = choose.placed.plan.shaft && choose.placed.plan.shaft.length
      ? unionBox(choose.placed.plan.shaft.map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 })))
      : unionBox(choose.placed.ends.map((e) => (isHit(e.res) ? e.res.box : { x: W / 2, y: H / 2, w: 0, h: 0 })));
    const low = area.y + area.h / 2 > H / 2;
    lines = createPortal(
      <div data-ink-ui className="mdp-ink-lines" role="listbox"
        style={{ left: r.left + r.width / 2, top: low ? r.top + 8 : r.bottom - 8, transform: `translate(-50%, ${low ? '0' : '-100%'})`, maxWidth: Math.max(260, r.width - 24) }}
        onMouseDown={(e) => e.preventDefault()}>
        <div className="head">{choose.lines.length ? 'Show it with which line?' : 'This slide has no narration'}</div>
        {choose.lines.length ? choose.lines.map((l) => (
          <button key={l.n} type="button" role="option" aria-selected={l.n === choose.pick} className={`line${l.n === choose.pick ? ' on' : ''}`}
            onMouseEnter={() => setChoose({ ...choose, pick: l.n })} onClick={() => create(choose, l.n)}>
            <span className="n">{l.n + 1}</span>
            <span className="t">{l.caption}</span>
            {l.emphases > 0 && <span className="em" title="This line already shows an emphasis — both would show together (not the rule: one per line)">{'●'.repeat(Math.min(l.emphases, 3))}</span>}
          </button>
        )) : (
          <button type="button" className="line on" onClick={() => create(choose, -1)}><span className="t">Show it with the slide (written into its script)</span></button>
        )}
        <div className="foot">
          <span>↑↓ Enter · Esc</span>
          <button type="button" onClick={() => setChoose(null)}>Cancel</button>
        </div>
      </div>,
      document.body,
    );
  }

  // A place's right-click menu: a mark on it, or an arrow / a line from / to it.
  let ctx: React.ReactNode = null;
  if (menu) {
    ctx = createPortal(
      <div data-ink-ui className="mdp-ink-menu" role="menu"
        style={{ left: clamp(menu.x, 8, window.innerWidth - 230), top: clamp(menu.y, 8, window.innerHeight - 340) }}
        onMouseDown={(e) => e.preventDefault()} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }}>
        <div className="head" title={menu.anchor}>🖊 {menu.anchor}</div>
        {MARK_SHAPES.map(([s, icon, label]) => (
          <button key={s} type="button" role="menuitem" onClick={() => { setMenu(null); finish(inkOf(s, [menu.spot.target])); }}>
            <span className="i">{icon}</span>{label}
          </button>
        ))}
        <div className="sep" />
        <button type="button" role="menuitem" onClick={() => fromMenu('arrow', 'from')}><span className="i">→</span>Arrow from here…</button>
        <button type="button" role="menuitem" onClick={() => fromMenu('arrow', 'to')}><span className="i">←</span>Arrow to here…</button>
        <button type="button" role="menuitem" onClick={() => fromMenu('line', 'from')}><span className="i">—</span>Line from here…</button>
      </div>,
      document.body,
    );
  }

  return (
    <div ref={layerRef} tabIndex={-1} className="mdp-ink-edit" style={{ '--u': `${u}px` } as React.CSSProperties} onKeyDown={onKeyDown}>
      {layer}
      {make}
      {missing.length > 0 && (
        <div className="mdp-ink-edit-missing">
          {missing.map((it) => {
            const lost = it.placed.ends.find((e) => !isHit(e.res));
            return <div key={it.nth}>🖊 {it.nth + 1}: {lost ? `${lost.target} — ${(lost.res as { error: string }).error}` : 'not drawn'}</div>;
          })}
        </div>
      )}
      {panel}
      {lines}
      {ctx}
    </div>
  );
};
