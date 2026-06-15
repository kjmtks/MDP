import { useEffect } from 'react';
import { apiClient, isElectron } from '../../../api/apiClient';

declare const __API_PORT__: string;

// Captured once at module load, before any component effect can overwrite it.
const SAVED_OPEN_FILES: { paths?: string[]; active?: string | null } | null = (() => {
  try { return JSON.parse(localStorage.getItem('mdp_open_files') || 'null'); } catch { return null; }
})();

// Unsaved drafts kept from the previous session (VSCode-style hot exit).
const SAVED_DRAFTS: Record<string, string> = (() => {
  try { return JSON.parse(localStorage.getItem('mdp_unsaved_drafts') || '{}') || {}; } catch { return {}; }
})();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const collectFilePaths = (nodes: any[], acc: Set<string>): Set<string> => {
  for (const n of nodes || []) {
    if (n.type === 'file') acc.add(n.path);
    if (n.children) collectFilePaths(n.children, acc);
  }
  return acc;
};

export const useAppInit = (
  fetchFileTree: () => void,
  loadFile: (fileName: string, isBinaryFromServer?: boolean, initialPage?: number, draftContent?: string) => Promise<void> | void,
  setTemplateContent: (content: string) => void,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setSnipets: (snipets: any) => void,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setThemes: (themes: any) => void,
) => {
  useEffect(() => {
    const init = async () => {
      if (isElectron()) {
        const rootPath = localStorage.getItem('mdp_root_path');
        if (rootPath) {
          try { await apiClient.setBaseDir(rootPath); } catch (err) { console.error(err); }
        }
      }

      let existing = new Set<string>();
      try { existing = collectFilePaths(await apiClient.getFileTree(), new Set()); } catch { /* ignore */ }

      fetchFileTree();
      apiClient.getSnipets().then(data => setSnipets(data)).catch(err => console.error(err));
      apiClient.getTemplateContent('').then(text => setTemplateContent(text)).catch(err => console.error(err));
      apiClient.getThemes().then(data => setThemes(data)).catch(err => console.error(err));

      const params = new URLSearchParams(window.location.search);
      const fileUrl = params.get('file');
      const savedPaths = Array.isArray(SAVED_OPEN_FILES?.paths) ? SAVED_OPEN_FILES!.paths! : [];
      const savedActive = SAVED_OPEN_FILES?.active ?? null;

      const activePath = (fileUrl && existing.has(fileUrl)) ? fileUrl
        : (savedActive && existing.has(savedActive)) ? savedActive
        : null;

      // Reopen previously-open files that still exist; load the active one last.
      // Apply any unsaved draft so the editor is restored exactly as it was left.
      for (const p of savedPaths) {
        if (p !== activePath && existing.has(p)) {
          try { await loadFile(p, undefined, 0, SAVED_DRAFTS[p]); } catch { /* skip */ }
        }
      }
      if (activePath) {
        try { await loadFile(activePath, undefined, 0, SAVED_DRAFTS[activePath]); } catch { /* skip */ }
      }
    };
    init();

    if (isElectron()) return;

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

    const wsHost = (window.location.port === '5173' || window.location.port === '4173')
      ? `localhost:${__API_PORT__}`
      : window.location.host;

    let ws: WebSocket;
    let retryTimer: ReturnType<typeof setTimeout>;
    let isUnmounting = false;

    const connectWs = () => {
      if (isUnmounting) return;
      try {
        ws = new WebSocket(`${wsProtocol}//${wsHost}`);
        ws.onopen = () => console.log("Connected to file watcher");
        ws.onmessage = (event) => { if (event.data === 'file-change') fetchFileTree(); };
        ws.onclose = () => { if (!isUnmounting) retryTimer = setTimeout(connectWs, 5000); };
      } catch (e) {
        console.error("WS connection error:", e);
        if (!isUnmounting) retryTimer = setTimeout(connectWs, 5000);
      }
    };
    connectWs();

    return () => {
      isUnmounting = true;
      clearTimeout(retryTimer);
      if (ws) { ws.onclose = null; ws.close(); }
    };
  }, [fetchFileTree, loadFile, setTemplateContent, setSnipets, setThemes]);
};