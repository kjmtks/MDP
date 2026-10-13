// The video file — beside its deck, or (desktop) where the user chose in the save
// dialog — written in pieces as the encoder produces them: through the desktop
// app's IPC (streamFileOpen / Write / Close, app/main.cjs) or the web server's
// /api/stream/* (server.cjs — only for the users its administrator allows video
// export). Either way the bytes go to `<name>.part`, and close() commits it under
// the real name or deletes it.
import { apiClient, isElectron } from '../../api/apiClient';
import { WEB_BASE } from '../../api/base';

interface Bridge {
  streamFileOpen: (relPath: string) => Promise<string>;
  streamFileWrite: (r: { id: string; position: number; data: Uint8Array }) => Promise<boolean>;
  streamFileClose: (r: { id: string; commit: boolean }) => Promise<boolean>;
  videoTargetOf: (deckRel: string) => Promise<{ local: boolean }>;
  videoSaveDialog: (r: { name: string; folder?: string }) => Promise<string | null>;
  videoFileOpen: (r: { file: string; reveal?: boolean }) => Promise<boolean>;
}
const bridge = (): Partial<Bridge> | undefined => (window as unknown as { electronAPI?: Partial<Bridge> }).electronAPI;

/** Can a video go beside this deck? Not when its folder is reached through an SSH
 *  link (desktop) — then it must be saved elsewhere (pickVideoFile). */
export async function besideDeckPossible(deckPath: string): Promise<boolean> {
  const api = bridge();
  if (!isElectron() || !api?.videoTargetOf) return true;
  try { return (await api.videoTargetOf(deckPath)).local; } catch { return true; }
}

/** Desktop: where to save a video — the system's save dialog, opened in `folder`
 *  (else the Videos folder). The absolute .mp4 path, or null when cancelled. */
export async function pickVideoFile(name: string, folder?: string): Promise<string | null> {
  const api = bridge();
  if (!api?.videoSaveDialog) return null;
  return api.videoSaveDialog({ name, folder });
}

/** Desktop: play a video saved outside the workspace, or show it in its folder. */
export async function openSavedVideo(file: string, reveal = false): Promise<void> {
  await bridge()?.videoFileOpen?.({ file, reveal });
}

/** Is this a path outside the workspace (picked in the save dialog)? */
export const isOutsidePath = (p: string): boolean => /^([A-Za-z]:[\\/]|\/|\\\\)/.test(p);

/** The subtitles (.vtt) beside the video: in the workspace through its own file API
 *  (as always — the web server's stream takes only videos); where the user saved the
 *  video, written like the video (the save dialog allowed that name's .vtt too). */
export async function writeVideoText(path: string, text: string): Promise<void> {
  if (!isOutsidePath(path)) { await apiClient.saveFile(path, text); return; }
  const file = await openVideoFile(path);
  try {
    await file.write(0, new TextEncoder().encode(text));
  } catch (e) {
    await file.close(false).catch(() => { /* already gone */ });
    throw e;
  }
  await file.close(true);
}

export interface VideoFile {
  /** `data` at byte `position` (the MP4 muxer comes back to patch earlier bytes). */
  write: (position: number, data: Uint8Array) => Promise<void>;
  /** Commit (rename to the real name) or drop the part file. */
  close: (commit: boolean) => Promise<void>;
}

// The web server drops a stream it has not heard from for 3 minutes (its tab is
// gone). The encoder may write nothing for longer — the fast mode holds 8 MiB
// (minutes of video) before its first write, and the narration it waits for may
// queue on a shared TTS server — so an open file tells the server it is alive.
const KEEPALIVE_MS = 30_000;

// The server says why in `{ error }` (not allowed here, too large, read-only…).
async function refusal(res: Response): Promise<Error> {
  let why = '';
  try { why = String((await res.json()).error || ''); } catch { /* not JSON */ }
  return new Error(why || `The server did not accept the video file (HTTP ${res.status}).`);
}

export async function openVideoFile(relPath: string): Promise<VideoFile> {
  if (isElectron()) {
    const api = bridge();
    if (!api?.streamFileOpen || !api.streamFileWrite || !api.streamFileClose) throw new Error('Video export needs the desktop app.');
    const id = await api.streamFileOpen(relPath);
    return {
      write: async (position, data) => { await api.streamFileWrite!({ id, position, data }); },
      close: async (commit) => { await api.streamFileClose!({ id, commit }); },
    };
  }
  const json = { 'Content-Type': 'application/json' };
  const res = await fetch(`${WEB_BASE}/api/stream/open`, { method: 'POST', headers: json, body: JSON.stringify({ path: relPath }) });
  if (!res.ok) throw await refusal(res);
  const url = `${WEB_BASE}/api/stream/${encodeURIComponent(String((await res.json()).id))}`;
  const keepAlive = window.setInterval(() => {
    void fetch(`${url}/touch`, { method: 'POST' }).catch(() => { /* the next write reports a lost stream */ });
  }, KEEPALIVE_MS);
  return {
    write: async (position, data) => {
      const r = await fetch(`${url}?pos=${position}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: data as BufferSource,
      });
      if (!r.ok) throw await refusal(r);
    },
    close: async (commit) => {
      window.clearInterval(keepAlive);
      const r = await fetch(`${url}/close`, { method: 'POST', headers: json, body: JSON.stringify({ commit }) });
      if (!r.ok && commit) throw await refusal(r);
    },
  };
}
