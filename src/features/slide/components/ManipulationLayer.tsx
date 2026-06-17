import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  onCommit: (edits: Array<{ sel: DirectiveSelector; t: TransformEdit }>) => void;
  onDelete: (sels: DirectiveSelector[]) => void;
}

interface Props {
  container: HTMLElement | null;             // the .slide-content node holding .mdp-manip
  runtime: ManipRuntime;
}

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

export const ManipulationLayer: React.FC<Props> = ({ container, runtime }) => {
  const { enabled, snap, snapStep, onCommit, onDelete } = runtime;
  const { settings } = useAppSettings();
  const rootRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string[]>([]);
  // Frame boxes are kept in STATE (not read during render) so they reflect the
  // committed DOM after a re-render instead of lagging a frame behind.
  const [frameBoxes, setFrameBoxes] = useState<Record<string, Box>>({});
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

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

  const els = useCallback(
    (): HTMLElement[] => (container ? Array.from(container.querySelectorAll<HTMLElement>('.mdp-manip')) : []),
    [container],
  );
  const findEl = useCallback(
    (key: string): HTMLElement | null =>
      container ? container.querySelector<HTMLElement>(`.mdp-manip[data-mdp-ord="${CSS.escape(key.slice(4))}"]`) : null,
    [container],
  );

  const readBox = useCallback((el: HTMLElement, r: DOMRect): Box => {
    // Fast path: a lifted element's box is fully described by its inline style
    // (percent). Read those directly — deterministic and reflow-free, so frame
    // sync converges instead of churning on sub-pixel getBoundingClientRect noise.
    if (el.getAttribute('data-lifted') === '1') {
      const cx = parseFloat(el.style.left);
      const cy = parseFloat(el.style.top);
      const w = parseFloat(el.style.width);
      const h = parseFloat(el.style.height);
      if (!isNaN(cx) && !isNaN(cy) && !isNaN(w) && !isNaN(h)) {
        return { cx, cy, w, h, rot: rotateOf(el.style.transform), lifted: true };
      }
    }
    // Measure (unlifted, or lifted with incomplete style).
    const b = el.getBoundingClientRect();
    return {
      cx: ((b.left + b.width / 2 - r.left) / r.width) * 100,
      cy: ((b.top + b.height / 2 - r.top) / r.height) * 100,
      w: (b.width / r.width) * 100,
      h: (b.height / r.height) * 100,
      rot: 0,
      lifted: el.getAttribute('data-lifted') === '1',
    };
  }, []);

  const applyLive = (el: HTMLElement, b: Box) => {
    el.style.position = 'absolute';
    el.setAttribute('data-lifted', '1');
    el.style.left = `${b.cx}%`;
    el.style.top = `${b.cy}%`;
    el.style.width = `${b.w}%`;
    el.style.height = `${b.h}%`;
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
    | { mode: 'move'; items: DragItem[]; psx: number; psy: number }
    | { mode: 'resize'; item: DragItem; handle: string; psx: number; psy: number }
    | { mode: 'rotate'; item: DragItem; ccx: number; ccy: number }
    | { mode: 'marquee'; sx: number; sy: number; additive: boolean }
    | null
  >(null);

  const liveSet = (updates: Array<{ key: string; el: HTMLElement; box: Box }>) => {
    for (const u of updates) applyLive(u.el, u.box);
    setFrameBoxes((prev) => {
      const next = { ...prev };
      for (const u of updates) next[u.key] = u.box;
      return next;
    });
  };

  const commitItems = useCallback(
    (items: DragItem[]) => {
      const r = oRect();
      const now = performance.now();
      const r2 = (n: number) => Math.round(n * 100) / 100; // match moduleDocEdits fmt
      const edits = items.map((it) => {
        const b = readBox(it.el, r);
        // Store the rounded box (as written to the doc) so the guard settles
        // once the committed HTML lands instead of fighting rounding noise.
        committedRef.current[it.key] = { box: { ...b, cx: r2(b.cx), cy: r2(b.cy), w: r2(b.w), h: r2(b.h), rot: r2(b.rot) }, t: now };
        return { sel: selOf(it.key), t: { x: b.cx, y: b.cy, w: b.w, h: b.h, rot: b.rot } as TransformEdit };
      });
      onCommit(edits);
    },
    [onCommit, readBox],
  );

  // ---- pointer interaction ---------------------------------------------------
  const onPointerDown = (e: React.PointerEvent) => {
    if (!enabled || !container) return;
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

    // Hit-test manipulable elements (topmost in DOM order containing the point).
    let hit: HTMLElement | null = null;
    for (const el of els()) {
      const b = el.getBoundingClientRect();
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
      draggingRef.current = true;
      const items: DragItem[] = sel.map((k) => { const el = findEl(k); return el ? { key: k, el, start: readBox(el, r) } : null; }).filter(Boolean) as DragItem[];
      drag.current = { mode: 'move', items, psx: px, psy: py };
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
      liveSet(d.items.map((it) => {
        const bnd = boundsOf(it.el);
        const cx = bnd.move.includes('x') ? snapTo(it.start.cx + dx, !e.altKey) : it.start.cx;
        const cy = bnd.move.includes('y') ? snapTo(it.start.cy + dy, !e.altKey) : it.start.cy;
        return { key: it.key, el: it.el, box: { ...it.start, cx: clamp(cx, 0, 100), cy: clamp(cy, 0, 100) } };
      }));
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
        const b = el.getBoundingClientRect();
        return b.left < mx1 && b.right > mx0 && b.top < my1 && b.bottom > my0;
      }).map(keyOf);
      setSelected((prev) => (d.additive ? Array.from(new Set([...prev, ...hits])) : hits));
      setMarquee(null);
    }
  };

  // ---- keyboard --------------------------------------------------------------
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const sel = selRef.current;
      if (!sel.length) return;
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || (document.activeElement as HTMLElement)?.isContentEditable) return;

      const action = matchAction(e, ACTIONS_BY_SCOPE.manipulation, settings);
      if (action?.id === 'manip.deselect') { setSelected([]); return; }
      if (action?.id === 'manip.delete') {
        e.preventDefault();
        onDelete(sel.map(selOf));
        setSelected([]);
        return;
      }
      const r = rootRef.current?.getBoundingClientRect();
      if (!r) return;
      const items = sel.map((k) => { const el = findEl(k); return el ? { key: k, el, start: readBox(el, r) } : null; }).filter(Boolean) as DragItem[];
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
  }, [enabled, snapStep, findEl, readBox, commitItems, onDelete, settings]);

  // Drop selection when leaving edit mode.
  useEffect(() => { if (!enabled) { setSelected([]); setMarquee(null); setFrameBoxes({}); } }, [enabled]);

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
      style={{ position: 'absolute', inset: 0, zIndex: 60, touchAction: 'none', cursor: 'default' }}
    >
      {frames.map(({ key, box }) => (
        <div
          key={key}
          style={{
            position: 'absolute', left: `${box.cx}%`, top: `${box.cy}%`, width: `${box.w}%`, height: `${box.h}%`,
            transform: `translate(-50%,-50%) rotate(${box.rot}deg)`, transformOrigin: 'center center',
            border: `1.5px solid ${single && single.key === key ? '#3b82f6' : 'rgba(59,130,246,0.6)'}`,
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
      ))}

      {marquee && (
        <div style={{
          position: 'absolute', left: `${Math.min(marquee.x0, marquee.x1)}%`, top: `${Math.min(marquee.y0, marquee.y1)}%`,
          width: `${Math.abs(marquee.x1 - marquee.x0)}%`, height: `${Math.abs(marquee.y1 - marquee.y0)}%`,
          border: '1px dashed #3b82f6', background: 'rgba(59,130,246,0.1)', pointerEvents: 'none',
        }} />
      )}
    </div>
  );
};
