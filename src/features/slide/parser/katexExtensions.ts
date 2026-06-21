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

let registered = false;
/** Register the MDP `\(…\)` / `\[…\]` KaTeX extensions on the shared marked
 *  singleton (idempotent). Call wherever marked-katex-extension is registered.
 *  (Not a React hook — deliberately not named `use*`.) */
export const registerMdpKatex = (): void => {
  if (registered) return;
  registered = true;
  marked.use({ extensions: [displayMath, inlineMath] });
};
