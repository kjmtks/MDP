import React, { useState } from 'react';
import { Button, CircularProgress } from '@mui/material';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import RefreshIcon from '@mui/icons-material/Refresh';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import { syncOfficialCatalog } from '../../../features/catalog/syncService';

const btnSx = {
  textTransform: 'none' as const,
  color: 'var(--app-text-secondary)',
  borderColor: 'var(--app-border-strong)',
  '&:hover': { borderColor: 'var(--app-accent)', backgroundColor: 'var(--app-bg-hover)' },
  '&.Mui-disabled': { color: 'var(--app-text-disabled)', borderColor: 'var(--app-border)' },
};

export const AssetsSection: React.FC = () => {
  const [syncing, setSyncing] = useState(false);
  const [snipReloading, setSnipReloading] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  // Run the catalog sync HERE (not via the editor) so the spinner reflects real
  // progress and no confirmation dialog hides behind this settings overlay. The
  // sync fires `mdp-sync-start`/`mdp-sync-end`, which the editor uses to refresh
  // the file tree, modules, themes and slides automatically.
  const sync = async () => {
    if (syncing) return;
    setSyncing(true);
    setStatus(null);
    try {
      await syncOfficialCatalog();
      setStatus({ ok: true, text: 'Official assets updated (modules, themes, templates, snippets).' });
    } catch {
      setStatus({ ok: false, text: 'Update failed — check your internet connection and try again.' });
    } finally {
      setSyncing(false);
    }
  };

  const reloadSnippets = () => {
    if (snipReloading) return;
    setSnipReloading(true);
    setStatus(null);
    window.dispatchEvent(new CustomEvent('mdp-reload-snippets'));
    window.setTimeout(() => {
      setSnipReloading(false);
      setStatus({ ok: true, text: 'Snippets reloaded.' });
    }, 700);
  };

  return (
    <div>
      <h2 className="settings-section-title">Assets</h2>
      <p className="settings-section-desc">Get the latest official assets (modules, themes, templates, snippets) and reload snippets.</p>

      <div className="settings-field">
        <div className="settings-field-label">Official assets</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 6, alignItems: 'center' }}>
          <Button
            variant="outlined"
            size="small"
            disabled={syncing}
            startIcon={syncing ? <CircularProgress size={15} sx={{ color: 'var(--app-accent)' }} /> : <CloudDownloadIcon fontSize="small" />}
            onClick={sync}
            sx={btnSx}
          >
            {syncing ? 'Updating…' : 'Get / update official assets'}
          </Button>
          <Button
            variant="outlined"
            size="small"
            disabled={snipReloading}
            startIcon={snipReloading ? <CircularProgress size={15} sx={{ color: 'var(--app-accent)' }} /> : <RefreshIcon fontSize="small" />}
            onClick={reloadSnippets}
            sx={btnSx}
          >
            Reload snippets
          </Button>
        </div>
        {status && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: '0.82rem', color: status.ok ? 'var(--app-success, #4caf50)' : 'var(--app-danger, #ef5350)' }}>
            {status.ok ? <CheckCircleIcon fontSize="small" /> : <ErrorOutlineIcon fontSize="small" />}
            <span>{status.text}</span>
          </div>
        )}
        <div className="settings-field-hint">Downloads the latest assets from the official catalog (internet required). The editor refreshes automatically when the update finishes.</div>
      </div>

      <div className="settings-field">
        <div className="settings-field-label">Modules</div>
        <div className="settings-field-hint">Module enable/disable is now <b>per folder</b>: right-click a <code>.mdp</code> folder in the file tree → <b>Configure (.mdp)…</b>. Choices live in that folder's <code>content.json</code> and cascade to the decks beneath it.</div>
      </div>
    </div>
  );
};
