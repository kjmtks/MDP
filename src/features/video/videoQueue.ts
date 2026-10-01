// The video export QUEUE: jobs run one after another in the background (each
// needs the TTS — and its capture or export window — to itself), and any of them —
// waiting or running — can be cancelled. A job holds a snapshot of its deck taken
// when it was queued, so the author can keep editing, or queue the next deck,
// meanwhile. A module-level store (useSyncExternalStore) — it outlives any one
// component. The encoders (showRecorder.ts / videoExport.ts + mediabunny) are
// loaded when a job first runs.
import type { VideoJobInput, VideoProgress, VideoResult } from './videoTypes';

export type VideoJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface VideoJob {
  id: string;
  deckPath: string;
  title: string;
  status: VideoJobStatus;
  progress: VideoProgress | null;
  result?: VideoResult;
  error?: string;
  addedAt: number;
  startedAt?: number;
  finishedAt?: number;
}

interface Entry { job: VideoJob; input: VideoJobInput | null; ac: AbortController }

let entries: Entry[] = [];
let snapshot: readonly VideoJob[] = [];
const listeners = new Set<() => void>();
let pumping = false;
let finished: ((job: VideoJob) => void) | null = null;

// A web exact job holds this tab's share from the moment it is queued: stop it
// whenever the job will not record (cancelled while waiting, replaced, ended).
const release = (input: VideoJobInput | null) => { input?.tabStream?.getTracks().forEach((t) => t.stop()); };

const publish = () => {
  snapshot = entries.map((e) => e.job);
  listeners.forEach((l) => { try { l(); } catch { /* keep notifying */ } });
};
const patch = (e: Entry, p: Partial<VideoJob>) => { e.job = { ...e.job, ...p }; publish(); };
const active = (s: VideoJobStatus) => s === 'queued' || s === 'running';

export const getVideoJobs = (): readonly VideoJob[] => snapshot;
export function subscribeVideoJobs(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
/** Called after each job ends (done, failed or cancelled) — e.g. to refresh the tree. */
export function onVideoJobFinished(fn: ((job: VideoJob) => void) | null): void { finished = fn; }

/** Queue a deck. A deck already WAITING in the queue just gets the newer snapshot
 *  (one video per deck — a second run would only overwrite the first). */
export function enqueueVideo(input: VideoJobInput): string {
  const waiting = entries.find((e) => e.job.status === 'queued' && e.job.deckPath === input.deckPath);
  if (waiting) {
    if (waiting.input?.tabStream !== input.tabStream) release(waiting.input);
    waiting.input = input;
    patch(waiting, { addedAt: Date.now() });
    return waiting.job.id;
  }
  const id = `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const title = (input.deckPath.split('/').pop() || input.deckPath).replace(/\.slide\.md$/i, '');
  entries.push({
    job: { id, deckPath: input.deckPath, title, status: 'queued', progress: null, addedAt: Date.now() },
    input,
    ac: new AbortController(),
  });
  publish();
  void pump();
  return id;
}

export function cancelVideo(id: string): void {
  const e = entries.find((x) => x.job.id === id);
  if (!e || !active(e.job.status)) return;
  if (e.job.status === 'queued') {
    release(e.input);
    e.input = null;
    patch(e, { status: 'cancelled', finishedAt: Date.now() });
  } else {
    e.ac.abort();       // the runner marks it cancelled once the export has cleaned up
  }
}

export function cancelAllVideos(): void {
  for (const e of [...entries]) cancelVideo(e.job.id);
}

/** Drop the finished rows (done / failed / cancelled). */
export function clearFinishedVideos(): void {
  entries = entries.filter((e) => active(e.job.status));
  publish();
}

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    for (;;) {
      const e = entries.find((x) => x.job.status === 'queued');
      if (!e || !e.input) break;
      patch(e, { status: 'running', startedAt: Date.now() });
      try {
        // Exact (the real auto-play, recorded) unless the job asked for the fast
        // still-picture render.
        const onProgress = (progress: VideoProgress) => patch(e, { progress });
        const result = e.input.options.mode === 'fast'
          ? await (await import('./videoExport')).exportVideo(e.input, onProgress, e.ac.signal)
          // (The last argument: what the web show's own Cancel button does.)
          : await (await import('./showRecorder')).recordShow(e.input, onProgress, e.ac.signal, () => cancelVideo(e.job.id));
        patch(e, { status: 'done', result, finishedAt: Date.now() });
      } catch (err) {
        const cancelled = e.ac.signal.aborted || (err as { name?: string })?.name === 'AbortError';
        patch(e, cancelled
          ? { status: 'cancelled', finishedAt: Date.now() }
          : { status: 'failed', error: err instanceof Error ? err.message : String(err), finishedAt: Date.now() });
      }
      release(e.input);
      e.input = null;   // the snapshot (every slide's HTML) is not needed any more
      try { finished?.(e.job); } catch { /* a listener's problem, not the queue's */ }
    }
  } finally {
    pumping = false;
  }
}
