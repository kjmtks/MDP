import React from 'react';
import { TextField } from '@mui/material';
import { useAppSettings } from '../../../features/settings/AppSettingsContext';

const fieldSx = {
  maxWidth: 420,
  '& .MuiInputBase-root': { color: 'var(--app-text)', backgroundColor: 'var(--app-bg-editor)' },
  '& .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--app-border-strong)' },
  '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--app-accent)' },
  '& .MuiInputLabel-root': { color: 'var(--app-text-muted)' },
};

export const ProfileSection: React.FC = () => {
  const { settings, update } = useAppSettings();

  return (
    <div>
      <h2 className="settings-section-title">Author profile</h2>
      <p className="settings-section-desc">
        Default author details. When you create a new slide, these values pre-fill the cover
        meta (<code>@presenter</code>, <code>@affiliation</code>, <code>@contact</code>). Leave a
        field blank to keep the template's own placeholder.
      </p>

      <div className="settings-field">
        <div className="settings-field-label">Name</div>
        <TextField
          size="small" fullWidth variant="outlined" sx={fieldSx}
          placeholder="Your Name"
          value={settings.authorName}
          onChange={(e) => update({ authorName: e.target.value })}
        />
        <div className="settings-field-hint">Written to the <code>@presenter</code> directive.</div>
      </div>

      <div className="settings-field">
        <div className="settings-field-label">Affiliation</div>
        <TextField
          size="small" fullWidth variant="outlined" sx={fieldSx}
          placeholder="Your Affiliation"
          value={settings.authorAffiliation}
          onChange={(e) => update({ authorAffiliation: e.target.value })}
        />
        <div className="settings-field-hint">Written to the <code>@affiliation</code> directive.</div>
      </div>

      <div className="settings-field">
        <div className="settings-field-label">Email</div>
        <TextField
          size="small" fullWidth variant="outlined" sx={fieldSx}
          placeholder="you@example.com"
          value={settings.authorEmail}
          onChange={(e) => update({ authorEmail: e.target.value })}
        />
        <div className="settings-field-hint">Written to the <code>@contact</code> directive.</div>
      </div>
    </div>
  );
};
