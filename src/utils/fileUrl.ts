import { WEB_BASE } from '../api/base';
import { isElectron } from '../api/apiClient';

// Path-style slide URLs: /mdp/homes/kojima/deck.slide.md instead of
// /mdp/?file=%40homes%2Fkojima%2Fdeck.slide.md.
//
// Only deployments built with an ABSOLUTE base (VITE_BASE=/mdp/ or /) can use
// them — a relative base ('./', the Electron and standalone-LAN default)
// resolves asset URLs against the current path, so a deep pathname would break
// every script/css reference. Those builds keep the query form, byte-identical
// to the old behavior.
const PATH_URLS: boolean = (() => {
  try { return String(import.meta.env.BASE_URL || './').startsWith('/') && !isElectron(); }
  catch { return false; }
})();

// The '@' of a virtual space ('@homes/…') is dropped in the URL for
// readability; reading tries the raw path first, then '@'+path (see
// filePathCandidatesFromLocation).
const pathToUrl = (filePath: string): string =>
  filePath.replace(/^@/, '').split('/').map(encodeURIComponent).join('/');

// Non-file query params (e.g. ?url= import) survive the rewrite.
const restQuery = (): string => {
  const params = new URLSearchParams(window.location.search);
  params.delete('file');
  const qs = params.toString();
  return qs ? `?${qs}` : '';
};

// History URL that shows `filePath` as the open file.
export const urlForFile = (filePath: string): string => {
  if (!PATH_URLS) {
    const params = new URLSearchParams(window.location.search);
    params.set('file', filePath);
    return `${window.location.pathname}?${params.toString()}`;
  }
  return `${WEB_BASE}/${pathToUrl(filePath)}${restQuery()}`;
};

// History URL for "no file open".
export const urlForNoFile = (): string => {
  if (!PATH_URLS) return window.location.pathname;
  return `${WEB_BASE}/${restQuery()}`;
};

// SPA routes that live under the same prefix and are never file paths.
const RESERVED_ROUTES = new Set(['presenter', 'remote', 'settings', 'capture']);

// Workspace-path candidates encoded in the current location, most specific
// first. `?file=` (legacy links, Electron) wins; else the pathname beyond
// WEB_BASE, tried raw and with a restored '@' space prefix. The caller matches
// candidates against the actual file tree, so a reserved route or a bogus path
// simply never matches.
export const filePathCandidatesFromLocation = (): string[] => {
  const q = new URLSearchParams(window.location.search).get('file');
  if (q) return [q];
  if (!PATH_URLS) return [];
  let rest = window.location.pathname;
  if (WEB_BASE && rest.startsWith(WEB_BASE)) rest = rest.slice(WEB_BASE.length);
  rest = rest.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!rest) return [];
  let decoded: string;
  try { decoded = rest.split('/').map(decodeURIComponent).join('/'); } catch { return []; }
  if (RESERVED_ROUTES.has(decoded)) return [];
  return [decoded, `@${decoded}`];
};
