// What the editor's "Add to glossary…" starts with: the selected words (a selected
// ruby [[SHAP|シャップ]] gives its base and reading), else the ruby the caret is in,
// else the word at the caret. A formula is no glossary term — the glossary never reads
// inside one (narration keeps formulas whole), its reading stays a ruby in the script.

export interface GlossaryPick {
  term: string;
  reading: string;
  /** The ruby picked (its range in the document) — it can be removed once the glossary reads the term. */
  ruby: { from: number; to: number; text: string } | null;
  formula: boolean;
}

// [[base|reading]] — not a marker ([[look: …]], [[emit: … | label]], [[say: …]] …)
const RUBY = /\[\[((?:(?!\]\]).)+?)\|((?:(?!\]\]).)*?)\]\]/g;
const MARKER = /^\s*(look|mark|clear|ink|emit|emit-wait|wait|pause|say|step|then)\b/;
const isFormula = (s: string) => /\\\(|\\\[|\$/.test(s);

/** `line` = the caret's line and `lineFrom` its offset; `sel` = the selection (from,
 *  to; equal = a caret); `word` = the word at the caret (the editor's wordAt). */
export function glossaryPick(line: string, lineFrom: number, sel: { from: number; to: number; text: string }, word: { from: number; to: number } | null): GlossaryPick | null {
  if (sel.from !== sel.to) {
    const t = sel.text.replace(/\s+/g, ' ').trim();
    const m = /^\[\[((?:(?!\]\]).)+?)\|((?:(?!\]\]).)*?)\]\]$/.exec(t);
    if (m && !MARKER.test(m[1])) return { term: m[1].trim(), reading: m[2].trim(), ruby: { from: sel.from, to: sel.to, text: sel.text }, formula: isFormula(m[1]) };
    return t ? { term: t, reading: '', ruby: null, formula: isFormula(t) } : null;
  }
  const at = sel.from - lineFrom;
  for (const m of line.matchAll(RUBY)) {
    const i = m.index ?? 0;
    if (at < i || at > i + m[0].length || MARKER.test(m[1])) continue;
    return { term: m[1].trim(), reading: m[2].trim(), ruby: { from: lineFrom + i, to: lineFrom + i + m[0].length, text: m[0] }, formula: isFormula(m[1]) };
  }
  if (word && word.to > word.from) {
    const t = line.slice(word.from - lineFrom, word.to - lineFrom).trim();
    if (t) return { term: t, reading: '', ruby: null, formula: false };
  }
  return null;
}

/** The event the editor fires: open "Add to glossary…" with this. */
export const ADD_TO_GLOSSARY_EVENT = 'mdp-add-to-glossary';
