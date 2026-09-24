import { useEffect, useRef } from 'react';
import { apiClient } from '../../../api/apiClient';
import { syncOfficialCatalog, fetchCatalog, catalogLocalPath, assetHash } from '../syncService';
import type { FileNode } from '../../../types';
import { reportError, notify, confirmDialog } from '../../../components/error/errorReporter';

// Versions the user chose NOT to update, as `{ 'modules/x.mdpmod.xml': hash }`.
// Kept in the workspace so a deliberately customised asset stops asking, while a
// NEWER official version (different hash) asks again.
const SKIP_FILE = '.mdp/.asset-update-skip.json';

const loadSkippedStale = async (): Promise<Record<string, string>> => {
  try {
    const raw = await apiClient.readFileText(SKIP_FILE);
    const obj = JSON.parse(raw);
    return (obj && typeof obj === 'object') ? obj as Record<string, string> : {};
  } catch { return {}; }
};

const saveSkippedStale = async (map: Record<string, string>): Promise<void> => {
  try { await apiClient.saveFile(SKIP_FILE, JSON.stringify(map, null, 2)); }
  catch (e) { console.error('Failed to record skipped asset updates', e); }
};

export function useCatalogSync(
  fileTree: FileNode[],
  onManualRefresh: () => void
) {
  const hasPrompted = useRef(false);

  useEffect(() => {
    if (!fileTree || fileTree.length === 0 || hasPrompted.current) return;

    const checkAndPromptSync = async () => {
      try {
        const isIgnored = fileTree.some(node => node.name === '.mdp_sync_ignored');
        if (isIgnored) return;

        // Only run the network check once per session.
        hasPrompted.current = true;

        // Compare the official catalog against local files and prompt when any
        // asset is missing — including newly added themes/templates, even if
        // other special folders (e.g. .modules) already exist.
        let catalog;
        try {
          catalog = await fetchCatalog();
        } catch (e) {
          console.error('Failed to fetch official catalog', e);
          return;
        }

        // ASK THE SERVER, don't trust the tree. In shared (multi-user) mode the
        // workspace root can be configured not to list its own files at all
        // (`rootListing: "spaces-only"` — the roots shown are `@homes`,
        // `@personal`, … while assets are written to the ROOT space). The tree
        // then never contains `.mdp/...`, so every asset looked "missing" on
        // every reload even right after a successful download (2026-09-24).
        // Reading each file answers both questions (present? current?) and is
        // correct in every mode; we already read the present ones to hash them.
        const wanted: Array<{ local: string; remote: string; hash: string }> = [];
        for (const [category, items] of Object.entries(catalog)) {
          for (const item of items) {
            wanted.push({ local: catalogLocalPath(category, item),
                          remote: item.path, hash: item.hash || '' });
          }
        }

        const missing: string[] = [];
        // Present locally, but no longer the official content: the catalog carries
        // each file's hash, so a stale copy is detectable. This is the case that
        // used to be invisible — e.g. a module predating a new capability, whose
        // slides then silently do nothing.
        const stale: string[] = [];
        // A few at a time: a workspace can be a `.mdplink` over SFTP, where a
        // hundred simultaneous reads would be rude. This runs in the background —
        // nothing waits on it but the prompt.
        const skipped = await loadSkippedStale();
        const present: Array<{ local: string; remote: string; hash: string }> = [];
        for (let i = 0; i < wanted.length; i += 8) {
          await Promise.all(wanted.slice(i, i + 8).map(async (f) => {
            let text: string | null = null;
            try { text = await apiClient.readFileText(f.local); }
            catch { missing.push(f.remote); return; }
            if (!f.hash) return;                 // no hash to compare against
            present.push(f);
            if (skipped[f.remote] === f.hash) return;   // deliberately kept
            if (assetHash(text) !== f.hash) stale.push(f.remote);
          }));
        }

        if (missing.length === 0 && stale.length === 0) return;

        const what = [
          missing.length ? `${missing.length} missing` : '',
          stale.length ? `${stale.length} out of date` : '',
        ].filter(Boolean).join(' and ');
        const wantsToSync = await confirmDialog(
          `Official MDP assets: ${what}.\n` +
          (stale.length ? `Out of date: ${stale.slice(0, 6).map((p) => p.split('/').pop()).join(', ')}` +
            `${stale.length > 6 ? `, +${stale.length - 6} more` : ''}\n` : '') +
          'Download the latest modules, themes, templates and snippets?\n' +
          'Local edits to these files WILL be overwritten.',
          { title: 'Update Official Assets', confirmText: 'Update', cancelText: 'Not now' }
        );

        if (wantsToSync) {
          try {
            await syncOfficialCatalog();
            notify('MDP official assets setup completed successfully.');
            onManualRefresh();
          } catch (err) {
            reportError('Sync failed. Please check your network connection.', { detail: err });
          }
        } else if (missing.length) {
          // Declining the FIRST-TIME setup means this workspace doesn't want
          // official assets at all — unchanged behaviour.
          try {
            await apiClient.saveFile('.mdp_sync_ignored', '');
            onManualRefresh();
          } catch (e) {
            console.error('Failed to create ignore file', e);
          }
        } else {
          // Declining an UPDATE is not a rejection of official assets: the copy is
          // probably customised on purpose. Remember these exact versions so the
          // prompt stays quiet until the official file changes again.
          await saveSkippedStale({ ...skipped, ...Object.fromEntries(
            present.filter((f) => stale.includes(f.remote)).map((f) => [f.remote, f.hash]),
          ) });
        }
      } catch (e) {
        console.error('Error in useCatalogSync:', e);
      }
    };

    checkAndPromptSync();
  }, [fileTree, onManualRefresh]);
}
