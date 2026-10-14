// Where a focus cue's TARGET is on a rendered slide — measured from the DOM that
// SlideView drew, in the slide's own CSS pixels (whatever the surface's zoom).
//
//   "語句" / 「語句」(#n)        a phrase as SHOWN on the slide (n-th occurrence) —
//                               whitespace, full/half width and (as a fallback) case
//                               and Markdown marks do not matter; a bare word too
//   item:"…" / item:N          the bullet holding the phrase / the N-th bullet
//   cell:"…" / cell:R,C        a table cell (rows counted from the header, 1-based)
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
      if (p.nums) {
        const li = nthOf(Array.from(root.querySelectorAll('li')), p.nums[0], 'bullet', target);
        return 'error' in li ? li : elementHit(target, li, root, undefined, 'hug');
      }
      const found = findText(root, p.text || '', p.nth, target);
      if ('error' in found) return found;
      const li = found.range.startContainer.parentElement?.closest('li');
      return li ? elementHit(target, li, root, found.count, 'hug') : { target, error: `"${p.text}" is not in a bullet` };
    }
    case 'cell': case 'row': case 'col': {
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
      const found = findText(root, p.text || '', p.nth, target);
      if ('error' in found) return found;
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
      return { target, error: `unknown kind "${p.kind}:" (item, cell, row, col, math, fig, area, @tag, or "text")` };
  }
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
  content.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((h) => {
    const t = short(h.textContent || '');
    if (t) add(quote(t), `heading ${h.tagName.toLowerCase()}`, h);
  });
  Array.from(content.querySelectorAll('li')).forEach((li, i) => {
    const own = Array.from(li.childNodes).filter((n) => n.nodeType === 3 || (n as Element).tagName !== 'UL' && (n as Element).tagName !== 'OL')
      .map((n) => n.textContent || '').join(' ');
    const t = short(own);
    const lines = writtenLines([li], conv);      // where it is written, as resolveTarget gives it
    add(t ? `item:${quote(t)}` : `item:${i + 1}`, `bullet ${i + 1}`, li, t ? `also item:${i + 1}` : undefined, lines.length ? unionBox(lines) : undefined);
  });
  tablesOf(content).forEach((table, ti) => {
    Array.from(table.rows).forEach((row, r) => Array.from(row.cells).forEach((cell, c) => {
      const t = short(cell.textContent || '');
      add(t ? `cell:${quote(t)}` : `cell:${r + 1},${c + 1}`, `table ${ti + 1} row ${r + 1} col ${c + 1}`, cell,
        ti === 0 ? `also cell:${r + 1},${c + 1} · row:${r + 1} · col:${c + 1}` : 'a later table: point at it by its text');
    }));
  });
  content.querySelectorAll('[data-mdp-tag]').forEach((m) => add(`@${(m as HTMLElement).dataset.mdpTag}`, 'module', m));
  content.querySelectorAll('[class*="mdp-mod-"]').forEach((m) => {
    if (m.closest('[data-mdp-tag]')) return;
    const name = (Array.from(m.classList).find((c) => c.startsWith('mdp-mod-') && c !== 'mdp-mod-inited') || '').slice(8);
    if (name) add(`@…`, `module @${name}`, m, 'give its directive `tag: NAME` to point at it as @NAME');
  });
  Array.from(content.querySelectorAll('.katex')).forEach((k, i) => add(`math:${i + 1}`, 'formula', k.querySelector('.katex-html') || k));
  content.querySelectorAll('[data-mdp-focus]').forEach((m) => add(`math:${(m as HTMLElement).dataset.mdpFocus}`, 'formula part', m));
  content.querySelectorAll('svg text').forEach((t) => {
    const s = short(t.textContent || '');
    if (s) add(`fig:${quote(s)}`, 'figure label', t);
  });
  content.querySelectorAll('svg [data-focus]').forEach((g) => add(`fig:${g.getAttribute('data-focus')}`, 'figure part', g));
  content.querySelectorAll('img').forEach((img, i) => add(`area:…`, `image ${i + 1}`, img, 'point into it with area:x,y,w,h (% of the slide); its box is given'));
  return out;
}
