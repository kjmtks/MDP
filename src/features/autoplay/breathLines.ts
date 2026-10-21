import { captionChunks, displayWidth } from './captionSplit';

// The presenter's script one BREATH per line — what a person reading it aloud says in
// one go — so a script read at first sight still gets its pauses. Cut where the
// narration would cut a long sentence (captionChunks: after 、 and clause ends first,
// never inside a word, pieces kept even), only shorter. A word with its reading, a
// formula, a marker (a chip), a code span or a tag is never cut.

export const BREATH_MAX = 24;

const A = String.fromCharCode(0xe000);
const Z = String.fromCharCode(0xe001);
const ATOM_BACK = new RegExp(`${A}(\\d+)${Z}`, 'g');
// The pieces that stay whole: a ruby (markScriptReadings' span), a code span set aside
// (slideParser's placeholder), a marker, a formula, any other tag.
const PIECE_RE = /<span class="mdp-script-ruby"[^>]*>[\s\S]*?<\/span>|\[\[\[MDPCODE\d+\]\]\]|\[\[[\s\S]*?\]\]|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|<[^>]+>/g;

// How wide a piece shows: a ruby its base, a formula its LaTeX without the markup (a
// command = one glyph), a chip about two, a tag nothing.
function widthOf(piece: string): number {
  if (piece.startsWith('<span')) return displayWidth(piece.replace(/<[^>]+>/g, ''));
  if (piece.startsWith('[[[MDPCODE')) return 4;
  if (piece.startsWith('[[')) return 2;
  if (piece.startsWith('\\')) return Math.max(0.5, displayWidth(piece.replace(/\\[()[\]]/g, '').replace(/\\[a-zA-Z]+/g, 'x').replace(/[{}^_\\]/g, '')));
  return 0;
}

/** A script's text with a line break between its breaths (`max` full-width
 *  characters at most per breath, unless one word is longer). */
export function breathLines(text: string, max = BREATH_MAX): string {
  const pieces: string[] = [];
  const masked = String(text || '').replace(PIECE_RE, (m) => { pieces.push(m); return `${A}${pieces.length - 1}${Z}`; });
  const chunks = captionChunks(masked, max, (n) => widthOf(pieces[n] ?? ''));
  if (chunks.length <= 1) return text;
  return chunks.map((c) => c.replace(ATOM_BACK, (_m, i) => pieces[Number(i)] ?? '')).join('\n');
}
