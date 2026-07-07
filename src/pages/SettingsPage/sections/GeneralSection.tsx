import React from 'react';
import { useAppSettings } from '../../../features/settings/AppSettingsContext';
import { ReadingSpeedField } from './ReadingSpeedField';

const radioRow: React.CSSProperties = { display: 'flex', gap: 20, marginTop: 6, flexWrap: 'wrap' };
const radioLabel: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' };

export const GeneralSection: React.FC = () => {
  const { settings, update } = useAppSettings();

  return (
    <div>
      <h2 className="settings-section-title">General</h2>
      <p className="settings-section-desc">Miscellaneous editor preferences.</p>

      <div className="settings-field">
        <div className="settings-field-label">PDF export filename</div>
        <div style={radioRow}>
          <label style={radioLabel}>
            <input
              type="radio"
              name="pdfNameSource"
              checked={settings.pdfNameSource === 'filename'}
              onChange={() => update({ pdfNameSource: 'filename' })}
            />
            <span>Deck file name</span>
          </label>
          <label style={radioLabel}>
            <input
              type="radio"
              name="pdfNameSource"
              checked={settings.pdfNameSource === 'title'}
              onChange={() => update({ pdfNameSource: 'title' })}
            />
            <span>Deck title (<code>@title</code>)</span>
          </label>
        </div>
        <div className="settings-field-hint">Default filename suggested when exporting to PDF. “Deck title” falls back to the file name when the deck has no <code>@title</code>.</div>
      </div>

      <ReadingSpeedField />
    </div>
  );
};
