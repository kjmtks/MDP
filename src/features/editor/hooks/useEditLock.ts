import { useEffect, useRef, useState } from 'react';
import { apiClient, isElectron, isMcpRenderer } from '../../../api/apiClient';

// Advisory lock for concurrent Markdown editing on a shared server.
//
// The FIRST person to open a file holds it; later openers get `lockedBy` set
// to the holder's name and should present the editor read-only. The lock is
// renewed on a heartbeat and released on file switch / unmount / tab close, so
// nothing wedges a file permanently (the server also expires stale locks).
//
// Electron and single-user web return no owner, so `lockedBy` stays null and
// behavior is unchanged. The headless MCP renderer never takes one either: it
// reads decks on an AI's behalf, and must not lock the author out of their file.
const RENEW_MS = 20 * 1000;

export function useEditLock(path: string | null, active: boolean): string | null {
  const [lockedBy, setLockedBy] = useState<string | null>(null);
  const heldRef = useRef<string | null>(null);

  useEffect(() => {
    if (isElectron() || isMcpRenderer() || !active || !path) { setLockedBy(null); return; }
    let cancelled = false;
    let timer: number | undefined;

    const beat = async () => {
      const r = await apiClient.acquireLock(path);
      if (cancelled) return;
      setLockedBy(r.ok ? null : r.owner);
      if (r.ok) heldRef.current = path;
      timer = window.setTimeout(beat, RENEW_MS);
    };
    beat();

    const onUnload = () => { if (heldRef.current) apiClient.releaseLock(heldRef.current); };
    window.addEventListener('pagehide', onUnload);

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      window.removeEventListener('pagehide', onUnload);
      if (heldRef.current === path) { apiClient.releaseLock(path); heldRef.current = null; }
    };
  }, [path, active]);

  return lockedBy;
}
