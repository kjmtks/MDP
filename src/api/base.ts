// Where the web app is mounted: '' at the domain root (all deployments to
// date, plus dev), '/mdp' when built with VITE_BASE=/mdp/ for a
// path-prefixed deployment behind a reverse proxy.
//
// Electron builds keep base './' so WEB_BASE is '' there — every URL string
// derived from it is byte-identical to the pre-prefix code, which is what
// keeps the desktop app out of harm's way.
export const WEB_BASE: string = (() => {
  const b: string = import.meta.env.BASE_URL || './';
  return b.startsWith('/') ? b.replace(/\/+$/, '') : '';
})();

// The `/files/` prefix used for workspace media in web mode. (Electron uses
// mdp-file:// URLs instead and never reads this.)
export const FILES_PREFIX = `${WEB_BASE}/files/`;

// Whether the server runs the shared multi-user deployment. Fetched once;
// callers get `false` until the answer arrives (features appear rather than
// flicker away). Electron never asks (it has no shared server).
let shared = false;
let asked = false;
export const isSharedMode = (): boolean => shared;
export const askSharedMode = async (): Promise<boolean> => {
  if (asked) return shared;
  asked = true;
  try {
    const res = await fetch(`${WEB_BASE}/api/server-info`);
    if (res.ok) shared = !!(await res.json()).sharedMode;
  } catch { /* keep false */ }
  return shared;
};
