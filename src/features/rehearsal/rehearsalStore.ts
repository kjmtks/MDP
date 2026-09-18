// Rehearsal history of a deck — the measured speaking time of every run, kept in a
// JSON sidecar NEXT TO the deck (`<deck>.rehearsals.json`, e.g.
// `talk.slide.md` → `talk.slide.rehearsals.json`) so it travels with the file,
// works over `.mdplink` remotes, and is readable by the MCP bridge
// (`get_rehearsals`) without the editor. Two sources feed it:
//   * the presenter tool's stopwatch (a live run: seconds per slide while the
//     timer runs, summed over revisits), and
//   * the TTS rehearsal dialog (a synthetic dry run of the @script text).
// Each run also freezes the PLANNED budget of every slide at that moment, so a
// later comparison still makes sense after the deck's `@time` values change.
import { apiClient } from '../../api/apiClient';

export interface RehearsalSlideRecord {
  /** 1-based position of the slide in the deck at the time of the run. */
  slide: number;
  heading?: string;
  /** Budget (s) at the time of the run: `@time`, else script/complexity estimate. */
  plannedSec: number;
  /** Seconds actually spent on the slide (all visits summed). */
  actualSec: number;
  visits: number;
}

export interface RehearsalRun {
  id: string;
  source: 'presenter' | 'tts';
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
