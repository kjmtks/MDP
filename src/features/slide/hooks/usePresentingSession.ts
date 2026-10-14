import { useEffect } from 'react';
import { holdNotifications } from '../../../components/error/errorReporter';

interface WakeLockLike { release: () => Promise<void> }
type PresentingApi = { setPresenting?: (reason: string, on: boolean) => Promise<unknown> };

/** While a show runs here — the slideshow, a narrated auto-play, the presenter view,
 *  the output window — the screen stays on: no display sleep, no screen saver. The
 *  desktop app asks the system (main's powerSaveBlocker, released when the window
 *  closes); a browser takes a Screen Wake Lock (only where the page is a secure
 *  context — https / localhost — and again whenever the page comes back into view).
 *  `quiet`: this window's own notifications wait until the show ends (they would
 *  pop up in front of the audience). The system's notifications cannot be turned
 *  off by an app (Windows keeps Do Not Disturb to itself: it turns it on for a
 *  full-screen app or a duplicated display, by the user's settings). */
export function usePresentingSession(active: boolean, reason: string, quiet = false): void {
  useEffect(() => {
    if (!active) return undefined;
    const release = quiet ? holdNotifications(reason) : () => {};
    const api = (window as unknown as { electronAPI?: PresentingApi }).electronAPI;
    if (api?.setPresenting) {
      void api.setPresenting(reason, true).catch(() => {});
      return () => {
        release();
        void api.setPresenting?.(reason, false).catch(() => {});
      };
    }
    let lock: WakeLockLike | null = null;
    let alive = true;
    const take = async () => {
      const wl = (navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<WakeLockLike> } }).wakeLock;
      if (!wl || document.visibilityState !== 'visible') return;
      try {
        const got = await wl.request('screen');
        if (alive) lock = got; else void got.release().catch(() => {});
      } catch { /* not allowed here (http, power saving): the screen may sleep */ }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') void take(); };
    void take();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      release();
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => {});
    };
  }, [active, reason, quiet]);
}
