import { isHit, resolveTarget, type FocusBox } from '../focus/focusTargets';
import type { LocatedItem } from './reviewModel';

/** The colours of the review (pins, a card's left edge, the legend): the person's own
 *  comments, an AI's questions, then an AI's findings by severity. */
export const REVIEW_COLORS = {
  human: { color: '#00897b', short: 'yours', label: 'Your own comment' },
  question: { color: '#1e88e5', short: 'question', label: 'A question from an AI — only you can answer it' },
  major: { color: '#e53935', short: 'major', label: 'Major — the students would lose the thread, or it is wrong' },
  minor: { color: '#fb8c00', short: 'minor', label: 'Minor — worth fixing' },
  nit: { color: '#90a4ae', short: 'nit', label: 'Nit — a small point' },
} as const;

export const itemColor = (it: Pick<LocatedItem, 'by' | 'kind' | 'severity'>) =>
  REVIEW_COLORS[it.by === 'human' ? 'human' : it.kind === 'question' ? 'question' : it.severity === 'major' ? 'major' : it.severity === 'minor' ? 'minor' : 'nit'].color;

/** A pin's tooltip: what kind of item it is, then its words. */
export const itemTooltip = (it: Pick<LocatedItem, 'by' | 'kind' | 'severity' | 'aspect' | 'status' | 'text' | 'decision'>) =>
  `${it.by === 'human' ? 'your comment' : it.kind === 'question' ? 'question' : it.severity} · ${it.aspect}`
  + `${it.decision ? ` · ${it.decision === 'skip' ? 'won\'t fix' : it.decision === 'fix' ? 'you: fix' : 'later'}` : ''}${it.status !== 'open' && it.decision !== 'skip' ? ` · ${it.status}` : ''} — ${plainText(it.text)}`;

/** Where on the rendered slide an item points (slide px): its target, else the words
 *  it quotes, else the box kept with it; null = the slide as a whole. */
export function anchorBox(root: HTMLElement, it: LocatedItem): FocusBox | null {
  const tryTarget = (t: string) => { const r = resolveTarget(t, root); return isHit(r) && !r.hidden ? r.box : null; };
  if (it.at.target) { const b = tryTarget(it.at.target); if (b) return b; }
  if (it.at.quote && !it.at.quote.includes('」')) { const b = tryTarget(`「${it.at.quote}」`); if (b) return b; }
  return it.at.box || null;
}

/** "p.12 (slide 13)", "cover (slide 1)", "hidden (slide 4)", "slide ?" */
export const slideLabel = (slide: number | null, fact?: { page: number | null; cover: boolean; hidden: boolean }) =>
  !slide ? 'slide ?' : fact?.cover ? `cover (slide ${slide})` : fact?.hidden ? `hidden (slide ${slide})` : fact?.page ? `p.${fact.page} (slide ${slide})` : `slide ${slide}`;

/** A finding's text for a plain tooltip: its TeX formulas' delimiters and the
 *  Markdown marks of emphasis and code dropped. */
export const plainText = (text: string): string => String(text || '').replace(/\\[()[\]]/g, '').replace(/\*\*|__|`/g, '');
