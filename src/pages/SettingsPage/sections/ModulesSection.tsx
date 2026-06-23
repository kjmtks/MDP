import React from 'react';
import { Button } from '@mui/material';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useAppSettings } from '../../../features/settings/AppSettingsContext';
import { loadedModules } from '../../../features/modules/moduleManager';

const btnSx = {
  textTransform: 'none' as const,
  color: 'var(--app-text-secondary)',
  borderColor: 'var(--app-border-strong)',
  '&:hover': { borderColor: 'var(--app-accent)', backgroundColor: 'var(--app-bg-hover)' },
};

const listStyle: React.CSSProperties = {
  marginTop: 8, border: '1px solid var(--app-border)', borderRadius: 6,
  maxHeight: 360, overflowY: 'auto', background: 'var(--app-bg-elevated)',
};
const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px',
  borderBottom: '1px solid var(--app-border-subtle)', cursor: 'pointer',
};

export const ModulesSection: React.FC = () => {
  const { settings, update } = useAppSettings();
  const disabled = new Set(settings.disabledModules || []);

  // The live registry (populated by the editor underneath this overlay). Show every
  // registered module so the user can toggle any of them.
  const modules = Object.values(loadedModules)
    .map((m) => m.config)
    .sort((a, b) => a.name.localeCompare(b.name));

  const toggle = (name: string, enabled: boolean) => {
    const next = new Set(settings.disabledModules || []);
    if (enabled) next.delete(name); else next.add(name);
    update({ disabledModules: Array.from(next).sort() });
  };

  const sync = () => window.dispatchEvent(new CustomEvent('mdp-sync-catalog'));
  const reloadSnippets = () => window.dispatchEvent(new CustomEvent('mdp-reload-snippets'));

  return (
    <div>
      <h2 className="settings-section-title">Modules</h2>
      <p className="settings-section-desc">Get the latest official assets, reload snippets, and enable or disable individual modules.</p>

      <div className="settings-field">
        <div className="settings-field-label">Official assets</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 6 }}>
          <Button variant="outlined" size="small" startIcon={<CloudDownloadIcon fontSize="small" />} onClick={sync} sx={btnSx}>
            Get / update official modules
          </Button>
          <Button variant="outlined" size="small" startIcon={<RefreshIcon fontSize="small" />} onClick={reloadSnippets} sx={btnSx}>
            Reload snippets
          </Button>
        </div>
        <div className="settings-field-hint">Downloads the latest modules, themes, templates and snippets from the official catalog (internet required). “Reload snippets” re-reads workspace &amp; module snippets without a download.</div>
      </div>

      <div className="settings-field">
        <div className="settings-field-label">Enabled modules</div>
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
