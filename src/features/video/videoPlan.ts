// The timing plan of a narrated video — pure, so it can be tested without a
// browser. The narration order is the auto-play's own (buildPlaylist): the video
// is what the narrated auto-play would show, rendered offline instead of played.
//
// Everything is counted in FRAMES of a fixed rate, and audio in samples of a fixed
// rate, with SAMPLES_PER_FRAME samples per frame — so picture and sound can never
// drift apart, however long the deck.
import { buildPlaylist } from '../autoplay/autoplay';

export const FPS = 30;
export const SAMPLE_RATE = 48000;
export const SAMPLES_PER_FRAME = SAMPLE_RATE / FPS;   // 1600

export interface PlanSlide {
  html: string;
  raw: string;
  stepCount?: number;
  isHidden?: boolean;
  transition?: string;        // the slide's own @transition name, if any
}

export interface PlanOptions {
  includeHidden: boolean;     // hidden slides are not presented — normally left out
  fade: boolean;              // cross-fade picture changes (else hard cuts)
  globalTransition?: string;  // the deck's @transition (a slide's own one wins)
}

/** One stretch of the video: a slide at a build step with a caption, `frames`
 *  long. `speech` (if any) starts after `leadFrames` of silence; the rest of the
 *  stretch is silent. */
export interface VideoSegment {
  slideIdx: number;           // index into ALL the deck's slides (hidden included)
  buildStep: number;
  caption: string;            // '' = no subtitle
  speech: string | null;      // text for the TTS
  leadFrames: number;
  tailFrames: number;         // silence kept after the speech (a breath)
  frames: number;             // silent stretches: known now; speech: set once the audio is known
  fade: boolean;              // cross-fade into this stretch's picture
}

const LEAD_NEW_SLIDE = 0.5;   // s of silence before the first words on a new slide
const FADE_SECONDS = 0.4;
export const FADE_FRAMES = Math.round(FADE_SECONDS * FPS);

const toFrames = (ms: number) => Math.max(1, Math.round((ms / 1000) * FPS));

/** The stretches of the video, in order. Speech stretches get their `frames`
 *  from `withSpeech` once their audio has been synthesized. */
export function planSegments(slides: readonly PlanSlide[], cpm: number, opts: PlanOptions): VideoSegment[] {
  const shown = slides.map((s, i) => ({ s, i })).filter(({ s }) => opts.includeHidden || !s.isHidden);
  const playlist = buildPlaylist(shown.map(({ s }) => ({ html: s.html, raw: s.raw, stepCount: s.stepCount })), cpm);
  const out: VideoSegment[] = [];
  let prev: { slideIdx: number; buildStep: number } | null = null;
  for (const item of playlist) {
    const slideIdx = shown[item.slideIdx].i;
    // Only a timed pause lasts in a video: events (modules, [[wait]]) have nobody
    // to answer them here.
    if (item.action && item.action.kind !== 'pause') continue;
    const newSlide = !prev || prev.slideIdx !== slideIdx;
    const changed = newSlide || prev!.buildStep !== item.buildStep;
    const transition = slides[slideIdx].transition || opts.globalTransition || '';
    const fade = !!prev && changed && opts.fade && !(newSlide && transition === 'none');
    const seg: VideoSegment = {
      slideIdx,
      buildStep: item.buildStep,
      caption: item.caption,
      speech: item.text,
      leadFrames: item.text && newSlide ? Math.round(LEAD_NEW_SLIDE * FPS) : 0,
      tailFrames: item.text ? toFrames(item.dwellMs) : 0,
      frames: item.text ? 0 : toFrames(item.action ? item.action.timeoutMs || 1000 : item.dwellMs),
      fade,
    };
    // A fade needs room to happen in.
    if (!item.text && fade) seg.frames = Math.max(seg.frames, FADE_FRAMES);
    out.push(seg);
    prev = { slideIdx, buildStep: item.buildStep };
  }
  return out;
}

/** A speech stretch's length once its audio (`samples` long) is known: the lead,
 *  the words, the breath — rounded up to whole frames. */
export function withSpeech(seg: VideoSegment, samples: number): VideoSegment {
  const speechFrames = Math.ceil(samples / SAMPLES_PER_FRAME);
  return { ...seg, frames: Math.max(seg.leadFrames + speechFrames + seg.tailFrames, seg.fade ? FADE_FRAMES : 1) };
}

/** WebVTT subtitles for the finished plan (math delimiters dropped). */
export function toWebVtt(segments: readonly VideoSegment[]): string {
  const ts = (frame: number) => {
    const ms = Math.round((frame / FPS) * 1000);
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
  };
  const cues: string[] = [];
  let at = 0;
  for (const seg of segments) {
    const text = seg.caption.replace(/\\\(|\\\)|\\\[|\\\]/g, '').replace(/\s+/g, ' ').trim();
    if (text) cues.push(`${ts(at + seg.leadFrames)} --> ${ts(at + seg.frames)}\n${text}`);
    at += seg.frames;
  }
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}

/** Total length of the plan, in seconds. */
export const planSeconds = (segments: readonly VideoSegment[]): number =>
  segments.reduce((n, s) => n + s.frames, 0) / FPS;
