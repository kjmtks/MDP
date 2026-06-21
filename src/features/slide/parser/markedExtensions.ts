import { marked, type RendererObject } from 'marked';
import type { SlideContext } from '../parser/SlideContext';
import { parseCommand } from './slideCommands';
import hljs from 'highlight.js';

const parseLineRanges = (rangeStr: string | undefined): Set<number> => {
  const lines = new Set<number>();
  if (!rangeStr) return lines;
  const ranges = rangeStr.replace(/^\{|\}$/g, '').split(',');
  ranges.forEach(range => {
    const trimmed = range.trim();
    if (trimmed.includes('-')) {
      const [start, end] = trimmed.split('-').map(Number);
      if (!isNaN(start) && !isNaN(end)) {
        for (let i = start; i <= end; i++) lines.add(i);
      }
    } else {
      const line = Number(trimmed);
      if (!isNaN(line)) lines.add(line);
    }
  });
  return lines;
};

const renderMeta = (text: string | undefined): string => {
  if (!text) return "";
  // `\(…\)` / `\[…\]` are handled by the marked katex extensions (katexExtensions.ts),
  // so no `$…$` conversion is needed here.
  return marked.parseInline(text) as string;
};

export const slideRenderer = (context: SlideContext, baseUrl: string = "", lastUpdated: number = 0): RendererObject => ({
  // Inline code (`…`) keeps its raw content — do NOT HTML-escape it, so the deck
  // stays consistent (the `html` renderer below passes tags through): `<span>` in
  // backticks renders as HTML. EXCEPTION: an HTML comment / MDP directive
  // (`<!-- … -->`) is escaped so it is DISPLAYED literally instead of being
  // swallowed by the browser as a comment (e.g. `<!-- @note: メモ -->` would
  // otherwise vanish). To show other literal tags, escape them in the source.
  codespan({ text }) {
    const body = /^\s*<!--[\s\S]*?-->\s*$/.test(text)
      ? text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      : text;
    return `<code>${body}</code>`;
  },
  html(token) {
    if (!token.text.trim().startsWith('<!--')) {
       return token.text;
    }
    const command = parseCommand(token.text);
    if (!command) {
      return token.text;
    }
    if (command.scope === 'GLOBAL') {
      return "";
    }
    if (command.type === 'CAPTION') {
        context.caption = command.params;
        return "";
    }
    if (command.type === 'COVER') {
        let html = `<div class="cover-title-wrapper">`;
        const m = context.meta;
        if (m.date) html += `<div class="date">${renderMeta(m.date)}</div>`;
        if (m.title) html += `<div class="title">${renderMeta(m.title)}</div>`;
        if (m.subtitle) html += `<div class="subtitle">${renderMeta(m.subtitle)}</div>`;
        if (m.presenter) html += `<div class="presenter">${renderMeta(m.presenter)}</div>`;
        if (m.affiliation) html += `<div class="affiliation">${renderMeta(m.affiliation)}</div>`;
        if (m.contact) html += `<div class="contact">${renderMeta(m.contact)}</div>`;
        html += `</div>`;
        return html;
    }
    return token.text;
  },

  list(token) {
    let body = '';
    for (let i = 0; i < token.items.length; i++) {
      body += this.listitem(token.items[i]);
    }
    if (token.ordered) {
      const start = token.start !== 1 ? ` start="${token.start}"` : '';
      return `<ol${start}>\n${body}</ol>\n`;
    }
    return `<ul>\n${body}</ul>\n`;
  },

  listitem(item) {
    let content = '';
    if (item.task) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const checkbox = this.checkbox({ checked: !!item.checked } as any);
      if (item.loose) {
        if (item.tokens.length > 0 && item.tokens[0].type === 'paragraph') {
          item.tokens[0].text = checkbox + ' ' + item.tokens[0].text;
          if (item.tokens[0].tokens && item.tokens[0].tokens.length > 0 && item.tokens[0].tokens[0].type === 'text') {
            item.tokens[0].tokens[0].text = checkbox + ' ' + item.tokens[0].tokens[0].text;
          }
        } else {
          item.tokens.unshift({
            type: 'text',
            text: checkbox + ' '
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any);
        }
      } else {
        content += checkbox + ' ';
      }
    }
    content += this.parser.parse(item.tokens);
    return `<li>${content}</li>\n`;
  },

  heading({ tokens, depth }) {
    const text = this.parser.parseInline(tokens);
    return `<h${depth}>${text}</h${depth}>\n`;
  },

  paragraph({ tokens }) {
    const text = this.parser.parseInline(tokens);
    return `<p>${text}</p>\n`;
  },

  blockquote({ tokens }) {
    const body = this.parser.parse(tokens);
    return `<blockquote>\n${body}</blockquote>\n`;
  },

  tablecell(token) {
    const content = this.parser.parseInline(token.tokens);
    const type = token.header ? 'th' : 'td';
    const tag = token.align
      ? `<${type} align="${token.align}">`
      : `<${type}>`;
    return tag + content + `</${type}>\n`;
  },

  tablerow(token) {
    return `<tr>\n${token.text}</tr>\n`;
  },

  table(token) {
    let header = '';
    let cell = '';
    for (let j = 0; j < token.header.length; j++) {
      cell += this.tablecell(token.header[j]);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    header += this.tablerow({ text: cell } as any);

    let body = '';
    for (let j = 0; j < token.rows.length; j++) {
      const row = token.rows[j];
      cell = '';
      for (let k = 0; k < row.length; k++) {
        cell += this.tablecell(row[k]);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      body += this.tablerow({ text: cell } as any);
    }

    const caption = context.caption ? context.caption : null;
    if (caption) {
      delete context.caption;
      return `<table>\n<caption>${renderMeta(caption)}</caption>\n<thead>\n${header}</thead>\n<tbody>\n${body}</tbody>\n</table>\n`;
    } else {
      return `<table>\n<thead>\n${header}</thead>\n<tbody>\n${body}</tbody>\n</table>\n`;
    }

  },

  image({ href, title, text }) {
    let cleanHref = href || '';
    if (text === '@drawio') {
      const content = href || "";
      const cleanContent = content.replace(/[\r\n\s]/g, '');
      baseUrl = "";
      cleanHref = cleanContent;
      text = "";
      lastUpdated = 0;
    }
    if (baseUrl && !cleanHref.match(/^(https?:|\/|data:|blob:|mdp-file:|app-asset:)/)) {
      cleanHref = `${baseUrl}${cleanHref}`;
    }
    if (lastUpdated > 0) {
      const separator = cleanHref.includes('?') ? '&' : '?';
      cleanHref = `${cleanHref}${separator}_t=${lastUpdated}`;
    }
    const titleAttr = title ? ` title="${title}"` : '';
    const altAttr = text ? ` alt="${text}"` : '';
    const caption = context.caption;
    if (caption) {
      delete context.caption;
      return `<figure><img src="${cleanHref}"${altAttr}${titleAttr} /><figcaption>${renderMeta(caption)}</figcaption></figure>`;
    } else {
      return `<figure><img src="${cleanHref}"${altAttr}${titleAttr} /></figure>`;
    }
  },

  code({ text, lang }: { text: string, lang?: string }) {
    if (lang === '@mermaid') {
      return `<div class="mermaid">${text}</div>`;
    }
    if (lang === '@plantuml') {
      return `<div class="plantuml">${text}</div>`;
    }
    if (lang === '@chartjs') {
      try {
        const base64 = btoa(unescape(encodeURIComponent(text)));
        return `<div class="chartjs-render" data-chart="${base64}" style="position:relative; width:100%; height:400px;"><canvas></canvas></div>`;
      } catch {
        return `<div style="color:red">Chart JSON Error</div>`;
      }
    }
    const code = text;
    const infostring = lang || '';
    const langMatch = infostring.match(/^([^:\s\\{]+)(?::([^:\s\\{]+))?/);
    const languageStr = langMatch ? langMatch[1] : 'text';
    const fileName = langMatch ? langMatch[2] : undefined;
    const rangeMatch = infostring.match(/\{([\d,\-\s]+)\}/);
    const rangeStr = rangeMatch ? rangeMatch[1] : undefined;
    const highlightLines = parseLineRanges(rangeStr);
    const startMatch = infostring.match(/start[=:](\d+)/);
    const startLine = startMatch ? parseInt(startMatch[1], 10) : 1;
    const validLang = hljs.getLanguage(languageStr) ? languageStr : 'plaintext';
    const highlightedCode = hljs.highlight(code, { language: validLang }).value;
    const splitLines = code.split(/\r?\n/);
    if (splitLines.length > 0 && splitLines[splitLines.length - 1] === '') {
        splitLines.pop();
    }
    const backgroundRows = splitLines.map((_, index) => {
      const currentLineNum = index + startLine;
      const isHighlighted = highlightLines.has(currentLineNum);
      const highlightClass = isHighlighted ? 'highlighted-line' : '';
      return `<div class="code-bg-row ${highlightClass}" data-line-number="${currentLineNum}"></div>`;
    }).join('');
    const filenameHtml = fileName
      ? `<div class="code-filename">${fileName}</div>`
      : '';
    return `
      <div>
        <div class="code-block-wrapper">
          ${filenameHtml}
          <div class="code-background">
            ${backgroundRows}
          </div>
          <pre><code class="hljs language-${validLang}">${highlightedCode}</code></pre>
        </div>
      </div>
    `;
  },

  strong(token) {
    const text = this.parser.parseInline(token.tokens);
    const isAsterisk = token.raw.startsWith('**');
    const typeClass = isAsterisk ? 'asterisk' : 'underscore';
    return `<strong class="${typeClass}">${text}</strong>`;
  },

  em(token) {
    const text = this.parser.parseInline(token.tokens);
    const isAsterisk = token.raw.startsWith('*');
    const typeClass = isAsterisk ? 'asterisk' : 'underscore';
    return `<em class="${typeClass}">${text}</em>`;
  },
});