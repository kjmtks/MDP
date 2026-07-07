// Speaking-time model for a deck, shared (by IDENTICAL logic) with the MCP
// get_deck_outline tool (app/mcp-bridge.cjs) so the number the app shows equals
// what an AI sees. Talk time is genuinely hard, so the model is honest — three
// regimes per slide, from RAW markdown:
//
//   1. EXPLICIT   — `<!-- @time 90s -->`: use it verbatim (no guessing). Wins.
//   2. SCRIPT     — `<!-- @script: … -->` present: the presenter intends to READ it
//                   aloud, so time = script length / reading speed. This is an
//                   EXPLICIT intent (distinct from @note, which is a supplementary
//                   reminder and does NOT affect time).
//   3. IMPROVISED — else time is driven by CONTENT COMPLEXITY, not character count:
//                   a per-slide base + bullets + visuals (diagrams/images/code) plus
//                   a light weight on body text.
//
// Reading speed (chars/min) is per-person → passed in (from the app setting, which
// can be calibrated). Defaults to 320 (Japanese ≈300–350).
export const DEFAULT_READING_CPM = 320;
const BASE_SEC = 20;        // per improvised slide, before content
const BULLET_SEC = 7;
const VISUAL_SEC = 20;      // each diagram / image / code block
const BODY_WEIGHT = 0.5;    // improvised body text isn't read verbatim

const nonWs = (s: string): number => s.replace(/\s+/g, '').length;
const stripComments = (raw: string): string => raw.replace(/<!--[\s\S]*?-->/g, ' ');
const bodyChars = (raw: string): number => nonWs(stripComments(raw));
const scriptChars = (raw: string): number =>
  nonWs([...raw.matchAll(/<!--\s*@script:\s*([\s\S]*?)-->/g)].map((m) => m[1]).join(''));

// Parse a human time string to seconds: `90s`, `90`, `2m`, `1m30s`, `1.5m`, `1:30`
// (mm:ss), `1h`. Bare integer = seconds. Returns null if unparseable.
export function parseTimeToSeconds(str: string): number | null {
  const s = (str || '').trim().toLowerCase();
  if (!s) return null;
  let m = s.match(/^(\d+):(\d{1,2})$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  let total = 0, matched = false;
  const re = /(\d+(?:\.\d+)?)\s*(h|hr|hours?|m|min|minutes?|s|sec|seconds?)/g;
  while ((m = re.exec(s))) {
    matched = true;
    const v = parseFloat(m[1]);
    total += m[2][0] === 'h' ? v * 3600 : m[2][0] === 'm' ? v * 60 : v;
  }
  if (matched) return Math.round(total);
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  return null;
}

// The explicit `<!-- @time … -->` budget of a slide (seconds), or null if unset.
export function explicitSlideSeconds(raw: string): number | null {
  const m = (raw || '').match(/<!--\s*@time\s+([\s\S]*?)\s*-->/i);
  return m ? parseTimeToSeconds(m[1]) : null;
}

const complexity = (raw: string): { bullets: number; visuals: number } => {
  const noC = stripComments(raw);
  const bullets = (noC.match(/^[ \t]*(?:[-*+]|\d+\.)\s+\S/gm) || []).length;
  const codeBlocks = Math.floor((raw.match(/```/g) || []).length / 2);
  const images = (noC.match(/!\[[^\]]*\]\(/g) || []).length;
  return { bullets, visuals: codeBlocks + images };
};

// Estimated seconds for ONE slide's raw markdown (explicit → script → improvised).
export function slideSecondsFromRaw(raw: string, cpm: number = DEFAULT_READING_CPM): number {
  const cps = (cpm > 0 ? cpm : DEFAULT_READING_CPM) / 60;
  const explicit = explicitSlideSeconds(raw);
  if (explicit != null) return explicit;
  const script = scriptChars(raw);
  if (script > 0) return Math.round(script / cps);
  const { bullets, visuals } = complexity(raw);
  return Math.round(BASE_SEC + bullets * BULLET_SEC + visuals * VISUAL_SEC + (bodyChars(raw) / cps) * BODY_WEIGHT);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function slideSeconds(slide: any, cpm?: number): number {
  return slide ? slideSecondsFromRaw(slide.raw || '', cpm) : 0;
}

// Total estimated seconds for the deck (hidden slides excluded — not spoken).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function estimateDeckSeconds(slides: any[], cpm?: number): number {
  let s = 0;
  for (const sl of slides || []) { if (sl && !sl.isHidden) s += slideSeconds(sl, cpm); }
  return s;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function estimateTalkMinutes(slides: any[], cpm?: number): number {
  return Math.round((estimateDeckSeconds(slides, cpm) / 60) * 10) / 10;
}

// "≈ 12.5 min" / "< 1 min" for the overview.
export function formatTalkMinutes(min: number): string {
  if (min <= 0) return '—';
  if (min < 1) return '< 1 min';
  return `≈ ${min % 1 === 0 ? min : min.toFixed(1)} min`;
}

// "12:05" / "-1:20" clock for the presenter (negative = over budget).
export function formatClock(totalSeconds: number): string {
  const neg = totalSeconds < 0;
  const t = Math.abs(Math.round(totalSeconds));
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${neg ? '-' : ''}${m}:${String(s).padStart(2, '0')}`;
}
