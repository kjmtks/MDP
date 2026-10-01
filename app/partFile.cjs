// The `.part` file a video export streams into, renamed into place when the
// export is done — shared by the web server (server.cjs, /api/stream/*) and the
// desktop app (app/main.cjs, streamFile* IPC).
//
// Opened EXCLUSIVELY. Two exports of the same video — two people, two tabs, or
// the web server and the desktop app on one folder — would otherwise both write
// into one part file (opening it truncates the other's bytes) and commit a corrupt
// video. A part file still being written is refused; "being written" = touched
// within STALE_MS (every chunk written touches it, and the web server touches it
// on each keep-alive of its client). One left behind by an export that died is
// replaced.
const fs = require('fs');
const path = require('path');

const STALE_MS = 3 * 60 * 1000;

function busyError() {
  const e = new Error('This video is being written by another export right now — wait for it to finish.');
  e.code = 'EXPORT_BUSY';
  return e;
}

/** Open `<abs>.part` for writing → { part, fh }. Rejects with code 'EXPORT_BUSY'
 *  while another export writes it. */
async function openPartFile(abs, staleMs = STALE_MS) {
  const part = `${abs}.part`;
  await fs.promises.mkdir(path.dirname(part), { recursive: true });
  try {
    return { part, fh: await fs.promises.open(part, 'wx') };
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
  const st = await fs.promises.stat(part).catch(() => null);
  if (st && Date.now() - st.mtimeMs < staleMs) throw busyError();
  // Abandoned: start over. (Another export may get here at the same moment, or —
  // on Windows — the file may still be held open: then it is busy after all.)
  await fs.promises.rm(part, { force: true }).catch(() => {});
  try {
    return { part, fh: await fs.promises.open(part, 'wx') };
  } catch (e) {
    if (e.code === 'EEXIST' || e.code === 'EPERM' || e.code === 'EBUSY' || e.code === 'EACCES') throw busyError();
    throw e;
  }
}

/** Mark an open part file as still being written. */
async function touchPartFile(fh) {
  const now = new Date();
  await fh.utimes(now, now);
}

module.exports = { openPartFile, touchPartFile, STALE_MS };
