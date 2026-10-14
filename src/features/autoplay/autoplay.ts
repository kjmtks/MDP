// Auto-narration helpers. A slide's read-aloud `@script` may contain `[[step]]`
// markers that split the narration into SEGMENTS: the narrator reads a segment,
// then the in-slide build advances one step, then the next segment is read — so the
// spoken words stay in sync with the reveals. The markers are stripped before TTS.

import { captionChunks, displayWidth, splitSentences, UNIT_MAX } from './captionSplit';

const STEP_MARKER = /\[\[\s*step\s*\]\]/gi;

// ---- Focus cues: where to look, in time with the narration ------------------------
//
//   [[look: TARGET [STYLE] [key=value…]]]   the one point of attention moves there
//   [[mark: TARGET [STYLE] [key=value…]]]   an annotation that stays (until [[clear]]
//                                            or the next slide), like chalk on a board
//   [[clear]] / [[clear: TARGET]]           take them away
// Several things pointed at AT ONCE ("これとこれを比べます") are one emphasis with
// several targets: [[look: "A", "B"]].
//
// The narration LINE is the unit of time: a cue goes with the line it is written in
// and shows when that line starts — the moment its voice begins, exact for every
// engine. The lines never change for a cue: they are cut from the script's words
// alone, exactly as without any cue (captionSplit), since every cut is heard and
// breaks the tempo. Write ONE emphasis (look / mark) per line — its own sentence;
// a line that has several still shows every one of them, together as it starts
// (never dropped, never timed by a guess), and a check reports it.
// Like the other markers they are never spoken, captioned or counted in the talk time.
const CUE_MARKER_SRC = '\\[\\[\\s*(look|mark|clear)\\s*(?::\\s*([^\\]]*?))?\\s*\\]\\]';
const cueMarkerRe = () => new RegExp(CUE_MARKER_SRC, 'gi');

export interface FocusCue {
  kind: 'look' | 'mark' | 'clear';
  /** What it points at, as written: "語句", item:"…", cell:"…", @tag, math:name,
   *  area:x,y,w,h… — several = one emphasis on all of them; none (clear) = all. */
  targets: string[];
  /** How it looks (pointer, marker, spotlight…); '' = the default for its kind. */
  style: string;
  /** key=value options (color=…). */
  options: Record<string, string>;
  /** (scriptUnits) how far into its line it was written, in full-width characters —
   *  for the checks (it still shows as the line starts); absent = at the start. */
  lead?: number;
}

// One target: an optional kind prefix and a quoted text ("…" / 「…」, spaces and
// commas allowed) with #n for its n-th occurrence; or a prefix with numbers
// (area:10,20,30,40 / cell:2,3); or a bare word (@tag, math:rhs).
const CUE_TARGET = /^((?:[A-Za-z]+:)?(?:"[^"]*"|「[^」]*」)(?:#\d+)?|[A-Za-z]+:[\d.]+(?:,[\d.]+)+|[^\s,]+)\s*/;

/** A cue's body: TARGET[, TARGET…] [STYLE] [key=value…]. */
export function parseFocusCue(kindRaw: string, bodyRaw = ''): FocusCue {
  const kind = kindRaw.toLowerCase() as FocusCue['kind'];
  let rest = String(bodyRaw || '').trim();
  const targets: string[] = [];
  for (let m = CUE_TARGET.exec(rest); m; m = CUE_TARGET.exec(rest)) {
    targets.push(m[1]);
    rest = rest.slice(m[0].length);
    if (!rest.startsWith(',')) break;
    rest = rest.slice(1).trimStart();
  }
  const options: Record<string, string> = {};
  let style = '';
  for (const tok of rest.split(/\s+/).filter(Boolean)) {
    const kv = /^([A-Za-z-]+)=(.*)$/.exec(tok);
    if (kv) options[kv[1].toLowerCase()] = kv[2];
    else if (!style) style = tok.toLowerCase();
  }
  return { kind, targets, style, options };
}

/** A line's cues as they act — all at once as it starts: its `clear`s first (so a
 *  clear never wipes an emphasis of the same line), then every emphasis in written
 *  order. */
export function lineCues(cues: readonly FocusCue[]): FocusCue[] {
  return [...cues.filter((c) => c.kind === 'clear'), ...cues.filter((c) => c.kind !== 'clear')];
}

/** How many emphases (look / mark) a line has — more than one is shown, but not
 *  recommended (a check reports it). */
export const emphasisCount = (cues: readonly FocusCue[] | undefined): number =>
  (cues || []).filter((c) => c.kind !== 'clear').length;

/** The focus cues of a script, in order. */
export function scriptCues(script: string): FocusCue[] {
  return [...String(script || '').matchAll(cueMarkerRe())].map((m) => parseFocusCue(m[1], m[2]));
}

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

// ACTION markers fire app-wide bus events (mdpBus) from inside a script:
//   [[emit: topic arg1 arg2 | label]]        fire and keep reading
//   [[emit-wait: topic args timeout=30s | label]]  fire, PAUSE narration until the
//                                            reply (or timeout), then resume
//   [[wait: topic timeout=10s]]              wait for an event
//   [[pause: 2s]]                            timed pause
// The optional `| label` names the chip shown in the presenter's script pane.
// Like [[step]]/[[say]], they are stripped from captions, speech and estimates.
const ACTION_MARKER_SRC = '\\[\\[\\s*(emit-wait|emit|wait|pause)\\s*:\\s*([^\\]]*?)\\s*\\]\\]';
const actionMarkerRe = () => new RegExp(ACTION_MARKER_SRC, 'gi');

export interface ScriptAction {
  kind: 'emit' | 'emit-wait' | 'wait' | 'pause';
  topic?: string;
  args?: string[];
  timeoutMs?: number;
  label?: string;
}

// Parse "2s" / "1500ms" / "2" (seconds) into ms.
function parseDurationMs(s: string): number | undefined {
  const m = /^([\d.]+)\s*(ms|s)?$/i.exec(s.trim());
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return undefined;
  return (m[2] || 's').toLowerCase() === 'ms' ? Math.round(n) : Math.round(n * 1000);
}

export function parseScriptAction(kindRaw: string, bodyRaw: string): ScriptAction {
  const kind = kindRaw.toLowerCase() as ScriptAction['kind'];
  let body = bodyRaw;
  let label: string | undefined;
  const bar = body.indexOf('|');
  if (bar >= 0) { label = body.slice(bar + 1).trim() || undefined; body = body.slice(0, bar); }
  if (kind === 'pause') {
    return { kind, timeoutMs: parseDurationMs(body) ?? 1000, label };
  }
  const tokens = body.trim().split(/\s+/).filter(Boolean);
  let timeoutMs: number | undefined;
  const rest: string[] = [];
  for (const t of tokens) {
    const m = /^timeout=(.+)$/i.exec(t);
    if (m) timeoutMs = parseDurationMs(m[1]);
    else rest.push(t);
  }
  return { kind, topic: rest[0] || '', args: rest.slice(1), timeoutMs, label };
}

// Split a narration segment into text parts and action parts, in order.
export type SegmentPart = { text: string } | { action: ScriptAction };
export function segmentParts(seg: string): SegmentPart[] {
  const out: SegmentPart[] = [];
  const re = actionMarkerRe();
  let last = 0;
  let m: RegExpExecArray | null;
  const s = String(seg || '');
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) out.push({ text: s.slice(last, m.index) });
    out.push({ action: parseScriptAction(m[1], m[2]) });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out;
}

// ---- Ruby: how the narrator should READ a word or a formula --------------------
//
//   ルビの[[仕様|しよう]]を[[改良|かいりょう]]したい。
//   エネルギーは [[\(E=mc^2\)|イーイコールエムシー二乗]] です。   (the base may hold math)
//
// `[[base|reading]]` — the base is exactly what is written before the |, so a
// reading can never land on the wrong characters. The narrator says the reading.
// Everything that SHOWS the script — the presenter pane, subtitles, the talk-time
// count — keeps only the base in the text; the presenter pane marks it (a dashed
// underline) and shows its reading on hover. The event markers (`[[emit: … |
// label]]`…) and `[[say: …]]` are not rubies; after a formula, `[[say: よみ]]` still
// works as before.
// Mirrored for the talk-time count in app/mcp-bridge.cjs — keep the two identical.
const RUBY = /\[\[(?!\s*(?:emit-wait|emit|wait|pause|say|look|mark|clear)\s*:)((?:\\\((?:(?!\\\))[\s\S])*\\\)|\\\[(?:(?!\\\])[\s\S])*\\\]|[^[\]|\n])+?)\|([^[\]|\n]+?)\]\]/g;

interface RubyHit { base: string; reading: string; math: boolean }
function eachRuby(text: string, fn: (hit: RubyHit) => string): string {
  return String(text || '').replace(RUBY, (_m, base: string, reading: string) =>
    fn({ base, reading: reading.trim(), math: /\\\(|\\\[/.test(base) }));
}
/** The script as SHOWN: every ruby reduced to its base (the reading dropped). */
export const rubyBase = (text: string): string => eachRuby(text, (h) => h.base);
/** The script as SPOKEN: every ruby replaced by its reading. */
export const rubyReading = (text: string): string => eachRuby(text, (h) => (h.math ? ` ${h.reading} ` : h.reading));

const escAttr = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A script for the PRESENTER pane with its readings marked. A reading is not in
 *  the text (the presenter reads the words and the math themselves), but within
 *  reach: a ruby's base — or a formula with its `[[say:…]]` — becomes
 *  `<span class="mdp-script-ruby" data-reading="…">`, which the pane underlines
 *  (dashed) and whose reading it shows on hover. A stray `[[say:…]]` goes. */
export function markScriptReadings(script: string): string {
  const mark = (base: string, reading: string) => `<span class="mdp-script-ruby" data-reading="${escAttr(reading)}">${base}</span>`;
  return eachRuby(String(script || ''), (h) => mark(h.base, h.reading))
    .replace(/(\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\])\s*\[\[\s*say\s*:\s*([\s\S]*?)\]\]/gi, (_m, math: string, say: string) =>
      (say.trim() ? mark(math, say.trim()) : math))
    .replace(/\[\[\s*say\s*:[\s\S]*?\]\]/gi, ' ');
}

// Render a script's markdown for the PRESENTER pane: markers become inline chip
// elements (clicked chips re-fire the same events manually). Its readings are
// marked before that (markScriptReadings, while code spans are still set aside).
export function renderScriptChips(scriptMarkdown: string): string {
  const esc = escAttr;
  return String(scriptMarkdown || '')
    .replace(/\[\[\s*step\s*\]\]/gi, '<button type="button" class="mdp-script-chip" data-chip="step" title="ビルドを1歩進める">⏭</button>')
    .replace(actionMarkerRe(), (_m, kindRaw: string, body: string) => {
      const a = parseScriptAction(kindRaw, body);
      if (a.kind === 'pause') return `<span class="mdp-script-chip mdp-chip-passive" title="自動再生時の間">⏸${a.label ? ' ' + esc(a.label) : ''}</span>`;
      if (a.kind === 'wait') return `<span class="mdp-script-chip mdp-chip-passive" title="自動再生時はイベント待ち">⏳ ${esc(a.label || a.topic || '')}</span>`;
      const label = a.label || a.topic || '';
      return `<button type="button" class="mdp-script-chip" data-chip="emit" data-topic="${esc(a.topic || '')}" data-args="${esc((a.args || []).join(' '))}" title="クリックでイベント送信">▶ ${esc(label)}</button>`;
    })
    // Focus cues: what the auto-play points at here — a click shows it on the
    // slideshow (focusBus; a second click takes it away).
    .replace(cueMarkerRe(), (_m, kindRaw: string, body?: string) => {
      const c = parseFocusCue(kindRaw, body || '');
      const icon = c.kind === 'look' ? '👁' : c.kind === 'mark' ? '🖍' : '✕';
      const what = c.targets.map((t) => t.replace(/^[A-Za-z]+:(?=["「])/, '').replace(/^["「]|["」](#\d+)?$/g, '')).join('・');
      const title = c.kind === 'clear' ? 'クリックで注目を消す' : 'クリックでスライドに注目を表示（もう一度で消す）';
      return `<button type="button" class="mdp-script-chip mdp-chip-focus" data-chip="focus" data-cue="${esc(JSON.stringify(c))}" title="${title}">${icon}${what ? ` ${esc(what)}` : ''}</button>`;
    })
    .replace(/\[\[\s*say\s*:[\s\S]*?\]\]/gi, ' ');
}

// A `[[say: 読み]]` marker gives the SPOKEN reading of a nearby formula, so the
// on-screen caption can render the math (`\(…\)` / `\[…\]`) while the narrator says
// the reading instead of the raw LaTeX. Placed next to the math it annotates.
const SAY_MARKER = /\[\[\s*say\s*:\s*([\s\S]*?)\]\]/gi;
// KaTeX math spans in a script: inline `\(…\)` and display `\[…\]`.
const MATH_SPAN = /\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/g;

// True if the segment carries any KaTeX math (so its caption must be RENDERED, not
// shown as raw LaTeX, and must not be split mid-formula).
export function hasScriptMath(seg: string): boolean {
  return /\\\(|\\\[/.test(String(seg || ''));
}

// The CAPTION form of a script segment: keep the math (`\(…\)` / `\[…\]`) so it can be
// KaTeX-rendered on screen; drop the readings (rubies, `[[say:…]]`) and the markers.
export function captionText(seg: string): string {
  return rubyBase(seg)
    .replace(SAY_MARKER, ' ')
    .replace(STEP_MARKER, ' ')
    .replace(actionMarkerRe(), ' ')
    .replace(cueMarkerRe(), '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// The SPOKEN form of a script segment: each ruby and `[[say: 読み]]` becomes its
// reading, the remaining math spans go (a formula is SHOWN in the caption, and only
// SPOKEN when the author gave it a reading), and the markers go. Whitespace collapses.
export function speechText(seg: string): string {
  return rubyReading(seg)
    .replace(SAY_MARKER, ' $1 ')
    .replace(MATH_SPAN, ' ')
    .replace(STEP_MARKER, ' ')
    .replace(actionMarkerRe(), ' ')
    .replace(cueMarkerRe(), '')
    .replace(/\s+/g, ' ')
    .trim();
}

// The script as SHOWN, without any control: rubies reduced to their base, the
// `[[say:…]]` readings and `[[step]]` / event / focus markers removed (math kept).
// Also what the talk-time estimate counts (talkTime.scriptChars) — mirrored in
// app/mcp-bridge.cjs scriptCharsOf.
export function stripScriptMarkers(s: string): string {
  return rubyBase(s).replace(SAY_MARKER, ' ').replace(STEP_MARKER, ' ').replace(actionMarkerRe(), ' ')
    .replace(cueMarkerRe(), '').replace(/[ \t]+/g, ' ').trim();
}

// One subtitle-sized unit of a narration segment: what to SHOW (caption — may carry
// `\(…\)` KaTeX to render) and what to SPEAK (reading; '' = show-only, e.g. a formula
// without a `[[say:…]]`). `cues`: the focus cues written in it (they act as it
// starts); `cuesAfter`: those written after the text's last word (they go with
// whatever comes next — a wait, the line after a [[step]]).
export interface ScriptUnit { caption: string; speech: string; cues?: FocusCue[]; cuesAfter?: FocusCue[] }

// Atomic-token markers (Unicode private-use — never appears in author text).
const ATOM = (i: number) => `\uE000${i}\uE001`;
const ATOM_RE = /\uE000(\d+)\uE001/g;
// Where a focus cue stood, while a narration is being cut into lines (scriptUnits).
const CUE_OPEN = String.fromCharCode(0xe002);
const CUE_CLOSE = String.fromCharCode(0xe003);

// Split a narration segment into subtitle units WITHOUT ever cutting inside a
// formula or a ruby: each ruby, and each math span (with its optional trailing
// `[[say: 読み]]` reading), is masked to one atomic token (as wide as what it SHOWS),
// the text is cut into units (captionChunks: whole sentences where they fit, a long
// one at its most natural places into even pieces), then each chunk is restored
// twice — the caption shows the base / the math, the speech says the reading (or
// nothing, for a formula without one). A long paragraph that merely CONTAINS a small
// formula is therefore still split normally.
export function scriptUnits(seg: string, maxWidth = UNIT_MAX): ScriptUnit[] {
  // `speech` carries its own spacing: a formula's reading is set apart, a word's
  // reading takes the word's place in the sentence.
  const atoms: { caption: string; speech: string }[] = [];
  const atom = (caption: string, speech: string) => { atoms.push({ caption, speech }); return ATOM(atoms.length - 1); };
  // Focus cues are marked where they stand, then taken out BEFORE the cutting — so
  // the lines come out exactly as they would without them — and each one goes with
  // the line it stood in (cues after the text's last word: with what comes next).
  const cues: FocusCue[] = [];
  const marked = String(seg || '').replace(cueMarkerRe(), (_m, kind: string, body?: string) => {
    cues.push(parseFocusCue(kind, body || ''));
    return `${CUE_OPEN}${cues.length - 1}${CUE_CLOSE}`;
  });
  const masked = eachRuby(marked.replace(STEP_MARKER, ' ').replace(actionMarkerRe(), ' '),
    (h) => atom(h.base, h.math ? ` ${h.reading} ` : h.reading))
    // math span + optional attached reading → one indivisible token
    .replace(/(\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\])\s*(?:\[\[\s*say\s*:\s*([\s\S]*?)\]\])?/g,
      (_m, math: string, say?: string) => atom(math, say && say.trim() ? ` ${say.trim()} ` : ''))
    // a stray reading with no preceding formula: speak it, show nothing
    .replace(/\[\[\s*say\s*:\s*([\s\S]*?)\]\]/gi, (_m, say: string) => atom('', ` ${say.trim()} `));
  // The text the lines are cut from (whitespace as the cutting sees it), and where
  // in it each cue stood.
  let text = '';
  const cueAt: number[] = [];
  for (let i = 0; i < masked.length; i++) {
    const c = masked[i];
    if (c === CUE_OPEN) {
      const end = masked.indexOf(CUE_CLOSE, i);
      cueAt[Number(masked.slice(i + 1, end))] = text.length;
      i = end;
    } else if (/\s/.test(c)) {
      if (text && !text.endsWith(' ')) text += ' ';
    } else {
      text += c;
    }
  }
  text = text.trimEnd();
  // A formula's width on screen ≈ its LaTeX without the markup (a command = one glyph).
  const atomWidth = (n: number) => Math.max(0.5, displayWidth(String(atoms[n]?.caption ?? '')
    .replace(/\\[()[\]]/g, '').replace(/\\[a-zA-Z]+/g, 'x').replace(/[{}^_\\]/g, '')));
  const chunks = captionChunks(text, maxWidth, atomWidth);
  const units: ScriptUnit[] = chunks.map((chunk) => ({
    caption: chunk.replace(ATOM_RE, (_m, i) => atoms[+i].caption).replace(/[ \t]+/g, ' ').trim(),
    speech: chunk.replace(ATOM_RE, (_m, i) => atoms[+i].speech || ' ').replace(/\s+/g, ' ').trim(),
  }));
  // Where each line ends in the text; a cue belongs to the first line ending after
  // it (written before a sentence, it is that sentence's).
  const starts: number[] = [];
  const ends: number[] = [];
  let from = 0;
  for (const chunk of chunks) {
    const at = text.indexOf(chunk, from);
    starts.push(at < 0 ? from : at);
    from = (at < 0 ? from : at) + chunk.length;
    ends.push(from);
  }
  const after: FocusCue[] = [];
  cues.forEach((cue, k) => {
    const pos = Math.min(cueAt[k] ?? text.length, text.length);
    const line = ends.findIndex((e) => pos < e);
    if (line < 0) { after.push(cue); return; }
    const before = text.slice(starts[line], Math.max(starts[line], pos)).replace(ATOM_RE, (_m, i) => atoms[+i].caption);
    const lead = displayWidth(before.trim());
    if (lead > 0) cue.lead = Math.round(lead * 2) / 2;
    (units[line].cues ||= []).push(cue);
  });
  if (after.length) {
    if (units.length) units[units.length - 1].cuesAfter = after;
    else units.push({ caption: '', speech: '', cuesAfter: after });
  }
  return units;
}

// ---- The narration plan (auto-play and video export) ------------------------------

// One playable step of the narration: which slide + build step to show, the text to
// SPEAK (`text`; null = a silent dwell), and the CAPTION to show (`caption`; may carry
// `\(…\)` KaTeX that is rendered on screen). Caption and speech can differ: a formula
// is shown in the caption but spoken only via its reading, a ruby shows its base.
// An `action` item fires/waits on an app-wide bus event instead of speaking
// ([[emit…]] / [[wait…]] / [[pause…]] script markers). `cues`: the focus cues that
// act as the item starts — every one written in its line (lineCues order).
export interface PlayItem {
  slideIdx: number; buildStep: number; text: string | null; caption: string; dwellMs: number; action?: ScriptAction;
  cues?: FocusCue[];
}
export interface PlaylistSlide { html: string; raw: string; stepCount?: number }

/** Flatten a deck into narration steps: one per subtitle unit of each @script
 *  segment (segments split at `[[step]]`), plus dwell items for script-less slides
 *  and trailing build reveals. `cpm` = the human reading speed (dwell lengths). */
export function buildPlaylist(slides: readonly PlaylistSlide[], cpm: number): PlayItem[] {
  const out: PlayItem[] = [];
  slides.forEach((s, si) => {
    const segs = scriptSegments(s.raw);
    const steps = s.stepCount || 0;
    if (segs.length === 0) {
      // No script → dwell proportional to the slide's actual content (not the
      // talk-time estimate, which is longer). Reveal all builds up front.
      out.push({ slideIdx: si, buildStep: steps, text: null, caption: '', dwellMs: slideDwellMs(s.html, cpm) });
      return;
    }
    // Each segment is split into subtitle UNITS (scriptUnits): normal sentence /
    // clause chunking, but a formula (with its reading) or a ruby is an ATOMIC token
    // — never cut mid-math, while a long paragraph that merely contains a small
    // formula still splits normally. Per unit: the caption keeps the math
    // (KaTeX-rendered on screen), the speech substitutes the reading (or silence — a
    // show-only formula dwells long enough to read). All units of a segment share
    // its build step; builds advance only at [[step]]. Focus cues go with the line
    // they are written in (cues after a text's last words: with the next item — a
    // wait, the line after a [[step]]), all of them, as the line starts.
    const first = out.length;
    let pending: FocusCue[] = [];
    const withCues = (it: PlayItem, cues: FocusCue[]): PlayItem => (cues.length ? { ...it, cues: lineCues(cues) } : it);
    const push = (it: PlayItem, cues?: FocusCue[]) => {
      out.push(withCues(it, [...pending, ...(cues || [])]));
      pending = [];
    };
    segs.forEach((seg, k) => {
      const bs = Math.min(k, steps);
      // Split the segment further at ACTION markers: text parts narrate as usual;
      // action parts become fire/wait items at that exact position.
      for (const part of segmentParts(seg)) {
        if ('action' in part) {
          push({ slideIdx: si, buildStep: bs, text: null, caption: '', dwellMs: 0, action: part.action });
          continue;
        }
        for (const u of scriptUnits(part.text)) {
          if (!u.caption && !u.speech) { pending.push(...(u.cues || []), ...(u.cuesAfter || [])); continue; }
          if (u.speech) {
            push({ slideIdx: si, buildStep: bs, text: u.speech, caption: u.caption, dwellMs: 90 }, u.cues);
          } else {
            const readMs = Math.round(Math.max(1800, Math.min(7000, (u.caption.replace(/\\[()[\]]/g, '').length / (cpm / 60)) * 1000)));
            push({ slideIdx: si, buildStep: bs, text: null, caption: u.caption, dwellMs: readMs }, u.cues);
          }
          if (u.cuesAfter) pending.push(...u.cuesAfter);
        }
      }
    });
    if (steps > segs.length - 1) push({ slideIdx: si, buildStep: steps, text: null, caption: '', dwellMs: 500 });
    // A script of cues alone (nothing said, shown or waited for) holds its slide like
    // one without a script; otherwise cues after the slide's last words go with its
    // last item.
    if (!out.slice(first).some((it) => it.text || it.caption || it.action)) {
      const cues = [...out.slice(first).flatMap((it) => it.cues || []), ...pending];
      out.length = first;
      pending = [];
      push({ slideIdx: si, buildStep: steps, text: null, caption: '', dwellMs: slideDwellMs(s.html, cpm) }, cues);
    } else if (pending.length) {
      const last = out[out.length - 1];
      out[out.length - 1] = withCues({ ...last, cues: undefined }, [...(last.cues || []), ...pending]);
      pending = [];
    }
  });
  return out;
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

// Split a text into SENTENCES — Japanese 。．！？, English . ! ? before the next
// sentence (not after Mr. / e.g. / an initial), never inside brackets or quotes
// (captionSplit.splitSentences). A run with no sentence ender is returned whole.
export function sentenceUnits(text: string): string[] {
  return splitSentences(text);
}

// The subtitle units of a narration text: whole sentences wherever they fit the
// caption's two lines, a long one cut at its most natural places into even pieces
// (captionSplit.ts).
export { captionChunks };
