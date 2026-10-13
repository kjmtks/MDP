// Rehearsal history of a deck — the measured speaking time of every run, kept in a
// JSON sidecar NEXT TO the deck (`<deck>.rehearsals.json`, e.g.
// `talk.slide.md` → `talk.slide.rehearsals.json`) so it travels with the file,
// works over `.mdplink` remotes, and is readable by the MCP bridge
// (`get_rehearsals`) without the editor. Three sources feed it:
//   * the presenter tool's stopwatch (a live run: seconds per slide while the
//     timer runs, summed over revisits),
//   * the TTS rehearsal dialog (a synthetic dry run of the @script text), and
//   * the narrated auto-play / video with "Update the time estimates" (source
//     'autoplay' / 'video'): what each slide's narration took — its words, pauses
//     and the activities its script waits for. Their records carry the slide's
//     script key, and the newest one of each script becomes that slide's time
//     estimate (measuredTimesOf → withMeasuredTimes → talkTime) until the script is
//     edited. Mirrored in app/mcp-bridge.cjs (measuredOf).
// Each run also freezes the PLANNED budget of every slide at that moment, so a
// later comparison still makes sense after the deck's `@time` values change.
import { apiClient } from '../../api/apiClient';
import { scriptKey } from '../slide/talkTime';

export interface RehearsalSlideRecord {
  /** 1-based position of the slide in the deck at the time of the run. */
  slide: number;
  heading?: string;
  /** Budget (s) at the time of the run: `@time`, else script/complexity estimate. */
  plannedSec: number;
  /** Seconds actually spent on the slide (all visits summed). */
  actualSec: number;
  visits: number;
  /** A narrated run: the slide's script key (talkTime.scriptKey) — `actualSec` is
   *  that script's measured time (removed by forgetMeasuredTimes). */
  key?: string;
  /** A narrated run: the part of `actualSec` spent speaking (the rest: pauses, the
   *  activities the script waits for). */
  speechSec?: number;
}

export type RehearsalSource = 'presenter' | 'tts' | 'autoplay' | 'video';

export interface RehearsalRun {
  id: string;
  source: RehearsalSource;
  startedAt: string;
  endedAt: string;
  /** Stopwatch total (s). */
  totalSec: number;
  /** Sum of the per-slide budgets (s) at the time of the run (hidden slides excluded). */
  plannedTotalSec: number;
  slideCount: number;
  /** Highest 1-based slide reached. */
  lastSlide: number;
  /** True when the run reached the deck's last (visible) slide. */
  complete: boolean;
  readingCpm?: number;
  /** A narrated run: who spoke — engine, voice, speed (videoTypes.narratorLabel). */
  narrator?: string;
  slides: RehearsalSlideRecord[];
}

export interface RehearsalFile {
  version: 1;
  deck: string;
  runs: RehearsalRun[];
}

/** Runs kept per deck (oldest dropped first). */
export const MAX_RUNS = 50;

export const REHEARSAL_SUFFIX = '.rehearsals.json';

/** Sidecar path for a deck: strip the `.md` extension, append `.rehearsals.json`. */
export function rehearsalPathFor(deckPath: string): string {
  return deckPath.replace(/\.md$/i, '') + REHEARSAL_SUFFIX;
}

export function isRehearsalFile(path: string): boolean {
  return path.toLowerCase().endsWith(REHEARSAL_SUFFIX);
}

/** First markdown heading of a slide's raw text (comments ignored). */
export function firstHeading(raw: string): string {
  const noComments = String(raw || '').replace(/<!--[\s\S]*?-->/g, ' ');
  return ((noComments.match(/^\s*#{1,6}\s+(.+)$/m) || [])[1] || '').trim();
}

export function newRunId(): string {
  return `${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 6)}`;
}

const emptyFile = (deckPath: string): RehearsalFile => ({ version: 1, deck: deckPath, runs: [] });

/** Read a deck's rehearsal sidecar (an empty history when absent or invalid). */
export async function readRehearsals(deckPath: string): Promise<RehearsalFile> {
  try {
    const parsed = JSON.parse(await apiClient.readFileText(rehearsalPathFor(deckPath)));
    if (!parsed || !Array.isArray(parsed.runs)) return emptyFile(deckPath);
    return { version: 1, deck: deckPath, runs: parsed.runs.filter((r: unknown) => !!r && typeof r === 'object') };
  } catch {
    return emptyFile(deckPath);
  }
}

/** Read-modify-write: replace the run with the same id (a run is re-sent every
 *  time the presenter pauses), else append; keep the newest MAX_RUNS. */
export async function upsertRehearsal(deckPath: string, run: RehearsalRun): Promise<RehearsalFile> {
  const file = await readRehearsals(deckPath);
  const i = file.runs.findIndex((r) => r.id === run.id);
  if (i >= 0) file.runs[i] = run; else file.runs.push(run);
  if (file.runs.length > MAX_RUNS) file.runs.splice(0, file.runs.length - MAX_RUNS);
  await apiClient.saveFile(rehearsalPathFor(deckPath), JSON.stringify(file, null, 2));
  return file;
}

/** The most recent run, or null. */
export function latestRun(file: RehearsalFile | null | undefined): RehearsalRun | null {
  if (!file || !file.runs.length) return null;
  return file.runs[file.runs.length - 1];
}

/** Measured by the narrated auto-play / video (not a person, nor the TTS dry run). */
export const isNarrationRun = (run: RehearsalRun | null | undefined): boolean =>
  !!run && (run.source === 'autoplay' || run.source === 'video');

/** The most recent REHEARSAL — a presenter or TTS dry run — for the presenter's
 *  "last time" marks: a narration measured for the time estimates is not one. */
export function latestRehearsal(file: RehearsalFile | null | undefined): RehearsalRun | null {
  const runs = file?.runs || [];
  for (let i = runs.length - 1; i >= 0; i--) if (!isNarrationRun(runs[i])) return runs[i];
  return null;
}

// ---- measured narration → time estimates ----------------------------------------

/** One script's measured narration. */
export interface MeasuredTime { sec: number; speechSec?: number; at: string; source: RehearsalSource; narrator?: string }

/** Every measured script of a deck, by script key: the NEWEST measurement of each
 *  (narrated runs ordered by when they ended). */
export function measuredTimesOf(file: RehearsalFile | null | undefined): Map<string, MeasuredTime> {
  const out = new Map<string, MeasuredTime>();
  const runs = (file?.runs || []).filter(isNarrationRun)
    .sort((a, b) => String(b.endedAt || '').localeCompare(String(a.endedAt || '')));
  for (const run of runs) {
    for (const s of run.slides || []) {
      if (!s || typeof s.key !== 'string' || !s.key || out.has(s.key) || !(Number(s.actualSec) >= 0)) continue;
      out.set(s.key, { sec: Number(s.actualSec), speechSec: s.speechSec, at: run.endedAt, source: run.source, narrator: run.narrator });
    }
  }
  return out;
}

/** What the measured times depend on — unchanged by a presenter run, so the deck's
 *  slides keep their identity when only the rehearsal history grows. */
export function narrationSignature(file: RehearsalFile | null | undefined): string {
  return (file?.runs || []).filter(isNarrationRun)
    .map((r) => `${r.id}@${r.endedAt}:${(r.slides || []).filter((s) => s && s.key).length}`).join('|');
}

/** The deck's slides with `measuredSec` on each one whose exact script was measured
 *  (talkTime puts it in place of the estimate from the script's length). The very
 *  same array when nothing applies. */
export function withMeasuredTimes<T extends { raw?: string }>(slides: T[], measured: Map<string, MeasuredTime>): (T & { measuredSec?: number })[] {
  if (!measured.size || !slides.length) return slides;
  let hit = false;
  const out = slides.map((s) => {
    const key = scriptKey(s.raw || '');
    const m = key ? measured.get(key) : undefined;
    if (!m) return s;
    hit = true;
    return { ...s, measuredSec: m.sec };
  });
  return hit ? out : slides;
}

/** What a narrated auto-play / video measured — before it becomes a run. */
export interface NarrationMeasure {
  id: string;
  source: 'autoplay' | 'video';
  startedAt: string;
  endedAt: string;
  /** The show was played to its end (else stopped part way). */
  complete: boolean;
  /** videoTypes.narratorLabel of the voice that spoke. */
  narrator: string;
  /** The deck's slide count, hidden ones included (filled in by whoever knows it). */
  slideCount?: number;
  /** The slides with a script that played through completely. */
  slides: { deckIndex: number; key: string; heading?: string; plannedSec: number; sec: number; speechSec: number }[];
}

/** A measurement as a rehearsal run (source 'autoplay' / 'video'). */
export function narrationRun(m: NarrationMeasure, slideCount: number, cpm: number): RehearsalRun {
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const slides = [...m.slides].sort((a, b) => a.deckIndex - b.deckIndex);
  return {
    id: m.id, source: m.source, startedAt: m.startedAt, endedAt: m.endedAt,
    totalSec: r1(slides.reduce((a, s) => a + s.sec, 0)),
    plannedTotalSec: Math.round(slides.reduce((a, s) => a + s.plannedSec, 0)),
    slideCount: m.slideCount ?? slideCount,
    lastSlide: slides.length ? slides[slides.length - 1].deckIndex + 1 : 0,
    complete: m.complete, readingCpm: cpm, narrator: m.narrator,
    slides: slides.map((s) => ({
      slide: s.deckIndex + 1, ...(s.heading ? { heading: s.heading } : {}),
      plannedSec: Math.round(s.plannedSec), actualSec: r1(s.sec), visits: 1, key: s.key, speechSec: r1(s.speechSec),
    })),
  };
}

/** Back to the estimates from the scripts' length: the narrated runs stay in the
 *  history, without their script keys. */
export async function forgetMeasuredTimes(deckPath: string): Promise<RehearsalFile> {
  const file = await readRehearsals(deckPath);
  let changed = false;
  for (const run of file.runs) {
    if (!isNarrationRun(run)) continue;
    for (const s of run.slides || []) if (s && s.key) { delete s.key; changed = true; }
  }
  if (changed) await apiClient.saveFile(rehearsalPathFor(deckPath), JSON.stringify(file, null, 2));
  return file;
}
