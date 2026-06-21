import { marked } from 'marked';
import markedKatex from 'marked-katex-extension';
import { registerMdpKatex } from '../slide/parser/katexExtensions';

// The slide parser configures the shared `marked` singleton with the KaTeX
// extension on load. Configure it here too so this module works regardless of
// import order; re-registration is harmless (the first tokenizer wins).
marked.use(markedKatex({ throwOnError: false, output: 'html' }));
registerMdpKatex();

// Builds a regex for a single-line `<!-- @<key> ... -->` meta command. The
// content group is optional so an empty value still matches and can be told
// apart from a file that has no such meta at all.
const metaRe = (key: string) => new RegExp(`<!--\\s*@${key}(?:\\s+(.*?))?\\s*-->`);
const TITLE_RE = metaRe('title');
const SUBTITLE_RE = metaRe('subtitle');

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Mirrors renderMeta() in markedExtensions: render inline markdown, with `\(..\)` /
// `\[..\]` typeset by the marked katex extensions (katexExtensions.ts).
const renderTitleInline = (text: string): string => {
  return marked.parseInline(text) as string;
};

// From rendered title HTML, drop <br> and decoration tags (keeping their inner
// text) while preserving KaTeX-rendered math as-is. <br> is removed without
// inserting a space so CJK titles don't gain stray gaps.
const stripDecorations = (html: string): string => {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const out: string[] = [];
  const walk = (node: Node) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        out.push(escapeHtml((child.textContent || '').replace(/\s+/g, ' ')));
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as HTMLElement;
        if (el.tagName === 'BR') {
          // drop line breaks entirely (no space)
        } else if (el.classList.contains('katex') || el.classList.contains('katex-display')) {
          out.push(el.outerHTML);
        } else {
          walk(el); // unwrap decoration tags, keep their content
        }
      }
    });
  };
  walk(doc.body);
  return out.join('').trim();
};

export type BookmarkTitle =
  | { kind: 'none' }                // no @title meta — caller should show the file name
  | { kind: 'empty' }               // @title present but empty — show （タイトルなし）
  | { kind: 'html'; html: string }; // rendered title HTML (plain text + KaTeX math)

/**
 * Resolve a bookmark's display title from a file's markdown.
 *
 * - `none`  → the file has no `@title` meta (e.g. a non-slide file); show the file name.
 * - `empty` → `@title` is present but blank; show （タイトルなし）.
 * - `html`  → sanitised title HTML to render via dangerouslySetInnerHTML.
 */
export const extractBookmarkTitle = (markdown: string): BookmarkTitle => {
  const m = markdown.match(TITLE_RE);
  if (!m) return { kind: 'none' };
  const raw = (m[1] || '').trim();
  if (!raw) return { kind: 'empty' };
  const stripped = stripDecorations(renderTitleInline(raw));
  return stripped ? { kind: 'html', html: stripped } : { kind: 'empty' };
};

/**
 * Resolve a slide's subtitle (`@subtitle`) as sanitised HTML (plain text + KaTeX),
 * or `null` when there is no non-empty `@subtitle`. Used as the bookmark's
 * secondary line in place of the path when set.
 */
export const extractBookmarkSubtitle = (markdown: string): string | null => {
  const m = markdown.match(SUBTITLE_RE);
  if (!m) return null;
  const raw = (m[1] || '').trim();
  if (!raw) return null;
  return stripDecorations(renderTitleInline(raw)) || null;
};
