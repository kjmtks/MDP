// The "exact" video export: the deck's REAL narrated auto-play — module scripts
// running, slide transitions, build effects, [[emit-wait]] cues answered by the
// modules, everything the browser does — plays in a page of its own (ShowExportPage)
// and is recorded from here as a tab, picture and sound together, the way a live
// recording is (slideRecorder.ts), into an MP4 beside the deck. The desktop app
// plays it in a hidden window; the web build over this page, through "share this
// tab" (webShow.ts). It takes as long as the show: all of the narration is
// synthesized first, so the show never waits for the TTS, then it plays once,
// start to end.
import type { StreamTargetChunk } from 'mediabunny';
import { apiClient, isElectron } from '../../api/apiClient';
import { synthesizesAudio } from '../tts/ttsService';
import type { AutoPlayExportEvent, AutoPlaySlide } from '../autoplay/AutoPlayView';
import {
  showExportChannel, videoBaseOf, type ShowExportDeck, type ShowExportMessage, type VideoJobInput, type VideoProgress,
  type VideoResult,
} from './videoTypes';
import { openVideoFile, type VideoFile } from './videoFiles';
import { openWebShow, type WebShow } from './webShow';

interface Bridge {
  openShowExport: (r: { jobId: string; width: number; height: number }) => Promise<boolean>;
  showExportSource: (jobId: string) => Promise<{ id: string }>;
  closeShowExport: (jobId: string) => Promise<boolean>;
}
const bridge = (): Partial<Bridge> | undefined => (window as unknown as { electronAPI?: Partial<Bridge> }).electronAPI;

const aborted = () => new DOMException('The video export was cancelled.', 'AbortError');
const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));
const LEAD_MS = 400;     // the first slide at rest before the show starts
const TAIL_MS = 600;     // the last slide at rest after it ends

/** WebVTT from the captions as they were shown (seconds from the recording's start). */
function toVtt(cues: { start: number; end: number; text: string }[]): string {
  const ts = (sec: number) => {
    const ms = Math.max(0, Math.round(sec * 1000));
    const p = (n: number, w = 2) => String(n).padStart(w, '0');
    return `${p(Math.floor(ms / 3600000))}:${p(Math.floor((ms % 3600000) / 60000))}:${p(Math.floor((ms % 60000) / 1000))}.${p(ms % 1000, 3)}`;
  };
  return `WEBVTT\n\n${cues.map((c) => `${ts(c.start)} --> ${ts(c.end)}\n${c.text}`).join('\n\n')}\n`;
}
const plainCaption = (s: string) => s.replace(/\\\(|\\\)|\\\[|\\\]/g, '').replace(/\s+/g, ' ').trim();

// Where the show plays and how it is recorded.
interface ShowHost {
  open: () => Promise<void>;
  /** Its picture (`width`×`height` frames, or any size when `scaled`) and sound. */
  capture: (width: number, height: number) => Promise<MediaStream>;
  /** The frames are not of the video's size (the web's cropped tab): scale them. */
  scaled: boolean;
  status: (p: VideoProgress) => void;
  close: () => Promise<void>;
}

// Desktop: a hidden window at the slide's size, recorded as a tab (it renders at
// the capture size — sharp at any resolution).
function desktopHost(jobId: string, slideSize: { width: number; height: number }): ShowHost {
  const api = bridge();
  if (!api?.openShowExport || !api.showExportSource || !api.closeShowExport) throw new Error('Video export needs the desktop app.');
  return {
    open: async () => { await api.openShowExport!({ jobId, width: slideSize.width, height: slideSize.height }); },
    capture: async (width, height) => {
      const src = await api.showExportSource!(jobId);
      const tab = { chromeMediaSource: 'tab', chromeMediaSourceId: src.id };
      return navigator.mediaDevices.getUserMedia({
        audio: { mandatory: tab },
        video: { mandatory: { ...tab, maxFrameRate: 30, minWidth: width, maxWidth: width, minHeight: height, maxHeight: height } },
      } as unknown as MediaStreamConstraints);
    },
    scaled: false,
    status: () => { /* the queue panel shows the progress */ },
    close: async () => { await api.closeShowExport!(jobId).catch(() => { /* already gone */ }); },
  };
}

// Web: over this page, from the tab the user shared when queueing the job.
function webHost(jobId: string, job: VideoJobInput, cancel: () => void): ShowHost {
  const stream = job.tabStream;
  if (!stream || !stream.getVideoTracks().some((t) => t.readyState === 'live')) {
    throw new Error('This tab is not shared any more — export again and allow sharing this tab.');
  }
  let show: WebShow | null = null;
  return {
    open: async () => { show = openWebShow(jobId, job.slideSize, cancel); },
    capture: async () => {
      const video = stream.getVideoTracks()[0];
      if (!stream.getAudioTracks().length) {
        throw new Error('The recording has no sound — export again and keep “Also share tab audio” on.');
      }
      try { await show!.cropTo(video); } catch {
        throw new Error('Only THIS tab can be recorded — export again and share this tab.');
      }
      return stream;
    },
    scaled: true,
    status: (p) => show?.status(p),
    close: async () => { show?.close(); stream.getTracks().forEach((t) => t.stop()); },
  };
}

/** Record one job. `onProgress` while the narration is synthesized and then while
 *  the show plays; `signal` cancels (the show is closed, the half-written file
 *  deleted); `cancel` is what the web show's own Cancel button calls. */
export async function recordShow(
  job: VideoJobInput, onProgress: (p: VideoProgress) => void, signal: AbortSignal, cancel: () => void = () => {},
): Promise<VideoResult> {
  if (!synthesizesAudio(job.tts.engine)) {
    throw new Error('Web Speech gives no audio data — choose VOICEVOX or a TTS server to make a narrated video.');
  }
  const slides: AutoPlaySlide[] = job.slides
    .filter((s) => job.options.includeHidden || !s.isHidden)
    .map((s) => ({
      html: s.html, raw: s.raw, className: s.className, header: s.header, footer: s.footer,
      stepCount: s.stepCount || 0, pageNumber: s.pageNumber, transition: s.motion,
    }));
  if (!slides.length) throw new Error('The deck has no slide to show.');
  const jobId = `x${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const host = isElectron() ? desktopHost(jobId, job.slideSize) : webHost(jobId, job, cancel);
  const progress = (p: VideoProgress) => { onProgress(p); host.status(p); };
  progress({ stage: 'prepare', done: 0, total: 0, seconds: 0 });
  const height = job.options.height;
  const width = Math.round((height * job.slideSize.width) / job.slideSize.height / 2) * 2;   // H.264 wants even sizes

  const channel = new BroadcastChannel(showExportChannel(jobId));
  const deck: ShowExportDeck = {
    slides, slideSize: job.slideSize, basePath: job.basePath, themeCssUrl: job.themeCssUrl, fontCss: job.fontCss,
    modules: job.modules || [], effects: job.effects || [], globalMotion: job.globalMotion,
    tts: job.tts, cpm: job.cpm, captions: job.options.subtitles,
  };

  // Everything that can end the job early funnels into `fail`; the waits below race it.
  let fail!: (e: Error) => void;
  const failure = new Promise<never>((_, reject) => { fail = reject; });
  failure.catch(() => { /* raced below */ });
  const onAbort = () => fail(aborted());
  signal.addEventListener('abort', onAbort, { once: true });
  const race = <T>(p: Promise<T>): Promise<T> => Promise.race([p, failure]);

  // The show's events.
  let armed!: () => void;
  const armedP = new Promise<void>((r) => { armed = r; });
  let finished!: () => void;
  const finishedP = new Promise<void>((r) => { finished = r; });
  let recStart = 0;
  let items = { done: 0, total: 0 };
  const cues: { start: number; end: number; text: string }[] = [];
  let cue: { start: number; text: string } | null = null;
  const now = () => (recStart ? (performance.now() - recStart) / 1000 : 0);
  const closeCue = (at: number) => {
    if (cue && cue.text) cues.push({ start: cue.start, end: Math.max(at, cue.start + 0.05), text: cue.text });
    cue = null;
  };
  const onEvent = (e: AutoPlayExportEvent) => {
    if (e.type === 'prep') progress({ stage: 'prepare', done: e.done, total: e.total, seconds: 0 });
    else if (e.type === 'armed') armed();
    else if (e.type === 'item') {
      items = { done: e.index + 1, total: e.total };
      progress({ stage: 'record', done: items.done, total: items.total, seconds: now() });
      const text = plainCaption(e.caption);
      if (!cue || cue.text !== text) { closeCue(now()); cue = { start: now(), text }; }
    } else if (e.type === 'finished') { closeCue(now()); finished(); }
    else if (e.type === 'error') fail(new Error(e.message));
  };
  channel.onmessage = (ev: MessageEvent<ShowExportMessage>) => {
    const m = ev.data;
    if (m.type === 'ready') channel.postMessage({ type: 'deck', deck } satisfies ShowExportMessage);
    else if (m.type === 'event') onEvent(m.event);
  };

  let file: VideoFile | null = null;
  let opening: Promise<VideoFile> | null = null;
  let committed = false;
  let tracks: MediaStreamTrack[] = [];
  let output: import('mediabunny').Output | null = null;
  let ticker = 0;
  try {
    await race(host.open());
    await race(armedP);    // every line synthesized, the first slide on screen

    const {
      MediaStreamAudioTrackSource, MediaStreamVideoTrackSource, Mp4OutputFormat, Output, QUALITY_HIGH,
      StreamTarget, WebMOutputFormat, canEncodeAudio, canEncodeVideo,
    } = await import('mediabunny');
    const stream = await race(host.capture(width, height));
    tracks = stream.getTracks();
    const video = stream.getVideoTracks()[0];
    const sound = stream.getAudioTracks()[0];
    if (!video || !sound) throw new Error('The show could not be recorded.');
    // The window closing (or its page crashing — or, on the web, the sharing being
    // stopped) ends the tracks.
    video.addEventListener('ended', () => fail(new Error(host.scaled
      ? 'The sharing of this tab was stopped before the show ended.'
      : 'The export window closed before the show ended.')));
    const audioCfg = { numberOfChannels: sound.getSettings().channelCount || 2, sampleRate: sound.getSettings().sampleRate || 48000 };
    const mp4 = await canEncodeVideo('avc', { width, height, frameRate: 30 }) && await canEncodeAudio('aac', audioCfg);

    const path = videoBaseOf(job.deckPath) + (mp4 ? '.mp4' : '.webm');
    opening = openVideoFile(path);
    const out = file = await race(opening);
    output = new Output({
      format: mp4 ? new Mp4OutputFormat({ fastStart: false }) : new WebMOutputFormat(),
      target: new StreamTarget(new WritableStream<StreamTargetChunk>({
        write: (chunk) => out.write(chunk.position, chunk.data),
      }), { chunked: true, chunkSize: 8 << 20 }),
    });
    // frameRate: a still slide sends no new frames — the last one is repeated so the
    // video keeps a steady 30 fps. A cropped tab's frames are as large as the show
    // is on the screen: scaled to the video's size.
    const pictures = new MediaStreamVideoTrackSource(video, {
      codec: mp4 ? 'avc' : 'vp9', quality: QUALITY_HIGH, keyFrameInterval: 2, sizeChangeBehavior: 'contain',
      ...(host.scaled ? { transform: { width, height, fit: 'contain' as const } } : {}),
    }, { frameRate: 30 });
    const voice = new MediaStreamAudioTrackSource(sound, { codec: mp4 ? 'aac' : 'opus', quality: QUALITY_HIGH });
    pictures.errorPromise.catch((e) => fail(e instanceof Error ? e : new Error(String(e))));
    voice.errorPromise.catch((e) => fail(e instanceof Error ? e : new Error(String(e))));
    output.addVideoTrack(pictures, { frameRate: 30 });
    output.addAudioTrack(voice);
    await race(output.start());
    recStart = performance.now();
    ticker = window.setInterval(() => {
      if (items.total) progress({ stage: 'record', done: items.done, total: items.total, seconds: now() });
    }, 1000);

    await race(sleep(LEAD_MS));
    channel.postMessage({ type: 'go' } satisfies ShowExportMessage);
    await race(finishedP);
    await race(sleep(TAIL_MS));
    const seconds = now();
    window.clearInterval(ticker);
    progress({ stage: 'finish', done: items.total, total: items.total, seconds });
    await race(output.finalize());
    await out.close(true);
    committed = true;
    let vttPath: string | undefined;
    if (job.options.vtt) {
      vttPath = `${videoBaseOf(job.deckPath)}.vtt`;
      await apiClient.saveFile(vttPath, toVtt(cues));
    }
    return { path, vttPath, seconds };
  } catch (e) {
    if (output) await output.cancel().catch(() => { /* not started / torn down */ });
    if (file && !committed) await file.close(false).catch(() => { /* ignore */ });
    // The job ended while the file was being opened: close it when it is.
    else if (!file && opening) void opening.then((f) => f.close(false), () => { /* never opened */ }).catch(() => { /* ignore */ });
    throw signal.aborted ? aborted() : e;
  } finally {
    window.clearInterval(ticker);
    signal.removeEventListener('abort', onAbort);
    tracks.forEach((t) => t.stop());
    channel.close();
    await host.close();
  }
}
