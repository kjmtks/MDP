// Checks of a slide's focus cues — for the AI (MCP get_focus_targets, check_deck,
// render_slide_image) — answering the two things an author cannot see in the text:
//   WHEN a cue acts: the narration line it goes with and the build step shown then
//     (buildPlaylist — exactly what the auto-play and the videos do);
//   WHETHER it lands: each target found on the slide as rendered at that step,
//     in one place, and visible.
import { buildPlaylist, emphasisCount, lineCues, scriptCues, slideScript, type FocusCue, type PlaylistSlide } from '../autoplay/autoplay';
import { applyCues, NO_FOCUS, type FocusState } from './focusState';
import { FOCUS_STYLES, type FocusOutlineItem } from './focusStyles';
import { isHit, parseTarget, resolveTarget, type FocusBox } from './focusTargets';

/** Where cues act: a narration line (`line` ≥ 1, `at` = its caption), or another
 *  item (`line` 0, `after` lines before it): a wait / pause, the slide's last build
 *  after the narration, a slide shown without narration. */
export interface CueSite { line: number; after: number; at: string; buildStep: number; cues: FocusCue[] }

export interface FocusProblem {
  level: 'error' | 'warn' | 'note';
  line: number;
  cue?: string;
  target?: string;
  message: string;
}

const TARGET_KINDS = ['', '#', 'item', 'cell', 'row', 'col', 'math', 'fig', 'area', '@'];

/** The names a slide gives places, from its text, with how often: \focus{name}{…}
 *  (in the text or a formula), <!-- @focus name -->, a module's tag: name, an
 *  inline SVG's data-focus / id, a cover's parts (title, subtitle…). (An SVG FILE's
 *  names are only known rendered.) */
export function slideNames(raw: string): Map<string, number> {
  const names = new Map<string, number>();
  const add = (n: string) => names.set(n, (names.get(n) || 0) + 1);
  const text = String(raw || '').replace(/<!--\s*@(?:script|note):[\s\S]*?-->/g, ' ');
  for (const m of text.matchAll(/\\focus\{([\p{L}\p{N}_.-]+)\}\{/gu)) add(m[1]);
  for (const m of text.matchAll(/<!--\s*@focus\s+([^\s>]+?)\s*-->/g)) add(m[1]);
  for (const m of text.matchAll(/<!--\s*@[a-zA-Z][\w-]*\s[^>]*?\btag:\s*([^,\s>]+)/g)) add(m[1]);
  // …or the module already expanded (the editor expands the deck's modules first)
  for (const m of text.matchAll(/\sdata-mdp-tag\s*=\s*"([^"]+)"/g)) add(m[1]);
  for (const svg of text.matchAll(/<svg[\s\S]*?<\/svg>/gi)) {
    for (const d of svg[0].matchAll(/\s(?:data-focus|id)\s*=\s*"([^"]+)"/g)) add(d[1]);
  }
  // A cover's parts are named by the app (from the meta page: whichever it has).
  if (/<!--\s*@cover\s*-->/.test(text)) for (const n of ['date', 'title', 'subtitle', 'presenter', 'affiliation', 'contact']) if (!names.has(n)) names.set(n, 1);
  return names;
}

/** The name a target points at (#name, item:#name…), or null. */
export function targetName(t: string): string | null {
  const p = parseTarget(t);
  if (!p) return null;
  if (p.kind === '#') return p.name || null;
  if (['item', 'cell', 'row', 'col'].includes(p.kind) && p.name?.startsWith('#')) return p.name.slice(1) || null;
  return null;
}

/** A target found by the slide's WORDS or POSITION ("phrase", item:2, cell:"…",
 *  math:1, fig:"label") — it breaks when they change; a name does not. (area: is a
 *  spot inside a picture: nothing else can point there.) */
export function pointsByWords(t: string): boolean {
  const p = parseTarget(t);
  if (!p) return false;
  if (p.kind === '' ) return true;
  if (['item', 'cell', 'row', 'col'].includes(p.kind)) return !p.name?.startsWith('#');
  if (p.kind === 'math') return !!p.nums;
  if (p.kind === 'fig') return p.text !== undefined;
  return false;
}

/** Names given to more than one place on a slide (#name points at the first). */
export function duplicateNames(raw: string): string[] {
  return [...slideNames(raw)].filter(([, n]) => n > 1).map(([name]) => name);
}
const STYLES = new Set<string>(FOCUS_STYLES);
// A cue written this far into its line (full-width characters, ≈ 2 s of speech)
// shows noticeably before the words it stands by.
const EARLY = 15;

/** A cue written back as its marker. */
export function cueText(c: FocusCue): string {
  const body = [c.targets.join(', '), c.style, ...Object.entries(c.options).map(([k, v]) => `${k}=${v}`)].filter(Boolean).join(' ');
  return `[[${c.kind}${body ? `: ${body}` : ''}]]`;
}

const whereOf = (s: CueSite) => (s.line ? `line ${s.line}` : s.at);

/** Every place on the slide where cues act, in order. */
export function cueSites(slide: PlaylistSlide, cpm = 400): CueSite[] {
  const sites: CueSite[] = [];
  let line = 0;
  for (const it of buildPlaylist([slide], cpm)) {
    const spoken = !!(it.text || it.caption);
    if (spoken) line++;
    if (!it.cues?.length) continue;
    const at = spoken ? (it.caption || it.text || '')
      : it.action ? `the [[${it.action.kind}${it.action.topic ? `: ${it.action.topic}` : ''}]] after line ${line}`
      : line ? `the slide's last build, after line ${line}` : 'the slide shown without narration';
    sites.push({ line: spoken ? line : 0, after: spoken ? line - 1 : line, at, buildStep: it.buildStep, cues: it.cues });
  }
  return sites;
}

/** How many narration lines the slide has (a slide without any counts its one
 *  silent hold as line 1, so `line:1` still shows its cues). */
export function lineCount(slide: PlaylistSlide, cpm = 400): number {
  return Math.max(1, buildPlaylist([slide], cpm).filter((it) => it.text || it.caption).length);
}

/** The focus as the auto-play shows it while the slide's n-th line plays, and the
 *  build step then; null past the last line. */
export function focusAtLine(slide: PlaylistSlide, n: number, cpm = 400): { focus: FocusState; buildStep: number; caption: string } | null {
  const items = buildPlaylist([slide], cpm);
  let state = NO_FOCUS;
  let line = 0;
  for (const it of items) {
    state = applyCues(state, it.cues);
    if ((it.text || it.caption) && ++line === n) return { focus: state, buildStep: it.buildStep, caption: it.caption };
  }
  // No narration at all: its one hold is "line 1".
  if (line === 0 && n === 1 && items.length) return { focus: state, buildStep: items[items.length - 1].buildStep, caption: '' };
  return null;
}

/** The cues of some marker text (`[[look: …]] [[mark: …]]`) as one line would show them. */
export const focusOfMarkers = (text: string): FocusState => applyCues(NO_FOCUS, lineCues(scriptCues(text)));

/** Every cue of the slide's script, numbered as written (the preview's marks). */
export const outlineOf = (raw: string): FocusOutlineItem[] =>
  scriptCues(slideScript(raw)).map((cue, i) => ({ n: i + 1, cue })).filter((it) => it.cue.targets.length > 0);

/** What can be told from the text alone: several emphases in a line, a cue written
 *  well into its line, an unknown style or target — and, given the slide's `raw`,
 *  a #name that nothing on it is given (unless an SVG file on it may hold it). */
export function cueLineProblems(sites: readonly CueSite[], raw?: string): FocusProblem[] {
  const out: FocusProblem[] = [];
  const names = raw !== undefined ? slideNames(raw) : null;
  const figureFiles = raw !== undefined && /\.svg\b|data:image\/svg/i.test(raw);
  for (const s of sites) {
    const n = emphasisCount(s.cues);
    if (n > 1) {
      out.push({
        level: 'note', line: s.line,
        message: `${whereOf(s)} has ${n} emphases (${s.cues.filter((c) => c.kind !== 'clear').map(cueText).join(' ')}) — all of them show together as it starts. Not recommended: give each emphasis a sentence of its own (never cut a sentence for one), or point at several things with ONE cue: [[look: "A", "B"]].`,
      });
    }
    for (const c of s.cues) {
      const cue = cueText(c);
      if (c.style && !STYLES.has(c.style)) {
        out.push({ level: 'warn', line: s.line, cue, message: `unknown style "${c.style}" — the default (${c.kind === 'mark' ? 'marker' : 'pointer'}) is used. Styles: ${FOCUS_STYLES.join(', ')}.` });
      }
      if (c.kind !== 'clear' && !c.targets.length) out.push({ level: 'error', line: s.line, cue, message: 'no target — nothing is pointed at.' });
      for (const t of c.targets) {
        const p = parseTarget(t);
        if (!p || !TARGET_KINDS.includes(p.kind)) {
          out.push({ level: 'error', line: s.line, cue, target: t, message: `cannot read the target "${t}" — use #name (a place the slide names), item:#name, cell:#name, row:#name, col:#name, or "phrase", item:…, cell:…, row:…, col:…, math:…, fig:…, area:x,y,w,h, @tag.` });
          continue;
        }
        const name = targetName(t);
        if (name && names && !names.has(name) && !figureFiles) {
          out.push({ level: 'error', line: s.line, cue, target: t, message: `nothing on this slide is named "${name}" — mark the place: \\focus{${name}}{…} around words, an image or a formula part, <!-- @focus ${name} -->…<!-- @end --> around blocks, tag: ${name} on a module, data-focus="${name}" in an inline SVG.` });
        }
      }
      if (c.kind !== 'clear' && s.line > 0 && (c.lead || 0) >= EARLY) {
        out.push({
          level: 'note', line: s.line, cue,
          message: `written ${Math.round(c.lead!)} characters into line ${s.line} — it shows as the line STARTS, about ${Math.round(c.lead! / 6.5)} s before the words it stands by. Fine if the whole line is about it; otherwise give that sentence a line of its own (12+ characters: a shorter sentence rides with the next) and put the cue at its start. Never cut a sentence for it.`,
        });
      }
    }
  }
  return out;
}

export interface TargetResult {
  target: string;
  ok: boolean;
  kind?: string;
  /** In % of the slide. */
  box?: FocusBox;
  matches?: number;
  hidden?: boolean;
  error?: string;
}
export interface CueResult { cue: string; targets: TargetResult[] }

const r1 = (v: number) => Math.round(v * 10) / 10;
/** A box in the slide's pixels → % of the slide. */
export const pctBox = (b: FocusBox, W: number, H: number): FocusBox =>
  ({ x: r1((b.x / W) * 100), y: r1((b.y / H) * 100), w: r1((b.w / W) * 100), h: r1((b.h / H) * 100) });

/** The targets of a site's cues, on the slide rendered as it is then (`root` =
 *  SlideView's wrapper at the site's build step). */
export function checkSiteTargets(site: CueSite, root: HTMLElement): { cues: CueResult[]; problems: FocusProblem[] } {
  const W = root.offsetWidth || 1;
  const H = root.offsetHeight || 1;
  const problems: FocusProblem[] = [];
  const cues = site.cues.filter((c) => c.kind !== 'clear').map((c): CueResult => {
    const cue = cueText(c);
    const targets = c.targets.map((t): TargetResult => {
      const r = resolveTarget(t, root);
      if (!isHit(r)) {
        problems.push({ level: 'error', line: site.line, cue, target: t, message: `${r.error} — nothing is drawn for it.` });
        return { target: t, ok: false, error: r.error };
      }
      if (r.matches && r.matches > 1 && !/#\d+$/.test(t)) {
        const name = targetName(t);
        problems.push({
          level: 'warn', line: site.line, cue, target: t,
          message: name ? `"${name}" names ${r.matches} places on the slide — the first is used. Give each place its own name.`
            : `found in ${r.matches} places — the first is used. Add #n (${t}#2 …) or quote a longer phrase — or name the place (\\focus{name}{…}) and point with #name.`,
        });
      }
      if (r.hidden) {
        problems.push({ level: 'warn', line: site.line, cue, target: t, message: `not visible when ${whereOf(site)} starts (build step ${site.buildStep}) — it is not drawn. Point at it after the [[step]] that reveals it.` });
      }
      return {
        target: t, ok: true, kind: r.kind, box: pctBox(r.box, W, H),
        ...(r.matches && r.matches > 1 ? { matches: r.matches } : {}), ...(r.hidden ? { hidden: true } : {}),
      };
    });
    return { cue, targets };
  });
  return { cues, problems };
}
