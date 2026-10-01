// Records a LIVE presentation — the window the audience sees (the output window
// when one is open, otherwise the main window's slideshow) plus the microphone —
// into an MP4 beside the deck. Pen strokes, the laser pointer, transitions and
// embedded videos are all in the picture, because that window's page is recorded
// (as a tab: no window frame, re-rendered sharp at the video's size, and still
// recording while the window is covered or minimised). The browser's encoders
// (WebCodecs, through mediabunny) encode it live and the file is streamed to disk
// as it grows (streamFile* IPC), so an hour-long talk never sits in memory.
// Desktop app only. A module-level store: the presenter view drives it remotely.
// The encoder library is loaded when a recording starts (not with the editor).
import type { Output, StreamTargetChunk } from 'mediabunny';
import { videoBaseOf } from '../video/videoTypes';

export type RecordingStatus = 'idle' | 'starting' | 'recording' | 'stopping';

export interface RecordingState {
  status: RecordingStatus;
  seconds: number;              // length so far (recording) / of the last recording (idle)
  source: 'output' | 'main' | '';
  lastPath: string;             // the recording saved last ('' = none yet)
  error: string;                // why the last start or stop failed ('' = fine)
}

interface Bridge {
  getSlideWindowSource: () => Promise<{ id: string; which: 'output' | 'main'; width: number; height: number }>;
  streamFileOpen: (relPath: string) => Promise<string>;
  streamFileWrite: (r: { id: string; position: number; data: Uint8Array }) => Promise<boolean>;
  streamFileClose: (r: { id: string; commit: boolean }) => Promise<boolean>;
}
const bridge = (): Partial<Bridge> | undefined => (window as unknown as { electronAPI?: Partial<Bridge> }).electronAPI;

/** Can this app record (desktop app with window capture)? */
export const recordingSupported = (): boolean => typeof bridge()?.getSlideWindowSource === 'function';

let state: RecordingState = { status: 'idle', seconds: 0, source: '', lastPath: '', error: '' };
const listeners = new Set<() => void>();
const set = (p: Partial<RecordingState>) => {
  state = { ...state, ...p };
  listeners.forEach((l) => { try { l(); } catch { /* keep notifying */ } });
};
export const getRecordingState = (): RecordingState => state;
export function subscribeRecording(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

let saved: ((path: string) => void) | null = null;
/** Called with the file's path once a recording is saved (e.g. to refresh the tree). */
export function onRecordingSaved(fn: ((path: string) => void) | null): void { saved = fn; }

// ---- the microphone, remembered per computer ------------------------------------
const MIC_KEY = 'mdp.recording.mic';
export function preferredMic(): string {
  try { return localStorage.getItem(MIC_KEY) || ''; } catch { return ''; }
}
export function setPreferredMic(deviceId: string): void {
  try { localStorage.setItem(MIC_KEY, deviceId); } catch { /* not remembered */ }
}
export async function listMicrophones(): Promise<Array<{ deviceId: string; label: string }>> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications')
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
}

// ---- recording --------------------------------------------------------------------
interface Session {
  output: Output;
  fileId: string;
  path: string;
  tracks: MediaStreamTrack[];
  startedAt: number;
  timer: number;
}
let session: Session | null = null;

const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};
// The video's size: the page's shape within 1920×1080 (even numbers, for the
// encoder). The page is re-rendered at this size, so a small window still gives
// sharp text; a window resized later is letterboxed into it.
const frameFor = (w: number, h: number) => {
  if (!(w > 0 && h > 0)) return { width: 1920, height: 1080 };
  const k = Math.min(1920 / w, 1080 / h);
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  const size = { width: even(w * k), height: even(h * k) };
  // A 16:9 window a pixel off (whole pixels rarely make exactly 16:9) → plain 1080p.
  return 1920 - size.width <= 4 && 1080 - size.height <= 4 ? { width: 1920, height: 1080 } : size;
};
const messageOf = (e: unknown) => {
  const name = (e as { name?: string })?.name;
  if (name === 'NotAllowedError') return 'The screen or the microphone may not be recorded (permission denied).';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'The chosen microphone is not connected.';
  return e instanceof Error ? e.message : String(e);
};

/** Start recording the audience window and the microphone (`micId` '' = the
 *  system's default) into `<deck>-rec-<date>-<time>.mp4` beside the deck.
 *  `mainShowsSlides`: the main window is in its slideshow — without an output
 *  window that is the only picture worth recording (never the editor). */
export async function startRecording(deckPath: string, micId = '', mainShowsSlides = true): Promise<void> {
  if (state.status !== 'idle') return;
  const api = bridge();
  if (!api?.getSlideWindowSource || !api.streamFileOpen || !api.streamFileWrite || !api.streamFileClose) {
    set({ error: 'Recording needs the desktop app.' });
    return;
  }
  set({ status: 'starting', error: '', seconds: 0 });
  const tracks: MediaStreamTrack[] = [];
  let fileId = '';
  let output: Output | null = null;
  try {
    const {
      MediaStreamAudioTrackSource, MediaStreamVideoTrackSource, Mp4OutputFormat, Output, QUALITY_HIGH, QUALITY_MEDIUM,
      StreamTarget, WebMOutputFormat, canEncodeAudio, canEncodeVideo,
    } = await import('mediabunny');
    const src = await api.getSlideWindowSource();
    if (src.which === 'main' && !mainShowsSlides) throw new Error('Start the slideshow or open the output window first — there is nothing to record yet.');
    const size = frameFor(src.width, src.height);
    const screen = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { mandatory: {
        chromeMediaSource: 'tab', chromeMediaSourceId: src.id, maxFrameRate: 30,
        minWidth: size.width, maxWidth: size.width, minHeight: size.height, maxHeight: size.height,
      } },
    } as unknown as MediaStreamConstraints);
    tracks.push(...screen.getTracks());
    // A recording, not a call: no echo cancellation (it would take out what the room
    // hears from the laptop, e.g. a video on a slide, and colour the voice); noise
    // suppression and level control stay on, for laptop microphones.
    const mic = await navigator.mediaDevices.getUserMedia({
      audio: { ...(micId ? { deviceId: { exact: micId } } : {}), echoCancellation: false }, video: false,
    });
    tracks.push(...mic.getTracks());
    const video = screen.getVideoTracks()[0];
    const voice = mic.getAudioTracks()[0];
    const { width = size.width, height = size.height } = video.getSettings();
    const audioOk = { numberOfChannels: voice.getSettings().channelCount || 1, sampleRate: voice.getSettings().sampleRate || 48000 };
    const mp4 = await canEncodeVideo('avc', { width, height, frameRate: 30 }) && await canEncodeAudio('aac', audioOk);

    const path = `${videoBaseOf(deckPath)}-rec-${stamp()}${mp4 ? '.mp4' : '.webm'}`;
    fileId = await api.streamFileOpen(path);
    const id = fileId;
    output = new Output({
      format: mp4 ? new Mp4OutputFormat({ fastStart: false }) : new WebMOutputFormat(),
      target: new StreamTarget(new WritableStream<StreamTargetChunk>({
        write: async (chunk) => { await api.streamFileWrite!({ id, position: chunk.position, data: chunk.data }); },
      }), { chunked: true, chunkSize: 4 << 20 }),
    });
    // One size per file: should a frame ever arrive at another size, it is
    // letterboxed into the first one. frameRate: a still slide sends no new frames,
    // so the last one is repeated to keep the video at a steady 30 fps.
    const pictures = new MediaStreamVideoTrackSource(video, {
      codec: mp4 ? 'avc' : 'vp9', quality: QUALITY_MEDIUM, keyFrameInterval: 2, sizeChangeBehavior: 'contain',
    }, { frameRate: 30 });
    const sound = new MediaStreamAudioTrackSource(voice, { codec: mp4 ? 'aac' : 'opus', quality: QUALITY_HIGH });
    output.addVideoTrack(pictures, { frameRate: 30 });
    output.addAudioTrack(sound);
    // An encoder that fails stops the recording (what was recorded is kept) — also
    // when it fails while the start is still finishing.
    let failure: unknown = null;
    const failed = (e: unknown) => {
      failure ??= e;
      if (session?.fileId === id) void stopRecording(messageOf(e));
    };
    pictures.errorPromise.catch(failed);
    sound.errorPromise.catch(failed);
    await output.start();

    const startedAt = Date.now();
    const timer = window.setInterval(() => set({ seconds: Math.floor((Date.now() - startedAt) / 1000) }), 500);
    session = { output, fileId, path, tracks, startedAt, timer };
    // The recorded window closed → the recording ends and is kept.
    video.addEventListener('ended', () => { if (session?.fileId === id) void stopRecording(); });
    set({ status: 'recording', source: src.which });
    if (failure) void stopRecording(messageOf(failure));
  } catch (e) {
    tracks.forEach((t) => t.stop());
    if (output) await output.cancel().catch(() => { /* not started */ });
    if (fileId) await api.streamFileClose({ id: fileId, commit: false }).catch(() => { /* ignore */ });
    set({ status: 'idle', error: messageOf(e) });
  }
}

/** Stop and keep the recording. With `reason`, it stopped by itself (an encoder
 *  failed): what was recorded so far is still kept, and the reason reported. */
export async function stopRecording(reason = ''): Promise<void> {
  const s = session;
  if (!s || state.status !== 'recording') return;
  session = null;
  window.clearInterval(s.timer);
  const seconds = Math.floor((Date.now() - s.startedAt) / 1000);
  set({ status: 'stopping', seconds });
  const api = bridge()!;
  try {
    await s.output.finalize();
    await api.streamFileClose!({ id: s.fileId, commit: true });
    set({ status: 'idle', lastPath: s.path, error: reason });
    try { saved?.(s.path); } catch { /* a listener's problem */ }
  } catch (e) {
    await s.output.cancel().catch(() => { /* already torn down */ });
    await api.streamFileClose!({ id: s.fileId, commit: false }).catch(() => { /* ignore */ });
    set({ status: 'idle', error: `The recording could not be saved: ${messageOf(e)}` });
  } finally {
    s.tracks.forEach((t) => t.stop());
  }
}
