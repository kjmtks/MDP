import { marked, type RendererObject } from 'marked';
import type { SlideContext } from './SlideContext';
import { parseCommand } from './slideCommands';
import hljs from 'highlight.js';

const getAttributesAndClear = (context: SlideContext, tagName: string): string => {
  const parts: string[] = [];
  const tag = tagName.toLowerCase();
  if (context.addclasses[tag]) {
    parts.push(`class="${context.addclasses[tag]}"`);
    delete context.addclasses[tag];
  }
  if (context.addstyles[tag]) {
    parts.push(`style="${context.addstyles[tag]}"`);
    delete context.addstyles[tag];
  }
  return parts.length > 0 ? ' ' + parts.join(' ') : '';
};


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
  const texText = text
      .replace(/\\\[([\s\S]*?)\\\]/g, '$$$$$1$$$$')
      .replace(/\\\(([\s\S]*?)\\\)/g, '$$$1$$');
  return marked.parseInline(texText) as string;
};

export const slideRenderer = (context: SlideContext, baseUrl: string = "", lastUpdated: number = 0): RendererObject => ({
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
    if (command.type === 'MULTICOLUMN_BEGIN') {
        const ratioStr = command.params as string;
        context.columnsRatio = ratioStr ? ratioStr.split(":").map(Number) : [1, 1];
        context.columnIndex = 0;
        return `<div class="multicolumn-container"><div class="multicolumn-col" style="flex: ${context.columnsRatio[0]}">`;
    }
    if (command.type === 'MULTICOLUMN_NEXT') {
        if (context.columnsRatio && context.columnIndex !== undefined) {
          context.columnIndex++;
          const flexVal = context.columnsRatio[context.columnIndex] || 1;
          return `</div><div class="multicolumn-col" style="flex: ${flexVal}">`;
        }
        return "";
    }
    if (command.type === 'MULTICOLUMN_END') {
        context.columnsRatio = undefined;
        context.columnIndex = undefined;
        return `</div></div>`;
    }
    if (command.type === 'ADD_CLASS') {
        const { tag: cTag, val: cVal } = command.params;
        const lowerTag = cTag.toLowerCase();
        context.addclasses[lowerTag] = context.addclasses[lowerTag] 
          ? `${context.addclasses[lowerTag]} ${cVal}` 
          : cVal;
        return ""; 
    }
    if (command.type === 'ADD_STYLE') {
        const { tag: sTag, val: sVal } = command.params;
        const lowerTag = sTag.toLowerCase();
        context.addstyles[lowerTag] = context.addstyles[lowerTag] 
          ? `${context.addstyles[lowerTag]} ${sVal}` 
          : sVal;
        return "";
    }
    if (command.type === 'CAPTION') {
        context.caption = command.params;
        return "";
    }
    if (command.type === 'COVER') {
        let html = "";
        const m = context.meta;
        if (m.date) html += `<div class="date">${renderMeta(m.date)}</div>`;
        if (m.title) html += `<div class="title">${renderMeta(m.title)}</div>`;
        if (m.subtitle) html += `<div class="subtitle">${renderMeta(m.subtitle)}</div>`;
        if (m.presenter) html += `<div class="presenter">${renderMeta(m.presenter)}</div>`;
        if (m.affiliation) html += `<div class="affiliation">${renderMeta(m.affiliation)}</div>`;
        if (m.contact) html += `<div class="contact">${renderMeta(m.contact)}</div>`;
        return html;
    }
    return token.text;
  },


  list(token) {
    let body = '';
    for (let i = 0; i < token.items.length; i++) {
      body += this.listitem(token.items[i]);
    }
    const tag = token.ordered ? 'ol' : 'ul';
    const attrs = getAttributesAndClear(context, tag);
    if (token.ordered) {
      const start = token.start !== 1 ? ` start="${token.start}"` : '';
      return `<ol${start}${attrs}>\n${body}</ol>\n`;
    }
    return `<ul${attrs}>\n${body}</ul>\n`;
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
    const attrs = getAttributesAndClear(context, 'li');
    return `<li${attrs}>${content}</li>\n`;
  },

  heading({ tokens, depth }) {
    const text = this.parser.parseInline(tokens);
    const attrs = getAttributesAndClear(context, `h${depth}`);
    return `<h${depth}${attrs}>${text}</h${depth}>\n`;
  },

  paragraph({ tokens }) {
    const text = this.parser.parseInline(tokens);
    const attrs = getAttributesAndClear(context, 'p');
    return `<p${attrs}>${text}</p>\n`;
  },

  blockquote({ tokens }) {
    const body = this.parser.parse(tokens);
    const attrs = getAttributesAndClear(context, 'blockquote');
    return `<blockquote${attrs}>\n${body}</blockquote>\n`;
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
    
    const attrs = getAttributesAndClear(context, 'table');
    const caption = context.caption ? context.caption : null;
    if (caption) {
      delete context.caption;
      return `<table${attrs}>\n<caption>${renderMeta(caption)}</caption>\n<thead>\n${header}</thead>\n<tbody>\n${body}</tbody>\n</table>\n`;
    } else {
      return `<table${attrs}>\n<thead>\n${header}</thead>\n<tbody>\n${body}</tbody>\n</table>\n`;
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
    if (baseUrl && !cleanHref.match(/^(https?:|\/|data:)/)) {
      cleanHref = `${baseUrl}${cleanHref}`;
    }
    if (lastUpdated > 0) {
      const separator = cleanHref.includes('?') ? '&' : '?';
      cleanHref = `${cleanHref}${separator}_t=${lastUpdated}`;
    }
    const attrs = getAttributesAndClear(context, 'img');
    const titleAttr = title ? ` title="${title}"` : '';
    const altAttr = text ? ` alt="${text}"` : '';
    const caption = context.caption;
    if (caption) {
      delete context.caption;
      return `<figure><img src="${cleanHref}"${altAttr}${titleAttr}${attrs} /><figcaption>${renderMeta(caption)}</figcaption></figure>`;
    } else {
      return `<figure><img src="${cleanHref}"${altAttr}${titleAttr}${attrs} /></figure>`;
    }
  },

  code({ text, lang }: { text: string, lang?: string }) {
    if (lang === '@mermaid') {
      return `<div class="mermaid">${text}</div>`;
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
    const attrs = getAttributesAndClear(context, 'code');
    return `
      <div${attrs}>
        <div class="code-block-wrapper">
          ${filenameHtml}
          <div class="code-background">
            ${backgroundRows}
          </div>
          <pre><code class="hljs language-${validLang}">${highlightedCode}</code></pre>
        </div>
      </div>
    `;
  }
});