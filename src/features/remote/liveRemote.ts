import type { ModuleData } from '../../utils/moduleParser';
import type { EffectData } from '../../utils/effectParser';
import type { MotionSpec } from '../slide/parser/SlideContext';
import type { Stroke } from '../drawing/components/DrawingOverlay';
import { FILES_PREFIX, WEB_BASE } from '../../api/base';
import { apiClient, isElectron } from '../../api/apiClient';

// The LIVE remote: the device renders the deck itself — HTML with the workspace's
// own fonts, builds, transitions, interactive modules and focus cues — instead of
// showing pictures of the slides drawn on the PC (the 'image' view, still there for
// any device that cannot reach the workspace's files). The host sends the deck once
// per change (REMOTE_DECK) and only the position on a page turn (REMOTE_POS).
export type RemoteView = 'image' | 'live';

/** What a remote device gets of a slide: what is SHOWN, nothing else — no script,
 *  no notes, no source beyond the inline images SlideView restores. */
export interface RemoteSlide {
  html: string;
  className?: string;
  id?: string;
  header?: string;
  footer?: string;
  transition?: MotionSpec;
  stepCount?: number;
  isHidden?: boolean;
  pageNumber?: number;
  /** Only the `![…](data:image/…)` images of the source, in order — SlideView puts
   *  inline images back from them. */
  raw?: string;
}

export interface RemoteDeck {
  /** Bumped by every deck sent; a position names the deck it belongs to. */
  rev: number;
  slides: RemoteSlide[];
  slideSize: { width: number; height: number };
  transition?: MotionSpec;          // the deck's own @transition
  basePath?: string;
  themeCssUrl?: string;
  fontCss?: string;
  modules: ModuleData[];
  effects: EffectData[];
}

export interface RemotePos {
  rev: number;
  index: number;
  step: number;
  isOverview: boolean;
  allDrawings?: Record<number, Stroke[]>;
}

const INLINE_IMAGE = /!\[.*?\]\((data:image\/[^)]+)\)/g;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function remoteSlide(s: any): RemoteSlide {
  const images = String(s?.raw || '').match(INLINE_IMAGE);
  return {
    html: String(s?.html || ''),
    ...(s?.className ? { className: s.className } : {}),
    ...(s?.id ? { id: s.id } : {}),
    ...(s?.header ? { header: s.header } : {}),
    ...(s?.footer ? { footer: s.footer } : {}),
    ...(s?.transition ? { transition: s.transition } : {}),
    ...(s?.stepCount ? { stepCount: s.stepCount } : {}),
    ...(s?.isHidden ? { isHidden: true } : {}),
    ...(typeof s?.pageNumber === 'number' ? { pageNumber: s.pageNumber } : {}),
    ...(images ? { raw: images.join('\n') } : {}),
  };
}

// What the remote shows, chosen per computer in the Connect dialog.
const VIEW_KEY = 'mdp.remote.view';
export function storedRemoteView(): RemoteView {
  try { return localStorage.getItem(VIEW_KEY) === 'live' ? 'live' : 'image'; } catch { return 'image'; }
}
export function storeRemoteView(v: RemoteView): void {
  try { localStorage.setItem(VIEW_KEY, v); } catch { /* not remembered */ }
}

// ---- What the device may read ------------------------------------------------------
// The desktop app's own URL schemes mean nothing on a device: mdp-file:///X is the
// workspace file X — the remote server's /files/X — and app-asset://X the app's own
// file (served at /X). The web build's URLs are already /files/… and /….
export const forDevice = (s: string): string =>
  String(s || '').replace(/mdp-file:\/\/+/g, FILES_PREFIX).replace(/app-asset:\/\//g, `${WEB_BASE}/`);

/** A reference in a slide or a stylesheet → the workspace path it names; null for a
 *  web address, inline data, the app's own files, an anchor — or a deck's source
 *  (a link to another deck is a navigation, never a file to hand out). */
function workspacePath(ref: string, base?: string): string | null {
  let s = String(ref || '').trim();
  if (!s || /^(https?:|data:|blob:|#|mailto:|javascript:|about:)/i.test(s)) return null;
  s = s.split('#')[0].split('?')[0];
  if (s.startsWith(FILES_PREFIX)) s = s.slice(FILES_PREFIX.length);
  else if (/^mdp-file:/i.test(s)) s = s.replace(/^mdp-file:\/\/+/i, '');
  else if (/^[a-z][\w+.-]*:/i.test(s)) return null;
  else if (s.startsWith('/')) s = s.slice(1);
  else if (base) s = `${base}/${s}`;
  try { s = decodeURIComponent(s); } catch { /* keep */ }
  const out: string[] = [];
  for (const seg of s.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') { if (!out.length) return null; out.pop(); } else out.push(seg);
  }
  const p = out.join('/');
  return p && !/\.md$/i.test(p) ? p : null;
}

const ATTR_REF = /\s(?:src|poster|data|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const LINK_HREF = /<link\b[^>]*\shref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const CSS_URL = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
const refsInCss = (css: string): string[] => [...String(css || '').matchAll(CSS_URL)].map((m) => m[2]);
const refsInHtml = (html: string): string[] => [
  ...[...String(html || '').matchAll(ATTR_REF)].map((m) => m[1] ?? m[2] ?? ''),
  ...[...String(html || '').matchAll(LINK_HREF)].map((m) => m[1] ?? m[2] ?? ''),
  ...refsInCss(html),
];

/** The workspace files a live remote device will ask for: what the slides show
 *  (images, inline SVGs, videos…), the fonts, the modules' CSS, the theme — and
 *  what the theme itself refers to. */
export async function remoteAssetPaths(deck: Omit<RemoteDeck, 'rev'>): Promise<string[]> {
  const out = new Set<string>();
  const add = (ref: string, base?: string) => { const p = workspacePath(ref, base); if (p) out.add(p); };
  for (const s of deck.slides) for (const h of [s.html, s.header || '', s.footer || '']) refsInHtml(h).forEach((r) => add(r, deck.basePath));
  refsInCss(deck.fontCss || '').forEach((r) => add(r));
  for (const m of deck.modules || []) refsInCss(m.style || '').forEach((r) => add(r));
  const theme = deck.themeCssUrl && deck.themeCssUrl.startsWith(FILES_PREFIX) ? workspacePath(deck.themeCssUrl) : null;
  if (theme) {
    out.add(theme);
    try {
      const css = await apiClient.readFileText(theme);
      const dir = theme.split('/').slice(0, -1).join('/');
      refsInCss(css).forEach((r) => add(r, dir));
    } catch { /* the theme file alone */ }
  }
  return [...out];
}

/** Tell the server which files this presentation's devices may read — the desktop
 *  app's remote server, or the web server (which resolves them with the presenter's
 *  rights) — and wait for it, so the deck goes out once they are readable. */
export async function grantRemoteFiles(channel: string, token: string, paths: string[], timeoutMs = 4000): Promise<void> {
  const call = isElectron()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? (window as any).electronAPI?.remoteGrantFiles?.({ channel, token, paths })
    : fetch(`${WEB_BASE}/api/remote/grant`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel, token, paths }) });
  await Promise.race([Promise.resolve(call).catch(() => undefined), new Promise((r) => setTimeout(r, timeoutMs))]);
}

/** A device joins its presentation's file session (a cookie the server checks on
 *  every file it reads). */
export function joinRemoteSession(channel: string, token: string): Promise<unknown> {
  return fetch(`${WEB_BASE}/api/remote/session?channel=${encodeURIComponent(channel)}&token=${encodeURIComponent(token)}`, { credentials: 'same-origin', cache: 'no-store' })
    .catch(() => undefined);
}
