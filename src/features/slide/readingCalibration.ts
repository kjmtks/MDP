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

/** The slide being edited first, then the following ones (wrapping round), until
 *  about TARGET_CHARS. null when no visible slide has a script to read. */
export function deckCalibrationPassage(slides: readonly OpenDeckSlide[], start: number): CalibrationPassage | null {
  const n = slides.length;
  if (!n) return null;
  const from = Math.min(Math.max(0, Math.floor(start) || 0), n - 1);
  const parts: string[] = [];
  const picked: number[] = [];
  let chars = 0;
  for (let k = 0; k < n && chars < TARGET_CHARS; k++) {
    const i = (from + k) % n;
    const slide = slides[i];
    if (!slide || slide.isHidden) continue;             // not spoken in the talk
    const raw = slide.raw || '';
    const count = scriptChars(raw);
    if (!count || (picked.length && chars + count > MAX_CHARS)) continue;
    const spoken = scriptSegments(raw).map(speechText).filter(Boolean).join(' ');
    if (!spoken) continue;                               // e.g. only a formula without a reading
    parts.push(spoken);
    picked.push(i + 1);
    chars += count;
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
