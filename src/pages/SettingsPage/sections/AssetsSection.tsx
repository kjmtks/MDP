import React, { useState } from 'react';
import { Button, CircularProgress } from '@mui/material';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import RefreshIcon from '@mui/icons-material/Refresh';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import { useAppSettings } from '../../../features/settings/AppSettingsContext';
import { loadedModules } from '../../../features/modules/moduleManager';
import { syncOfficialCatalog } from '../../../features/catalog/syncService';

const btnSx = {
  textTransform: 'none' as const,
  color: 'var(--app-text-secondary)',
  borderColor: 'var(--app-border-strong)',
  '&:hover': { borderColor: 'var(--app-accent)', backgroundColor: 'var(--app-bg-hover)' },
  '&.Mui-disabled': { color: 'var(--app-text-disabled)', borderColor: 'var(--app-border)' },
};

const listStyle: React.CSSProperties = {
  marginTop: 8, border: '1px solid var(--app-border)', borderRadius: 6,
  maxHeight: 360, overflowY: 'auto', background: 'var(--app-bg-elevated)',
};
const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px',
  borderBottom: '1px solid var(--app-border-subtle)', cursor: 'pointer',
};

export const AssetsSection: React.FC = () => {
  const { settings, update } = useAppSettings();
  const disabled = new Set(settings.disabledModules || []);

  const [syncing, setSyncing] = useState(false);
  const [snipReloading, setSnipReloading] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  // The live registry (populated by the editor underneath this overlay).
  const modules = Object.values(loadedModules)
    .map((m) => m.config)
    .sort((a, b) => a.name.localeCompare(b.name));

  const toggle = (name: string, enabled: boolean) => {
    const next = new Set(settings.disabledModules || []);
    if (enabled) next.delete(name); else next.add(name);
    update({ disabledModules: Array.from(next).sort() });
  };

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
      <p className="settings-section-desc">Get the latest official assets (modules, themes, templates, snippets), reload snippets, and enable or disable individual modules.</p>

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
        <div className="settings-field-hint">Unchecked modules are ignored — their <code>{'<!-- @name -->'}</code> directives render as nothing and they offer no snippets. Default: all enabled.</div>
        <div style={listStyle}>
          {modules.length === 0 && (
            <div style={{ padding: '10px 12px', color: 'var(--app-text-disabled)' }}>No modules loaded.</div>
          )}
          {modules.map((m) => (
            <label key={m.name} style={rowStyle}>
              <input
                type="checkbox"
                checked={!disabled.has(m.name)}
                onChange={(e) => toggle(m.name, e.target.checked)}
              />
              <span style={{ fontWeight: 600, color: 'var(--app-text-strong)', minWidth: 110 }}>{m.name}</span>
              <span style={{ fontSize: '0.72rem', color: 'var(--app-text-disabled)', textTransform: 'uppercase', minWidth: 44 }}>{m.type}</span>
              <span style={{ fontSize: '0.8rem', color: 'var(--app-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.description}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
};
