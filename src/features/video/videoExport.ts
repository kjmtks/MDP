// Narrated video export: the deck as the narrated auto-play would show it,
// rendered OFFLINE — no slideshow runs, nothing plays aloud. The voice comes from
// the TTS (VOICEVOX / a TTS server — Web Speech gives no audio data), each picture
// from the capture window (the slide at its build step, subtitle baked in; in the
// web build a hidden capture iframe, webCapture.ts), and the browser's own encoders
// (WebCodecs, through mediabunny) make an MP4 (H.264 + AAC; WebM with VP9 + Opus
// where those are missing), streamed into a file next to the deck (videoFiles.ts).
import {
  AudioBufferSource, CanvasSource, Mp4OutputFormat, Output, QUALITY_HIGH, StreamTarget, WebMOutputFormat,
  canEncodeAudio, canEncodeVideo, type StreamTargetChunk,
} from 'mediabunny';
import { apiClient, isElectron } from '../../api/apiClient';
import { synthesizeAudio } from '../tts/ttsService';
import type { CaptureSlideData } from '../remote/capture/captureTypes';
import {
  FADE_FRAMES, FPS, SAMPLE_RATE, SAMPLES_PER_FRAME, planSegments, toWebVtt, withSpeech, type VideoSegment,
} from './videoPlan';
import { videoBaseOf, type VideoJobInput, type VideoProgress, type VideoResult } from './videoTypes';
import { openVideoFile, type VideoFile } from './videoFiles';
import { openWebCapturer } from './webCapture';

const bridge = () => (window as unknown as { electronAPI?: { captureSlide?: (d: object) => Promise<Uint8Array> } }).electronAPI;

const aborted = () => new DOMException('The video export was cancelled.', 'AbortError');
function checkAbort(signal: AbortSignal) { if (signal.aborted) throw aborted(); }

async function chooseCodecs(width: number, height: number) {
  const audio = { numberOfChannels: 1, sampleRate: SAMPLE_RATE };
  const video = { width, height, frameRate: FPS };
  if (await canEncodeVideo('avc', video) && await canEncodeAudio('aac', audio)) {
    return { mp4: true, video: 'avc', audio: 'aac', ext: '.mp4' } as const;
  }
  if (await canEncodeVideo('vp9', video) && await canEncodeAudio('opus', audio)) {
    return { mp4: false, video: 'vp9', audio: 'opus', ext: '.webm' } as const;
  }
  throw new Error('This computer offers no video encoder (neither H.264 + AAC nor VP9 + Opus).');
}

// The capture window's ids of other callers start at 1; frames take their own range.
let frameSeq = 1_000_000_000;

const frameData = (job: VideoJobInput, seg: VideoSegment, width: number, height: number): CaptureSlideData => {
  const s = job.slides[seg.slideIdx];
  return {
    id: ++frameSeq,
    html: s.html, className: s.className, header: s.header, footer: s.footer,
    basePath: job.basePath, themeCssUrl: job.themeCssUrl, moduleCss: job.moduleCss, fontCss: job.fontCss,
    width: job.slideSize.width, height: job.slideSize.height,
    buildStep: seg.buildStep, pageNumber: s.pageNumber ?? seg.slideIdx + 1,
    caption: job.options.subtitles ? seg.caption : '',
    outWidth: width, outHeight: height,
  };
};

// Where the pictures come from: the desktop app's capture window (PNG bytes), or
// the web build's capture iframe (an ImageBitmap).
interface Capturer { capture: (d: CaptureSlideData) => Promise<ImageBitmap>; close: () => void }
async function openCapturer(job: VideoJobInput, signal: AbortSignal): Promise<Capturer> {
  if (!isElectron()) return openWebCapturer(job.slideSize.width, job.slideSize.height, signal);
  const captureSlide = bridge()?.captureSlide;
  if (!captureSlide) throw new Error('Video export needs the desktop app.');
  return {
    capture: async (d) => createImageBitmap(new Blob([await captureSlide(d) as BlobPart], { type: 'image/png' })),
    close: () => { /* the capture window is the app's */ },
  };
}

// The narration (WAV, or the MP3 a server may send) as mono 48 kHz — decodeAudioData
// reads either and resamples to the context's rate.
async function decodeVoice(wav: Uint8Array): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(1, 1, SAMPLE_RATE);
  const buf = await ctx.decodeAudioData(wav.slice().buffer);
  if (buf.numberOfChannels === 1) return buf;
  const mono = new AudioBuffer({ length: buf.length, numberOfChannels: 1, sampleRate: SAMPLE_RATE });
  const out = mono.getChannelData(0);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) out[i] += d[i] / buf.numberOfChannels;
  }
  return mono;
}
const silence = (samples: number) => new AudioBuffer({ length: samples, numberOfChannels: 1, sampleRate: SAMPLE_RATE });

/** Render one job. `onProgress` after every stretch; `signal` cancels (the TTS
 *  request in flight is dropped and the half-written file deleted). */
export async function exportVideo(
  job: VideoJobInput, onProgress: (p: VideoProgress) => void, signal: AbortSignal,
): Promise<VideoResult> {
  onProgress({ stage: 'prepare', done: 0, total: 0, seconds: 0 });
  const height = job.options.height;
  const width = Math.round((height * job.slideSize.width) / job.slideSize.height / 2) * 2;   // H.264 wants even sizes
  const codecs = await chooseCodecs(width, height);
  const segments = planSegments(job.slides, job.cpm, {
    includeHidden: job.options.includeHidden, fade: job.options.fade, globalTransition: job.globalTransition,
  });
  if (!segments.length) throw new Error('The deck has no slide to show.');
  checkAbort(signal);

  const path = videoBaseOf(job.deckPath) + codecs.ext;
  const capturer = await openCapturer(job, signal);
  let file: VideoFile;
  try { file = await openVideoFile(path); } catch (e) { capturer.close(); throw e; }
  let committed = false;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d')!;
  const output = new Output({
    format: codecs.mp4 ? new Mp4OutputFormat({ fastStart: false }) : new WebMOutputFormat(),
    target: new StreamTarget(new WritableStream<StreamTargetChunk>({
      write: (chunk) => file.write(chunk.position, chunk.data),
    }), { chunked: true, chunkSize: 8 << 20 }),
  });
  const video = new CanvasSource(canvas, { codec: codecs.video, quality: QUALITY_HIGH, keyFrameInterval: 5 });
  const audio = new AudioBufferSource({ codec: codecs.audio, quality: QUALITY_HIGH });
  output.addVideoTrack(video, { frameRate: FPS });
  output.addAudioTrack(audio);

  // The next stretch's voice is synthesized while this one's picture renders.
  const voices = new Map<number, Promise<AudioBuffer>>();
  const prefetch = (i: number) => {
    const seg = segments[i];
    if (!seg?.speech || voices.has(i)) return;
    const p = synthesizeAudio(seg.speech, job.tts, signal).then(decodeVoice);
    p.catch(() => { /* awaited (or abandoned on cancel) below */ });
    voices.set(i, p);
  };

  let prev: ImageBitmap | null = null;
  let prevKey = '';
  try {
    await output.start();
    let frame = 0;
    for (let i = 0; i < segments.length; i++) {
      checkAbort(signal);
      prefetch(i);
      prefetch(i + 1);
      let seg = segments[i];
      let voice: AudioBuffer | null = null;
      if (seg.speech) {
        voice = await voices.get(i)!;
        voices.delete(i);
        seg = segments[i] = withSpeech(seg, voice.length);
      }
      checkAbort(signal);

      // ---- picture: the same slide/step/subtitle is captured once
      const key = `${seg.slideIdx}|${seg.buildStep}|${job.options.subtitles ? seg.caption : ''}`;
      const changed: boolean = key !== prevKey || !prev;
      const pic: ImageBitmap = changed ? await capturer.capture(frameData(job, seg, width, height)) : prev!;
      const add = (at: number, n: number, keyFrame: boolean) => video.add(at / FPS, n / FPS, keyFrame ? { keyFrame: true } : undefined);
      let at = frame;
      let left = seg.frames;
      if (changed && seg.fade && prev) {
        const n = Math.min(FADE_FRAMES, left);
        for (let k = 1; k <= n; k++) {
          g.globalAlpha = 1;
          g.drawImage(prev, 0, 0, width, height);
          g.globalAlpha = k / n;
          g.drawImage(pic, 0, 0, width, height);
          await add(at, 1, k === 1);
          at += 1;
          left -= 1;
        }
      }
      // Hold: one encoded frame a second (a still costs almost nothing to encode).
      g.globalAlpha = 1;
      g.drawImage(pic, 0, 0, width, height);
      let firstHold = changed && !(seg.fade && prev);
      while (left > 0) {
        const n = Math.min(FPS, left);
        await add(at, n, firstHold);
        firstHold = false;
        at += n;
        left -= n;
      }
      if (changed) {
        prev?.close();
        prev = pic;
        prevKey = key;
      }

      // ---- sound: lead-in, the words, then silence to the stretch's last frame
      const samples = seg.frames * SAMPLES_PER_FRAME;
      if (voice) {
        const lead = seg.leadFrames * SAMPLES_PER_FRAME;
        if (lead > 0) await audio.add(silence(lead));
        await audio.add(voice);
        const rest = samples - lead - voice.length;
        if (rest > 0) await audio.add(silence(rest));
      } else {
        await audio.add(silence(samples));
      }

      frame += seg.frames;
      onProgress({ stage: 'render', done: i + 1, total: segments.length, seconds: frame / FPS });
    }

    onProgress({ stage: 'finish', done: segments.length, total: segments.length, seconds: frame / FPS });
    await output.finalize();
    await file.close(true);
    committed = true;
    let vttPath: string | undefined;
    if (job.options.vtt) {
      vttPath = `${videoBaseOf(job.deckPath)}.vtt`;
      await apiClient.saveFile(vttPath, toWebVtt(segments));
    }
    return { path, vttPath, seconds: frame / FPS };
  } catch (e) {
    await output.cancel().catch(() => { /* already torn down */ });
    if (!committed) await file.close(false).catch(() => { /* ignore */ });
    throw signal.aborted ? aborted() : e;
  } finally {
    prev?.close();
    capturer.close();
  }
}
