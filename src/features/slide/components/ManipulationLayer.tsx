import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TransformEdit, DirectiveSelector } from '../../modules/moduleDocEdits';
import { useAppSettings } from '../../settings/AppSettingsContext';
import { matchAction } from '../../settings/shortcuts/matcher';
import { ACTIONS_BY_SCOPE } from '../../settings/shortcuts/registry';

// Runtime wiring supplied by the editor preview. Commit/delete go through the
// editor view (moduleDocEdits) so changes land in the markdown with native undo.
export interface ManipRuntime {
  enabled: boolean;       // edit-layout mode on
  snap: boolean;          // grid snap on
  snapStep: number;       // percent
  onCommit: (edits: Array<{ sel: DirectiveSelector; t: TransformEdit; chrome?: boolean }>) => void;
  onDelete: (sels: DirectiveSelector[]) => void;
  // Selecting a single module moves the editor cursor to its directive.
  onSelect?: (sel: DirectiveSelector) => void;
  // Context-menu "Property" → open that module's settings dialog.
  onRequestProperty?: (sel: DirectiveSelector) => void;
  // Reorder: move the module's directive block earlier/later in the document
  // (dir -1 = behind, +1 = on top). Returns the moved module's new ord.
  onReorder?: (sel: DirectiveSelector, dir: 1 | -1) => number | null;
  // Copy: return the module's directive source text (stored in the layer clipboard).
  onCopyText?: (sel: DirectiveSelector) => string | null;
  // Paste: insert a copy of `text` after `afterSel`. Returns the new copy's ord.
  onPaste?: (afterSel: DirectiveSelector, text: string) => number | null;
  // Paste on empty canvas: drop a copy of `text` into the current slide at (x, y) %.
  onPasteAt?: (text: string, x: number, y: number) => number | null;
}

// Clipboard for module copy/paste. Module-level (not React state) so it persists
// across slide switches — each SlideView mounts its own ManipulationLayer.
let moduleClipboard: string | null = null;

interface Props {
  container: HTMLElement | null;             // the .slide-content node holding .mdp-manip
  // Header/footer chrome nodes — their modules are manipulable too (slide-wide
  // coords, since the chrome layers span the whole slide). Framed in green/orange
  // to distinguish them from content (blue/red).
  headerContainer?: HTMLElement | null;
  footerContainer?: HTMLElement | null;
  runtime: ManipRuntime;
}

// Is this manip element part of the header/footer chrome (vs the slide body)?
const isChromeEl = (el: Element): boolean => !!el.closest('.slide-header, .slide-footer');

interface Box { cx: number; cy: number; w: number; h: number; rot: number; lifted: boolean }

const HANDLES: Record<string, { fx: number; fy: number; hx: number; vy: number; cur: string }> = {
  e:  { fx: 100, fy: 50,  hx: 1,  vy: 0,  cur: 'ew-resize' },
  w:  { fx: 0,   fy: 50,  hx: -1, vy: 0,  cur: 'ew-resize' },
  n:  { fx: 50,  fy: 0,   hx: 0,  vy: -1, cur: 'ns-resize' },
  s:  { fx: 50,  fy: 100, hx: 0,  vy: 1,  cur: 'ns-resize' },
  ne: { fx: 100, fy: 0,   hx: 1,  vy: -1, cur: 'nesw-resize' },
  nw: { fx: 0,   fy: 0,   hx: -1, vy: -1, cur: 'nwse-resize' },
  se: { fx: 100, fy: 100, hx: 1,  vy: 1,  cur: 'nwse-resize' },
  sw: { fx: 0,   fy: 100, hx: -1, vy: 1,  cur: 'nesw-resize' },
};

// Identity is purely document-order (data-mdp-ord). No id is written to the
// directive — the transform args travel inline with the directive text, so ord
// is enough for the overlay's (transient) selection mapping.
const keyOf = (el: Element): string => `ord:${el.getAttribute('data-mdp-ord') ?? ''}`;
const selOf = (key: string): DirectiveSelector => ({ ord: Number(key.slice(4)) });
const rotateOf = (transform: string): number => {
  const m = /rotate\(\s*(-?[\d.]+)deg\s*\)/.exec(transform || '');
  return m ? parseFloat(m[1]) : 0;
};
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const boxEq = (a: Box | undefined, b: Box) =>
  !!a && a.cx === b.cx && a.cy === b.cy && a.w === b.w && a.h === b.h && a.rot === b.rot;

// Smart-guide snapping: distance (px) within which a moved edge/centre snaps to
// an alignment target (slide centre/edges, or another module's edge/centre).
const SNAP_PX = 6;
// Best snap of any `edge` to any `target` within `thresh`. Returns the correction
// to add to the moved coordinate so the closest edge lands exactly on the target.
const snapAxis = (edges: number[], targets: number[], thresh: number): { delta: number; target: number } | null => {
  let best: { d: number; delta: number; target: number } | null = null;
  for (const e of edges) for (const t of targets) {
    const d = Math.abs(e - t);
    if (d <= thresh && (!best || d < best.d)) best = { d, delta: t - e, target: t };
  }
  return best ? { delta: best.delta, target: best.target } : null;
};

// Convert a CANVAS-% box to its containing block's relative % (identity when the
// containing block IS the canvas, i.e. p = {0,0,100,100}).
const toParentPct = (b: Box, p: { left: number; top: number; w: number; h: number }): Box =>
  ({ cx: ((b.cx - p.left) / p.w) * 100, cy: ((b.cy - p.top) / p.h) * 100, w: (b.w / p.w) * 100, h: (b.h / p.h) * 100, rot: b.rot, lifted: b.lifted });
// Inverse: a containing-block-relative % box (the element's inline style) → canvas %.
const fromParentPct = (s: Box, p: { left: number; top: number; w: number; h: number }): Box =>
  ({ cx: p.left + (s.cx / 100) * p.w, cy: p.top + (s.cy / 100) * p.h, w: (s.w / 100) * p.w, h: (s.h / 100) * p.h, rot: s.rot, lifted: true });

const CtxItem: React.FC<{ onClick: () => void; danger?: boolean; children: React.ReactNode }> = ({ onClick, danger, children }) => {
  const [hover, setHover] = useState(false);
  // Act on pointerdown (not onClick): the menu opens via a right-click and a
  // focus shift can otherwise swallow the follow-up click. preventDefault keeps
  // focus where it is; stopPropagation keeps the close-backdrop from firing.
  const fire = (e: React.PointerEvent) => { e.preventDefault(); e.stopPropagation(); onClick(); };
  return (
    <div
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onPointerDown={fire}
      style={{
        padding: '6px 14px', cursor: 'pointer', whiteSpace: 'nowrap',
        color: danger ? 'var(--app-danger)' : 'var(--app-text-secondary)',
        background: hover ? 'var(--app-bg-hover)' : 'transparent',
      }}
    >{children}</div>
  );
};

export const ManipulationLayer: React.FC<Props> = ({ container, headerContainer, footerContainer, runtime }) => {
  const { enabled, snap, snapStep, onCommit, onDelete, onSelect, onRequestProperty, onReorder, onCopyText, onPaste, onPasteAt } = runtime;
  const { settings } = useAppSettings();
  const rootRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string[]>([]);
  // Right-click context menu. On a module: key set (Property / Delete / reorder /
  // copy). On empty canvas: key null + the click position (px, py %) for "Paste here".
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; key: string | null; px: number; py: number } | null>(null);
  // Frame boxes are kept in STATE (not read during render) so they reflect the
  // committed DOM after a re-render instead of lagging a frame behind.
  const [frameBoxes, setFrameBoxes] = useState<Record<string, Box>>({});
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  // Smart alignment guides shown while dragging (slide centre/edges + other
  // modules' edges/centres). `axis:'x'` = vertical line at x%, `axis:'y'` = horizontal at y%.
  const [guides, setGuides] = useState<Array<{ axis: 'x' | 'y'; pos: number }>>([]);

  const selRef = useRef(selected);
  selRef.current = selected;
  const draggingRef = useRef(false);
  // Just-committed boxes. For a short window after a commit we re-assert these on
  // every layout pass (before paint), so a transient re-render with stale slide
  // HTML can't briefly snap the element back to its pre-edit position/size.
  const committedRef = useRef<Record<string, { box: Box; t: number }>>({});

  // ---- coordinate helpers (everything in % of the canvas = overlay) ----------
  const oRect = () => rootRef.current!.getBoundingClientRect();
  const pctX = (clientX: number, r: DOMRect) => ((clientX - r.left) / r.width) * 100;
  const pctY = (clientY: number, r: DOMRect) => ((clientY - r.top) / r.height) * 100;

  // Search the slide body PLUS the header/footer chrome (their modules are
  // manipulable too). ords are global (whole-doc), so a key resolves uniquely.
  const containers = useMemo(
    () => [container, headerContainer, footerContainer].filter(Boolean) as HTMLElement[],
    [container, headerContainer, footerContainer],
  );
  const els = useCallback(
    (): HTMLElement[] => containers.flatMap((c) => Array.from(c.querySelectorAll<HTMLElement>('.mdp-manip'))),
    [containers],
  );
  const findEl = useCallback(
    (key: string): HTMLElement | null => {
      const sel = `.mdp-manip[data-mdp-ord="${CSS.escape(key.slice(4))}"]`;
      for (const c of containers) { const el = c.querySelector<HTMLElement>(sel); if (el) return el; }
      return null;
    },
    [containers],
  );

  // The element to MEASURE / hit-test. A lifted element is its own box. Otherwise
  // measure the module's INNER element: the wrapper may be display:contents (a
  // select-only module → no box at all) or a full-width block while the visible
  // module is narrower (e.g. a 250px shape) — measuring the inner element makes
  // the frame hug the module instead of leaving a gap.
  const measureEl = useCallback((el: HTMLElement): HTMLElement => {
    if (el.getAttribute('data-lifted') === '1') return el;
    return (el.firstElementChild as HTMLElement | null) || el;
  }, []);

  // A module nested INSIDE another module's body positions against that module's
  // box (its CSS containing block), not the canvas. The overlay works in canvas %,
  // so for a nested element we convert between canvas % and parent % using its
  // containing block (offsetParent). Top-level elements resolve against the canvas
  // → this returns the identity {0,0,100,100}, making all conversions no-ops for
  // the common (non-nested) case.
  const parentRectPct = useCallback((el: HTMLElement): { left: number; top: number; w: number; h: number } => {
    const root = rootRef.current;
    const nested = el.parentElement?.closest('.mdp-manip');
    const op = el.offsetParent as HTMLElement | null;
    if (!nested || !root || !op) return { left: 0, top: 0, w: 100, h: 100 };
    const o = op.getBoundingClientRect(), rr = root.getBoundingClientRect();
    if (!o.width || !o.height) return { left: 0, top: 0, w: 100, h: 100 };
    return {
      left: ((o.left - rr.left) / rr.width) * 100,
      top: ((o.top - rr.top) / rr.height) * 100,
      w: (o.width / rr.width) * 100,
      h: (o.height / rr.height) * 100,
    };
  }, []);

  const readBox = useCallback((el: HTMLElement, r: DOMRect): Box => {
    // A lifted element's box is fully described by its inline style: the TRUE
    // width/height/centre (relative to its containing block) and rotation. Read
    // those and convert to canvas % — never getBoundingClientRect, whose value for
    // a ROTATED element is the inflated axis-aligned bounding box (which would make
    // the size grow on every commit). For top-level elements the conversion is the
    // identity, so this matches the previous fast path exactly.
    if (el.getAttribute('data-lifted') === '1') {
      const cx = parseFloat(el.style.left);
      const cy = parseFloat(el.style.top);
      const w = parseFloat(el.style.width);
      const h = parseFloat(el.style.height);
      if (!isNaN(cx) && !isNaN(cy) && !isNaN(w) && !isNaN(h)) {
        return fromParentPct({ cx, cy, w, h, rot: rotateOf(el.style.transform), lifted: true }, parentRectPct(el));
      }
    }
    // Measure (unlifted — never rotated, so the bounding box IS the box).
    const b = measureEl(el).getBoundingClientRect();
    return {
      cx: ((b.left + b.width / 2 - r.left) / r.width) * 100,
      cy: ((b.top + b.height / 2 - r.top) / r.height) * 100,
      w: (b.width / r.width) * 100,
      h: (b.height / r.height) * 100,
      rot: 0,
      lifted: false,
    };
  }, [measureEl, parentRectPct]);

  // `b` is a CANVAS-% box; write it as the element's containing-block-relative %.
  const applyLive = (el: HTMLElement, b: Box) => {
    const q = toParentPct(b, parentRectPct(el));
    el.style.position = 'absolute';
    el.setAttribute('data-lifted', '1');
    el.style.left = `${q.cx}%`;
    el.style.top = `${q.cy}%`;
    el.style.width = `${q.w}%`;
    el.style.height = `${q.h}%`;
    el.style.transformOrigin = 'center center';
    el.style.transform = `translate(-50%,-50%) rotate(${b.rot}deg)`;
  };

  const boundsOf = (el: HTMLElement) => ({
    minW: parseFloat(el.getAttribute('data-minw') || '') || 1,
    maxW: parseFloat(el.getAttribute('data-maxw') || '') || 100,
    minH: parseFloat(el.getAttribute('data-minh') || '') || 1,
    maxH: parseFloat(el.getAttribute('data-maxh') || '') || 100,
    move: el.getAttribute('data-move') || '',
    resize: el.getAttribute('data-resize') || '',
    rotate: el.getAttribute('data-rotate') === '1',
  });
  // A module with no move/resize/rotate is "select-only" (non-manipulable): it
  // can be framed (red dashed) + given a context menu, but never dragged/lifted.
  const hasAxes = (el: HTMLElement) => { const b = boundsOf(el); return !!(b.move || b.resize || b.rotate); };

  const snapTo = (v: number, useSnap: boolean) => (useSnap && snap && snapStep > 0 ? Math.round(v / snapStep) * snapStep : v);

  // Re-read the selected elements' boxes from the (committed) DOM, unless a drag
  // is mid-flight (then frameBoxes is driven live by the pointer handlers).
  const syncFrames = useCallback(() => {
    if (draggingRef.current) return;
    const root = rootRef.current;
    if (!root) return;
    const r = root.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    setFrameBoxes((prev) => {
      const next: Record<string, Box> = {};
      for (const key of selRef.current) {
        const el = findEl(key);
        if (el) next[key] = readBox(el, r);
      }
      // Only a real difference (key set or box) counts as changed — otherwise a
      // persistently-missing selected element would flip `changed` every render
      // and loop setState forever (white screen).
      const nk = Object.keys(next);
      let changed = nk.length !== Object.keys(prev).length;
      if (!changed) for (const k of nk) if (!boxEq(prev[k], next[k])) { changed = true; break; }
      return changed ? next : prev;
    });
  }, [findEl, readBox]);

  // After every render/commit: (1) for a short window re-assert just-committed
  // boxes onto their elements BEFORE paint (kills the brief "snap back to
  // original" flash if a stale-HTML render slips in), then (2) re-sync frames.
  useLayoutEffect(() => {
    if (draggingRef.current) return; // frame is driven live during a drag
    const root = rootRef.current;
    if (root) {
      const r = root.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        const now = performance.now();
        for (const key of Object.keys(committedRef.current)) {
          const entry = committedRef.current[key];
          if (now - entry.t > 450) { delete committedRef.current[key]; continue; }
          const el = findEl(key);
          if (el && !boxEq(readBox(el, r), entry.box)) applyLive(el, entry.box);
        }
      }
    }
    syncFrames();
  });

  // ---- drag state ------------------------------------------------------------
  interface DragItem { key: string; el: HTMLElement; start: Box }
  const drag = useRef<
    | { mode: 'move'; items: DragItem[]; psx: number; psy: number; targets: { xs: number[]; ys: number[] } }
    | { mode: 'resize'; item: DragItem; handle: string; psx: number; psy: number }
    | { mode: 'rotate'; item: DragItem; ccx: number; ccy: number }
    | { mode: 'marquee'; sx: number; sy: number; additive: boolean }
    | null
  >(null);

  // Alignment targets, captured once at drag start: slide centre/edges (0/50/100)
  // plus every OTHER module's left/centre/right (x) and top/centre/bottom (y), in
  // canvas %. The moved selection snaps its own edges/centre to these.
  const collectTargets = useCallback((r: DOMRect, movedKeys: Set<string>): { xs: number[]; ys: number[] } => {
    const xs = new Set<number>([0, 50, 100]);
    const ys = new Set<number>([0, 50, 100]);
    for (const el of els()) {
      if (movedKeys.has(keyOf(el))) continue;
      const b = readBox(el, r);
      xs.add(b.cx - b.w / 2); xs.add(b.cx); xs.add(b.cx + b.w / 2);
      ys.add(b.cy - b.h / 2); ys.add(b.cy); ys.add(b.cy + b.h / 2);
    }
    return { xs: [...xs], ys: [...ys] };
  }, [els, readBox]);

  const liveSet = (updates: Array<{ key: string; el: HTMLElement; box: Box }>) => {
    for (const u of updates) applyLive(u.el, u.box);
    setFrameBoxes((prev) => {
      const next = { ...prev };
      for (const u of updates) next[u.key] = u.box;
      return next;
    });
  };

  const commitItems = useCallback(
    (rawItems: DragItem[]) => {
      // Select-only (non-manipulable) modules never get transform args written.
      const items = rawItems.filter((it) => hasAxes(it.el));
      if (!items.length) return;
      const r = oRect();
      const now = performance.now();
      const r2 = (n: number) => Math.round(n * 100) / 100; // match moduleDocEdits fmt
      const edits = items.map((it) => {
        const b = readBox(it.el, r);                       // canvas %
        const q = toParentPct(b, parentRectPct(it.el));    // containing-block %
        // Store the rounded CANVAS box (applyLive re-converts) so the re-assert
        // guard settles once the committed HTML lands instead of fighting noise.
        committedRef.current[it.key] = { box: { ...b, cx: r2(b.cx), cy: r2(b.cy), w: r2(b.w), h: r2(b.h), rot: r2(b.rot) }, t: now };
        // The directive stores parent-relative % (== canvas % when not nested).
        // `chrome`: a header/footer module — its commit must NOT be suppressed (it
        // writes to the GLOBAL/meta directive shown on every slide, so the preview
        // must re-render or other slides keep the stale position).
        return { sel: selOf(it.key), t: { x: q.cx, y: q.cy, w: q.w, h: q.h, rot: q.rot } as TransformEdit, chrome: isChromeEl(it.el) };
      });
      onCommit(edits);
    },
    [onCommit, readBox, parentRectPct],
  );

  // ---- pointer interaction ---------------------------------------------------
  const onPointerDown = (e: React.PointerEvent) => {
    if (!enabled || !container) return;
    if (e.button !== 0) return;   // right/middle handled by onContextMenu
    setCtxMenu(null);
    const r = oRect();
    const px = pctX(e.clientX, r), py = pctY(e.clientY, r);

    const handleEl = (e.target as HTMLElement).closest('[data-mdp-handle]') as HTMLElement | null;
    if (handleEl && selRef.current.length === 1) {
      const el = findEl(selRef.current[0]);
      if (el) {
        e.preventDefault();
        rootRef.current!.setPointerCapture(e.pointerId);
        draggingRef.current = true;
        const start = readBox(el, r);
        const handle = handleEl.getAttribute('data-mdp-handle')!;
        if (handle === 'rotate') {
          const ccx = r.left + (start.cx / 100) * r.width;
          const ccy = r.top + (start.cy / 100) * r.height;
          drag.current = { mode: 'rotate', item: { key: selRef.current[0], el, start }, ccx, ccy };
        } else {
          drag.current = { mode: 'resize', item: { key: selRef.current[0], el, start }, handle, psx: px, psy: py };
        }
        return;
      }
    }

    // Hit-test module elements (topmost in DOM order containing the point).
    let hit: HTMLElement | null = null;
    for (const el of els()) {
      const b = measureEl(el).getBoundingClientRect();
      if (e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom) hit = el;
    }

    if (hit) {
      e.preventDefault();
      rootRef.current!.setPointerCapture(e.pointerId);
      const key = keyOf(hit);
      let sel = selRef.current;
      if (e.shiftKey) {
        sel = sel.includes(key) ? sel.filter((k) => k !== key) : [...sel, key];
        setSelected(sel);
      } else if (!sel.includes(key)) {
        sel = [key];
        setSelected(sel);
      }
      // A single (non-shift) selection jumps the editor cursor to its directive —
      // but NOT for chrome (header/footer) modules: a global header's directive
      // lives in the meta page, so jumping there would yank the preview to slide 1.
      if (!e.shiftKey && !isChromeEl(hit)) onSelect?.(selOf(key));
      // Select-only (non-manipulable) module: show the frame, but no drag/lift.
      if (!hasAxes(hit)) {
        draggingRef.current = false;
        drag.current = null;
        setFrameBoxes(() => {
          const next: Record<string, Box> = {};
          for (const k of sel) { const el = findEl(k); if (el) next[k] = readBox(el, r); }
          return next;
        });
        return;
      }
      draggingRef.current = true;
      const items: DragItem[] = sel.map((k) => { const el = findEl(k); return el ? { key: k, el, start: readBox(el, r) } : null; }).filter(Boolean) as DragItem[];
      const targets = collectTargets(r, new Set(items.map((i) => i.key)));
      drag.current = { mode: 'move', items, psx: px, psy: py, targets };
      // Reveal the selection frame (+ resize/rotate handles) immediately on
      // press — a plain click now shows the box, instead of only once a drag
      // actually moves. (syncFrames is suppressed while draggingRef is set, so
      // we seed the boxes here from the elements' current geometry.)
      setFrameBoxes(() => {
        const next: Record<string, Box> = {};
        for (const it of items) next[it.key] = it.start;
        return next;
      });
    } else {
      if (!e.shiftKey) setSelected([]);
      rootRef.current!.setPointerCapture(e.pointerId);
      drag.current = { mode: 'marquee', sx: px, sy: py, additive: e.shiftKey };
      setMarquee({ x0: px, y0: py, x1: px, y1: py });
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const r = oRect();
    const px = pctX(e.clientX, r), py = pctY(e.clientY, r);

    if (d.mode === 'move') {
      const dx = px - d.psx, dy = py - d.psy;
      // Proposed positions (grid snap applies only when its toggle is on; Alt = free).
      const prop = d.items.map((it) => {
        const bnd = boundsOf(it.el);
        return {
          it, bnd,
          cx: bnd.move.includes('x') ? snapTo(it.start.cx + dx, !e.altKey) : it.start.cx,
          cy: bnd.move.includes('y') ? snapTo(it.start.cy + dy, !e.altKey) : it.start.cy,
        };
      });
      // Smart alignment guides (Alt bypasses). Snap the moved selection's
      // bounding box (left/centre/right, top/centre/bottom) to the cached targets.
      const nextGuides: Array<{ axis: 'x' | 'y'; pos: number }> = [];
      if (!e.altKey) {
        const xMov = prop.filter((p) => p.bnd.move.includes('x'));
        const yMov = prop.filter((p) => p.bnd.move.includes('y'));
        const thX = (SNAP_PX / r.width) * 100, thY = (SNAP_PX / r.height) * 100;
        if (xMov.length) {
          const left = Math.min(...xMov.map((p) => p.cx - p.it.start.w / 2));
          const right = Math.max(...xMov.map((p) => p.cx + p.it.start.w / 2));
          const s = snapAxis([left, (left + right) / 2, right], d.targets.xs, thX);
          if (s) { for (const p of xMov) p.cx += s.delta; nextGuides.push({ axis: 'x', pos: s.target }); }
        }
        if (yMov.length) {
          const top = Math.min(...yMov.map((p) => p.cy - p.it.start.h / 2));
          const bottom = Math.max(...yMov.map((p) => p.cy + p.it.start.h / 2));
          const s = snapAxis([top, (top + bottom) / 2, bottom], d.targets.ys, thY);
          if (s) { for (const p of yMov) p.cy += s.delta; nextGuides.push({ axis: 'y', pos: s.target }); }
        }
      }
      setGuides(nextGuides);
      liveSet(prop.map((p) => ({ key: p.it.key, el: p.it.el, box: { ...p.it.start, cx: clamp(p.cx, 0, 100), cy: clamp(p.cy, 0, 100) } })));
    } else if (d.mode === 'resize') {
      const { item, handle } = d;
      const hd = HANDLES[handle];
      const bnd = boundsOf(item.el);
      const dx = px - d.psx, dy = py - d.psy;
      let { cx, cy, w, h } = item.start;
      if (hd.hx !== 0 && bnd.resize.includes('x')) {
        if (hd.hx > 0) { const left = item.start.cx - item.start.w / 2; const nr = item.start.cx + item.start.w / 2 + dx; w = snapTo(clamp(nr - left, bnd.minW, bnd.maxW), !e.altKey); cx = left + w / 2; }
        else { const right = item.start.cx + item.start.w / 2; const nl = item.start.cx - item.start.w / 2 + dx; w = snapTo(clamp(right - nl, bnd.minW, bnd.maxW), !e.altKey); cx = right - w / 2; }
      }
      if (hd.vy !== 0 && bnd.resize.includes('y')) {
        if (hd.vy > 0) { const top = item.start.cy - item.start.h / 2; const nb = item.start.cy + item.start.h / 2 + dy; h = snapTo(clamp(nb - top, bnd.minH, bnd.maxH), !e.altKey); cy = top + h / 2; }
        else { const bot = item.start.cy + item.start.h / 2; const nt = item.start.cy - item.start.h / 2 + dy; h = snapTo(clamp(bot - nt, bnd.minH, bnd.maxH), !e.altKey); cy = bot - h / 2; }
      }
      liveSet([{ key: item.key, el: item.el, box: { ...item.start, cx, cy, w, h } }]);
    } else if (d.mode === 'rotate') {
      const ang = (Math.atan2(e.clientY - d.ccy, e.clientX - d.ccx) * 180) / Math.PI + 90;
      const step = e.shiftKey ? 15 : 1;
      const rot = Math.round(ang / step) * step;
      liveSet([{ key: d.item.key, el: d.item.el, box: { ...d.item.start, rot } }]);
    } else if (d.mode === 'marquee') {
      setMarquee({ x0: d.sx, y0: d.sy, x1: px, y1: py });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    draggingRef.current = false;
    setGuides([]);   // drop alignment guides once the drag ends
    try { rootRef.current?.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (!d) return;
    if (d.mode === 'move') commitItems(d.items);
    else if (d.mode === 'resize' || d.mode === 'rotate') commitItems([d.item]);
    else if (d.mode === 'marquee') {
      const r = oRect();
      const mx0 = (Math.min(d.sx, pctX(e.clientX, r)) / 100) * r.width + r.left;
      const mx1 = (Math.max(d.sx, pctX(e.clientX, r)) / 100) * r.width + r.left;
      const my0 = (Math.min(d.sy, pctY(e.clientY, r)) / 100) * r.height + r.top;
      const my1 = (Math.max(d.sy, pctY(e.clientY, r)) / 100) * r.height + r.top;
      const hits = els().filter((el) => {
        const b = measureEl(el).getBoundingClientRect();
        return b.left < mx1 && b.right > mx0 && b.top < my1 && b.bottom > my0;
      }).map(keyOf);
      setSelected((prev) => (d.additive ? Array.from(new Set([...prev, ...hits])) : hits));
      setMarquee(null);
    }
  };

  const onContextMenu = (e: React.MouseEvent) => {
    if (!enabled || !container) { setCtxMenu(null); return; }
    let hit: HTMLElement | null = null;
    for (const el of els()) {
      const b = measureEl(el).getBoundingClientRect();
      if (e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom) hit = el;
    }
    e.preventDefault();
    const r = oRect();
    const px = pctX(e.clientX, r), py = pctY(e.clientY, r);
    if (hit) {
      const key = keyOf(hit);
      setSelected([key]);   // visually select; don't steal editor focus on right-click
      setCtxMenu({ x: e.clientX, y: e.clientY, key, px, py });
    } else {
      // Empty canvas: only a "Paste here" menu, and only if the clipboard has a
      // module (else there's nothing to offer).
      if (!moduleClipboard) { setCtxMenu(null); return; }
      setSelected([]);
      setCtxMenu({ x: e.clientX, y: e.clientY, key: null, px, py });
    }
  };

  // ---- reorder / copy / paste (shared by the context menu and keyboard) -------
  // Reorder rewrites the directive's text position; the moved module takes a new
  // ord, so re-point the selection to it.
  const doReorder = useCallback((key: string, dir: 1 | -1) => {
    const newOrd = onReorder?.(selOf(key), dir);
    if (newOrd != null) setSelected([`ord:${newOrd}`]);
  }, [onReorder]);
  const doCopy = useCallback((key: string) => {
    const t = onCopyText?.(selOf(key));
    if (t != null) moduleClipboard = t;
  }, [onCopyText]);
  const doPaste = useCallback((afterKey: string) => {
    if (!moduleClipboard) return;
    const newOrd = onPaste?.(selOf(afterKey), moduleClipboard);
    if (newOrd != null) setSelected([`ord:${newOrd}`]);
  }, [onPaste]);
  // Paste on empty canvas at the clicked (px, py) %.
  const doPasteAt = useCallback((px: number, py: number) => {
    if (!moduleClipboard) return;
    const newOrd = onPasteAt?.(moduleClipboard, px, py);
    if (newOrd != null) setSelected([`ord:${newOrd}`]);
  }, [onPasteAt]);

  // ---- keyboard --------------------------------------------------------------
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const sel = selRef.current;
      if (!sel.length) return;
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || (document.activeElement as HTMLElement)?.isContentEditable) return;

      // Copy / paste / duplicate (Ctrl/Cmd + C / V / D) act on a single selection.
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === 'c' && sel.length === 1) { e.preventDefault(); doCopy(sel[0]); return; }
        if (k === 'v' && sel.length === 1 && moduleClipboard) { e.preventDefault(); doPaste(sel[0]); return; }
        if (k === 'd' && sel.length === 1) { e.preventDefault(); doCopy(sel[0]); doPaste(sel[0]); return; }
      }

      const action = matchAction(e, ACTIONS_BY_SCOPE.manipulation, settings);
      if (action?.id === 'manip.deselect') { setSelected([]); setCtxMenu(null); return; }
      if (action?.id === 'manip.delete') {
        e.preventDefault();
        onDelete(sel.map(selOf));
        setSelected([]); setCtxMenu(null);
        return;
      }
      const r = rootRef.current?.getBoundingClientRect();
      if (!r) return;
      const allItems = sel.map((k) => { const el = findEl(k); return el ? { key: k, el, start: readBox(el, r) } : null; }).filter(Boolean) as DragItem[];
      // Only manipulable items respond to arrow-nudge / rotate keys.
      const items = allItems.filter((it) => hasAxes(it.el));
      if (!items.length) return;

      const step = e.altKey ? 0.1 : e.shiftKey ? Math.max(snapStep, 1) : 0.5;
      let handled = true;
      const arrow = e.key === 'ArrowLeft' ? [-1, 0] : e.key === 'ArrowRight' ? [1, 0] : e.key === 'ArrowUp' ? [0, -1] : e.key === 'ArrowDown' ? [0, 1] : null;
      if (arrow) {
        liveSet(items.map((it) => {
          const bnd = boundsOf(it.el);
          const b = { ...it.start };
          if (e.ctrlKey || e.metaKey) {
            if (arrow[0] && bnd.resize.includes('x')) b.w = clamp(b.w + arrow[0] * step, bnd.minW, bnd.maxW);
            if (arrow[1] && bnd.resize.includes('y')) b.h = clamp(b.h + arrow[1] * step, bnd.minH, bnd.maxH);
          } else {
            if (arrow[0] && bnd.move.includes('x')) b.cx = clamp(b.cx + arrow[0] * step, 0, 100);
            if (arrow[1] && bnd.move.includes('y')) b.cy = clamp(b.cy + arrow[1] * step, 0, 100);
          }
          return { key: it.key, el: it.el, box: b };
        }));
      } else if (e.key === '[' || e.key === ']') {
        const dr = (e.key === ']' ? 1 : -1) * (e.shiftKey ? 15 : 1);
        liveSet(items.filter((it) => boundsOf(it.el).rotate).map((it) => ({ key: it.key, el: it.el, box: { ...it.start, rot: it.start.rot + dr } })));
      } else handled = false;

      if (handled) { e.preventDefault(); commitItems(items); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, snapStep, findEl, readBox, commitItems, settings, onDelete, doCopy, doPaste]);

  // Drop selection when leaving edit mode.
  useEffect(() => { if (!enabled) { setSelected([]); setMarquee(null); setFrameBoxes({}); setCtxMenu(null); setGuides([]); } }, [enabled]);

  if (!enabled) return null;

  const frames = selected.map((key) => (frameBoxes[key] ? { key, box: frameBoxes[key] } : null)).filter(Boolean) as Array<{ key: string; box: Box }>;
  const single = frames.length === 1 ? frames[0] : null;
  const singleEl = single ? findEl(single.key) : null;
  const sb = singleEl ? boundsOf(singleEl) : null;

  const resizeHandles: string[] = [];
  if (sb) {
    const rx = sb.resize.includes('x'), ry = sb.resize.includes('y');
    if (rx) resizeHandles.push('e', 'w');
    if (ry) resizeHandles.push('n', 's');
    if (rx && ry) resizeHandles.push('ne', 'nw', 'se', 'sw');
  }

  return (
    <div
      ref={rootRef}
      className="mdp-manip-overlay"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onContextMenu={onContextMenu}
      style={{ position: 'absolute', inset: 0, zIndex: 60, touchAction: 'none', cursor: 'default' }}
    >
      {frames.map(({ key, box }) => {
        const fEl = findEl(key);
        const selOnly = fEl ? !hasAxes(fEl) : false;   // non-manipulable → dashed
        const chrome = fEl ? isChromeEl(fEl) : false;  // header/footer → green/orange
        const isSingle = single && single.key === key;
        // Content: blue (manip) / red (select-only). Chrome: green / orange.
        const solid = chrome ? '#16a34a' : '#3b82f6';
        const solidDim = chrome ? 'rgba(22,163,74,0.6)' : 'rgba(59,130,246,0.6)';
        const dash = chrome ? '#f59e0b' : '#ef4444';
        const dashDim = chrome ? 'rgba(245,158,11,0.6)' : 'rgba(239,68,68,0.6)';
        const border = selOnly
          ? `1.5px dashed ${isSingle ? dash : dashDim}`
          : `1.5px solid ${isSingle ? solid : solidDim}`;
        return (
        <div
          key={key}
          style={{
            position: 'absolute', left: `${box.cx}%`, top: `${box.cy}%`, width: `${box.w}%`, height: `${box.h}%`,
            transform: `translate(-50%,-50%) rotate(${box.rot}deg)`, transformOrigin: 'center center',
            border,
            boxShadow: '0 0 0 1px rgba(255,255,255,0.5)', pointerEvents: 'none', boxSizing: 'border-box',
          }}
        >
          {single && single.key === key && sb && (
            <>
              {resizeHandles.map((dir) => {
                const hd = HANDLES[dir];
                return (
                  <div key={dir} data-mdp-handle={dir}
                    style={{
                      position: 'absolute', left: `${hd.fx}%`, top: `${hd.fy}%`, width: 11, height: 11,
                      transform: 'translate(-50%,-50%)', background: '#fff', border: '1.5px solid #3b82f6',
                      borderRadius: 2, pointerEvents: 'auto', cursor: hd.cur,
                    }} />
                );
              })}
              {sb.rotate && (
                <div data-mdp-handle="rotate"
                  style={{
                    position: 'absolute', left: '50%', top: 0, width: 12, height: 12, marginTop: -26,
                    transform: 'translate(-50%,-50%)', background: '#3b82f6', border: '1.5px solid #fff',
                    borderRadius: '50%', pointerEvents: 'auto', cursor: 'grab',
                  }} />
              )}
            </>
          )}
        </div>
        );
      })}

      {marquee && (
        <div style={{
          position: 'absolute', left: `${Math.min(marquee.x0, marquee.x1)}%`, top: `${Math.min(marquee.y0, marquee.y1)}%`,
          width: `${Math.abs(marquee.x1 - marquee.x0)}%`, height: `${Math.abs(marquee.y1 - marquee.y0)}%`,
          border: '1px dashed #3b82f6', background: 'rgba(59,130,246,0.1)', pointerEvents: 'none',
        }} />
      )}

      {/* Smart alignment guides (slide centre/edges + other modules). */}
      {guides.map((g, i) => (
        <div
          key={`g${i}`}
          style={g.axis === 'x'
            ? { position: 'absolute', left: `${g.pos}%`, top: 0, bottom: 0, width: 0, borderLeft: '1px dashed #ff2d9b', pointerEvents: 'none', zIndex: 65 }
            : { position: 'absolute', top: `${g.pos}%`, left: 0, right: 0, height: 0, borderTop: '1px dashed #ff2d9b', pointerEvents: 'none', zIndex: 65 }}
        />
      ))}

      {/* Right-click menu — portalled to <body> so position:fixed uses viewport
          coords (the slide overlay is transformed, which would otherwise re-anchor
          a fixed element). */}
      {ctxMenu && createPortal(
        <>
          <div
            onPointerDown={() => setCtxMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null); }}
            style={{ position: 'fixed', inset: 0, zIndex: 10000 }}
          />
          <div style={{
            position: 'fixed', left: ctxMenu.x, top: ctxMenu.y, zIndex: 10001, minWidth: 150,
            background: 'var(--app-bg-panel)', color: 'var(--app-text-secondary)',
            border: '1px solid var(--app-border)', borderRadius: 6, padding: '4px 0',
            boxShadow: '0 6px 20px rgba(0,0,0,0.35)', fontSize: '0.85rem',
          }}>
            {ctxMenu.key === null ? (
              <CtxItem onClick={() => { doPasteAt(ctxMenu.px, ctxMenu.py); setCtxMenu(null); }}>📋  Paste here</CtxItem>
            ) : (
            <>
            <CtxItem onClick={() => { doReorder(ctxMenu.key!, 1); setCtxMenu(null); }}>⬆  Bring forward</CtxItem>
            <CtxItem onClick={() => { doReorder(ctxMenu.key!, -1); setCtxMenu(null); }}>⬇  Send backward</CtxItem>
            <div style={{ height: 1, background: 'var(--app-border)', margin: '4px 0' }} />
            <CtxItem onClick={() => { doCopy(ctxMenu.key!); setCtxMenu(null); }}>⧉  Copy</CtxItem>
            <CtxItem onClick={() => { doCopy(ctxMenu.key!); doPaste(ctxMenu.key!); setCtxMenu(null); }}>⧉  Duplicate</CtxItem>
            {moduleClipboard && (
              <CtxItem onClick={() => { doPaste(ctxMenu.key!); setCtxMenu(null); }}>📋  Paste</CtxItem>
            )}
            <div style={{ height: 1, background: 'var(--app-border)', margin: '4px 0' }} />
            <CtxItem onClick={() => { onRequestProperty?.(selOf(ctxMenu.key!)); setCtxMenu(null); }}>⚙  Property…</CtxItem>
            <CtxItem danger onClick={() => { onDelete([selOf(ctxMenu.key!)]); setSelected([]); setCtxMenu(null); }}>🗑  Delete</CtxItem>
            </>
            )}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
};
