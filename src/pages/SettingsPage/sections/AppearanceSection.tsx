import React from 'react';
import { Slider } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import { useAppSettings } from '../../../features/settings/AppSettingsContext';
import { APP_THEMES } from '../../../styles/appThemes';

export const AppearanceSection: React.FC = () => {
  const { settings, update } = useAppSettings();

  return (
    <div>
      <h2 className="settings-section-title">Appearance</h2>
      <p className="settings-section-desc">Theme and font sizes for the editor app. (Slide themes are set per deck with the <code>@theme</code> directive.)</p>

      <div className="settings-field">
        <div className="settings-field-label">App theme</div>
        <div className="app-theme-grid">
          {APP_THEMES.map((t) => {
            const active = settings.appTheme === t.id;
            return (
              <div
                key={t.id}
                className={`app-theme-card${active ? ' active' : ''}`}
                data-app-theme={t.id}
                onClick={() => update({ appTheme: t.id })}
              >
                <div className="app-theme-swatch">
                  <span style={{ background: 'var(--app-bg-header)' }} />
                  <span style={{ background: 'var(--app-bg-panel)' }} />
                  <span style={{ background: 'var(--app-bg-editor)' }} />
                  <span style={{ background: 'var(--app-accent)' }} />
                </div>
                <div className="app-theme-card-label">
                  <span>{t.label}</span>
                  {active && <CheckIcon fontSize="small" sx={{ color: 'var(--app-accent)' }} />}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="settings-field">
        <div className="settings-field-label">App UI font size — {settings.appFontSize}px</div>
        <Slider
          value={settings.appFontSize}
          min={11} max={20} step={1} marks
          valueLabelDisplay="auto"
          onChange={(_e, v) => update({ appFontSize: v as number })}
          sx={{ maxWidth: 360, color: 'var(--app-accent)' }}
        />
        <div className="settings-field-hint">Base size for menus, panels and this settings screen.</div>
      </div>

      <div className="settings-field">
        <div className="settings-field-label">Editor font size — {settings.editorFontSize}px</div>
        <Slider
          value={settings.editorFontSize}
          min={10} max={40} step={1}
          valueLabelDisplay="auto"
          onChange={(_e, v) => update({ editorFontSize: v as number })}
          sx={{ maxWidth: 360, color: 'var(--app-accent)' }}
        />
        <div className="settings-field-hint">Code editor font size (also adjustable with Ctrl + mouse wheel).</div>
      </div>

      <div className="settings-field">
        <div className="settings-field-label">Cursor thickness — {settings.editorCaretWidth}px</div>
        <Slider
          value={settings.editorCaretWidth}
          min={1} max={6} step={1} marks
          valueLabelDisplay="auto"
          onChange={(_e, v) => update({ editorCaretWidth: v as number })}
          sx={{ maxWidth: 360, color: 'var(--app-accent)' }}
        />
        <div className="settings-field-hint">Width of the text cursor (caret) in the editor.</div>
      </div>

      <div className="settings-field">
        <div className="settings-field-label">Editor line height — {settings.editorLineHeight.toFixed(1)}</div>
        <Slider
          value={settings.editorLineHeight}
          min={1.2} max={2.4} step={0.1}
          valueLabelDisplay="auto"
          onChange={(_e, v) => update({ editorLineHeight: v as number })}
          sx={{ maxWidth: 360, color: 'var(--app-accent)' }}
        />
        <div className="settings-field-hint">Line spacing in the code editor.</div>
      </div>
    </div>
  );
};
