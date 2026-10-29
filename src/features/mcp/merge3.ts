// A line-based three-way merge — save_deck's `merge`: the deck changed on disk (the
// author fixed it on another computer) while the editor holds an AI's unsaved edits.
// Both sides' changes against what the editor loaded are kept when they touch
// different lines; where both changed the same lines — or lines right next to each
// other — differently, that is a conflict, and the caller writes nothing.

/** base lines [from, to) replaced by `lines` (from === to: an insertion). */
export interface Hunk { from: number; to: number; lines: string[] }

export interface Conflict {
  line: number;        // 1-based, in the text the editor loaded
  base: string[];
  ours: string[];      // the editor's version of those lines
  theirs: string[];    // the disk's
}

// LCS table cells allowed between the first and the last difference (Uint16 → 2 bytes
// each); beyond that the two texts are too far apart to merge line by line here.
const MAX_CELLS = 9_000_000;

/** The changes turning `base` into `other`, as hunks over base's lines — or null when
 *  the differing middle is too large to compare. */
export function diffHunks(base: string[], other: string[]): Hunk[] | null {
  let pre = 0;
  while (pre < base.length && pre < other.length && base[pre] === other[pre]) pre++;
  let suf = 0;
  while (suf < base.length - pre && suf < other.length - pre && base[base.length - 1 - suf] === other[other.length - 1 - suf]) suf++;
  const a = base.slice(pre, base.length - suf);
  const b = other.slice(pre, other.length - suf);
  if (!a.length && !b.length) return [];
  if (!a.length || !b.length) return [{ from: pre, to: pre + a.length, lines: b }];
  const n = a.length;
  const m = b.length;
  if ((n + 1) * (m + 1) > MAX_CELLS || Math.min(n, m) > 65000) return null;
  const w = m + 1;
  const dp = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = a[i] === b[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }
  const hunks: Hunk[] = [];
  let i = 0;
  let j = 0;
  let cur: Hunk | null = null;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      if (cur) { hunks.push(cur); cur = null; }
      i++; j++;
      continue;
    }
    if (!cur) cur = { from: pre + i, to: pre + i, lines: [] };
    if (j < m && (i >= n || dp[i * w + j + 1] >= dp[(i + 1) * w + j])) { cur.lines.push(b[j]); j++; }
    else { i++; cur.to = pre + i; }
  }
  if (cur) hunks.push(cur);
  return hunks;
}

const touches = (h: Hunk, from: number, to: number) => h.from <= to && h.to >= from;
const sameLines = (x: string[], y: string[]) => x.length === y.length && x.every((l, k) => l === y[k]);

// base[from, to) with the given hunks (all inside it, in order) applied.
function applyWithin(base: string[], from: number, to: number, hunks: Hunk[]): string[] {
  const out: string[] = [];
  let pos = from;
  for (const h of hunks) {
    out.push(...base.slice(pos, h.from), ...h.lines);
    pos = h.to;
  }
  out.push(...base.slice(pos, to));
  return out;
}

/** Merge `ours` and `theirs`, both changed from `base`. → the merged text and the
 *  conflicts (empty = clean), or `tooLarge`. */
export function merge3(base: string, ours: string, theirs: string): { text: string; conflicts: Conflict[] } | { tooLarge: true } {
  const B = base.split('\n');
  const ho = diffHunks(B, ours.split('\n'));
  const ht = diffHunks(B, theirs.split('\n'));
  if (!ho || !ht) return { tooLarge: true };
  const out: string[] = [];
  const conflicts: Conflict[] = [];
  let pos = 0;
  let i = 0;
  let j = 0;
  while (i < ho.length || j < ht.length) {
    const a = ho[i];
    const b = ht[j];
    if (a && b && touches(a, b.from, b.to)) {
      // A cluster of hunks of both sides that overlap or touch each other.
      let from = Math.min(a.from, b.from);
      let to = Math.max(a.to, b.to);
      const os = [a];
      const ts = [b];
      i++; j++;
      for (let grew = true; grew;) {
        grew = false;
        while (i < ho.length && touches(ho[i], from, to)) { os.push(ho[i]); from = Math.min(from, ho[i].from); to = Math.max(to, ho[i].to); i++; grew = true; }
        while (j < ht.length && touches(ht[j], from, to)) { ts.push(ht[j]); from = Math.min(from, ht[j].from); to = Math.max(to, ht[j].to); j++; grew = true; }
      }
      const mine = applyWithin(B, from, to, os);
      const disk = applyWithin(B, from, to, ts);
      out.push(...B.slice(pos, from));
      if (!sameLines(mine, disk)) conflicts.push({ line: from + 1, base: B.slice(from, to), ours: mine, theirs: disk });
      out.push(...mine);
      pos = to;
    } else if (a && (!b || a.from < b.from)) {
      out.push(...B.slice(pos, a.from), ...a.lines);
      pos = a.to;
      i++;
    } else {
      out.push(...B.slice(pos, b.from), ...b.lines);
      pos = b.to;
      j++;
    }
  }
  out.push(...B.slice(pos));
  return { text: out.join('\n'), conflicts };
}

/** What changed from `base` to `other`, for a person (or an AI) to read: each change
 *  with its line number in `base`, `- ` the old lines, `+ ` the new; at most `max`
 *  lines (long lines shortened). */
export function describeChanges(base: string, other: string, max = 60): string[] {
  const B = base.split('\n');
  const hunks = diffHunks(B, other.split('\n'));
  if (!hunks) return ['(too many differences to list)'];
  const cut = (l: string) => (l.length > 160 ? `${l.slice(0, 157)}…` : l);
  const out: string[] = [];
  for (const h of hunks) {
    out.push(`@@ line ${h.from + 1}${h.to > h.from + 1 ? `–${h.to}` : ''}`);
    for (const l of B.slice(h.from, h.to)) out.push(`- ${cut(l)}`);
    for (const l of h.lines) out.push(`+ ${cut(l)}`);
    if (out.length >= max) { out.push(`… (${hunks.length} change(s) in all)`); break; }
  }
  return out.slice(0, max + 1);
}
