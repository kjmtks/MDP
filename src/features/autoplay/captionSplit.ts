// How a narration is cut into SUBTITLE UNITS — the pieces that are spoken and
// captioned one at a time (scriptUnits → buildPlaylist).
//
// Every unit is synthesized ON ITS OWN, so every cut is heard: the voice closes
// the piece like a sentence. Hence:
//   • a sentence stays whole whenever it fits the caption's two lines;
//   • a very short sentence ("はい。", "Time is up.") rides with its neighbour;
//   • a longer one is cut into as FEW pieces as fit, at the most natural places
//     (clause punctuation first, then phrase boundaries — after a particle, before
//     a conjunction or a preposition), the pieces as EVEN as those places allow;
//   • never inside a word, a formula or a ruby (those are atoms — see scriptUnits).
// Widths are on-screen widths in full-width characters: kana/kanji 1, Latin ½.

/** A unit's widest: two caption lines (the caption box holds ~35 full-width
 *  characters a line; a 4:3 slide's video frame ~28). */
export const UNIT_MAX = 66;
/** A sentence narrower than this joins the next one (or the previous one). */
const SHORT = 12;

interface Cell { s: string; w: number; atom: boolean }

const WIDE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꥠ-꥿가-힣豈-﫿︰-﹏＀-｠￠-￦]|[\u{20000}-\u{3fffd}]/u;
const charWidth = (c: string): number => (WIDE.test(c) ? 1 : /\s/.test(c) ? 0.3 : 0.55);

/** On-screen width of a plain string, in full-width characters. */
export function displayWidth(s: string): number {
  let w = 0;
  for (const c of String(s || '')) w += charWidth(c);
  return w;
}

// Atom tokens (scriptUnits masks each formula / ruby as <n>).
function cellsOf(text: string, atomWidth: (n: number) => number): Cell[] {
  const cells: Cell[] = [];
  for (let i = 0; i < text.length;) {
    if (text[i] === '') {
      const end = text.indexOf('', i);
      if (end > i) {
        cells.push({ s: text.slice(i, end + 1), w: atomWidth(Number(text.slice(i + 1, end))), atom: true });
        i = end + 1;
        continue;
      }
    }
    const c = String.fromCodePoint(text.codePointAt(i)!);
    cells.push({ s: c, w: charWidth(c), atom: false });
    i += c.length;
  }
  return cells;
}

const OPEN = '「『（(【〔《〈［[｛{';
const CLOSE = '」』）)】〕》〉］]｝}';
const JA_END = '。．！？';
// What may follow a sentence ender and still belong to the sentence.
const TRAIL = '。．！？!?…‥」』）)】〕》〉］]｝}"”’\'';
// Never at the START of a piece: closing punctuation, small kana, prolonged sound.
const NO_START = '、。，．,.!?！？:;；：」』）)】〕》〉］]｝}…‥ー〜～ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ々・%％';
const CLAUSE = '、，,;；:：';
const ABBREV = new Set(['mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'e.g', 'i.e', 'cf', 'al', 'fig', 'figs', 'eq', 'eqs', 'no', 'vol', 'pp', 'approx', 'ca', 'inc', 'ltd', 'co', 'dept', 'univ', 'sec', 'ch', 'ref', 'refs']);

const isHira = (c: string) => /^[ぁ-ゟ]$/.test(c);
const isKata = (c: string) => /^[ァ-ヿㇰ-ㇿｦ-ﾟ]$/.test(c);
const isKanji = (c: string) => /^[㐀-䶿一-鿿豈-﫿々〆]$/u.test(c) || /^[\u{20000}-\u{3fffd}]$/u.test(c);
const isLatin = (c: string) => /^[A-Za-z0-9０-９Ａ-Ｚａ-ｚ]$/.test(c);
const isSpace = (c: string) => /^\s$/.test(c);

// ---- sentences ----------------------------------------------------------------

/** Sentence ranges [from, to) over the cells. Japanese enders 。．！？ end a
 *  sentence; ! ? when a space, the end or Japanese follows; a period when a space
 *  and a capital (or a digit / quote / Japanese) follow — not after Mr., e.g.,
 *  etc. or an initial. Never inside brackets or quotes: 「はい。」と言った。 is one
 *  sentence, 「やります。」 次へ。 two. */
function sentenceRanges(cells: Cell[]): [number, number][] {
  const out: [number, number][] = [];
  const ch = (k: number) => (k >= 0 && k < cells.length && !cells[k].atom ? cells[k].s : '');
  const nextSolid = (k: number) => { while (k < cells.length && isSpace(ch(k))) k++; return k; };
  let start = 0;
  let depth = 0;
  let openedAt = -1;
  const cut = (end: number) => { if (end > start) out.push([start, end]); start = end; };
  const asciiEnd = (k: number) => {
    const c = ch(k);
    return !c || isSpace(c) || WIDE.test(c);
  };
  const periodEnd = (i: number) => {
    let k = i + 1;
    while (k < cells.length && '"”’\')]'.includes(ch(k)) && ch(k)) k++;
    if (k >= cells.length) return true;
    if (!isSpace(ch(k))) return false;
    const n = nextSolid(k);
    if (n >= cells.length) return true;
    const c = ch(n);
    if (!cells[n].atom && !/^[A-Z0-9"“‘'([]$/.test(c) && !WIDE.test(c)) return false;
    // the word before the period
    let b = i - 1;
    let word = '';
    while (b >= 0 && /^[A-Za-z.]$/.test(ch(b))) { word = ch(b) + word; b--; }
    if (word.length === 1 && /[A-Z]/.test(word)) return false;           // J. Smith, U.S.
    return !ABBREV.has(word.toLowerCase().replace(/\.$/, ''));
  };
  for (let i = 0; i < cells.length; i++) {
    const c = ch(i);
    if (!c) continue;
    if (OPEN.includes(c)) { if (depth === 0) openedAt = i; depth++; continue; }
    if (CLOSE.includes(c)) {
      if (depth > 0) depth--;
      // A quote that ends its own sentence ends ours too — unless the sentence
      // goes on with a quoting particle: 「はい。」と言った / 「はい。」って.
      if (depth === 0 && JA_END.includes(ch(i - 1))) {
        const n = nextSolid(i + 1);
        if (!/^[とっ]$/.test(ch(n))) cut(i + 1);
      }
      continue;
    }
    if (depth > 0) {
      if (i - openedAt <= 80) continue;
      depth = 0;                                   // never closed: not a quote after all
    }
    const ends = JA_END.includes(c)
      || ((c === '!' || c === '?') && asciiEnd(i + 1) && !'!?'.includes(ch(i + 1)))
      || ((c === '!' || c === '?') && '!?'.includes(ch(i + 1)))
      || (c === '.' && periodEnd(i));
    if (!ends) continue;
    let j = i + 1;
    while (j < cells.length && ch(j) && TRAIL.includes(ch(j))) j++;
    if (c === '!' || c === '?') {
      // "Yahoo!Japan": a word right after is not a new sentence
      if (j < cells.length && !asciiEnd(j)) continue;
    }
    cut(j);
    i = j - 1;
  }
  cut(cells.length);
  return out;
}

const join = (cells: Cell[], a: number, b: number) => cells.slice(a, b).map((c) => c.s).join('').trim();

/** A text's sentences (whitespace collapsed). */
export function splitSentences(text: string): string[] {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return [];
  const cells = cellsOf(t, () => 1);
  return sentenceRanges(cells).map(([a, b]) => join(cells, a, b)).filter(Boolean);
}

// ---- where a sentence may be cut ---------------------------------------------------

const CONJ = new Set(['and', 'but', 'or', 'nor', 'so', 'yet', 'because', 'which', 'who', 'whom', 'whose', 'that', 'when', 'while', 'where', 'whereas', 'if', 'although', 'though', 'unless', 'until', 'since', 'as', 'whether', 'then']);
const PREP = new Set(['to', 'for', 'with', 'in', 'on', 'at', 'from', 'by', 'into', 'onto', 'about', 'through', 'without', 'within', 'between', 'across', 'after', 'before', 'during', 'over', 'under', 'than', 'via', 'per', 'like']);
// A piece should not END on one of these (they lean on the next word).
const LEANS = new Set(['a', 'an', 'the', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'and', 'or', 'but', 'this', 'these', 'those', 'my', 'your', 'our', 'their', 'its', 'his', 'her', 'is', 'are', 'was', 'were', 'be', 'been', 'will', 'would', 'can', 'could', 'should', 'may', 'might', 'must', 'not', 'no', 'very', 'more', 'most', 'as', 'than', 'so', 'such', 'each', 'every', 'some', 'any', 'all', 'both']);
const JA_CONJ = ['ので', 'から', 'けど', 'れど', 'ても', 'でも', 'たら', 'なら', 'ながら', 'つつ', 'ため', 'ように'];
const PARTICLE = 'はがをにへとでもやのかてば';

/** How unnatural it is to cut BEFORE cell i (lower is better; Infinity: never). */
function cutCost(cells: Cell[], i: number): number {
  const ch = (k: number) => (k >= 0 && k < cells.length && !cells[k].atom ? cells[k].s : '');
  const n = cells[i];
  if (!n || (!n.atom && (isSpace(n.s) || NO_START.includes(n.s)))) return Infinity;
  let p = i - 1;
  while (p >= 0 && isSpace(ch(p))) p--;
  if (p < 0) return Infinity;
  const spaced = p < i - 1;
  const pc = ch(p);
  const pAtom = cells[p].atom;
  // ASCII brackets, quotes and dashes only count apart from a word: f(x), (s)he,
  // don't, 1–3 are one word each.
  const apart = spaced || (!n.atom && WIDE.test(n.s));
  if (!pAtom) {
    if (OPEN.includes(pc)) return Infinity;
    if (CLAUSE.includes(pc)) return 0;
    if (JA_END.includes(pc)) return 0.3;                          // a sentence inside a quote
    if (spaced && ('!?'.includes(pc) || (pc === '.' && /^[A-Z]$/.test(ch(i))))) return 0.3;
    if ('…‥'.includes(pc) || ('—―–'.includes(pc) && apart)) return 0.5;
    if (CLOSE.includes(pc) && (WIDE.test(pc) || apart)) return /^[とっ]$/.test(ch(i)) ? 3 : 0.6;
    if ('"”’'.includes(pc) && spaced) return 0.6;
  }
  if (!n.atom && OPEN.includes(n.s) && (WIDE.test(n.s) || spaced)) return 0.8;
  if (spaced) {
    // Between words: before a conjunction is natural, before a preposition fair;
    // never right after an article, a preposition or an auxiliary.
    let e = i;
    let next = '';
    while (e < cells.length && /^[A-Za-z']$/.test(ch(e))) next += ch(e++);
    let b = p;
    let prev = '';
    while (b >= 0 && /^[A-Za-z']$/.test(ch(b))) prev = ch(b--) + prev;
    const lower = next.toLowerCase();
    let cost = CONJ.has(lower) ? 1.5 : lower === 'of' ? 3.5 : PREP.has(lower) ? 2.5 : 4;
    if (LEANS.has(prev.toLowerCase())) cost += 3;
    return cost;
  }
  // Japanese, no space: a phrase boundary is where a run of kana (the particle or
  // ending) meets the next word's kanji / katakana / Latin / formula.
  if (!pAtom && isHira(pc) && (n.atom || isKanji(n.s) || isKata(n.s) || isLatin(n.s))) {
    let r = p;
    let run = '';
    while (r >= 0 && isHira(ch(r))) run = ch(r--) + run;
    // A lone kana that is not a particle is okurigana inside a word: 読み上げ, 書き込み.
    if (run.length < 2 && !PARTICLE.includes(run)) return Infinity;
    // A clause ends (ので, から, けど…) before a topic (は, を) or a te-form, which
    // often binds tight (まとめて引き受ける).
    if (JA_CONJ.some((x) => run.endsWith(x))) return 1.2;
    if (pc === 'ば') return 1.4;
    if ('はもを'.includes(pc)) return 1.8;
    if (pc === 'て' || pc === 'で') return 2;
    if ('がにへとやか'.includes(pc)) return 2.2;
    if (pc === 'の') return 3.2;
    return 2.8;
  }
  // Inside a word of kanji / katakana: only as a last resort.
  if (!pAtom && !n.atom && (isKanji(pc) || isKata(pc)) && (isKanji(n.s) || isKata(n.s))) return 12;
  return Infinity;
}

// ---- cutting ------------------------------------------------------------------

/** Cut cells [a, b) into the fewest pieces that fit `max`, at the most natural
 *  places, as even as those places allow. Returns the cut positions. */
function bestCuts(cells: Cell[], a: number, b: number, max: number, width: (u: number, v: number) => number): number[] {
  const pos: number[] = [];
  const pen: number[] = [];
  for (let i = a + 1; i < b; i++) {
    const c = cutCost(cells, i);
    if (Number.isFinite(c)) { pos.push(i); pen.push(c); }
  }
  if (!pos.length) return [];
  const total = width(a, b);
  const kMin = Math.max(2, Math.ceil(total / max));
  const nodes = [a, ...pos, b];
  const m = nodes.length - 1;
  let best: { cost: number; cuts: number[] } | null = null;
  for (let k = kMin; k <= Math.min(kMin + 2, m); k++) {
    const ideal = total / k;
    const piece = (u: number, v: number) => {
      const w = width(u, v);
      const off = (w - ideal) / ideal;
      return 4 * off * off + (w > max ? (w - max) * 1.5 : 0) + (w < 5 ? 8 : 0);
    };
    // dp[j][x]: the cheapest way to cover nodes[0]..nodes[x] with j pieces
    const dp: number[][] = Array.from({ length: k + 1 }, () => new Array(m + 1).fill(Infinity));
    const from: number[][] = Array.from({ length: k + 1 }, () => new Array(m + 1).fill(-1));
    dp[0][0] = 0;
    for (let j = 1; j <= k; j++) {
      for (let x = j; x <= m; x++) {
        if (j === k && x !== m) continue;
        const here = x < m ? pen[x - 1] : 0;
        for (let y = j - 1; y < x; y++) {
          if (!Number.isFinite(dp[j - 1][y])) continue;
          const c = dp[j - 1][y] + piece(nodes[y], nodes[x]) + here;
          if (c < dp[j][x]) { dp[j][x] = c; from[j][x] = y; }
        }
      }
    }
    if (!Number.isFinite(dp[k][m])) continue;
    // Every piece more than needed costs: as few cuts as possible.
    const cost = dp[k][m] + (k - kMin) * 3;
    if (!best || cost < best.cost) {
      const cuts: number[] = [];
      for (let j = k, x = m; j > 1; j--) { x = from[j][x]; cuts.unshift(nodes[x]); }
      best = { cost, cuts };
    }
  }
  return best ? best.cuts : [];
}

/** Split a narration text into subtitle units (see the top of this file). Atom
 *  tokens (<n>) are never cut; `atomWidth(n)` is atom n's width. */
export function captionChunks(text: string, max = UNIT_MAX, atomWidth: (n: number) => number = () => 2): string[] {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return [];
  const cells = cellsOf(t, atomWidth);
  const pre = [0];
  for (const c of cells) pre.push(pre[pre.length - 1] + c.w);
  const width = (u: number, v: number) => {
    while (u < v && !cells[u].atom && isSpace(cells[u].s)) u++;
    while (v > u && !cells[v - 1].atom && isSpace(cells[v - 1].s)) v--;
    return pre[v] - pre[u];
  };
  // Sentences; a very short one ("1つ目。", "Now.") rides with the next, the last
  // one ("以上です。") with the previous — when the two still fit.
  const sentences = sentenceRanges(cells);
  const merged: [number, number][] = [];
  for (let k = 0; k < sentences.length; k++) {
    const a = sentences[k][0];
    let b = sentences[k][1];
    while (width(a, b) < SHORT && k + 1 < sentences.length && width(a, sentences[k + 1][1]) <= max) b = sentences[++k][1];
    const last = merged[merged.length - 1];
    if (width(a, b) < SHORT && last && width(last[0], b) <= max) last[1] = b;
    else merged.push([a, b]);
  }
  const out: string[] = [];
  for (const [a, b] of merged) {
    if (width(a, b) <= max) { out.push(join(cells, a, b)); continue; }
    let at = a;
    for (const c of bestCuts(cells, a, b, max, width)) { out.push(join(cells, at, c)); at = c; }
    out.push(join(cells, at, b));
  }
  return out.filter(Boolean);
}
