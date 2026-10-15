// Ink — a pen's strokes over a slide, drawn as the narration reaches them: a focus
// cue of its own kind, [[ink: …]] in a script. What a cue keeps is the INTENT —
// what an arrow goes from and to, what is circled, which side a line passes — never
// coordinates of the slide. The strokes are worked out every time the slide is shown
// (inkGeometry.ts), from where those things ARE then: a line added above, a bigger
// font, a moved or resized figure — the ink follows. Like a mark it stays until
// [[clear]] / [[clear: TARGET]] or the next slide, and it counts as an emphasis.
//
//   [[ink: arrow FROM → TO [SIDE] [bend=0.3] [via=t/s,…] [color=…] [dur=1s]]]
//   [[ink: line FROM → TO …]]            the same without a head
//   [[ink: circle TARGET[, TARGET…]]]    a loop round them
//   [[ink: underline TARGET]]            under each line it is written on
//   [[ink: box TARGET]]                  a frame drawn by hand
//   [[ink: cross TARGET]]                struck out with a ×
//   [[ink: check TARGET [left|right]]]   a tick beside it
//   [[ink: bracket TARGET [left|right]]] a brace along its side
//
// FROM / TO / TARGET: any focus target — a place the slide names (#name) above all;
// a point inside one: #fig(62,40) = 62 %, 40 % of its box (a spot in a picture).
// SIDE — above / below / left / right (上 / 下 / 左 / 右): where an arrow bows;
// without one, the side that crosses the least text. bend: how far it bows, a
// fraction of its length (0 = straight). via: points it passes in the arrow's own
// frame — t along it (0 → 1), s across it (+ = its left: above, for an arrow going
// right), fractions of its length — so they move with its ends.
import type { FocusCue } from '../autoplay/autoplay';

export const INK_SHAPES = ['arrow', 'line', 'circle', 'underline', 'box', 'cross', 'check', 'bracket'] as const;
export type InkShape = typeof INK_SHAPES[number];
export const INK_SIDES = ['above', 'below', 'left', 'right'] as const;

const SIDE_WORDS: Record<string, string> = {
  above: 'above', below: 'below', left: 'left', right: 'right', up: 'above', down: 'below',
  '上': 'above', '下': 'below', '左': 'left', '右': 'right',
};

/** An arrow / a line goes FROM → TO; the other shapes take targets. */
export const isRoute = (shape: string): boolean => shape === 'arrow' || shape === 'line';
export const isInkShape = (shape: string): shape is InkShape => (INK_SHAPES as readonly string[]).includes(shape);

/** An anchor as written → the target it is in, and a point inside it in % of its
 *  box ("#fig(62,40)" → "#fig", 62 %, 40 %). */
export function inkAnchor(t: string): { base: string; point?: { x: number; y: number } } {
  const s = String(t || '').trim();
  const m = /^(.*?)\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)$/.exec(s);
  return m && m[1].trim() ? { base: m[1].trim(), point: { x: Number(m[2]), y: Number(m[3]) } } : { base: s };
}

// One anchor: a quoted phrase (of any kind:), kind:numbers, or a bare token — which
// stops before a point "(", a separator "," / "→" / "->" or a space — then its point.
const ANCHOR = /^((?:[A-Za-z]+:)?(?:"[^"]*"|「[^」]*」)(?:#\d+)?|[A-Za-z]+:\d+(?:\.\d+)?(?:,\d+(?:\.\d+)?)+|[^\s,()→]+?(?=\(|[\s,→]|->|$))(\(\s*-?[\d.]+\s*,\s*-?[\d.]+\s*\))?\s*/;
// A first word that is a shape (or meant as one): letters, then a space.
const SHAPE_WORD = /^([A-Za-z]+)\s+(?=\S)/;

/** The body of an [[ink: …]] cue → its shape (`style`), anchors (`targets`) and
 *  options (`side`, `bend`, `via`, `color`, `dur`; words it does not know → `extra`). */
export function parseInkCue(body: string): { targets: string[]; style: string; options: Record<string, string> } {
  let rest = String(body || '').trim();
  let style = '';
  const first = SHAPE_WORD.exec(rest);
  // A first word that is not a target ("#…", "…", kind:…) is the shape — an unknown
  // one too, so the checks can say so.
  if (first && !/^[A-Za-z]+:/.test(rest)) {
    style = first[1].toLowerCase();
    rest = rest.slice(first[0].length);
  } else {
    style = /→|->/.test(rest) ? 'arrow' : 'circle';
  }
  const route = isRoute(style);
  const targets: string[] = [];
  for (;;) {
    const m = ANCHOR.exec(rest);
    if (!m || !m[1]) break;
    targets.push(m[1] + (m[2] ? m[2].replace(/\s+/g, '') : ''));
    rest = rest.slice(m[0].length);
    const sep = (route ? /^(?:→|->)\s*/ : /^,\s*/).exec(rest);
    if (!sep) break;
    rest = rest.slice(sep[0].length);
  }
  const options: Record<string, string> = {};
  for (const tok of rest.split(/\s+/).filter(Boolean)) {
    const kv = /^([A-Za-z-]+)=(.*)$/.exec(tok);
    if (kv) options[kv[1].toLowerCase()] = kv[2];
    else if (SIDE_WORDS[tok.toLowerCase()] || SIDE_WORDS[tok]) options.side = SIDE_WORDS[tok.toLowerCase()] || SIDE_WORDS[tok];
    else options.extra = options.extra ? `${options.extra} ${tok}` : tok;
  }
  return { targets, style, options };
}

/** An ink cue written back as its marker. */
export function inkText(c: FocusCue): string {
  const opts = Object.entries(c.options).filter(([k]) => k !== 'side' && k !== 'extra').map(([k, v]) => `${k}=${v}`);
  const body = [c.style, c.targets.join(isRoute(c.style) ? ' → ' : ', '), c.options.side || '', c.options.extra || '', ...opts]
    .filter(Boolean).join(' ');
  return `[[ink: ${body}]]`;
}

// A slide's @script comments (≡ slideScript) and, inside them, the ink markers (≡
// the ink kind of autoplay's cue markers).
const SCRIPT_RE = /<!--\s*@script:\s*([\s\S]*?)\s*-->/g;
const SCRIPT_HEAD = /^<!--\s*@script:\s*/;
const INK_MARKER = /\[\[\s*ink\s*(?::\s*([^\]]*?))?\s*\]\]/gi;

/** Every [[ink: …]] of a slide's text, in the order its cues are read (scriptCues):
 *  where its marker is (`from` / `to`, offsets into `text`) and the cue — the n-th
 *  of a slide is what the preview's ink editing rewrites in place. */
export function inkMarkers(text: string): { from: number; to: number; cue: FocusCue }[] {
  const out: { from: number; to: number; cue: FocusCue }[] = [];
  for (const m of String(text || '').matchAll(SCRIPT_RE)) {
    const at = (m.index ?? 0) + (SCRIPT_HEAD.exec(m[0])?.[0].length ?? 0);
    for (const k of m[1].matchAll(INK_MARKER)) {
      const from = at + (k.index ?? 0);
      out.push({ from, to: from + k[0].length, cue: { kind: 'ink', ...parseInkCue(k[1] || '') } });
    }
  }
  return out;
}

/** A short label for a chip: "arrow #a→#b", "circle #peak". */
export function inkLabel(c: FocusCue): string {
  const plain = (t: string) => t.replace(/^[A-Za-z]+:(?=["「])/, '').replace(/^["「]|["」](#\d+)?$/g, '');
  return `${c.style} ${c.targets.map(plain).join(isRoute(c.style) ? '→' : '・')}`.trim();
}

/** Whether an ink cue is about `target` (an anchor in it, a point inside it too) —
 *  [[clear: TARGET]] takes such ink away whole: an arrow without one of its ends is
 *  no arrow. */
export const inkTouches = (c: FocusCue, target: string): boolean =>
  c.targets.some((t) => t === target || inkAnchor(t).base === target);

/** The via points of an arrow ("0.5/0.4,0.8/-0.2") → [{t, s}] (at most 6); null when
 *  the text cannot be read. */
export function parseVia(text: string | undefined): { t: number; s: number }[] | null {
  if (!text) return [];
  const pts = String(text).split(/[,;]/).filter(Boolean).map((p) => {
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)\s*$/.exec(p);
    return m ? { t: Number(m[1]), s: Number(m[2]) } : null;
  });
  return pts.every((p) => p) ? (pts as { t: number; s: number }[]).slice(0, 6) : null;
}

/** Problems that can be told from the text: an unknown shape, an arrow without two
 *  ends, words it does not know, a side a shape has no use for, via it cannot read. */
export function inkTextProblems(c: FocusCue): { level: 'error' | 'warn'; message: string }[] {
  const out: { level: 'error' | 'warn'; message: string }[] = [];
  if (!isInkShape(c.style)) {
    out.push({ level: 'error', message: `unknown ink shape "${c.style}" — one of ${INK_SHAPES.join(', ')}: [[ink: arrow #from → #to]], [[ink: circle #name]].` });
    return out;
  }
  if (isRoute(c.style) && c.targets.length !== 2) {
    out.push({ level: 'error', message: `an ${c.style} goes from one place to another — [[ink: ${c.style} #from → #to]] (${c.targets.length} given).` });
  }
  if (!isRoute(c.style) && !c.targets.length) out.push({ level: 'error', message: 'no target — nothing is drawn.' });
  if (c.options.extra) out.push({ level: 'warn', message: `unknown word(s) "${c.options.extra}" — sides are above / below / left / right; options bend=, via=, color=, dur=.` });
  const side = c.options.side;
  if (side && (c.style === 'check' || c.style === 'bracket') && side !== 'left' && side !== 'right') {
    out.push({ level: 'warn', message: `a ${c.style} goes on the left or the right — "${side}" is ignored.` });
  }
  if (side && !isRoute(c.style) && c.style !== 'check' && c.style !== 'bracket') {
    out.push({ level: 'warn', message: `a ${c.style} has no side — "${side}" is ignored.` });
  }
  if (c.options.bend !== undefined && !(Number(c.options.bend) >= 0 && Number(c.options.bend) <= 2)) {
    out.push({ level: 'warn', message: `bend=${c.options.bend} — a fraction of the arrow's length, 0 (straight) to about 1.` });
  }
  if (parseVia(c.options.via) === null) {
    out.push({ level: 'warn', message: `via=${c.options.via} — points t/s, comma-separated (t along the arrow 0 → 1, s across it; e.g. via=0.5/0.4).` });
  }
  if (c.options.dur !== undefined && !/^\d+(?:\.\d+)?(?:ms|s)?$/.test(c.options.dur)) {
    out.push({ level: 'warn', message: `dur=${c.options.dur} — a time such as 1s or 800ms.` });
  }
  return out;
}
