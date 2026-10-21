import { Marked, type Tokens } from 'marked';
import markedKatex from 'marked-katex-extension';
import DOMPurify from 'dompurify';
import { mdpMathExtensions } from '../slide/parser/katexExtensions';

// A review's findings and replies and a lecture's flow are written in Markdown with
// TeX formulas (the author writes every formula in TeX) — so wherever they are shown
// (the Review panel, the presenter's flow step) they are drawn like a slide's text:
// Markdown, and `\(…\)` / `\[…\]` / `$…$` typeset by KaTeX. A marked instance of its
// own: the slides' shared one carries the slide-only extensions. The texts come from
// AIs and people, so raw HTML is shown as text, a link opens outside the app (the
// window-open handler sends http(s) to the browser), an image is its alt text, and the
// result is sanitized.

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const md = new Marked({ gfm: true, breaks: true });
md.use(markedKatex({ throwOnError: false, output: 'html' }));
md.use({ extensions: mdpMathExtensions() });
md.use({
  renderer: {
    html(token: Tokens.HTML | Tokens.Tag) { return esc(token.text); },
    image(token: Tokens.Image) { return esc(token.text || ''); },
    link(token: Tokens.Link) {
      const inner = this.parser.parseInline(token.tokens);
      if (!/^(https?:|mailto:)/i.test(token.href)) return inner;
      return `<a href="${esc(token.href)}" target="_blank" rel="noopener noreferrer"${token.title ? ` title="${esc(token.title)}"` : ''}>${inner}</a>`;
    },
  },
});

/** The HTML of a text: one line of inline Markdown, or (block) paragraphs and lists. */
export function richHtml(text: string, block = false): string {
  const src = String(text || '');
  let html: string;
  try { html = (block ? md.parse(src) : md.parseInline(src)) as string; } catch { html = esc(src); }
  return DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });
}
