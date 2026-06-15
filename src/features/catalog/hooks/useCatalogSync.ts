import { useEffect, useRef } from 'react';
import { apiClient } from '../../../api/apiClient';
import { syncOfficialCatalog, fetchCatalog, catalogLocalPath } from '../syncService';
import type { FileNode } from '../../../types';
import { reportError, notify, confirmDialog } from '../../../components/error/errorReporter';

const collectFilePaths = (nodes: FileNode[], acc: Set<string>) => {
  for (const n of nodes) {
    if (n.type === 'file') acc.add(n.path);
    if (n.children) collectFilePaths(n.children, acc);
  }
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

        const localPaths = new Set<string>();
        collectFilePaths(fileTree, localPaths);

        const missing: string[] = [];
        for (const [category, items] of Object.entries(catalog)) {
          for (const item of items) {
            if (!localPaths.has(catalogLocalPath(category, item))) missing.push(item.path);
          }
        }

        if (missing.length === 0) return;

        const wantsToSync = await confirmDialog(
          `This project is missing ${missing.length} official MDP asset(s).\n` +
          'Download and set up the latest modules, themes, templates, and snippets?',
          { title: 'Set Up Official Assets', confirmText: 'Download', cancelText: 'Not now' }
        );

        if (wantsToSync) {
          try {
            await syncOfficialCatalog();
            notify('MDP official assets setup completed successfully.');
            onManualRefresh();
          } catch (err) {
            reportError('Sync failed. Please check your network connection.', { detail: err });
          }
        } else {
          try {
            await apiClient.saveFile('.mdp_sync_ignored', '');
            onManualRefresh();
          } catch (e) {
            console.error('Failed to create ignore file', e);
          }
        }
      } catch (e) {
        console.error('Error in useCatalogSync:', e);
      }
    };

    checkAndPromptSync();
  }, [fileTree, onManualRefresh]);
}
