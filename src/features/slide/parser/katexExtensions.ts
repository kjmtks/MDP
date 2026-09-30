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

const render = (text: string, displayMode: boolean): string => {
  try {
    return katex.renderToString(text, { throwOnError: false, output: 'html', displayMode });
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

let registered = false;
/** Register the MDP `\(…\)` / `\[…\]` KaTeX extensions on the shared marked
 *  singleton (idempotent). Call wherever marked-katex-extension is registered.
 *  (Not a React hook — deliberately not named `use*`.) */
export const registerMdpKatex = (): void => {
  if (registered) return;
  registered = true;
  marked.use({ extensions: [displayMath, inlineMath], hooks: { preprocess: protectTableMath } });
};
