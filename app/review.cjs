// Reviewing a deck with AI help (shared by the MCP bridge; the renderer has a TS
// mirror of the parts it needs — features/review). Pure: the bridge does the I/O.
//
// - The REVIEW of a deck — `<deck minus .md>.review.json` beside it: a person's
//   comments (the preview's right-click), an AI reviewer's findings, the AI author's
//   questions; each anchored to a slide (its @id and heading, so it survives slides
//   added before it) and a place on it (a focus target / the words quoted), with a
//   status and a thread of replies. Plus the index of the deck's SNAPSHOTS.
// - SNAPSHOTS — the deck's text as it was (before an AI revises it), kept under the
//   workspace root's `.mdp/review-snapshots/`, and what changed since one: slides
//   matched by @id, by their text, by heading, then in order.
// - The FLOW — `<deck minus .slide.md>.flow.md`: the lecture's understanding design,
//   written before the slides — per step the slides (#id), the student's question
//   at that point, the device that answers it, the sentence that should land, the
//   link to the next step. A step without a question is a flat one.

const REVIEW_SUFFIX = '.review.json';
const reviewPathFor = (deck) => String(deck).replace(/\.md$/i, '') + REVIEW_SUFFIX;
const flowPathFor = (deck) => String(deck).replace(/\.slide\.md$/i, '').replace(/\.md$/i, '') + '.flow.md';
const snapshotDirFor = (deck) => `.mdp/review-snapshots/${String(deck).replace(/[\\/]/g, '__')}`;

const KINDS = ['comment', 'finding', 'question'];
const ASPECTS = ['clarity', 'uptake', 'accuracy', 'effect', 'flow', 'style', 'other'];
const SEVERITIES = ['major', 'minor', 'nit'];
const STATUSES = ['open', 'resolved', 'declined', 'answered'];
const DECISIONS = ['fix', 'later', 'skip'];
const MAX_SNAPSHOTS = 20;

const str = (v, max = 4000) => String(v == null ? '' : v).trim().slice(0, max);
const nowIso = () => new Date().toISOString();
const newId = (prefix) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ---- slides ----------------------------------------------------------------------

const ID_RE = /<!--\s*@id\s+([\w-]+)\s*-->/;
const headingOf = (raw) => {
  const m = /^[ \t]{0,3}#{1,6}[ \t]+(.+?)[ \t#]*$/m.exec(String(raw || '').replace(/<!--[\s\S]*?-->/g, ' '));
  return m ? m[1].trim() : '';
};
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** What a deck's slides are (blocks[0] = the meta page): position, @id, heading,
 *  hidden / cover, the printed page, the text. */
function slideFacts(blocks) {
  let page = 0;
  return blocks.slice(1).map((raw, i) => {
    const hidden = /<!--\s+@hide\s+-->/.test(raw);
    const cover = /<!--\s*@cover\b/.test(raw);
    if (!hidden && !cover) page++;
    return {
      slide: i + 1, id: (ID_RE.exec(raw) || [])[1] || '', heading: headingOf(raw),
      hidden, cover, page: hidden || cover ? null : page, text: raw,
    };
  });
}

/** The slide an anchor names NOW: its @id, else its heading (if only one slide has
 *  it), else the slide it was written for when that one still has the heading (or
 *  none was kept). `sure: false` = a guess (the slide may have changed). */
function locate(at, facts) {
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
  if (Number.isInteger(n) && n >= 1 && n <= facts.length) {
    const f = facts[n - 1];
    return { slide: n, sure: !a.heading || f.heading === a.heading };
  }
  return { slide: null, sure: false };
}

// ---- the review file ----------------------------------------------------------------

const emptyReview = (deck) => ({ version: 1, deck, items: [], snapshots: [] });

const pick = (v, allowed, dflt) => (allowed.includes(v) ? v : dflt);

function normalizeItem(it) {
  if (!it || typeof it !== 'object' || !it.id || !str(it.text)) return null;
  const at = it.at && typeof it.at === 'object' ? it.at : {};
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
      ...(at.box && ['x', 'y', 'w', 'h'].every((k) => Number.isFinite(Number(at.box[k]))) ? { box: { x: +at.box.x, y: +at.box.y, w: +at.box.w, h: +at.box.h } } : {}),
    },
    thread: Array.isArray(it.thread) ? it.thread.filter((r) => r && str(r.text)).map((r) => ({ by: str(r.by, 60) || 'reviewer', text: str(r.text), at: str(r.at, 40) || nowIso() })) : [],
    createdAt: str(it.createdAt, 40) || nowIso(),
    updatedAt: str(it.updatedAt, 40) || str(it.createdAt, 40) || nowIso(),
  };
}

/** A review file as stored (anything unreadable → an empty review). */
function parseReview(text, deck) {
  let j;
  try { j = JSON.parse(String(text || '')); } catch { return emptyReview(deck); }
  if (!j || typeof j !== 'object') return emptyReview(deck);
  return {
    version: 1,
    deck: str(j.deck, 500) || deck,
    items: (Array.isArray(j.items) ? j.items : []).map(normalizeItem).filter(Boolean),
    snapshots: (Array.isArray(j.snapshots) ? j.snapshots : [])
      .filter((s) => s && s.id && s.path)
      .map((s) => ({ id: String(s.id), label: str(s.label, 120), at: str(s.at, 40), path: String(s.path), slides: Number(s.slides) || 0, by: str(s.by, 60) })),
  };
}

const serializeReview = (file) => `${JSON.stringify(file, null, 2)}\n`;

/** Add findings / comments / questions. Each names its slide (1-based, as the tools
 *  take it); its @id and heading are kept with it so it still finds its slide when
 *  slides are added before it. Returns the ids, or throws naming what is wrong. */
function addItems(file, items, facts, defaults = {}) {
  if (!Array.isArray(items) || !items.length) throw new Error('"items" must list at least one finding.');
  const added = [];
  const now = nowIso();
  items.forEach((raw, i) => {
    const it = raw || {};
    const text = str(it.text);
    if (!text) throw new Error(`items[${i}]: "text" is required.`);
    const n = Number(it.slide);
    if (!Number.isInteger(n) || n < 1 || n > facts.length) throw new Error(`items[${i}]: "slide" must be 1…${facts.length} (0 = the deck as a whole is not allowed: name the slide where it shows).`);
    const f = facts[n - 1];
    const item = normalizeItem({
      id: newId('r'),
      kind: it.kind || defaults.kind,
      aspect: it.aspect || defaults.aspect,
      severity: it.severity || defaults.severity,
      status: 'open',
      by: it.by || defaults.by,
      round: Number.isInteger(it.round) ? it.round : defaults.round,
      rule: !!it.rule,
      text,
      suggestion: it.suggestion,
      at: { slide: n, id: f.id, heading: f.heading, target: it.target, quote: it.quote, box: it.box },
      thread: [],
      createdAt: now,
      updatedAt: now,
    });
    file.items.push(item);
    added.push(item.id);
  });
  return added;
}

/** The person's judgment of an item (an AI's finding): fix = do it (the reviser does
 *  it first, after the person's own comments), later = leave it open but untouched
 *  (the reviser skips it), skip = will not fix: the item is declined (a reviewer does
 *  not raise its kind again); null = no judgment (an item declined by a skip opens
 *  again). */
function applyDecision(item, decision, now) {
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

/** Change items: a status (resolved — fixed; declined — not changed, say why;
 *  answered — a question answered; open — again), a reply in the thread, the
 *  "keep as a rule" mark. Unknown ids are reported, the rest applied. */
function updateItems(file, updates, by) {
  if (!Array.isArray(updates) || !updates.length) throw new Error('"updates" must list at least one { id, … }.');
  const done = [];
  const unknown = [];
  const now = nowIso();
  for (const u of updates) {
    const item = u && file.items.find((x) => x.id === String(u.id));
    if (!item) { unknown.push(u && u.id); continue; }
    if (u.status !== undefined) {
      if (!STATUSES.includes(u.status)) throw new Error(`"status" must be one of ${STATUSES.join(' / ')}.`);
      item.status = u.status;
    }
    if (u.decision !== undefined) applyDecision(item, u.decision, now);
    if (str(u.reply)) item.thread.push({ by: str(u.by, 60) || by || 'author', text: str(u.reply), at: now });
    if (u.rule !== undefined) { if (u.rule) item.rule = true; else delete item.rule; }
    item.updatedAt = now;
    done.push(item.id);
  }
  return { done, unknown: unknown.filter((x) => x !== undefined) };
}

const SEV_ORDER = { major: 0, minor: 1, nit: 2 };

/** The items as they stand on the deck NOW (their slide located again), filtered:
 *  `status` 'open' (default) | 'all' | a status; `slide` one slide. */
function listItems(file, facts, { status = 'open', slide } = {}) {
  return file.items
    .filter((it) => status === 'all' || it.status === status)
    .map((it) => {
      const loc = locate(it.at, facts);
      const f = loc.slide ? facts[loc.slide - 1] : null;
      return { ...it, slide: loc.slide, ...(f && f.page ? { page: f.page } : {}), ...(loc.sure ? {} : { moved: true }) };
    })
    .filter((it) => slide === undefined || it.slide === Number(slide))
    .sort((a, b) => (a.slide || 1e9) - (b.slide || 1e9) || SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || a.createdAt.localeCompare(b.createdAt));
}

const countItems = (file) => {
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

/** Note a snapshot in the review's index (the newest MAX_SNAPSHOTS kept); returns
 *  the entries dropped (their files can go). */
function addSnapshot(file, entry) {
  file.snapshots.push(entry);
  return file.snapshots.length > MAX_SNAPSHOTS ? file.snapshots.splice(0, file.snapshots.length - MAX_SNAPSHOTS) : [];
}

// ---- what changed since a snapshot -----------------------------------------------------

/** Line diff (LCS): [{ op: ' ' | '-' | '+', line }]. */
function lineDiff(a, b) {
  const x = String(a || '').split('\n');
  const y = String(b || '').split('\n');
  const n = x.length;
  const m = y.length;
  if (n * m > 400000) return [...x.map((line) => ({ op: '-', line })), ...y.map((line) => ({ op: '+', line }))];
  const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
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

/** The changed lines with `context` lines around them, as `-` / `+` / `  ` text. */
function diffText(a, b, context = 1) {
  const d = lineDiff(a, b);
  const keep = d.map(() => false);
  d.forEach((r, k) => { if (r.op !== ' ') for (let t = Math.max(0, k - context); t <= Math.min(d.length - 1, k + context); t++) keep[t] = true; });
  const out = [];
  let skipped = false;
  d.forEach((r, k) => {
    if (keep[k]) { out.push(`${r.op === ' ' ? ' ' : r.op} ${r.line}`); skipped = false; }
    else if (!skipped) { out.push('  …'); skipped = true; }
  });
  return out.join('\n');
}

// How alike two slides' texts are (character bigrams, Dice).
function similarity(a, b) {
  const grams = (s) => { const t = norm(s); const g = new Map(); for (let i = 0; i < t.length - 1; i++) { const k = t.slice(i, i + 2); g.set(k, (g.get(k) || 0) + 1); } return g; };
  const ga = grams(a);
  const gb = grams(b);
  let both = 0;
  let total = 0;
  for (const [k, v] of ga) { both += Math.min(v, gb.get(k) || 0); total += v; }
  for (const v of gb.values()) total += v;
  return total ? (2 * both) / total : 1;
}

/** Slides of two versions of a deck paired up: the same @id; the same text; the
 *  same heading (one each); then in order, when they are alike enough. */
function matchSlides(before, after) {
  const pairs = [];
  const freeA = new Set(before.map((f) => f.slide));
  const freeB = new Set(after.map((f) => f.slide));
  const take = (a, b) => { pairs.push([a, b]); freeA.delete(a.slide); freeB.delete(b.slide); };
  const ids = (list, id) => list.filter((f) => f.id === id);
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
  // in order: each leftover old slide with the next leftover new one, if alike
  const restB = after.filter((x) => freeB.has(x.slide));
  for (const a of before.filter((x) => freeA.has(x.slide))) {
    const b = restB.find((x) => freeB.has(x.slide) && similarity(a.text, x.text) >= 0.35);
    if (b) take(a, b);
  }
  return { pairs, removed: before.filter((x) => freeA.has(x.slide)), added: after.filter((x) => freeB.has(x.slide)) };
}

/** What changed from one version of a deck to another, slide by slide (in the new
 *  deck's order; removed slides at the end). `withDiff`: each change's line diff. */
function deckChanges(beforeBlocks, afterBlocks, { withDiff = true, context = 1 } = {}) {
  const before = slideFacts(beforeBlocks);
  const after = slideFacts(afterBlocks);
  const { pairs, removed, added } = matchSlides(before, after);
  const out = [];
  for (const [a, b] of pairs) {
    if (norm(a.text) === norm(b.text)) continue;
    out.push({ status: 'changed', slide: b.slide, oldSlide: a.slide, heading: b.heading || a.heading, ...(b.id ? { id: b.id } : {}), ...(withDiff ? { diff: diffText(a.text, b.text, context) } : {}) });
  }
  for (const b of added) out.push({ status: 'added', slide: b.slide, heading: b.heading, ...(b.id ? { id: b.id } : {}), ...(withDiff ? { diff: diffText('', b.text, 0) } : {}) });
  out.sort((x, y) => x.slide - y.slide);
  for (const a of removed) out.push({ status: 'removed', oldSlide: a.slide, heading: a.heading, ...(a.id ? { id: a.id } : {}), ...(withDiff ? { diff: diffText(a.text, '', 0) } : {}) });
  const moved = pairs.filter(([a, b]) => a.slide !== b.slide).length;
  const meta = norm(beforeBlocks[0]) !== norm(afterBlocks[0]);
  return { changes: out, unchanged: pairs.length - out.filter((c) => c.status === 'changed').length, moved, ...(meta ? { metaChanged: true } : {}) };
}

// ---- the flow (the understanding design) --------------------------------------------------

// Lines of a step: "- スライド: #a #b", "- 学生の問い: …" — the label before a colon.
const FIELD_RE = /^\s*[-*]\s*([^:：\n]{1,24})[:：]\s*(.*)$/;
const SLIDES_LABEL = /^(スライド|slides?)$/i;
const QUESTION_LABEL = /^(学生の問い|問い|question|student'?s question)$/i;
const ID_TOKEN = /(?:^|[\s,、，(（])#([\w-]+)/g;

/** A flow file's steps: its `###` headings (or `##` when it has none), each with its
 *  fields (label → text), the slides it names (#id) and its line. */
function parseFlow(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const level = lines.some((l) => /^###[ \t]+\S/.test(l)) ? 3 : 2;
  const head = new RegExp(`^#{${level}}[ \\t]+(.+?)[ \\t#]*$`);
  const higher = new RegExp(`^#{1,${level}}[ \\t]+\\S`);
  const title = ((lines.find((l) => /^#[ \t]+\S/.test(l)) || '').replace(/^#[ \t]+/, '')).trim();
  const steps = [];
  let cur = null;
  lines.forEach((l, i) => {
    const h = head.exec(l);
    // "### 1. Claim" → "Claim" (the step's number is its place)
    if (h) { cur = { n: steps.length + 1, title: h[1].trim().replace(/^\d+\s*[.．)）]\s*/, ''), line: i + 1, fields: {}, ids: [], body: [] }; steps.push(cur); return; }
    if (higher.test(l)) { cur = null; return; }
    if (!cur) return;
    cur.body.push(l);
    const f = FIELD_RE.exec(l);
    if (!f) return;
    const label = f[1].trim();
    const value = f[2].trim();
    if (SLIDES_LABEL.test(label)) { for (const m of value.matchAll(ID_TOKEN)) if (!cur.ids.includes(m[1])) cur.ids.push(m[1]); }
    else if (value) cur.fields[label] = cur.fields[label] ? `${cur.fields[label]} ${value}` : value;
  });
  return { title, steps: steps.map((s) => ({ ...s, body: s.body.join('\n').trim() })) };
}

const questionOf = (step) => {
  const k = Object.keys(step.fields).find((x) => QUESTION_LABEL.test(x));
  return k ? step.fields[k] : '';
};

/** The flow against the deck: ids named that no slide has; content slides with an
 *  @id no step names; content slides without an @id (a step cannot name them); steps
 *  that name no slide; steps without the student's question (a flat step). */
function checkFlow(flow, facts) {
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

/** Which step each slide belongs to: a step runs from the first slide it names to
 *  the slide before the next step's first one (steps in the deck's order). Returns
 *  an array: slide index (0-based) → step n, or 0 before the first step. */
function stepOfSlides(flow, facts) {
  const firstOf = new Map();
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

/** A new flow file for a deck — the form to fill in. */
function flowTemplate(title) {
  return [
    `# ${title || 'この回'} — 理解の設計`,
    '',
    '## 目標',
    '- この回のあと，学生が何をできるようになるか（確かめる問いと対応させる）',
    '',
    '## 受講生の出発点',
    '- 前回までに分かっていること，つまずきやすいこと',
    '',
    '## 流れ',
    '',
    '### 1. 〔この段で学生に言えるようになってほしい主張〕',
    '- スライド: #slide-id #slide-id',
    '- 学生の問い: この時点で学生が抱く疑問（書けなければ，淡々とした段）',
    '- 仕掛け: その問いに答える例・図・対比・考える時間',
    '- 腹落ち: この段のあとに学生が自分の言葉で言える一文',
    '- つなぎ: 次の段の問いをどう生むか',
    '- 時間: 3 分',
    '',
    '## 確かめ',
    '- 問い → どの目標を確かめるか',
    '',
  ].join('\n');
}

// ---- is a deck ready for an AI review? -------------------------------------------------------

/** What a review of a deck needs, checked (MCP review_readiness and the Review panel's
 *  "AI review" box — the renderer's copy is reviewModel.ts: KEEP IN STEP). In: the
 *  folder's personas, its slide skills' names, the flow's checkFlow (null = no flow
 *  file), the deck's facts, the newest snapshot, the Claude Code kit (null = unknown —
 *  the web). Each check: ok, and when not, `fix` = who does it: "loop" (the review loop
 *  itself), "loop + you" (the loop drafts it, the person confirms), "you", "optional". */
function readinessChecks({ personas = [], skills = [], flow = null, facts = [], lastSnapshot = null, kit = null }) {
  const noId = facts.filter((f) => !f.cover && !f.hidden && !f.id).length;
  const flowProblems = flow ? [
    flow.missing.length && `${flow.missing.length} id(s) no slide has`, flow.unnamed.length && `${flow.unnamed.length} slide(s) no step names`,
    flow.noId.length && `${flow.noId.length} slide(s) without @id`, flow.noSlides.length && `step(s) ${flow.noSlides.join(', ')} name no slide`,
    flow.noQuestion.length && `step(s) ${flow.noQuestion.join(', ')} without the students' question`,
  ].filter(Boolean) : [];
  const checks = [
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
      : { item: 'Claude Code kit', ok: false, fix: 'you', note: `${kit.state === 'missing' ? 'Not installed' : 'Different from this MDP\'s'} in ${kit.home}: install it from MDP's Review panel (AI review → Install).` }] : []),
  ];
  return { checks, canStart: !checks.some((c) => !c.ok && c.fix === 'you') };
}

module.exports = {
  REVIEW_SUFFIX, reviewPathFor, flowPathFor, snapshotDirFor,
  KINDS, ASPECTS, SEVERITIES, STATUSES, DECISIONS, MAX_SNAPSHOTS, applyDecision,
  slideFacts, locate, emptyReview, parseReview, serializeReview, addItems, updateItems, listItems, countItems, addSnapshot,
  lineDiff, diffText, matchSlides, deckChanges,
  parseFlow, checkFlow, stepOfSlides, flowTemplate, newId, readinessChecks,
};
