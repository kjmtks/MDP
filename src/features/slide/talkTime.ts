// Rough speaking-time estimate for a deck, shown in the slide overview. Uses the
// speaker NOTES when a slide has them (that's the script), else the slide's visible
// text, at ~320 characters/minute — tuned for Japanese (≈300–350). It's a ballpark
// for pacing, not a stopwatch. Kept consistent with the MCP get_deck_outline tool.
const CHARS_PER_MIN = 320;

const textLen = (html: string): number => {
  if (!html) return 0;
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return (tmp.textContent || '').replace(/\s+/g, '').length;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function estimateTalkMinutes(slides: any[]): number {
  let chars = 0;
  for (const s of slides || []) {
    if (!s || s.isHidden) continue;
    chars += textLen(s.noteHtml) || textLen(s.html);
  }
  return Math.round((chars / CHARS_PER_MIN) * 10) / 10;
}

// "≈ 12.5 min" / "< 1 min" for display.
export function formatTalkMinutes(min: number): string {
  if (min <= 0) return '—';
  if (min < 1) return '< 1 min';
  return `≈ ${min % 1 === 0 ? min : min.toFixed(1)} min`;
}
