// Where a focus cue's TARGET is on a rendered slide — measured from the DOM that
// SlideView drew, in the slide's own CSS pixels (whatever the surface's zoom).
//
//   #name                      a place the slide NAMES — the way to point that
//                              survives edits of its words and order: words / an
//                              image / a formula part marked \focus{name}{…}, blocks
//                              in <!-- @focus name -->…<!-- @end -->, a module's
//                              tag: name, an inline SVG's data-focus="name" (or id)
//   item:#name / cell:#name / row:#name / col:#name   the bullet / cell / row /
//                              column holding that place
//   "語句" / 「語句」(#n)        a phrase as SHOWN on the slide (n-th occurrence) —
//                               whitespace, full/half width and (as a fallback) case
//                               and Markdown marks do not matter; a bare word too
//   item:"…" / item:N          the bullet holding the phrase / the N-th bullet
//   cell:"…" / cell:R,C        a table cell (rows counted from the header, 1-based)
//                              — a phrase is looked for among the bullets' / the
//                              cells' words only, and #n counts there
//   row:"…" / row:N            a table row;  col:"…" / col:N  a column
//   @tag                       a module given `tag: …`
//   math:name / math:N         a formula part \focus{name}{…} / the N-th formula
//   fig:"label" / fig:name     a label in an inline figure (SVG) / its part with
//                              data-focus="name" (or id)
//   area:x,y,w,h               a region, in % of the slide
// The tables, bullets and formulas are counted in the whole slide, in reading order.

export interface FocusBox { x: number; y: number; w: number; h: number }

export interface FocusHit {
  target: string;
  kind: 'text' | 'element' | 'area';
  /** One box per line of WRITING — of a phrase (it may wrap), a bullet, a cell, a row
   *  or a column: what an underline or a highlighter follows. Else the element's box. */
  boxes: FocusBox[];
  /** All of them together. */
  box: FocusBox;
  /** How many places matched (more than one: the first is used — #n picks another). */
  matches?: number;
  /** Not visible now (an unrevealed build step, display: none…). */
  hidden?: boolean;
}
export interface FocusMiss { target: string; error: string }
export type FocusResolution = FocusHit | FocusMiss;
export const isHit = (r: FocusResolution): r is FocusHit => 'box' in r;

// ---- reading a target ----------------------------------------------------------

interface Parsed { kind: string; text?: string; nth: number; name?: string; nums?: number[] }

export function parseTarget(raw: string): Parsed | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (s.startsWith('@')) return s.length > 1 ? { kind: '@', name: s.slice(1), nth: 1 } : null;
  if (s.startsWith('#')) return s.length > 1 ? { kind: '#', name: s.slice(1), nth: 1 } : null;
  const q = /^(?:([A-Za-z]+):)?(?:"([^"]*)"|「([^」]*)」)(?:#(\d+))?$/.exec(s);
  if (q) return { kind: (q[1] || '').toLowerCase(), text: q[2] ?? q[3] ?? '', nth: q[4] ? Math.max(1, +q[4]) : 1 };
  const n = /^([A-Za-z]+):(\d+(?:\.\d+)?(?:,\d+(?:\.\d+)?)*)$/.exec(s);
  if (n) return { kind: n[1].toLowerCase(), nums: n[2].split(',').map(Number), nth: 1 };
  const b = /^([A-Za-z]+):(\S+)$/.exec(s);
  if (b) return { kind: b[1].toLowerCase(), name: b[2], nth: 1 };
  return { kind: '', text: s, nth: 1 };        // a bare word: the phrase itself
}

// ---- the slide's text ----------------------------------------------------------

interface Glyph { node: Text; offset: number; len: number }
interface TextIndex { flat: string; at: Glyph[] }

// Never searched: KaTeX's hidden MathML copy, the overlay itself, scripts/styles,
// the page number.
const SKIP = '.katex-mathml, [data-mdp-focus-layer], script, style, .slide-page-number';

function textIndex(root: HTMLElement, accept?: (t: Text) => boolean): TextIndex {
  const flat: string[] = [];
  const at: Glyph[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      const el = n.parentElement;
      if (!el || el.closest(SKIP)) return NodeFilter.FILTER_REJECT;
      return !accept || accept(n as Text) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const data = n.data;
    for (let i = 0; i < data.length;) {
      const cp = data.codePointAt(i)!;
      const ch = String.fromCodePoint(cp);
      if (!/\s/.test(ch)) {
        for (const c of ch.normalize('NFKC')) { flat.push(c); at.push({ node: n, offset: i, len: ch.length }); }
      }
      i += ch.length;
    }
  }
  return { flat: flat.join(''), at };
}

const squash = (s: string) => String(s || '').normalize('NFKC').replace(/\s+/g, '');

/** Every occurrence of `text` (as [start, end) in the index), the best way it can be
 *  found: as written, then ignoring case, then without Markdown marks. */
function occurrences(index: TextIndex, text: string): [number, number][] {
  const tries = [squash(text)];
  tries.push(tries[0].replace(/\*\*|__|[*_`~]/g, ''));
  for (const needle of tries) {
    if (!needle) continue;
    for (const hay of [index.flat, index.flat.toLowerCase()]) {
      if (hay.length !== index.flat.length) continue;
      const n = hay === index.flat ? needle : needle.toLowerCase();
      const out: [number, number][] = [];
      for (let i = hay.indexOf(n); i >= 0; i = hay.indexOf(n, i + n.length)) out.push([i, i + n.length]);
      if (out.length) return out;
    }
  }
  return [];
}

function rangeOf(index: TextIndex, [a, b]: [number, number]): Range {
  const first = index.at[a];
  const last = index.at[b - 1];
  const r = document.createRange();
  r.setStart(first.node, first.offset);
  r.setEnd(last.node, last.offset + last.len);
  return r;
}

// ---- geometry --------------------------------------------------------------------

/** Client rects → the slide's own pixels (the wrapper may be zoomed by its host). */
function toSlide(root: HTMLElement) {
  const base = root.getBoundingClientRect();
  const k = root.offsetWidth ? base.width / root.offsetWidth : 1;
  return (r: DOMRect | DOMRectReadOnly): FocusBox => ({
    x: (r.left - base.left) / (k || 1), y: (r.top - base.top) / (k || 1), w: r.width / (k || 1), h: r.height / (k || 1),
  });
}

export const unionBox = (boxes: FocusBox[]): FocusBox => {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
};

/** A formula, or a part of one (`\focus`): KaTeX lays fractions, limits and roots out
 *  in positioned stacks that stick out of their parent's line box, so a part's own box
 *  cut a fraction's numerator and denominator in half. The painted pieces are united
 *  instead — the glyphs (a Range over the text), the rules (fraction bars, over- and
 *  underlines) and the SVG pieces (roots, stretchy brackets and arrows). */
function katexBox(el: Element, conv: (r: DOMRect | DOMRectReadOnly) => FocusBox): FocusBox | null {
  const doc = el.ownerDocument;
  const boxes: FocusBox[] = [];
  const range = doc.createRange();
  const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue || !n.nodeValue.trim()) continue;
    range.selectNodeContents(n);
    for (const r of Array.from(range.getClientRects())) boxes.push(conv(r));
  }
  el.querySelectorAll('svg, .frac-line, .overline-line, .underline-line, .hline, .rule')
    .forEach((p) => boxes.push(conv(p.getBoundingClientRect())));
  const painted = boxes.filter((b) => b.w > 0.5 || b.h > 0.5);
  return painted.length ? unionBox(painted) : null;
}

/** Where an element sits on the slide. A `display: contents` element has no box of
 *  its own — the layout-neutral wrapper a block module that cannot be moved gets,
 *  which is where its `tag:` lands (moduleProcessor) — so its children are united. */
function elementBox(el: Element, conv: (r: DOMRect | DOMRectReadOnly) => FocusBox): FocusBox {
  if (el.closest('.katex-html')) {
    const k = katexBox(el, conv);
    if (k) return k;
  }
  const own = conv(el.getBoundingClientRect());
  if (own.w > 0.5 || own.h > 0.5 || getComputedStyle(el).display !== 'contents') return own;
  const kids = Array.from(el.children).map((c) => elementBox(c, conv)).filter((b) => b.w > 0.5 || b.h > 0.5);
  return kids.length ? unionBox(kids) : own;
}

/** A phrase's boxes, one per line it sits on. */
function lineBoxes(boxes: FocusBox[]): FocusBox[] {
  const sorted = boxes.filter((b) => b.w > 0.5 && b.h > 0.5).sort((p, q) => p.y - q.y || p.x - q.x);
  const lines: FocusBox[][] = [];
  for (const b of sorted) {
    const line = lines.find((l) => {
      const u = unionBox(l);
      const overlap = Math.min(u.y + u.h, b.y + b.h) - Math.max(u.y, b.y);
      return overlap > 0.5 * Math.min(u.h, b.h);
    });
    if (line) line.push(b); else lines.push([b]);
  }
  return lines.map(unionBox);
}

/** The lines of what is written in elements (a bullet, a cell, a row, a column): an
 *  underline or a highlighter goes under / over the words — a bullet's own box spans
 *  the slide, a cell's reaches into its padding, where a box around the row runs. A
 *  formula counts as one piece (a fraction's numerator is not a line of its own). */
function writtenLines(els: Element[], conv: (r: DOMRect | DOMRectReadOnly) => FocusBox): FocusBox[] {
  const boxes: FocusBox[] = [];
  for (const el of els) {
    const doc = el.ownerDocument;
    const range = doc.createRange();
    const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeValue?.trim() && !n.parentElement?.closest(`${SKIP}, .katex`) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      range.selectNodeContents(n);
      for (const r of Array.from(range.getClientRects())) boxes.push(conv(r));
    }
    el.querySelectorAll('.katex-html').forEach((k) => {
      const b = katexBox(k, conv);
      if (b) boxes.push(b);
    });
    // Pictures in it (an image, an inline SVG figure, a canvas…) are written too.
    el.querySelectorAll('img, canvas, video, iframe, object, svg').forEach((m) => {
      if (m.closest('.katex') || (m.tagName.toLowerCase() === 'svg' && m.parentElement?.closest('svg'))) return;
      boxes.push(conv(m.getBoundingClientRect()));
    });
  }
  return lineBoxes(boxes);
}

function isShown(node: Node, root: HTMLElement): boolean {
  for (let el: Element | null = node.nodeType === 1 ? node as Element : node.parentElement; el && el !== root; el = el.parentElement) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
  }
  return true;
}

/** `written`: its lines of writing are its `boxes` (a cell, a row); 'hug': its `box`
 *  too — a bullet's own box spans the slide however short it is, and a ring round it
 *  ran the slide's width. */
const elementHit = (target: string, el: Element, root: HTMLElement, matches?: number, written: boolean | 'hug' = false): FocusResolution => {
  const conv = toSlide(root);
  const own = elementBox(el, conv);
  if (own.w <= 0.5 && own.h <= 0.5) return { target, error: 'it is not on screen now (an unrevealed build step?)' };
  const lines = written ? writtenLines([el], conv) : [];
  const box = written === 'hug' && lines.length ? unionBox(lines) : own;
  return { target, kind: 'element', boxes: lines.length ? lines : [own], box, ...(matches && matches > 1 ? { matches } : {}), ...(isShown(el, root) ? {} : { hidden: true }) };
};

// ---- finding ---------------------------------------------------------------------

const cssEsc = (s: string) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&'));

function nthOf<T>(list: T[], n: number, what: string, target: string): T | FocusMiss {
  if (!list.length) return { target, error: `the slide has no ${what}` };
  if (n < 1 || n > list.length) return { target, error: `the slide has ${list.length} ${what}${list.length === 1 ? '' : 's'}, not ${n}` };
  return list[n - 1];
}

/** A phrase's place: the n-th occurrence's range, how many there are. */
function findText(root: HTMLElement, text: string, nth: number, target: string, accept?: (t: Text) => boolean): { range: Range; count: number } | FocusMiss {
  const index = textIndex(root, accept);
  const hits = occurrences(index, text);
  if (!hits.length) return { target, error: `"${text}" is not on the slide` };
  if (nth > hits.length) return { target, error: `"${text}" is on the slide ${hits.length} time${hits.length === 1 ? '' : 's'}, not ${nth}` };
  return { range: rangeOf(index, hits[nth - 1]), count: hits.length };
}

/** The places the slide names `name` — in the text or a formula (\focus{name}{…}), a
 *  block (@focus name), a module (tag:), an inline SVG (data-focus / id) — in the
 *  slide's order. */
function namedPlaces(root: HTMLElement, name: string): Element[] {
  const n = cssEsc(name);
  return Array.from(root.querySelectorAll(`[data-mdp-focus="${n}"], [data-mdp-tag="${n}"], svg [data-focus="${n}"], svg [id="${n}"]`))
    .filter((e) => !e.closest(SKIP));
}
const nothingNamed = (target: string, name: string): FocusMiss => ({
  target,
  error: `nothing on the slide is named "${name}" — mark the place: \\focus{${name}}{…} around words, an image or a formula part, <!-- @focus ${name} -->…<!-- @end --> around blocks, tag: ${name} on a module, data-focus="${name}" in an inline SVG`,
});
/** A named place: words / an image marked in the text hug what is written (the
 *  lines it is on); a block is its blocks; a formula part, a module, an SVG part
 *  their own box. */
const placeHit = (target: string, el: Element, root: HTMLElement, matches: number): FocusResolution => {
  if (el.closest('.katex-html') || el.hasAttribute('data-mdp-tag') || el.closest('svg')) return elementHit(target, el, root, matches);
  return elementHit(target, el, root, matches, el.classList.contains('mdp-focus-block') ? true : 'hug');
};
/** `kind:#name` — the bullet / cell holding a named place. */
function holderOf(root: HTMLElement, target: string, name: string, sel: string, what: string): Element | FocusMiss {
  const place = namedPlaces(root, name)[0];
  if (!place) return nothingNamed(target, name);
  return place.closest(sel) || { target, error: `"#${name}" is not in ${what}` };
}

const tablesOf = (root: HTMLElement) => Array.from(root.querySelectorAll('table')) as HTMLTableElement[];
const columnOf = (cell: HTMLTableCellElement): HTMLTableCellElement[] => {
  const table = cell.closest('table') as HTMLTableElement | null;
  if (!table) return [cell];
  return Array.from(table.rows).map((r) => r.cells[cell.cellIndex]).filter(Boolean) as HTMLTableCellElement[];
};
const boxesHit = (target: string, els: Element[], root: HTMLElement, matches?: number): FocusResolution => {
  const conv = toSlide(root);
  const boxes = els.map((e) => elementBox(e, conv)).filter((b) => b.w > 0.5 || b.h > 0.5);
  if (!boxes.length) return { target, error: 'it is not on screen now' };
  const box = unionBox(boxes);
  const lines = writtenLines(els, conv);
  return { target, kind: 'element', boxes: lines.length ? lines : [box], box, ...(matches && matches > 1 ? { matches } : {}), ...(els.every((e) => isShown(e, root)) ? {} : { hidden: true }) };
};

/** Resolve one target on a rendered slide (`root` = SlideView's wrapper). */
export function resolveTarget(target: string, root: HTMLElement): FocusResolution {
  const p = parseTarget(target);
  if (!p) return { target, error: 'empty target' };
  const W = root.offsetWidth || root.getBoundingClientRect().width;
  const H = root.offsetHeight || root.getBoundingClientRect().height;
  switch (p.kind) {
    case 'area': {
      const [x, y, w, h] = p.nums || [];
      if (![x, y, w, h].every((v) => Number.isFinite(v))) return { target, error: 'area takes x,y,w,h in % of the slide' };
      const box = { x: (x / 100) * W, y: (y / 100) * H, w: (w / 100) * W, h: (h / 100) * H };
      return { target, kind: 'area', boxes: [box], box };
    }
    case '#': {
      const places = namedPlaces(root, p.name!);
      return places.length ? placeHit(target, places[0], root, places.length) : nothingNamed(target, p.name!);
    }
    case '@': {
      const el = root.querySelector(`[data-mdp-tag="${cssEsc(p.name!)}"]`);
      return el ? elementHit(target, el, root) : { target, error: `no module has tag: ${p.name}` };
    }
    case 'math': {
      if (p.nums) {
        const all = Array.from(root.querySelectorAll('.katex')).map((k) => k.querySelector('.katex-html') || k);
        const el = nthOf(all, p.nums[0], 'formula', target);
        return 'error' in el ? el : elementHit(target, el, root);
      }
      if (p.name) {
        const el = root.querySelector(`[data-mdp-focus="${cssEsc(p.name)}"]`);
        return el ? elementHit(target, el, root) : { target, error: `no formula part is marked \\focus{${p.name}}{…}` };
      }
      return { target, error: 'math takes a name (\\focus{name}{…}) or a number' };
    }
    case 'fig': {
      if (p.text !== undefined) {
        const found = findText(root, p.text, p.nth, target, (t) => !!t.parentElement?.closest('svg'));
        if ('error' in found) return { ...found, error: `${found.error.replace('on the slide', 'in a figure')}` };
        const start = found.range.startContainer.parentElement;
        const label = start?.closest('text, foreignObject > *') || start;
        return label ? elementHit(target, label, root, found.count) : { target, error: 'figure label not found' };
      }
      if (p.name) {
        const el = root.querySelector(`svg [data-focus="${cssEsc(p.name)}"], svg [id="${cssEsc(p.name)}"]`);
        return el ? elementHit(target, el, root) : { target, error: `no figure part has data-focus="${p.name}"` };
      }
      return { target, error: 'fig takes a "label" or a name' };
    }
    case 'item': {
      if (p.name?.startsWith('#')) {
        const li = holderOf(root, target, p.name.slice(1), 'li', 'a bullet');
        return 'error' in li ? li : elementHit(target, li, root, undefined, 'hug');
      }
      if (p.nums) {
        const li = nthOf(Array.from(root.querySelectorAll('li')), p.nums[0], 'bullet', target);
        return 'error' in li ? li : elementHit(target, li, root, undefined, 'hug');
      }
      // the phrase among the bullets' words only (#n counts there): the same words
      // elsewhere on the slide — a heading, a formula — never hide the bullet
      const found = findText(root, p.text || '', p.nth, target, (t) => !!t.parentElement?.closest('li'));
      if ('error' in found) return { ...found, error: found.error.replace('on the slide', 'in a bullet') };
      const li = found.range.startContainer.parentElement?.closest('li');
      return li ? elementHit(target, li, root, found.count, 'hug') : { target, error: `"${p.text}" is not in a bullet` };
    }
    case 'cell': case 'row': case 'col': {
      if (p.name?.startsWith('#')) {
        const held = holderOf(root, target, p.name.slice(1), 'td, th', 'a table');
        if ('error' in held) return held;
        const cell = held as HTMLTableCellElement;
        if (p.kind === 'cell') return elementHit(target, cell, root, undefined, true);
        if (p.kind === 'row') return elementHit(target, cell.parentElement!, root, undefined, true);
        return boxesHit(target, columnOf(cell), root);
      }
      if (p.nums) {
        const table = tablesOf(root)[0];
        if (!table) return { target, error: 'the slide has no table' };
        const [a, b] = p.nums;
        if (p.kind === 'col') {
          const cells = Array.from(table.rows).map((r) => r.cells[a - 1]).filter(Boolean);
          return cells.length ? boxesHit(target, cells, root) : { target, error: `the table has no column ${a}` };
        }
        const row = table.rows[a - 1];
        if (!row) return { target, error: `the table has ${table.rows.length} rows, not ${a}` };
        if (p.kind === 'row') return elementHit(target, row, root, undefined, true);
        const at = row.cells[(b || 1) - 1];
        if (!at) return { target, error: `row ${a} has ${row.cells.length} cells, not ${b}` };
        return elementHit(target, at, root, undefined, true);
      }
      // the phrase among the tables' cells only (#n counts there)
      const found = findText(root, p.text || '', p.nth, target, (t) => !!t.parentElement?.closest('td, th'));
      if ('error' in found) return { ...found, error: found.error.replace('on the slide', 'in a table') };
      const count = found.count;
      const cell = (found.range.startContainer.parentElement?.closest('td, th') as HTMLTableCellElement | null) || null;
      if (!cell) return { target, error: `"${p.text}" is not in a table` };
      if (p.kind === 'cell') return elementHit(target, cell, root, count, true);
      if (p.kind === 'row') return elementHit(target, cell.parentElement!, root, count, true);
      return boxesHit(target, columnOf(cell), root, count);
    }
    case '': {
      const found = findText(root, p.text || '', p.nth, target);
      if ('error' in found) return found;
      const conv = toSlide(root);
      let boxes = lineBoxes(Array.from(found.range.getClientRects()).map(conv));
      // Some text (SVG labels) gives no line boxes: its element's box will do.
      if (!boxes.length) {
        const el = found.range.startContainer.parentElement;
        if (el) boxes = [elementBox(el, conv)].filter((b) => b.w > 0.5 && b.h > 0.5);
      }
      if (!boxes.length) return { target, error: `"${p.text}" is not on screen now (an unrevealed build step?)` };
      return {
        target, kind: 'text', boxes, box: unionBox(boxes),
        ...(found.count > 1 ? { matches: found.count } : {}),
        ...(isShown(found.range.startContainer, root) ? {} : { hidden: true }),
      };
    }
    default:
      return { target, error: `unknown kind "${p.kind}:" (#name, item, cell, row, col, math, fig, area, @tag, or "text")` };
  }
}

/** Where text is written on the slide — each run of a line, each formula, a figure's
 *  labels; also text a build has not revealed yet (it will be there) — what an ink
 *  line should not run over. Runs are not merged across a line: two columns keep the
 *  gap between them. */
export function textLines(root: HTMLElement): FocusBox[] {
  const content = (root.querySelector('.slide-content') as HTMLElement | null) || root;
  const conv = toSlide(root);
  const out: FocusBox[] = [];
  const range = document.createRange();
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeValue?.trim() && !n.parentElement?.closest(`${SKIP}, .katex`) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  for (let n = walker.nextNode(); n && out.length < 800; n = walker.nextNode()) {
    range.selectNodeContents(n);
    for (const r of Array.from(range.getClientRects())) {
      const b = conv(r);
      if (b.w > 0.5 && b.h > 0.5) out.push(b);
    }
  }
  content.querySelectorAll('.katex-html').forEach((k) => {
    const b = katexBox(k, conv);
    if (b) out.push(b);
  });
  return out;
}

// ---- what can be pointed at (MCP get_focus_targets) -------------------------------

export interface FocusTargetInfo { target: string; what: string; box: FocusBox; note?: string }

/** The slide's pointable things, each with a target string that resolves to it. */
export function listTargets(root: HTMLElement): FocusTargetInfo[] {
  const conv = toSlide(root);
  const out: FocusTargetInfo[] = [];
  const short = (s: string) => {
    const t = String(s || '').replace(/\s+/g, ' ').trim();
    return t.length > 24 ? t.slice(0, 24) : t;
  };
  const quote = (s: string) => `"${s.replace(/"/g, '')}"`;
  const add = (target: string, what: string, el: Element, note?: string, box = elementBox(el, conv)) => {
    if (box.w > 0.5 || box.h > 0.5) out.push({ target, what, box, ...(note ? { note } : {}) });
  };
  const content = (root.querySelector('.slide-content') as HTMLElement | null) || root;
  // The places the slide NAMES come first: #name is the way to point that survives
  // edits (the rest below are found by their words or position).
  const named = new Set<string>();
  content.querySelectorAll('[data-mdp-focus], [data-mdp-tag], svg [data-focus]').forEach((el) => {
    const name = el.getAttribute('data-mdp-focus') ?? el.getAttribute('data-mdp-tag') ?? el.getAttribute('data-focus') ?? '';
    if (!name || named.has(name) || el.closest(SKIP)) return;
    named.add(name);
    const hit = resolveTarget(`#${name}`, root);
    if (!isHit(hit)) return;
    const what = el.closest('.katex-html') ? 'formula part' : el.hasAttribute('data-mdp-tag') ? 'module'
      : el.closest('svg') ? 'figure part' : el.classList.contains('mdp-focus-block') ? 'named blocks' : 'named words';
    const holders = [el.closest('li') && `item:#${name}`, el.closest('td, th') && `cell:#${name} · row:#${name} · col:#${name}`].filter(Boolean);
    const also = what === 'formula part' ? `also math:${name}` : what === 'module' ? `also @${name}` : what === 'figure part' ? `also fig:${name}` : '';
    const note = [also, holders.length ? `its ${el.closest('li') ? 'bullet' : 'cell / row / column'}: ${holders.join(' · ')}` : '',
      hit.matches && hit.matches > 1 ? `named ${hit.matches} times on the slide — give each place its own name` : ''].filter(Boolean).join('; ');
    out.push({ target: `#${name}`, what, box: hit.box, ...(note ? { note } : {}) });
  });
  // A target found by its words must lead back to THIS element — the same words may
  // be written twice (a sum "13" in two cells, "+9" on two edges): then #2, #3 …
  const inside = (b: FocusBox, el: Element) => {
    const e = elementBox(el, conv);
    const x = b.x + b.w / 2;
    const y = b.y + b.h / 2;
    return x >= e.x - 1 && x <= e.x + e.w + 1 && y >= e.y - 1 && y <= e.y + e.h + 1;
  };
  const pin = (base: string, el: Element): string | null => {
    for (let n = 1; n <= 9; n++) {
      const t = n === 1 ? base : `${base}#${n}`;
      const r = resolveTarget(t, root);
      if (!isHit(r)) return null;
      if (inside(r.box, el)) return t;
    }
    return null;
  };
  content.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((h) => {
    const t = short(h.textContent || '');
    const by = t ? pin(quote(t), h) : null;
    if (by) add(by, `heading ${h.tagName.toLowerCase()}`, h);
  });
  Array.from(content.querySelectorAll('li')).forEach((li, i) => {
    const own = Array.from(li.childNodes).filter((n) => n.nodeType === 3 || (n as Element).tagName !== 'UL' && (n as Element).tagName !== 'OL')
      .map((n) => n.textContent || '').join(' ');
    const t = short(own);
    const lines = writtenLines([li], conv);      // where it is written, as resolveTarget gives it
    const by = t ? pin(`item:${quote(t)}`, li) : null;
    add(by || `item:${i + 1}`, `bullet ${i + 1}`, li, by ? `also item:${i + 1}` : undefined, lines.length ? unionBox(lines) : undefined);
  });
  tablesOf(content).forEach((table, ti) => {
    Array.from(table.rows).forEach((row, r) => Array.from(row.cells).forEach((cell, c) => {
      const t = short(cell.textContent || '');
      const by = t ? pin(`cell:${quote(t)}`, cell) : null;
      // by position: the first table only
      if (!by && ti > 0) return;
      add(by || `cell:${r + 1},${c + 1}`, `table ${ti + 1} row ${r + 1} col ${c + 1}`, cell,
        ti === 0 ? `also ${by ? `cell:${r + 1},${c + 1} · ` : ''}row:${r + 1} · col:${c + 1}` : 'a later table: point at it by its text');
    }));
  });
  // (named modules, formula parts and figure parts are the #name entries above)
  content.querySelectorAll('[class*="mdp-mod-"]').forEach((m) => {
    if (m.closest('[data-mdp-tag]')) return;
    const name = (Array.from(m.classList).find((c) => c.startsWith('mdp-mod-') && c !== 'mdp-mod-inited') || '').slice(8);
    if (name) add(`#…`, `module @${name}`, m, 'give its directive `tag: NAME` to point at it as #NAME');
  });
  Array.from(content.querySelectorAll('.katex')).forEach((k, i) => add(`math:${i + 1}`, 'formula', k.querySelector('.katex-html') || k,
    'by position: name it (or a part) with \\focus{name}{…} in its LaTeX to point as #name'));
  content.querySelectorAll('svg text').forEach((t) => {
    const s = short(t.textContent || '');
    const by = s ? pin(`fig:${quote(s)}`, t) : null;
    if (by) add(by, 'figure label', t);
  });
  content.querySelectorAll('img').forEach((img, i) => add(`area:…`, `image ${i + 1}`, img, 'point into it with area:x,y,w,h (% of the slide); its box is given — or name the image: \\focus{name}{![…](…)}'));
  return out;
}
