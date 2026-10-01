// The passage for the reading-speed calibration (Settings → Reading speed), taken
// from the open deck's own `@script` — the text whose reading time the talk-time
// estimate predicts — instead of a generic paragraph.
//
// Shown in its SPOKEN form (no [[step]]/[[emit]] markers, `[[say:…]]` readings in
// place of formulas) but COUNTED exactly as talkTime counts a script (raw
// characters of the directive): then speed = count / time makes the estimate
// reproduce the measured time for these very slides, markers and all.
import { scriptSegments, speechText } from '../autoplay/autoplay';
import type { OpenDeckSlide } from './openDeckRuntime';
import { scriptChars } from './talkTime';

export interface CalibrationPassage {
  text: string;        // what to read aloud
  chars: number;       // how many characters the talk-time estimate counts for it
  slides: number[];    // 1-based slide numbers it came from, in reading order
}

const TARGET_CHARS = 250;   // ≈ 45 s at 320 chars/min — long enough to average out
const MAX_CHARS = 700;      // don't add a slide that would make it much longer

/** One slide's script as it would be read: its spoken form and the characters the
 *  talk-time estimate counts for it. */
export interface SlideScript { slide: number; spoken: string; chars: number }

/** The deck's scripts in the order a reading takes them (the reading-speed and
 *  voice calibrations): from the slide on screen when it has a script — then on,
 *  page after page, round to the start — else from the deck's first script.
 *  Hidden slides are skipped (not spoken in the talk), and so is a script with
 *  nothing to say (e.g. only a formula without a reading). [] = no script at all:
 *  the caller falls back to the default passage. */
export function scriptsInReadingOrder(slides: readonly OpenDeckSlide[], current: number): SlideScript[] {
  const all: SlideScript[] = [];
  slides.forEach((slide, i) => {
    if (!slide || slide.isHidden) return;
    const raw = slide.raw || '';
    const chars = scriptChars(raw);
    const spoken = chars ? scriptSegments(raw).map(speechText).filter(Boolean).join(' ') : '';
    if (spoken) all.push({ slide: i + 1, spoken, chars });
  });
  const at = all.findIndex((s) => s.slide === Math.floor(current) + 1);
  return at > 0 ? [...all.slice(at), ...all.slice(0, at)] : all;
}

/** The scripts in reading order (scriptsInReadingOrder) until about TARGET_CHARS.
 *  null when no visible slide has a script to read. */
export function deckCalibrationPassage(slides: readonly OpenDeckSlide[], start: number): CalibrationPassage | null {
  const parts: string[] = [];
  const picked: number[] = [];
  let chars = 0;
  for (const s of scriptsInReadingOrder(slides, start)) {
    if (chars >= TARGET_CHARS) break;
    if (picked.length && chars + s.chars > MAX_CHARS) continue;
    parts.push(s.spoken);
    picked.push(s.slide);
    chars += s.chars;
  }
  return picked.length ? { text: parts.join('\n\n'), chars, slides: picked } : null;
}

/** "3", "3–5", "12, 1–2" — the slide numbers, runs collapsed, in reading order. */
export function formatSlideNumbers(nums: number[]): string {
  const runs: string[] = [];
  for (let i = 0; i < nums.length;) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    runs.push(j > i ? `${nums[i]}–${nums[j]}` : String(nums[i]));
    i = j + 1;
  }
  return runs.join(', ');
}
