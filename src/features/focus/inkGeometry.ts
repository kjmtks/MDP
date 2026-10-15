// The strokes of an ink cue (ink.ts), worked out from where its targets are NOW —
// on every showing, so the ink follows the slide when its layout changes. Pure:
// boxes in, SVG paths out (in the slide's CSS px). FocusLayer measures the boxes and
// draws the paths; the checks (focusCheck) read the same plan.
//
// A pen's look: every stroke wobbles a little — the same way every time (seeded by
// the cue's text), so a slide looks alike on every surface and in every frame of a
// video — and is written at a pen's pace (CSS animates it: InkStroke.delay / dur).
import type { FocusBox } from './focusTargets';
import { isRoute, parseVia } from './ink';

export interface InkPt { x: number; y: number }
/** One end of an arrow / one target: its box, the lines it is written on (an
 *  underline follows them) and — written "#fig(62,40)" — a point inside it. */
export interface InkEnd { box: FocusBox; lines?: FocusBox[]; point?: InkPt }
export interface InkStroke { d: string; length: number; delay: number; dur: number }
export interface InkPlan {
  strokes: InkStroke[];
  /** How much of an arrow / a line runs over text, 0..1 — and how many lines of text it crosses. */
  overlap: number;
  crosses?: number;
  /** Where an arrow bows (above / below / left / right; '' = straight), how far. */
  side?: string;
  bend?: number;
  /** A part of it lies off the slide. */
  off: boolean;
  /** An arrow / a line: where it starts and where it ends (its tip). */
  endsAt?: { from: InkPt; to: InkPt };
  /** An arrow / a line: the points its shaft is drawn through (the editor's handles
   *  sit on it). */
  shaft?: InkPt[];
  /** The route taken through points beside the line, when it was chosen here (no
   *  side / bend / via given): via=… keeps it so. */
  via?: string;
  problems: string[];
}
export interface InkInput {
  shape: string;
  ends: InkEnd[];
  options: Record<string, string>;
  W: number;
  H: number;
  /** The slide's height / 540: sizes follow the slide. */
  u: number;
  /** Text on the slide an arrow should not run over. */
  obstacles: FocusBox[];
  /** The cue as written: the same hand every time. */
  seed: string;
}

// ---- small geometry ----------------------------------------------------------------
const P = (x: number, y: number): InkPt => ({ x, y });
const plus = (a: InkPt, b: InkPt) => P(a.x + b.x, a.y + b.y);
const minus = (a: InkPt, b: InkPt) => P(a.x - b.x, a.y - b.y);
const times = (a: InkPt, k: number) => P(a.x * k, a.y * k);
const size = (a: InkPt) => Math.hypot(a.x, a.y);
const lerp = (a: InkPt, b: InkPt, t: number) => P(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
const unit = (a: InkPt) => { const l = size(a) || 1; return P(a.x / l, a.y / l); };
const rotate = (a: InkPt, deg: number) => {
  const r = (deg * Math.PI) / 180;
  return P(a.x * Math.cos(r) - a.y * Math.sin(r), a.x * Math.sin(r) + a.y * Math.cos(r));
};
const centerOf = (b: FocusBox) => P(b.x + b.w / 2, b.y + b.h / 2);
const within = (p: InkPt, b: FocusBox, pad = 0) =>
  p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad;
const meets = (a: FocusBox, b: FocusBox, pad = 0) =>
  a.x - pad < b.x + b.w && b.x < a.x + a.w + pad && a.y - pad < b.y + b.h && b.y < a.y + a.h + pad;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const union = (boxes: FocusBox[]): FocusBox => {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
};
const lengthOf = (pts: InkPt[]) => pts.reduce((s, p, i) => (i ? s + size(minus(p, pts[i - 1])) : 0), 0);

// The same hand every time: a small PRNG seeded by the cue's text.
function randomFrom(seed: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  let a = h >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Cubic = [InkPt, InkPt, InkPt, InkPt];
const onCubic = ([p0, p1, p2, p3]: Cubic, t: number): InkPt => {
  const s = 1 - t;
  return P(
    s * s * s * p0.x + 3 * s * s * t * p1.x + 3 * s * t * t * p2.x + t * t * t * p3.x,
    s * s * s * p0.y + 3 * s * s * t * p1.y + 3 * s * t * t * p2.y + t * t * t * p3.y,
  );
};
/** Points along the curves, about `n` in all, shared out by their lengths. */
function sample(curves: Cubic[], n: number): InkPt[] {
  const lens = curves.map((c) => size(minus(c[3], c[0])) + 1e-6);
  const all = lens.reduce((a, b) => a + b, 0);
  const out: InkPt[] = [curves[0][0]];
  curves.forEach((c, i) => {
    const k = Math.max(2, Math.round((n * lens[i]) / all));
    for (let j = 1; j <= k; j++) out.push(onCubic(c, j / k));
  });
  return out;
}
/** A smooth curve through the points (Catmull–Rom, as cubic pieces). */
function through(pts: InkPt[]): Cubic[] {
  const out: Cubic[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    out.push([p1, plus(p1, times(minus(p2, p0), 1 / 6)), minus(p2, times(minus(p3, p1), 1 / 6)), p2]);
  }
  return out;
}
const quad = (p0: InkPt, c: InkPt, p1: InkPt): Cubic => [p0, lerp(p0, c, 2 / 3), lerp(p1, c, 2 / 3), p1];

/** The pen's small unsteadiness: points moved across the line, smoothly, most in the
 *  middle and not at all at the ends (where the line meets what it is about). */
function wobble(pts: InkPt[], amp: number, rnd: () => number): InkPt[] {
  if (pts.length < 3 || amp <= 0) return pts;
  const f1 = 0.7 + rnd() * 0.6;
  const f2 = 1.8 + rnd() * 0.8;
  const p1 = rnd() * Math.PI * 2;
  const p2 = rnd() * Math.PI * 2;
  return pts.map((p, i) => {
    if (i === 0 || i === pts.length - 1) return p;
    const t = i / (pts.length - 1);
    const tan = unit(minus(pts[Math.min(pts.length - 1, i + 1)], pts[Math.max(0, i - 1)]));
    const off = amp * Math.pow(Math.sin(Math.PI * t), 0.6) * (0.6 * Math.sin(2 * Math.PI * f1 * t + p1) + 0.4 * Math.sin(2 * Math.PI * f2 * t + p2));
    return plus(p, P(-tan.y * off, tan.x * off));
  });
}

const fmt = (p: InkPt) => `${Math.round(p.x * 10) / 10} ${Math.round(p.y * 10) / 10}`;
/** A path through the points, smoothed (each point a control, the curve through the
 *  middles between them). */
function pathOf(pts: InkPt[]): string {
  if (pts.length < 2) return '';
  if (pts.length === 2) return `M ${fmt(pts[0])} L ${fmt(pts[1])}`;
  let d = `M ${fmt(pts[0])}`;
  for (let i = 1; i < pts.length - 1; i++) d += ` Q ${fmt(pts[i])} ${fmt(lerp(pts[i], pts[i + 1], 0.5))}`;
  return `${d} L ${fmt(pts[pts.length - 1])}`;
}

// ---- the pen's pace ---------------------------------------------------------------
const paceOf = (len: number, u: number) => clamp(0.2 + len / (1000 * u), 0.25, 1.5);
function seconds(text: string | undefined): number | null {
  const m = /^(\d+(?:\.\d+)?)(ms|s)?$/.exec(String(text || '').trim());
  if (!m) return null;
  const v = Number(m[1]);
  return m[2] === 'ms' ? v / 1000 : v;
}
/** Strokes one after another (a short lift of the pen between them); `dur=` sets the whole. */
function timed(strokes: { pts: InkPt[]; dur?: number }[], u: number, total: number | null): InkStroke[] {
  let at = 0;
  const out = strokes.filter((s) => s.pts.length >= 2).map((s) => {
    const length = lengthOf(s.pts);
    const dur = s.dur ?? paceOf(length, u);
    const st = { d: pathOf(s.pts), length, delay: at, dur };
    at += dur + 0.06;
    return st;
  });
  const end = out.length ? out[out.length - 1].delay + out[out.length - 1].dur : 0;
  if (total && end > 0) {
    const k = total / end;
    for (const s of out) { s.delay *= k; s.dur *= k; }
  }
  for (const s of out) { s.delay = Math.round(s.delay * 1000) / 1000; s.dur = Math.round(s.dur * 1000) / 1000; }
  return out;
}

const offSlide = (pts: InkPt[], W: number, H: number) => pts.some((p) => p.x < -1 || p.y < -1 || p.x > W + 1 || p.y > H + 1);

// ---- arrows and lines ---------------------------------------------------------------
const SIDE_VEC: Record<string, InkPt> = { above: P(0, -1), below: P(0, 1), left: P(-1, 0), right: P(1, 0) };
const sideOf = (v: InkPt): string => (Math.abs(v.x) > Math.abs(v.y) ? (v.x < 0 ? 'left' : 'right') : (v.y < 0 ? 'above' : 'below'));

interface Route { pts: InkPt[]; overlap: number; crosses: number; off: boolean; side: string; bend: number; via: string }

/** Where the segment from `inside` to `outside` leaves the box (grown by `pad`). */
function exitPoint(inside: InkPt, outside: InkPt, box: FocusBox, pad: number): InkPt {
  let a = 0;
  let b = 1;
  for (let k = 0; k < 14; k++) {
    const m = (a + b) / 2;
    if (within(lerp(inside, outside, m), box, pad)) a = m; else b = m;
  }
  return lerp(inside, outside, b);
}

/** The curve between its ends: from where it leaves FROM's box (a little out from
 *  it) to where it reaches TO's — or, at a point, from the point / to just short of
 *  it — cut between samples, not at them. */
function clipped(pts: InkPt[], from: InkEnd, to: InkEnd, gap: number, tip: number): InkPt[] {
  let i0 = 0;
  let start: InkPt = pts[0];
  if (!from.point) {
    while (i0 < pts.length - 1 && within(pts[i0], from.box, gap)) i0++;
    if (i0 > 0) start = exitPoint(pts[i0 - 1], pts[i0], from.box, gap);
  }
  let i1 = pts.length - 1;
  let end: InkPt = pts[i1];
  if (!to.point) {
    while (i1 > i0 && within(pts[i1], to.box, gap)) i1--;
    if (i1 < pts.length - 1) end = exitPoint(pts[i1 + 1], pts[i1], to.box, gap);
  } else {
    // Back along the curve by `tip`: the arrowhead's point just short of the spot.
    let back = tip;
    while (i1 > i0 + 1 && back > size(minus(pts[i1], pts[i1 - 1]))) { back -= size(minus(pts[i1], pts[i1 - 1])); i1--; }
    const seg = size(minus(pts[i1], pts[i1 - 1]));
    end = lerp(pts[i1], pts[i1 - 1], seg ? back / seg : 0);
    i1--;
  }
  if (i1 < i0) return [];
  const mid = pts.slice(i0, i1 + 1).filter((p) => p !== start && p !== end);
  return [start, ...mid, end];
}

function route(inp: InkInput): Route | { problem: string } {
  const { u, W, H } = inp;
  const [from, to] = inp.ends;
  const pointOf = (e: InkEnd) => e.point || centerOf(e.box);
  const a = pointOf(from);
  const b = pointOf(to);
  const d = minus(b, a);
  const L = size(d);
  if (L < 2 * u) return { problem: 'its two ends are the same place — nothing to draw between them' };
  const dir = times(d, 1 / L);
  const left = P(dir.y, -dir.x);            // the arrow's left: above, for an arrow going right
  const gap = 5 * u;
  const tip = 3 * u;
  // Text the line may not run over: not the text it starts from or points at.
  const obstacles = inp.obstacles.filter((o) => ![from, to].some((e) => (e.point ? within(e.point, o, 8 * u) : meets(o, e.box, 2 * u))));
  // …filed by where they are, so each point of a route is tried against its neighbours only.
  const pad = 1.5 * u;
  const cell = 32 * u;
  const grid = new Map<number, number[]>();
  const keyOf = (x: number, y: number) => (Math.floor(x / cell) + 512) * 4096 + Math.floor(y / cell) + 512;
  obstacles.forEach((o, k) => {
    for (let x = o.x - pad; x < o.x + o.w + pad + cell; x += cell) {
      for (let y = o.y - pad; y < o.y + o.h + pad + cell; y += cell) {
        const key = keyOf(Math.min(x, o.x + o.w + pad), Math.min(y, o.y + o.h + pad));
        const list = grid.get(key);
        if (!list) grid.set(key, [k]); else if (list[list.length - 1] !== k) list.push(k);
      }
    }
  });
  // How many LINES of text a route crosses: the runs it touches, grouped by height.
  const linesOf = (ks: Set<number>) => {
    const os = [...ks].map((k) => obstacles[k]).sort((p, q) => p.y + p.h / 2 - (q.y + q.h / 2));
    let n = 0;
    let last = -Infinity;
    for (const o of os) { const c = o.y + o.h / 2; if (c - last > o.h * 0.6) { n++; last = c; } }
    return n;
  };

  const via = parseVia(inp.options.via) || [];
  const given = inp.options.bend !== undefined && Number.isFinite(Number(inp.options.bend)) ? clamp(Number(inp.options.bend), 0, 2) : null;
  const side = inp.options.side && SIDE_VEC[inp.options.side] ? inp.options.side : '';
  const signs = side ? [left.x * SIDE_VEC[side].x + left.y * SIDE_VEC[side].y >= 0 ? 1 : -1] : [1, -1];
  // Without a side, bowing upward (or rightward, for an arrow going up or down) wins a tie.
  const preferred = (sg: number) => { const v = times(left, sg); return Math.abs(v.y) > 0.3 ? v.y < 0 : v.x > 0; };

  // The routes to try. Given via points: those. Given a bend: that bow (on the side
  // given, else either). Else bows from straight to deep and — for a crowded slide —
  // routes through one point beside the line (near either end too: to slip between
  // two rows of a table, or under it) and S-bends; all in the arrow's own frame, so a
  // route moves with its ends.
  interface Cand { sg: number; bend: number; via: { t: number; s: number }[]; cost: number }
  const cands: Cand[] = [];
  if (via.length) cands.push({ sg: 1, bend: 0, via, cost: 0 });
  else if (given !== null) for (const sg of signs) cands.push({ sg, bend: given, via: [], cost: 0 });
  else {
    for (const sg of signs) {
      for (const bend of side ? [0.1, 0.16, 0.25, 0.4, 0.6, 0.85] : [0, 0.03, 0.06, 0.1, 0.16, 0.22, 0.3, 0.4, 0.6, 0.85]) cands.push({ sg, bend, via: [], cost: Math.abs(bend - 0.2) * 0.3 });
      for (const t of [0.15, 0.3, 0.5, 0.7, 0.85]) for (const s of [0.05, 0.1, 0.18, 0.3, 0.45, 0.65, 0.85]) cands.push({ sg, bend: 0, via: [{ t, s: sg * s }], cost: 0.12 + 0.1 * s });
    }
    if (!side) {
      for (const k of [0.06, 0.12, 0.2, 0.35]) {
        for (const sg of [1, -1]) for (const [t1, t2] of [[0.33, 0.67], [0.2, 0.55], [0.45, 0.8]]) cands.push({ sg, bend: 0, via: [{ t: t1, s: sg * k }, { t: t2, s: -sg * k }], cost: 0.3 });
      }
    }
  }

  // How far it turns in all (a gentle bow ≈ 80°; an S, a hook: much more).
  const turnOf = (pts: InkPt[]) => {
    let t = 0;
    for (let i = 2; i < pts.length; i++) {
      const p = Math.atan2(pts[i - 1].y - pts[i - 2].y, pts[i - 1].x - pts[i - 2].x);
      const q = Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x);
      const dq = Math.abs(q - p);
      t += dq > Math.PI ? 2 * Math.PI - dq : dq;
    }
    return (t * 180) / Math.PI;
  };
  // A long thin target (an axis, an edge, a long phrase) is pointed at from its side,
  // toward its middle — reaching it at an end points at the end.
  const tb = to.box;
  const long = !to.point && Math.max(tb.w, tb.h) >= 3 * Math.min(tb.w, tb.h);
  const endMiss = (tipAt: InkPt) => {
    if (!long) return 0;
    const e = tb.w >= tb.h ? Math.abs(tipAt.x - (tb.x + tb.w / 2)) / (tb.w / 2) : Math.abs(tipAt.y - (tb.y + tb.h / 2)) / (tb.h / 2);
    return Math.max(0, Math.min(e, 1.5) - 0.5) * 0.6;
  };

  let best: (Route & { score: number; via: string }) | null = null;
  for (const c of cands) {
    const curves = c.via.length
      ? through([a, ...c.via.map(({ t, s }) => plus(plus(a, times(d, t)), times(left, s * L))), b])
      : [[a, plus(lerp(a, b, 1 / 3), times(left, (c.sg * c.bend * L) / 0.75)), plus(lerp(a, b, 2 / 3), times(left, (c.sg * c.bend * L) / 0.75)), b] as Cubic];
    const kept = clipped(sample(curves, 72), from, to, gap, tip);
    if (kept.length < 3 || lengthOf(kept) < 6 * u) continue;
    // How much of it lies on text — a line running ALONG text strikes it through,
    // the worst — and how many lines of text it crosses (crossing one quickly, as a
    // hand-drawn arrow out of a table must, is a small fault).
    const hit = new Set<number>();
    let on = 0;
    for (const p of kept) {
      let any = false;
      for (const k of grid.get(keyOf(p.x, p.y)) || []) if (within(p, obstacles[k], pad)) { hit.add(k); any = true; }
      if (any) on++;
    }
    const len = lengthOf(kept);
    const over = on / kept.length;
    const onText = over * len;
    const curl = len / Math.max(size(minus(kept[kept.length - 1], kept[0])), 1);
    const turn = turnOf(kept);
    const lines = linesOf(hit);
    const off = offSlide(kept, W, H);
    // Least text run over, on the slide; then the simplest route — a hand's gentle
    // bow (about 0.2) first —, no longer or twistier than such a bow, reaching a long
    // target toward its middle; the preferred side.
    const shape = Math.max(0, curl - 1.12) * 1.5 + (Math.max(0, turn - 100) / 90) * 0.8;
    // On text: an arrow lying mostly on words cannot be seen as one (its share of
    // the line), and every stretch of words it covers is hidden (how long that is).
    const textCost = 6 * over + 3 * Math.max(0, over - 0.3) + (2 * onText) / (100 * u) + 0.25 * lines;
    const score = textCost + (off ? 4 : 0) + c.cost + shape + endMiss(kept[kept.length - 1]) + (via.length || preferred(c.sg) ? 0 : 0.02);
    if (!best || score < best.score - 1e-9) {
      const chord = minus(kept[kept.length - 1], kept[0]);
      const across = unit(P(chord.y, -chord.x));
      // how far it bows from the line between its ends, and to which side
      let dev = 0;
      for (const p of kept) { const v = (p.x - kept[0].x) * across.x + (p.y - kept[0].y) * across.y; if (Math.abs(v) > Math.abs(dev)) dev = v; }
      best = {
        pts: kept, overlap: over, crosses: lines, off, score,
        side: Math.abs(dev) > 2 * u ? sideOf(times(across, dev)) : '',
        bend: Math.round((Math.abs(dev) / L) * 100) / 100,
        via: c.via.length && !via.length ? c.via.map((v) => `${v.t}/${Math.round(v.s * 100) / 100}`).join(',') : '',
      };
    }
  }
  return best || { problem: 'its two ends overlap — there is no room for a line between them' };
}

/** The arrowhead: two short strokes back from the tip, a little uneven. */
function head(pts: InkPt[], u: number, rnd: () => number): InkPt[] {
  const tip = pts[pts.length - 1];
  const back = unit(minus(pts[Math.max(0, pts.length - 5)], tip));
  const a = plus(tip, times(rotate(back, 26 + rnd() * 4), 11 * u));
  const b = plus(tip, times(rotate(back, -(23 + rnd() * 4)), 10 * u));
  return [a, tip, b];
}

// ---- the other shapes -----------------------------------------------------------------
function loop(box: FocusBox, u: number, rnd: () => number): InkPt[] {
  const pad = 8 * u;
  const c = centerOf(box);
  const rx = box.w / 2 + pad;
  const ry = box.h / 2 + pad;
  const start = -150 + rnd() * 20;
  const tilt = ((rnd() - 0.5) * 4 * Math.PI) / 180;
  const pts: InkPt[] = [];
  const n = 72;
  for (let i = 0; i <= n; i++) {
    const deg = start + (i / n) * 385;                 // once round and a little past the start
    const k = 1 + 0.05 * (i / n) + 0.02 * Math.sin((deg * Math.PI) / 90);
    const t = (deg * Math.PI) / 180;
    const x = rx * k * Math.cos(t);
    const y = ry * k * Math.sin(t);
    pts.push(P(c.x + x * Math.cos(tilt) - y * Math.sin(tilt), c.y + x * Math.sin(tilt) + y * Math.cos(tilt)));
  }
  return pts;
}

function frame(box: FocusBox, u: number, rnd: () => number): InkPt[] {
  const pad = 7 * u;
  const j = () => (rnd() - 0.5) * 3 * u;
  const tl = P(box.x - pad + j(), box.y - pad + j());
  const tr = P(box.x + box.w + pad + j(), box.y - pad + j());
  const br = P(box.x + box.w + pad + j(), box.y + box.h + pad + j());
  const bl = P(box.x - pad + j(), box.y + box.h + pad + j());
  const start = lerp(tl, tr, 0.04);
  const end = plus(tl, times(unit(minus(tr, tl)), 8 * u));     // past the start, as a pen closes a frame
  return [[start, tr], [tr, br], [br, bl], [bl, tl], [tl, end]].flatMap(([p, q], i) => {
    const seg = Array.from({ length: 9 }, (_, k) => lerp(p, q, k / 8));
    return i ? seg.slice(1) : seg;
  });
}

function strike(box: FocusBox, u: number, rnd: () => number): InkPt[][] {
  const inset = Math.min(box.w, box.h) * 0.08;
  const o = 3 * u;
  const j = () => (rnd() - 0.5) * 2 * u;
  const line = (p: InkPt, q: InkPt) => Array.from({ length: 12 }, (_, k) => lerp(p, q, k / 11));
  return [
    line(P(box.x + inset - o + j(), box.y + inset - o + j()), P(box.x + box.w - inset + o + j(), box.y + box.h - inset + o + j())),
    line(P(box.x + box.w - inset + o + j(), box.y + inset - o + j()), P(box.x + inset - o + j(), box.y + box.h - inset + o + j())),
  ];
}

function tick(line: FocusBox, right: boolean, u: number, rnd: () => number): InkPt[] {
  const s = clamp(line.h * 0.9, 12 * u, 32 * u);
  const x = right ? line.x + line.w + s * 0.3 : line.x - s * 1.2;
  const y = line.y + line.h / 2 - s / 2;
  const j = () => (rnd() - 0.5) * 1.5 * u;
  const a = P(x + j(), y + 0.55 * s + j());
  const m = P(x + 0.38 * s + j(), y + 0.95 * s + j());
  const z = P(x + s + j(), y + j());
  return [...Array.from({ length: 5 }, (_, k) => lerp(a, m, k / 4)), ...Array.from({ length: 9 }, (_, k) => lerp(m, z, (k + 1) / 9))];
}

function brace(box: FocusBox, right: boolean, u: number): InkPt[] {
  const k = clamp(box.h / 6, 4 * u, 10 * u);
  const sx = right ? 1 : -1;
  const x = right ? box.x + box.w + 6 * u : box.x - 6 * u;
  const top = box.y;
  const bot = box.y + box.h;
  const mid = (top + bot) / 2;
  const at = (dx: number, y: number) => P(x + sx * dx, y);
  const curves: Cubic[] = [
    quad(at(0, top), at(k, top), at(k, top + k)),
    [at(k, top + k), at(k, top + k + (mid - k - top - k) / 3), at(k, mid - k - (mid - k - top - k) / 3), at(k, mid - k)],
    quad(at(k, mid - k), at(k, mid), at(2 * k, mid)),
    quad(at(2 * k, mid), at(k, mid), at(k, mid + k)),
    [at(k, mid + k), at(k, mid + k + (bot - k - mid - k) / 3), at(k, bot - k - (bot - k - mid - k) / 3), at(k, bot - k)],
    quad(at(k, bot - k), at(k, bot), at(0, bot)),
  ];
  return sample(curves, 48);
}

/** The strokes of an ink cue, from the boxes its targets have now. */
export function planInk(inp: InkInput): InkPlan {
  const { u, W, H } = inp;
  const rnd = randomFrom(inp.seed);
  const total = seconds(inp.options.dur);
  const problems: string[] = [];
  if (!inp.ends.length) return { strokes: [], overlap: 0, off: false, problems: ['nothing to draw at'] };

  if (isRoute(inp.shape)) {
    if (inp.ends.length < 2) return { strokes: [], overlap: 0, off: false, problems: ['an arrow needs two ends'] };
    const r = route(inp);
    if ('problem' in r) return { strokes: [], overlap: 0, off: false, problems: [r.problem] };
    const len = lengthOf(r.pts);
    const shaft = wobble(r.pts, clamp(len / (300 * u), 0.3, 1) * 0.9 * u, rnd);
    const strokes = inp.shape === 'arrow' ? [{ pts: shaft }, { pts: head(shaft, u, rnd), dur: 0.16 }] : [{ pts: shaft }];
    if (r.crosses >= 3 || r.overlap > 0.1) problems.push(`it runs over text (${r.crosses} line${r.crosses === 1 ? '' : 's'} of it, ${Math.round(r.overlap * 100)} % of its length) — give it a side (above / below / left / right), a larger bend, or via points`);
    if (r.off) problems.push('a part of it runs off the slide — give it the other side or a smaller bend');
    return {
      strokes: timed(strokes, u, total), overlap: Math.round(r.overlap * 100) / 100, crosses: r.crosses, side: r.side, bend: r.bend, off: r.off,
      endsAt: { from: shaft[0], to: shaft[shaft.length - 1] }, shaft, ...(r.via ? { via: r.via } : {}), problems,
    };
  }

  const all = union(inp.ends.map((e) => e.box));
  const side = inp.options.side === 'left' ? false : inp.options.side === 'right' ? true : null;
  let strokes: { pts: InkPt[]; dur?: number }[];
  switch (inp.shape) {
    case 'circle':
      strokes = [{ pts: wobble(loop(all, u, rnd), 0.8 * u, rnd) }];
      break;
    case 'box':
      strokes = [{ pts: frame(all, u, rnd) }];
      break;
    case 'cross':
      strokes = strike(all, u, rnd).map((pts) => ({ pts: wobble(pts, 0.6 * u, rnd) }));
      break;
    case 'underline':
      strokes = inp.ends.flatMap((e) => (e.lines && e.lines.length ? e.lines : [e.box])).map((l) => {
        const drift = (rnd() - 0.6) * 2 * u;
        const p = P(l.x - 2 * u, l.y + l.h + 3 * u);
        const q = P(l.x + l.w + 3 * u, l.y + l.h + 3 * u + drift);
        return { pts: wobble(Array.from({ length: 16 }, (_, k) => lerp(p, q, k / 15)), 0.6 * u, rnd) };
      });
      break;
    case 'check': {
      const first = inp.ends[0].lines?.[0] || inp.ends[0].box;
      // On the left unless told otherwise — or unless the left has no room.
      const right = side ?? (first.x < clamp(first.h * 0.9, 12 * u, 32 * u) * 1.3);
      if (side === false && first.x < clamp(first.h * 0.9, 12 * u, 32 * u) * 1.3) problems.push('there is no room on its left — it runs off the slide');
      strokes = [{ pts: tick(first, right, u, rnd) }];
      break;
    }
    case 'bracket':
      strokes = [{ pts: wobble(brace(all, side ?? true, u), 0.4 * u, rnd) }];
      break;
    default:
      return { strokes: [], overlap: 0, off: false, problems: [`unknown ink shape "${inp.shape}"`] };
  }
  const off = strokes.some((s) => offSlide(s.pts, W, H));
  if (off && !problems.length) problems.push('a part of it runs off the slide');
  return { strokes: timed(strokes, u, total), overlap: 0, off, problems };
}
