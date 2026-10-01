// The exact video export in the web build. The desktop app plays the show in a
// hidden window of its own and records it as a tab; a web page can open no such
// window, so the show plays HERE — in an iframe over this page (ShowExportPage: its
// own document, so the job's theme, modules and fonts stay out of the editor) —
// and is recorded through "share this tab" (getDisplayMedia), cropped to the iframe
// (Region Capture). The browser asks for the share on a click, so it is asked when
// the job is queued (shareThisTab). Chromium only (Chrome, Edge): the others cannot
// share a tab with its sound, or crop it.
import type { VideoProgress } from './videoTypes';

const BAR = 44;   // the status bar above the show — outside the recorded region

// The show's box: the slide's aspect, as large as the window allows below the bar.
function frameSize(slide: { width: number; height: number }): { width: number; height: number } {
  const s = Math.min(window.innerWidth / slide.width, (window.innerHeight - BAR) / slide.height);
  return { width: Math.max(2, Math.floor(slide.width * s)), height: Math.max(2, Math.floor(slide.height * s)) };
}

/** Ask to share this tab, picture and sound. Call it straight from the click — the
 *  browser wants one. `outHeight` = the video's frame height: a tab rendered finer
 *  than the screen (where the browser offers that) gives a sharper picture. */
export function shareThisTab(slide: { width: number; height: number }, outHeight: number): Promise<MediaStream> {
  const f = Math.max(1, outHeight / frameSize(slide).height);
  const options = {
    video: {
      width: { ideal: Math.min(3840, Math.round(window.innerWidth * f)) },
      height: { ideal: Math.min(2160, Math.round(window.innerHeight * f)) },
      frameRate: { ideal: 30, max: 30 },
    },
    // The show plays silently here; the recording still hears it.
    audio: { suppressLocalAudioPlayback: true, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude',
    systemAudio: 'exclude', monitorTypeSurfaces: 'exclude',
  };
  return navigator.mediaDevices.getDisplayMedia(options as DisplayMediaStreamOptions);
}

export interface WebShow {
  /** Crop the shared tab to the show. */
  cropTo: (track: MediaStreamTrack) => Promise<void>;
  status: (p: VideoProgress) => void;
  close: () => void;
}

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

/** Put the show (`#/show-export?job=…`) up over this page. */
export function openWebShow(jobId: string, slide: { width: number; height: number }, onCancel: () => void): WebShow {
  const root = document.createElement('div');
  Object.assign(root.style, {
    position: 'fixed', inset: '0', zIndex: '2147483000', background: '#000', display: 'flex', flexDirection: 'column',
    font: '13px/1.4 system-ui, sans-serif', color: '#d8dbe2',
  });
  const bar = document.createElement('div');
  Object.assign(bar.style, { height: `${BAR}px`, flex: `0 0 ${BAR}px`, display: 'flex', alignItems: 'center', gap: '12px', padding: '0 14px', boxSizing: 'border-box' });
  const dot = document.createElement('span');
  Object.assign(dot.style, { width: '10px', height: '10px', borderRadius: '50%', background: '#e5484d', flex: '0 0 auto' });
  const text = document.createElement('span');
  text.textContent = 'Preparing the narrated video…';
  Object.assign(text.style, { flex: '1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  Object.assign(cancel.style, {
    padding: '5px 14px', borderRadius: '6px', border: '1px solid #4a4e58', background: '#1f2228', color: '#e8e8ea', cursor: 'pointer',
  });
  cancel.addEventListener('click', onCancel);
  bar.append(dot, text, cancel);

  const stage = document.createElement('div');
  Object.assign(stage.style, { flex: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' });
  const frame = document.createElement('iframe');
  frame.title = 'Narrated video';
  frame.allow = 'autoplay';
  frame.src = `${window.location.pathname}#/show-export?job=${encodeURIComponent(jobId)}`;
  Object.assign(frame.style, { border: '0', display: 'block', background: '#000' });
  const fit = () => {
    const { width, height } = frameSize(slide);
    frame.style.width = `${width}px`;
    frame.style.height = `${height}px`;
  };
  fit();
  stage.append(frame);
  root.append(bar, stage);
  document.body.append(root);
  window.addEventListener('resize', fit);
  // No key reaches the editor underneath while the show plays (its shortcuts would
  // act on a page nobody sees); Esc cancels.
  const swallow = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') onCancel();
  };
  window.addEventListener('keydown', swallow, true);
  cancel.focus();

  return {
    cropTo: async (track) => {
      const CT = (window as unknown as { CropTarget: { fromElement: (el: Element) => Promise<unknown> } }).CropTarget;
      const target = await CT.fromElement(frame);
      await (track as MediaStreamTrack & { cropTo: (t: unknown) => Promise<void> }).cropTo(target);
    },
    status: (p) => {
      text.textContent = p.stage === 'prepare'
        ? (p.total ? `Synthesizing the narration ${p.done}/${p.total}…` : 'Preparing the narrated video…')
        : p.stage === 'record'
          ? `Recording the narrated video · line ${p.done}/${p.total} · ${clock(p.seconds)} — keep this tab open`
          : 'Finishing the video…';
    },
    close: () => {
      window.removeEventListener('resize', fit);
      window.removeEventListener('keydown', swallow, true);
      root.remove();
    },
  };
}
