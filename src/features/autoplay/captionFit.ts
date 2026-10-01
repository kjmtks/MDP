import type { CSSProperties } from 'react';

// Captions on screen (auto-play, video frames): a caption that needs two lines gets
// two EVEN lines — never one full line and a tail of two characters. The browser
// balances the lines (`text-wrap: balance`) and breaks Japanese between phrases
// (`word-break: auto-phrase`, for lang="ja"); fitCaptionBox then narrows the box to
// the least width that still needs no more lines, so it hugs the balanced text.

/** Text styles of a caption box (with `width: max-content` and a `maxWidth`). */
export const CAPTION_TEXT: CSSProperties = {
  width: 'max-content', boxSizing: 'border-box',
  whiteSpace: 'normal', textWrap: 'balance', wordBreak: 'auto-phrase', lineBreak: 'strict', overflowWrap: 'break-word',
};

/** The caption's language, for its line breaking (`auto-phrase` needs "ja"). */
export function captionLang(text: string): string {
  if (/[぀-ヿ]/.test(text)) return 'ja';
  if (/[㐀-鿿]/.test(text)) return 'zh';
  return 'en';
}

/** Narrow a caption box to the least width that keeps its number of lines (the
 *  box must be laid out — call after its text and math are in, and again when
 *  fonts load or the size changes). */
export function fitCaptionBox(el: HTMLElement): void {
  el.style.width = 'max-content';
  const widest = el.offsetWidth;
  const tall = el.offsetHeight;
  if (!widest || !tall) return;
  let lo = Math.floor(widest * 0.3);
  let hi = widest;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    el.style.width = `${mid}px`;
    if (el.offsetHeight <= tall + 0.5) hi = mid; else lo = mid;
  }
  // A hair of room: a later repaint (a scale, the capture) must not wrap it again.
  el.style.width = hi >= widest ? 'max-content' : `${Math.min(widest, Math.ceil(hi * 1.01) + 1)}px`;
}
