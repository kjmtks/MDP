import { marked, type TokenizerAndRendererExtension } from 'marked';
import katex from 'katex';

// First-class `\( … \)` (inline) and `\[ … \]` (display) KaTeX delimiters for
// marked, with NO restriction on the characters before or after the delimiters.
//
// Previously `\(…\)` / `\[…\]` were text-replaced into `$…$` / `$$…$$` and rendered
// by marked-katex-extension. Its standard inline rule only matches when the closing
// `$` is followed by whitespace or select punctuation (`[\s?!.,:？！。，：]` or EOL),
// so e.g. `\(x\)-`, `\(x\)）`, `\(a\)\(b\)` were NOT recognised as math. These
// delimiters are explicit and unambiguous, so they need no such boundary guard.
//
// `$…$` is still handled by marked-katex-extension (left untouched so literal `$`
// in prose — e.g. prices — keeps its safe, standard behaviour).

// A part of a formula a focus cue can point at (`[[look: math:rhs]]`):
// `\focus{rhs}{mc^2}` renders as the formula itself, marked data-mdp-focus="rhs"
// (features/focus). KaTeX lets an HTML extension through only when trusted —
// exactly this attribute, nothing else (\href, \url, \includegraphics, \htmlClass,
// \htmlStyle, any other data-* stay off). A fresh macro table per formula: KaTeX
// writes \gdef'd macros into the one it is given.
export const mdpKatexOptions = () => ({
  macros: { '\\focus': '\\htmlData{mdp-focus=#1}{#2}' } as Record<string, string>,
  trust: (ctx: { command: string; attributes?: Record<string, string> }) =>
    ctx.command === '\\htmlData' && Object.keys(ctx.attributes || {}).every((k) => k === 'data-mdp-focus'),
  strict: (code: string) => (code === 'htmlExtension' ? 'ignore' : 'warn'),
});

const render = (text: string, displayMode: boolean): string => {
  try {
    return katex.renderToString(text, { throwOnError: false, output: 'html', displayMode, ...mdpKatexOptions() });
  } catch {
    return text;
  }
};

const inlineMath: TokenizerAndRendererExtension = {
  name: 'mdpKatexInline',
  level: 'inline',
  start(src: string) { const i = src.indexOf('\\('); return i < 0 ? undefined : i; },
  tokenizer(src: string) {
    const m = /^\\\(([\s\S]+?)\\\)/.exec(src);
    if (!m) return undefined;
    return { type: 'mdpKatexInline', raw: m[0], text: m[1] };
  },
  renderer(token) { return render(token.text as string, false); },
};

const displayMath: TokenizerAndRendererExtension = {
  name: 'mdpKatexDisplay',
  level: 'inline',
  start(src: string) { const i = src.indexOf('\\['); return i < 0 ? undefined : i; },
  tokenizer(src: string) {
    const m = /^\\\[([\s\S]+?)\\\]/.exec(src);
    if (!m) return undefined;
    return { type: 'mdpKatexDisplay', raw: m[0], text: m[1] };
  },
  renderer(token) { return render(token.text as string, true); },
};

// ---- A place a focus cue can point at, in the TEXT ------------------------------
// `\focus{name}{…}` — the same notation as in a formula — around words, an image, a
// formula: it renders unchanged (the content keeps its own Markdown), marked
// data-mdp-focus="name", and a script points at it with `#name` (focusTargets). A
// name the author gave survives edits of the words around it and of the slide's
// order — what a phrase or a position cannot. Braces inside are counted (a formula's
// own), escaped ones skipped; an unclosed one stays as text.
export const FOCUS_NAME_SRC = '[\\p{L}\\p{N}_.-]+';
const ANCHOR_OPEN = new RegExp(`^\\\\focus\\{(${FOCUS_NAME_SRC})\\}\\{`, 'u');
const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const focusAnchor: TokenizerAndRendererExtension = {
  name: 'mdpFocusAnchor',
  level: 'inline',
  start(src: string) { const i = src.indexOf('\\focus{'); return i < 0 ? undefined : i; },
  tokenizer(src: string) {
    const m = ANCHOR_OPEN.exec(src);
    if (!m) return undefined;
    let depth = 1;
    let i = m[0].length;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '\\') { i++; continue; }
      if (c === '{') depth++;
      else if (c === '}' && --depth === 0) break;
    }
    if (depth !== 0) return undefined;
    const text = src.slice(m[0].length, i);
    return { type: 'mdpFocusAnchor', raw: src.slice(0, i + 1), name: m[1], text, tokens: this.lexer.inlineTokens(text) };
  },
  renderer(token) {
    const inner = this.parser.parseInline(token.tokens || []);
    const name = `data-mdp-focus="${escAttr(String(token.name))}"`;
    // An image comes out as a <figure>, which no span can hold (the page pushes it
    // out of the paragraph, leaving the span empty): the name goes on the figure.
    const fig = /^\s*<figure>([\s\S]*)<\/figure>\s*$/.exec(inner);
    if (fig && !/<figure[\s>]/.test(fig[1])) return `<figure class="mdp-focus-anchor" ${name}>${fig[1]}</figure>`;
    return `<span class="mdp-focus-anchor" ${name}>${inner}</span>`;
  },
};

// ---- `|` inside math in GFM table rows ---------------------------------------
// marked splits a table row into cells on `|` BEFORE the inline math above is
// tokenized, so `\(|a|\)` in a cell cut the cell apart, and an escaped `\|` (the
// norm ‖) reached KaTeX as a bare `|`. Inside `\(…\)` / `\[…\]` spans of real table
// rows (a header followed by a delimiter row, up to the next blank line) we rewrite
// `\|` → `\Vert ` and `|` → `\vert `: KaTeX renders them identically and they contain
// no `|` for the cell split. Fenced code and inline code spans are left untouched.
// `$…$` math is not rewritten — the slide spec prescribes `\(…\)`.

const TABLE_DELIM_ROW = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

const rewritePipes = (math: string): string => {
  let out = '';
  for (let k = 0; k < math.length; k++) {
    const c = math[k];
    if (c === '\\' && k + 1 < math.length) {
      out += math[k + 1] === '|' ? '\\Vert ' : c + math[k + 1];
      k++;
    } else {
      out += c === '|' ? '\\vert ' : c;
    }
  }
  return out;
};

// Rewrite the pipes inside every `\(…\)` / `\[…\]` of one table row, skipping
// backslash escapes and inline code spans.
const protectRowMath = (row: string): string => {
  let out = '';
  let i = 0;
  while (i < row.length) {
    const c = row[i];
    if (c === '`') {
      const run = /^`+/.exec(row.slice(i))![0];
      const close = row.indexOf(run, i + run.length);
      if (close < 0) { out += run; i += run.length; continue; }
      out += row.slice(i, close + run.length);
      i = close + run.length;
    } else if (c === '\\' && (row[i + 1] === '(' || row[i + 1] === '[')) {
      const closer = row[i + 1] === '(' ? '\\)' : '\\]';
      const close = row.indexOf(closer, i + 2);
      if (close < 0) { out += row.slice(i); break; }
      out += row.slice(i, i + 2) + rewritePipes(row.slice(i + 2, close)) + closer;
      i = close + 2;
    } else if (c === '\\') {
      out += row.slice(i, i + 2); // an escape such as `\\` or `\|` outside math
      i += 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
};

export const protectTableMath = (markdown: string): string => {
  if (!markdown.includes('|') || !/\\[([]/.test(markdown)) return markdown;
  const lines = markdown.split('\n');
  let fence = '';
  let inTable = false;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const fenceOpen = /^(`{3,}|~{3,})/.exec(trimmed);
    if (fence) {
      if (fenceOpen && fenceOpen[1][0] === fence[0] && fenceOpen[1].length >= fence.length) fence = '';
      continue;
    }
    if (fenceOpen) { fence = fenceOpen[1]; inTable = false; continue; }
    if (inTable) {
      if (trimmed === '') { inTable = false; continue; }
      lines[i] = protectRowMath(lines[i]);
    } else if (lines[i].includes('|') && i + 1 < lines.length && lines[i + 1].includes('|')
      && TABLE_DELIM_ROW.test(lines[i + 1])) {
      lines[i] = protectRowMath(lines[i]); // header row; the delimiter row has no math
      inTable = true;
      i++;
    }
  }
  return lines.join('\n');
};

/** The `\(…\)` / `\[…\]` extensions alone — for a marked instance of its own (the
 *  review's and the flow's texts: features/review/richHtml.ts). */
export const mdpMathExtensions = (): TokenizerAndRendererExtension[] => [displayMath, inlineMath];

let registered = false;
/** Register the MDP `\(…\)` / `\[…\]` KaTeX extensions — and the text's
 *  `\focus{name}{…}` — on the shared marked singleton (idempotent). Call wherever
 *  marked-katex-extension is registered. (Not a React hook — deliberately not
 *  named `use*`.) */
export const registerMdpKatex = (): void => {
  if (registered) return;
  registered = true;
  marked.use({ extensions: [displayMath, inlineMath, focusAnchor], hooks: { preprocess: protectTableMath } });
};
