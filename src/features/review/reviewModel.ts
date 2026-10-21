// The review of a deck, as the renderer reads it — the same model as the MCP bridge's
// app/review.cjs (KEEP THE TWO IN STEP: slideFacts, locate, the item shape, the
// flow's steps and checks, what changed between two versions; scratchpad
// review_parity.cjs runs both on the same inputs):
// - `<deck minus .md>.review.json` beside the deck: a person's comments, an AI
//   reviewer's findings, the AI author's questions, each anchored to a slide (its
//   @id and heading — found again after slides are added) and a place on it.
// - snapshots of the deck's text (`.mdp/review-snapshots/…`) and what changed since.
// - `<deck minus .slide.md>.flow.md`: the lecture's flow — its understanding design.
import type { FocusBox } from '../focus/focusTargets';

export type ReviewKind = 'comment' | 'finding' | 'question';
export type ReviewAspect = 'clarity' | 'uptake' | 'accuracy' | 'effect' | 'flow' | 'style' | 'other';
export type ReviewSeverity = 'major' | 'minor' | 'nit';
export type ReviewStatus = 'open' | 'resolved' | 'declined' | 'answered';

export interface ReviewAnchor { slide?: number; id?: string; heading?: string; target?: string; quote?: string; box?: FocusBox }
export interface ReviewReply { by: string; text: string; at: string }
export interface ReviewItem {
  id: string;
  kind: ReviewKind;
  aspect: ReviewAspect;
  severity: ReviewSeverity;
  status: ReviewStatus;
  by: string;
  round?: number;
  rule?: boolean;
  /** The person's judgment of an AI's finding (applyDecision). */
  decision?: ReviewDecision;
  decidedAt?: string;
  text: string;
  suggestion?: string;
  at: ReviewAnchor;
  thread: ReviewReply[];
  createdAt: string;
  updatedAt: string;
}
export interface SnapshotEntry { id: string; label: string; at: string; path: string; slides: number; by: string }
export interface ReviewFile { version: 1; deck: string; items: ReviewItem[]; snapshots: SnapshotEntry[] }

export const KINDS: ReviewKind[] = ['comment', 'finding', 'question'];
export const ASPECTS: ReviewAspect[] = ['clarity', 'uptake', 'accuracy', 'effect', 'flow', 'style', 'other'];
export const SEVERITIES: ReviewSeverity[] = ['major', 'minor', 'nit'];
export const STATUSES: ReviewStatus[] = ['open', 'resolved', 'declined', 'answered'];
export type ReviewDecision = 'fix' | 'later' | 'skip';
export const DECISIONS: ReviewDecision[] = ['fix', 'later', 'skip'];

/** The Claude Code side of the AI review in ~/.claude (app/claudeReviewKit.cjs). */
export interface ClaudeReviewKit {
  home: string;
  state: 'current' | 'missing' | 'different';
  files: { file: string; state: 'current' | 'missing' | 'different' | 'unknown' }[];
  installed?: boolean;
  backedUp?: string[];
}
/** What the person types in Claude Code to run the review loop (≡ claudeReviewKit.cjs). */
export const loopCommand = (deckPath: string, rounds = 2) => `/mdp-review-loop ${deckPath} ${rounds}`;

export const reviewPathFor = (deck: string) => String(deck).replace(/\.md$/i, '') + '.review.json';
export const flowPathFor = (deck: string) => String(deck).replace(/\.slide\.md$/i, '').replace(/\.md$/i, '') + '.flow.md';
export const snapshotDirFor = (deck: string) => `.mdp/review-snapshots/${String(deck).replace(/[\\/]/g, '__')}`;

const str = (v: unknown, max = 4000) => String(v == null ? '' : v).trim().slice(0, max);
const nowIso = () => new Date().toISOString();
export const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ---- slides ----------------------------------------------------------------------

export interface SlideFact { slide: number; id: string; heading: string; hidden: boolean; cover: boolean; page: number | null; text: string }

const ID_RE = /<!--\s*@id\s+([\w-]+)\s*-->/;
export const headingOf = (raw: string) => {
  const m = /^[ \t]{0,3}#{1,6}[ \t]+(.+?)[ \t#]*$/m.exec(String(raw || '').replace(/<!--[\s\S]*?-->/g, ' '));
  return m ? m[1].trim() : '';
};
const norm = (s: string) => String(s || '').replace(/\s+/g, ' ').trim();

/** What a deck's slides are (blocks[0] = the meta page). */
export function slideFacts(blocks: string[]): SlideFact[] {
  let page = 0;
  return blocks.slice(1).map((raw, i) => {
    const hidden = /<!--\s+@hide\s+-->/.test(raw);
    const cover = /<!--\s*@cover\b/.test(raw);
    if (!hidden && !cover) page++;
    return { slide: i + 1, id: (ID_RE.exec(raw) || [])[1] || '', heading: headingOf(raw), hidden, cover, page: hidden || cover ? null : page, text: raw };
  });
}

/** The slide an anchor names now (see app/review.cjs locate). */
export function locate(at: ReviewAnchor | undefined, facts: SlideFact[]): { slide: number | null; sure: boolean } {
  const a = at || {};
  if (a.id) {
    const byId = facts.filter((f) => f.id === a.id);
    if (byId.length === 1) return { slide: byId[0].slide, sure: true };
  }
  if (a.heading) {
    const byHead = facts.filter((f) => f.heading === a.heading);
    if (byHead.length === 1) return { slide: byHead[0].slide, sure: true };
  }
  const n = Number(a.slide);
  if (Number.isInteger(n) && n >= 1 && n <= facts.length) return { slide: n, sure: !a.heading || facts[n - 1].heading === a.heading };
  return { slide: null, sure: false };
}

// ---- the review file -----------------------------------------------------------------

export const emptyReview = (deck: string): ReviewFile => ({ version: 1, deck, items: [], snapshots: [] });

const pick = <T extends string>(v: unknown, allowed: readonly T[], dflt: T): T => (allowed.includes(v as T) ? (v as T) : dflt);

/* eslint-disable @typescript-eslint/no-explicit-any */
function normalizeItem(it: any): ReviewItem | null {
  if (!it || typeof it !== 'object' || !it.id || !str(it.text)) return null;
  const at = it.at && typeof it.at === 'object' ? it.at : {};
  const box = at.box && ['x', 'y', 'w', 'h'].every((k) => Number.isFinite(Number(at.box[k]))) ? { x: +at.box.x, y: +at.box.y, w: +at.box.w, h: +at.box.h } : undefined;
  return {
    id: String(it.id),
    kind: pick(it.kind, KINDS, 'finding'),
    aspect: pick(it.aspect, ASPECTS, 'other'),
    severity: pick(it.severity, SEVERITIES, 'minor'),
    status: pick(it.status, STATUSES, 'open'),
    by: str(it.by, 60) || 'reviewer',
    ...(Number.isInteger(it.round) ? { round: it.round } : {}),
    ...(it.rule ? { rule: true } : {}),
    ...(DECISIONS.includes(it.decision) ? { decision: it.decision, ...(str(it.decidedAt, 40) ? { decidedAt: str(it.decidedAt, 40) } : {}) } : {}),
    text: str(it.text),
    ...(str(it.suggestion) ? { suggestion: str(it.suggestion) } : {}),
    at: {
      ...(Number.isInteger(Number(at.slide)) && Number(at.slide) > 0 ? { slide: Number(at.slide) } : {}),
      ...(str(at.id, 80) ? { id: str(at.id, 80) } : {}),
      ...(str(at.heading, 200) ? { heading: str(at.heading, 200) } : {}),
      ...(str(at.target, 200) ? { target: str(at.target, 200) } : {}),
      ...(str(at.quote, 400) ? { quote: str(at.quote, 400) } : {}),
      ...(box ? { box } : {}),
    },
    thread: Array.isArray(it.thread) ? it.thread.filter((r: any) => r && str(r.text)).map((r: any) => ({ by: str(r.by, 60) || 'reviewer', text: str(r.text), at: str(r.at, 40) || nowIso() })) : [],
    createdAt: str(it.createdAt, 40) || nowIso(),
    updatedAt: str(it.updatedAt, 40) || str(it.createdAt, 40) || nowIso(),
  };
}

export function parseReview(text: string, deck: string): ReviewFile {
  let j: any;
  try { j = JSON.parse(String(text || '')); } catch { return emptyReview(deck); }
  if (!j || typeof j !== 'object') return emptyReview(deck);
  return {
    version: 1,
    deck: str(j.deck, 500) || deck,
    items: (Array.isArray(j.items) ? j.items : []).map(normalizeItem).filter((x: ReviewItem | null): x is ReviewItem => !!x),
    snapshots: (Array.isArray(j.snapshots) ? j.snapshots : [])
      .filter((s: any) => s && s.id && s.path)
      .map((s: any) => ({ id: String(s.id), label: str(s.label, 120), at: str(s.at, 40), path: String(s.path), slides: Number(s.slides) || 0, by: str(s.by, 60) })),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export const serializeReview = (file: ReviewFile) => `${JSON.stringify(file, null, 2)}\n`;

/** A person's comment, anchored to a slide and what they pointed at. */
/** The person's judgment of an item (an AI's finding): fix = do it (the reviser does
 *  it first, after the person's own comments), later = leave it open but untouched
 *  (the reviser skips it), skip = will not fix: the item is declined (a reviewer does
 *  not raise its kind again); null = no judgment (an item declined by a skip opens
 *  again). */
export function applyDecision(item: ReviewItem, decision: ReviewDecision | null | '' | undefined, now: string): void {
  const was = item.decision;
  if (decision === null || decision === '' || decision === undefined) {
    delete item.decision;
    delete item.decidedAt;
    if (was === 'skip' && item.status === 'declined') item.status = 'open';
    return;
  }
  if (!DECISIONS.includes(decision)) throw new Error(`"decision" must be one of ${DECISIONS.join(' / ')} (or null).`);
  item.decision = decision;
  item.decidedAt = now;
  if (decision === 'skip') item.status = 'declined';
  else if (was === 'skip' && item.status === 'declined') item.status = 'open';
}

/** The open items counted (≡ app/review.cjs countItems). */
export const countItems = (file: ReviewFile) => {
  const open = file.items.filter((x) => x.status === 'open');
  return {
    open: open.length,
    major: open.filter((x) => x.severity === 'major').length,
    questions: open.filter((x) => x.kind === 'question').length,
    later: open.filter((x) => x.decision === 'later').length,
    toDecide: open.filter((x) => x.kind === 'finding' && x.by !== 'human' && !x.decision).length,
    byPerson: open.filter((x) => x.by === 'human').length,
    total: file.items.length,
  };
};

export function newComment(fact: SlideFact, o: { text: string; target?: string; quote?: string; box?: FocusBox; aspect?: ReviewAspect; severity?: ReviewSeverity; kind?: ReviewKind; rule?: boolean }): ReviewItem {
  const now = nowIso();
  const item = normalizeItem({
    id: newId('r'), kind: o.kind || 'comment', aspect: o.aspect || 'clarity', severity: o.severity || 'minor', status: 'open',
    by: 'human', rule: !!o.rule, text: o.text,
    at: { slide: fact.slide, id: fact.id, heading: fact.heading, target: o.target, quote: o.quote, box: o.box },
    thread: [], createdAt: now, updatedAt: now,
  });
  if (!item) throw new Error('A comment needs words.');
  return item;
}

export interface LocatedItem extends ReviewItem { slide: number | null; page?: number; moved?: true }

const SEV_ORDER: Record<ReviewSeverity, number> = { major: 0, minor: 1, nit: 2 };

/** The items as they stand on the deck now (see app/review.cjs listItems). */
export function listItems(file: ReviewFile, facts: SlideFact[], status: ReviewStatus | 'all' = 'open'): LocatedItem[] {
  return file.items
    .filter((it) => status === 'all' || it.status === status)
    .map((it) => {
      const loc = locate(it.at, facts);
      const f = loc.slide ? facts[loc.slide - 1] : null;
      return { ...it, slide: loc.slide, ...(f && f.page ? { page: f.page } : {}), ...(loc.sure ? {} : { moved: true as const }) };
    })
    .sort((a, b) => (a.slide || 1e9) - (b.slide || 1e9) || SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || a.createdAt.localeCompare(b.createdAt));
}

export const countOpen = (file: ReviewFile) => {
  const open = file.items.filter((x) => x.status === 'open');
  return { open: open.length, major: open.filter((x) => x.severity === 'major').length, questions: open.filter((x) => x.kind === 'question').length };
};

// ---- what changed since a snapshot ------------------------------------------------------

export interface DiffLine { op: ' ' | '-' | '+'; line: string }

export function lineDiff(a: string, b: string): DiffLine[] {
  const x = String(a || '').split('\n');
  const y = String(b || '').split('\n');
  const n = x.length;
  const m = y.length;
  if (n * m > 400000) return [...x.map((line) => ({ op: '-' as const, line })), ...y.map((line) => ({ op: '+' as const, line }))];
  const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { out.push({ op: ' ', line: x[i] }); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) out.push({ op: '-', line: x[i++] });
    else out.push({ op: '+', line: y[j++] });
  }
  while (i < n) out.push({ op: '-', line: x[i++] });
  while (j < m) out.push({ op: '+', line: y[j++] });
  return out;
}

function similarity(a: string, b: string): number {
  const grams = (s: string) => { const t = norm(s); const g = new Map<string, number>(); for (let i = 0; i < t.length - 1; i++) { const k = t.slice(i, i + 2); g.set(k, (g.get(k) || 0) + 1); } return g; };
  const ga = grams(a);
  const gb = grams(b);
  let both = 0;
  let total = 0;
  for (const [k, v] of ga) { both += Math.min(v, gb.get(k) || 0); total += v; }
  for (const v of gb.values()) total += v;
  return total ? (2 * both) / total : 1;
}

function matchSlides(before: SlideFact[], after: SlideFact[]) {
  const pairs: [SlideFact, SlideFact][] = [];
  const freeA = new Set(before.map((f) => f.slide));
  const freeB = new Set(after.map((f) => f.slide));
  const take = (a: SlideFact, b: SlideFact) => { pairs.push([a, b]); freeA.delete(a.slide); freeB.delete(b.slide); };
  const ids = (list: SlideFact[], id: string) => list.filter((f) => f.id === id);
  for (const a of before) if (a.id && ids(before, a.id).length === 1 && ids(after, a.id).length === 1) take(a, ids(after, a.id)[0]);
  for (const a of before) {
    if (!freeA.has(a.slide)) continue;
    const b = after.find((x) => freeB.has(x.slide) && norm(x.text) === norm(a.text));
    if (b) take(a, b);
  }
  for (const a of before) {
    if (!freeA.has(a.slide) || !a.heading) continue;
    const sameA = before.filter((x) => freeA.has(x.slide) && x.heading === a.heading);
    const sameB = after.filter((x) => freeB.has(x.slide) && x.heading === a.heading);
    if (sameA.length === 1 && sameB.length === 1) take(a, sameB[0]);
  }
  const restB = after.filter((x) => freeB.has(x.slide));
  for (const a of before.filter((x) => freeA.has(x.slide))) {
    const b = restB.find((x) => freeB.has(x.slide) && similarity(a.text, x.text) >= 0.35);
    if (b) take(a, b);
  }
  return { pairs, removed: before.filter((x) => freeA.has(x.slide)), added: after.filter((x) => freeB.has(x.slide)) };
}

export interface SlideChange {
  status: 'changed' | 'added' | 'removed';
  slide?: number;          // now
  oldSlide?: number;       // in the snapshot
  heading: string;
  id?: string;
  before: string;          // the slide's text in the snapshot ('' when added)
  after: string;           // now ('' when removed)
}

/** What changed from one version of a deck to another, slide by slide (the new
 *  deck's order; removed slides at the end). */
export function deckChanges(beforeBlocks: string[], afterBlocks: string[]): SlideChange[] {
  const before = slideFacts(beforeBlocks);
  const after = slideFacts(afterBlocks);
  const { pairs, removed, added } = matchSlides(before, after);
  const out: SlideChange[] = [];
  for (const [a, b] of pairs) {
    if (norm(a.text) === norm(b.text)) continue;
    out.push({ status: 'changed', slide: b.slide, oldSlide: a.slide, heading: b.heading || a.heading, ...(b.id ? { id: b.id } : {}), before: a.text, after: b.text });
  }
  for (const b of added) out.push({ status: 'added', slide: b.slide, heading: b.heading, ...(b.id ? { id: b.id } : {}), before: '', after: b.text });
  out.sort((x, y) => (x.slide || 0) - (y.slide || 0));
  for (const a of removed) out.push({ status: 'removed', oldSlide: a.slide, heading: a.heading, ...(a.id ? { id: a.id } : {}), before: a.text, after: '' });
  return out;
}

// ---- the flow ----------------------------------------------------------------------------

export interface FlowStep { n: number; title: string; line: number; fields: Record<string, string>; ids: string[]; body: string }
export interface Flow { title: string; steps: FlowStep[] }

const FIELD_RE = /^\s*[-*]\s*([^:：\n]{1,24})[:：]\s*(.*)$/;
const SLIDES_LABEL = /^(スライド|slides?)$/i;
const QUESTION_LABEL = /^(学生の問い|問い|question|student'?s question)$/i;
const ID_TOKEN = /(?:^|[\s,、，(（])#([\w-]+)/g;

export function parseFlow(text: string): Flow {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const level = lines.some((l) => /^###[ \t]+\S/.test(l)) ? 3 : 2;
  const head = new RegExp(`^#{${level}}[ \\t]+(.+?)[ \\t#]*$`);
  const higher = new RegExp(`^#{1,${level}}[ \\t]+\\S`);
  const title = ((lines.find((l) => /^#[ \t]+\S/.test(l)) || '').replace(/^#[ \t]+/, '')).trim();
  const steps: (Omit<FlowStep, 'body'> & { body: string[] })[] = [];
  let cur: (typeof steps)[number] | null = null;
  lines.forEach((l, i) => {
    const h = head.exec(l);
    if (h) { cur = { n: steps.length + 1, title: h[1].trim().replace(/^\d+\s*[.．)）]\s*/, ''), line: i + 1, fields: {}, ids: [], body: [] }; steps.push(cur); return; }
    if (higher.test(l)) { cur = null; return; }
    if (!cur) return;
    const c = cur as (typeof steps)[number];
    c.body.push(l);
    const f = FIELD_RE.exec(l);
    if (!f) return;
    const label = f[1].trim();
    const value = f[2].trim();
    if (SLIDES_LABEL.test(label)) { for (const m of value.matchAll(ID_TOKEN)) if (!c.ids.includes(m[1])) c.ids.push(m[1]); }
    else if (value) c.fields[label] = c.fields[label] ? `${c.fields[label]} ${value}` : value;
  });
  return { title, steps: steps.map((s) => ({ ...s, body: s.body.join('\n').trim() })) };
}

export const questionOf = (step: FlowStep) => {
  const k = Object.keys(step.fields).find((x) => QUESTION_LABEL.test(x));
  return k ? step.fields[k] : '';
};

export interface FlowCheck {
  steps: number;
  missing: string[];
  unnamed: { slide: number; id: string; heading: string }[];
  noId: { slide: number; heading: string }[];
  noSlides: number[];
  noQuestion: number[];
}

export function checkFlow(flow: Flow, facts: SlideFact[]): FlowCheck {
  const ids = new Set(facts.filter((f) => f.id).map((f) => f.id));
  const named = new Set(flow.steps.flatMap((s) => s.ids));
  const content = facts.filter((f) => !f.hidden && !f.cover);
  return {
    steps: flow.steps.length,
    missing: [...named].filter((id) => !ids.has(id)),
    unnamed: content.filter((f) => f.id && !named.has(f.id)).map((f) => ({ slide: f.slide, id: f.id, heading: f.heading })),
    noId: content.filter((f) => !f.id).map((f) => ({ slide: f.slide, heading: f.heading })),
    noSlides: flow.steps.filter((s) => !s.ids.length).map((s) => s.n),
    noQuestion: flow.steps.filter((s) => !questionOf(s)).map((s) => s.n),
  };
}

/** The step of each slide (0-based slide index → step n, 0 before the first step). */
export function stepOfSlides(flow: Flow, facts: SlideFact[]): number[] {
  const firstOf = new Map<number, number>();
  flow.steps.forEach((s) => {
    const at = facts.filter((f) => s.ids.includes(f.id)).map((f) => f.slide);
    if (at.length) firstOf.set(s.n, Math.min(...at));
  });
  const starts = [...firstOf.entries()].sort((a, b) => a[1] - b[1]);
  return facts.map((f) => {
    let n = 0;
    for (const [step, first] of starts) if (first <= f.slide) n = step;
    return n;
  });
}

// ---- is a deck ready for an AI review? (≡ app/review.cjs readinessChecks) ------------------

export type ReadinessFix = 'loop' | 'loop + you' | 'you' | 'optional';
export interface ReadinessCheck { item: string; ok: boolean; fix?: ReadinessFix; note: string }
export interface ReadinessInput {
  personas?: { name: string; primary?: boolean; configDir: string }[];
  skills?: string[];
  flow?: FlowCheck | null;
  facts?: SlideFact[];
  lastSnapshot?: { label: string; at: string } | null;
  kit?: { state: string; home: string } | null;
}

/** What a review of a deck needs, checked — the Review panel's "AI review" box (the
 *  MCP tool review_readiness runs the same in app/review.cjs: KEEP IN STEP). */
export function readinessChecks({ personas = [], skills = [], flow = null, facts = [], lastSnapshot = null, kit = null }: ReadinessInput): { checks: ReadinessCheck[]; canStart: boolean } {
  const noId = facts.filter((f) => !f.cover && !f.hidden && !f.id).length;
  const flowProblems = flow ? [
    flow.missing.length && `${flow.missing.length} id(s) no slide has`, flow.unnamed.length && `${flow.unnamed.length} slide(s) no step names`,
    flow.noId.length && `${flow.noId.length} slide(s) without @id`, flow.noSlides.length && `step(s) ${flow.noSlides.join(', ')} name no slide`,
    flow.noQuestion.length && `step(s) ${flow.noQuestion.join(', ')} without the students' question`,
  ].filter((x): x is string => !!x) : [];
  const checks: ReadinessCheck[] = [
    personas.length
      ? { item: 'audience', ok: true, note: `${personas.length} persona(s) from ${personas[0].configDir}: ${personas.map((x) => x.name + (x.primary ? ' (primary)' : '')).join(', ')}` }
      : { item: 'audience', ok: false, fix: 'loop + you', note: 'No persona for this folder: the loop drafts one from the course\'s skill and decks, and the person confirms it (write_audience).' },
    skills.length
      ? { item: 'skills', ok: true, note: skills.join(', ') }
      : { item: 'skills', ok: false, fix: 'optional', note: 'No slide skill in this folder\'s chain: the reviewer judges by the generic spec only.' },
    flow == null
      ? { item: 'flow', ok: false, fix: 'loop', note: 'No flow file: the loop has the reviser write one from the deck first (write_flow).' }
      : flowProblems.length || !flow.steps
        ? { item: 'flow', ok: false, fix: 'loop', note: `${flow.steps} step(s): ${flowProblems.join('; ') || 'no step'}` }
        : { item: 'flow', ok: true, note: `${flow.steps} step(s), clean` },
    noId
      ? { item: 'slide ids', ok: false, fix: 'loop', note: `${noId} content slide(s) without an invisible <!-- @id … --> (the flow names slides by it): the reviser adds them with the flow.` }
      : { item: 'slide ids', ok: true, note: 'every content slide has an @id' },
    lastSnapshot
      ? { item: 'snapshot', ok: true, note: `last: "${lastSnapshot.label}" (${lastSnapshot.at})` }
      : { item: 'snapshot', ok: false, fix: 'loop', note: 'None yet: the loop takes one before it starts.' },
    ...(kit ? [kit.state === 'current'
      ? { item: 'Claude Code kit', ok: true, note: `the reviewer, the reviser and the loop skill are installed in ${kit.home}` }
      : { item: 'Claude Code kit', ok: false, fix: 'you' as ReadinessFix, note: `${kit.state === 'missing' ? 'Not installed' : 'Different from this MDP\'s'} in ${kit.home}: install it from MDP's Review panel (AI review → Install).` }] : []),
  ];
  return { checks, canStart: !checks.some((c) => !c.ok && c.fix === 'you') };
}
