import React, { useState } from 'react';
import { IconButton, Tooltip } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PaletteIcon from '@mui/icons-material/Palette';
import KeyboardIcon from '@mui/icons-material/Keyboard';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import MinimizeIcon from '@mui/icons-material/Remove';
import MaximizeIcon from '@mui/icons-material/CropSquare';
import CloseIcon from '@mui/icons-material/Close';
import { isElectron } from '../../api/apiClient';
import { isMac } from '../../utils/osUtils';
import { closeSettings } from '../../features/settings/nav';
import { AppearanceSection } from './sections/AppearanceSection';
import { ShortcutsSection } from './sections/ShortcutsSection';
import { AboutSection } from './sections/AboutSection';
import './SettingsPage.css';

type SectionId = 'appearance' | 'shortcuts' | 'about';

const NAV: { id: SectionId; label: string; Icon: typeof PaletteIcon }[] = [
  { id: 'appearance', label: 'Appearance', Icon: PaletteIcon },
  { id: 'shortcuts', label: 'Shortcuts', Icon: KeyboardIcon },
  { id: 'about', label: 'About', Icon: InfoOutlinedIcon },
];

const winBtnSx = { minWidth: 0, width: 46, borderRadius: 0, color: 'var(--app-text-muted)', '&:hover': { backgroundColor: 'var(--app-bg-hover)', color: 'var(--app-text-strong)' } };

export const SettingsPage: React.FC = () => {
  const [section, setSection] = useState<SectionId>('appearance');

  return (
    <div className="settings-overlay">
      <div className="settings-topbar">
        <Tooltip title="Back to editor">
          <IconButton size="small" onClick={closeSettings} sx={{ color: 'var(--app-text-muted)', '&:hover': { color: 'var(--app-text-strong)' } }}>
            <ArrowBackIcon />
          </IconButton>
        </Tooltip>
        <span className="settings-title">Settings</span>
        <div style={{ flex: 1 }} />
        {isElectron() && !isMac() && (
          <div style={{ display: 'flex', height: 48 }}>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <IconButton sx={winBtnSx} onClick={() => (window as any).electronAPI?.minimize()}><MinimizeIcon fontSize="small" /></IconButton>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <IconButton sx={winBtnSx} onClick={() => (window as any).electronAPI?.maximize()}><MaximizeIcon fontSize="small" style={{ transform: 'scale(0.8)' }} /></IconButton>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <IconButton sx={{ ...winBtnSx, '&:hover': { backgroundColor: 'var(--app-danger)', color: '#fff' } }} onClick={() => (window as any).electronAPI?.close()}><CloseIcon fontSize="small" /></IconButton>
          </div>
        )}
      </div>

      <div className="settings-body">
        <nav className="settings-nav">
          {NAV.map(({ id, label, Icon }) => (
            <div
              key={id}
              className={`settings-nav-item${section === id ? ' active' : ''}`}
              onClick={() => setSection(id)}
            >
              <Icon fontSize="small" />
              <span>{label}</span>
            </div>
          ))}
        </nav>
        <div className="settings-content">
          {section === 'appearance' && <AppearanceSection />}
          {section === 'shortcuts' && <ShortcutsSection />}
          {section === 'about' && <AboutSection />}
        </div>
      </div>
    </div>
  );
};
