// Auto-narration helpers. A slide's read-aloud `@script` may contain `[[step]]`
// markers that split the narration into SEGMENTS: the narrator reads a segment,
// then the in-slide build advances one step, then the next segment is read — so the
// spoken words stay in sync with the reveals. The markers are stripped before TTS.

const STEP_MARKER = /\[\[\s*step\s*\]\]/gi;

// Extract the concatenated @script text from a slide's raw markdown.
export function slideScript(raw: string): string {
  return [...String(raw || '').matchAll(/<!--\s*@script:\s*([\s\S]*?)\s*-->/g)]
    .map((m) => m[1]).join('\n').trim();
}

// Split a slide's @script into narration segments at each `[[step]]` marker.
// Returns [] when there is no script. Each segment has markers removed and is
// trimmed; empty segments are dropped.
export function scriptSegments(raw: string): string[] {
  const full = slideScript(raw);
  if (!full) return [];
  return full.split(STEP_MARKER).map((s) => s.replace(STEP_MARKER, '').trim()).filter(Boolean);
}

// Remove `[[step]]` markers from a string (for display / plain reading).
export function stripStepMarkers(s: string): string {
  return String(s || '').replace(STEP_MARKER, '').trim();
}

// How long the auto-play should DWELL on a slide that has no @script — proportional
// to the slide's CONTENT, so a sparse slide isn't held as long as a dense one. Based
// on the visible text length at the reading speed (time to read it once) plus a small
// bump per visual (image/table/svg/canvas), clamped to a sane range. NOT the
// talk-time estimate (which adds speaking overhead and a base floor — too long here).
export function slideDwellMs(html: string, cpm: number): number {
  const h = String(html || '');
  const text = h.replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
  const visuals = (h.match(/<(?:img|svg|canvas|table)\b/gi) || []).length;
  const cps = (cpm > 0 ? cpm : 320) / 60;
  const seconds = text.length / cps + visuals * 1.8;
  return Math.round(Math.max(1.5, Math.min(10, seconds)) * 1000);
}

// Split a narration segment into SENTENCES (at 。．！？!?… enders). Each sentence is
// synthesized + captioned as its own unit, so the on-screen caption is exactly the
// audio being spoken (perfect sync) and speech stays natural (no mid-sentence cuts).
// A run with no sentence ender is returned whole.
export function sentenceUnits(text: string): string[] {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return [];
  return t.split(/(?<=[。．！？!?…])/).map((s) => s.trim()).filter(Boolean);
}

// Wrap an over-long clause at NATURAL word boundaries (spaces) — for English/mixed
// text. If the run has no spaces (e.g. plain CJK with no punctuation), it is kept
// WHOLE rather than cut mid-word: a long run virtually always ends at a 句点, so the
// pathological no-delimiter case isn't worth an ugly mid-word cut.
function wrapAtSpaces(s: string, maxLen: number): string[] {
  if (!/\s/.test(s)) return [s.trim()];
  const words = s.split(/(?<=\s)/); // keep each word's trailing space
  const out: string[] = [];
  let buf = '';
  for (const w of words) {
    if (!buf) buf = w;
    else if ((buf + w).trim().length <= maxLen) buf += w;
    else { out.push(buf.trim()); buf = w; }
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter(Boolean);
}

// Delimiters we break at, in addition to sentence enders — "natural" break points:
//   • clause punctuation:      、 ，, ; ； : ： ・
//   • AFTER a closing bracket/quote:  」 』 ） 】 〕 》 〉
//   • BEFORE an opening bracket/quote: 「 『 （ 【 〔 《 〈
// (Word-boundary spaces are handled separately, as a softer fallback.)
const CLAUSE_SPLIT = /(?<=[、，,;；:：・」』）】〕》〉])|(?=[「『（【〔《〈])/;

// Split a narration segment into SUBTITLE-sized chunks, breaking at NATURAL points as
// much as possible: first at sentence enders (。．！？!?…), then, for a long sentence,
// at the clause/bracket delimiters above — splitting there and merging pieces up to
// ~maxLen so every break lands on a delimiter. A clause still over maxLen is wrapped
// at word-boundary spaces (English); a delimiter-and-space-free run (long CJK with no
// punctuation) is kept whole. Whitespace is collapsed. Returns [] for empty.
export function captionChunks(text: string, maxLen = 42): string[] {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return [];
  const sentences = t.split(/(?<=[。．！？!?…])/).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const sentence of sentences) {
    if (sentence.length <= maxLen) { out.push(sentence); continue; }
    const pieces = sentence.split(CLAUSE_SPLIT).map((p) => p.trim()).filter(Boolean);
    let buf = '';
    const flush = () => { if (buf) { out.push(buf); buf = ''; } };
    for (const p of pieces) {
      if (p.length > maxLen) {
        // Clause longer than a line: wrap at spaces (English) or keep whole (CJK).
        flush();
        for (const w of wrapAtSpaces(p, maxLen)) out.push(w);
        continue;
      }
      if (!buf) buf = p;
      else if ((buf + p).length <= maxLen) buf += p; // merge; delimiters already inside
      else { flush(); buf = p; }
    }
    flush();
  }
  return out;
}
