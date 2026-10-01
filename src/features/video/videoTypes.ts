// The light half of the video export — types, the support check and file naming —
// so the editor can offer the feature without loading the encoder (mediabunny +
// the render loops in videoExport.ts / showRecorder.ts, imported only when a job
// actually runs).
import { isElectron } from '../../api/apiClient';
import { WEB_BASE } from '../../api/base';
import type { TtsConfig } from '../tts/ttsService';
import type { AutoPlayExportEvent, AutoPlaySlide } from '../autoplay/AutoPlayView';
import type { MotionSpec } from '../slide/parser/SlideContext';
import type { ModuleData } from '../../utils/moduleParser';
import type { EffectData } from '../../utils/effectParser';
import type { PlanSlide } from './videoPlan';

export interface VideoSlide extends PlanSlide {
  className?: string;
  header?: string;
  footer?: string;
  pageNumber?: number;
  motion?: MotionSpec;        // its @transition with the arguments (the exact mode plays it)
}

/** 'exact' = the real narrated auto-play, recorded while it plays (modules, slide
 *  transitions and builds as the browser runs them; takes as long as the show).
 *  'fast' = still pictures joined by cross-fades, rendered faster than real time. */
export type VideoMode = 'exact' | 'fast';

export interface VideoOptions {
  mode: VideoMode;
  height: 720 | 1080 | 2160;  // frame height; the width follows the deck's aspect
  subtitles: boolean;         // burned into the picture
  vtt: boolean;               // also a WebVTT file next to the video
  includeHidden: boolean;
  fade: boolean;              // fast mode: cross-fade picture changes
}

/** Everything a job needs, captured when it is queued — the deck may be edited,
 *  closed or switched while it waits. */
export interface VideoJobInput {
  deckPath: string;           // workspace-relative deck
  slides: VideoSlide[];
  globalTransition?: string;
  globalMotion?: MotionSpec;  // the deck's @transition with its arguments
  slideSize: { width: number; height: number };
  basePath?: string;
  themeCssUrl?: string;
  moduleCss: string;
  fontCss: string;
  modules?: ModuleData[];     // exact mode: the module definitions (their scripts run)
  effects?: EffectData[];     // exact mode: the effect definitions (transitions, builds)
  tts: TtsConfig;
  cpm: number;
  options: VideoOptions;
  /** Web, exact mode: this tab, shared when the job was queued (the browser asks on
   *  a click); recorded cropped to the show. Stopped when the job ends. */
  tabStream?: MediaStream;
}

export interface VideoProgress { stage: 'prepare' | 'render' | 'record' | 'finish'; done: number; total: number; seconds: number }
export interface VideoResult { path: string; vttPath?: string; seconds: number }

/** `talks/intro.slide.md` → `talks/intro` (the video sits beside its deck). */
export const videoBaseOf = (deckPath: string): string => deckPath.replace(/\.slide\.md$/i, '').replace(/\.md$/i, '');

// ---- may this user make videos here? ----
// Desktop app: always. Web: when the server's administrator allows it for this
// user (GET /api/features — the server checks again on every write), in a browser
// with the WebCodecs encoders.
let webAllowed = false;
const featureListeners = new Set<() => void>();
const hasEncoders = (): boolean => typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined';

/** Can this app make videos at all? */
export const videoExportSupported = (): boolean => (isElectron()
  ? typeof (window as unknown as { electronAPI?: { streamFileOpen?: unknown } }).electronAPI?.streamFileOpen === 'function'
  : webAllowed && hasEncoders());

/** Ask the server again (web) — the administrator may flip the switch at any time. */
export async function refreshVideoFeature(): Promise<boolean> {
  if (isElectron()) return videoExportSupported();
  let allowed = false;
  try {
    const res = await fetch(`${WEB_BASE}/api/features`);
    if (res.ok) allowed = !!(await res.json()).videoExport;
  } catch { /* unreachable: not allowed */ }
  if (allowed !== webAllowed) {
    webAllowed = allowed;
    featureListeners.forEach((l) => { try { l(); } catch { /* keep notifying */ } });
  }
  return videoExportSupported();
}
export function subscribeVideoFeature(cb: () => void): () => void {
  featureListeners.add(cb);
  return () => { featureListeners.delete(cb); };
}

/** Can it record the exact mode? (Web: only Chromium can share a tab with its sound.) */
export const exactModeSupported = (): boolean => isElectron()
  || (typeof (window as unknown as { CropTarget?: unknown }).CropTarget !== 'undefined'
    && typeof navigator.mediaDevices?.getDisplayMedia === 'function');

// ---- the exact mode's hidden window (ShowExportPage) ↔ its recorder (showRecorder) ----

/** Their own BroadcastChannel, per job — never the presentation's sync channel. */
export const showExportChannel = (jobId: string): string => `mdp-show-export-${jobId}`;

/** The deck as the export window needs it: what the output window gets over the
 *  sync channel, plus the narrator as queued. */
export interface ShowExportDeck {
  slides: AutoPlaySlide[];
  slideSize: { width: number; height: number };
  basePath?: string;
  themeCssUrl?: string;
  fontCss: string;
  modules: ModuleData[];
  effects: EffectData[];
  globalMotion?: MotionSpec;
  tts: TtsConfig;
  cpm: number;
  captions: boolean;
}

export type ShowExportMessage =
  | { type: 'ready' }                                   // window → recorder: loaded, send the deck
  | { type: 'deck'; deck: ShowExportDeck }
  | { type: 'go' }                                      // recorder → window: recording, start the show
  | { type: 'event'; event: AutoPlayExportEvent };
