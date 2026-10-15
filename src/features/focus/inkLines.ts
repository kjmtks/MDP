import { buildPlaylist, emphasisCount, type FocusCue, type PlayItem } from '../autoplay/autoplay';

// The narration LINES of one slide — the subtitle units the auto-play speaks and
// captions, in order — and where in the slide's text a cue for a line is written: a
// new [[ink]] made on the preview goes with the line the author picks (InkEditLayer).
// The lines are cut from the words alone (a cue never changes them), so which line a
// cue written at some place belongs to is asked of the narration plan itself: a probe
// cue written there shows with exactly one item of buildPlaylist — the item the
// auto-play would show it with. No second copy of the cutting rules to keep in step.

const PROBE_NAME = '#__mdp_line_probe__';
const PROBE = `[[look: ${PROBE_NAME}]]`;
const isProbe = (c: FocusCue) => c.targets[0] === PROBE_NAME;
const SCRIPT_RE = /<!--\s*@script:\s*([\s\S]*?)\s*-->/g;
const SCRIPT_HEAD = /^<!--\s*@script:\s*/;
// What a probe may not be written into: a marker / ruby [[…]], a formula \(…\) \[…\].
const UNSPLIT = /\[\[[\s\S]*?\]\]|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/g;
// Before a line's first word: spaces and markers that are not words of it (another
// cue, a [[step]], an event) — a new cue is written after them, right before the words.
const LEADING = /^(?:\s+|\[\[\s*(?:look|mark|clear|ink|step|then|emit-wait|emit|wait|pause)\b[^\]]*\]\])/i;

export interface NarrationLine {
  /** 0-based, in the slide's order. */
  n: number;
  /** As captioned (a formula as its LaTeX). */
  caption: string;
  /** Emphases (look / mark / ink) already shown with it — one is the rule. */
  emphases: number;
}

const plan = (text: string): PlayItem[] => buildPlaylist([{ raw: text, html: '' }], 400);
const isLine = (it: PlayItem) => !!(it.text || it.caption);
const lineItems = (items: PlayItem[]) => items.map((it, i) => (isLine(it) ? i : -1)).filter((i) => i >= 0);

/** The slide's script(s): where each one's text is in `text`. */
function scripts(text: string): { from: number; body: string }[] {
  return [...String(text || '').matchAll(SCRIPT_RE)].map((m) => ({ from: (m.index ?? 0) + (SCRIPT_HEAD.exec(m[0])?.[0].length ?? 0), body: m[1] }));
}

/** Every place in the scripts a cue could be written at (offsets into `text`, in order). */
function places(text: string): number[] {
  const out: number[] = [];
  for (const { from, body } of scripts(text)) {
    const blocked = [...body.matchAll(UNSPLIT)].map((b) => [b.index ?? 0, (b.index ?? 0) + b[0].length]);
    let j = 0;
    for (let i = 0; i <= body.length; i++) {
      while (j < blocked.length && blocked[j][1] <= i) j++;
      if (j < blocked.length && blocked[j][0] < i) continue;
      out.push(from + i);
    }
  }
  return out;
}

/** The plan item a cue written at `at` shows with (-1: none). */
const itemOf = (text: string, at: number): number =>
  plan(text.slice(0, at) + PROBE + text.slice(at)).findIndex((it) => (it.cues || []).some(isProbe));

/** The slide's narration lines (none: no script, or a script of cues alone). */
export function narrationLines(text: string): NarrationLine[] {
  return plan(text).filter(isLine).map((it, n) => ({ n, caption: it.caption, emphases: emphasisCount(it.cues) }));
}

/** The line a cue written at `offset` would show with; -1 when the offset is not in
 *  the slide's script or it has no lines. */
export function lineAtOffset(text: string, offset: number): number {
  if (!scripts(text).some((s) => offset >= s.from && offset <= s.from + s.body.length)) return -1;
  const lines = lineItems(plan(text));
  if (!lines.length) return -1;
  const at = places(text).filter((p) => p <= offset).pop();
  if (at === undefined) return -1;
  const item = itemOf(text, at);
  // A cue at an event / a wait shows as the line after it comes.
  const n = lines.findIndex((i) => i >= item);
  return n < 0 ? lines.length - 1 : n;
}

/** Where a cue for line `n` is written: right before the line's first word (after
 *  the spaces and markers before it). null: no such line. */
export function lineStart(text: string, n: number): number | null {
  const target = lineItems(plan(text))[n];
  if (target === undefined) return null;
  const at = places(text);
  // The first place whose cue shows with the line (the plan keeps the script's order).
  let lo = 0;
  let hi = at.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (itemOf(text, at[mid]) >= target) hi = mid; else lo = mid + 1;
  }
  if (lo >= at.length || itemOf(text, at[lo]) !== target) return null;
  let pos = at[lo];
  for (;;) {
    const m = LEADING.exec(text.slice(pos));
    if (!m) break;
    if (itemOf(text, pos + m[0].length) !== target) break;
    pos += m[0].length;
  }
  return pos;
}

/** Where the slide's script ends (a new cue for no line goes there); null: no script. */
export function scriptEnd(text: string): number | null {
  const all = scripts(text);
  const last = all[all.length - 1];
  return last ? last.from + last.body.length : null;
}
