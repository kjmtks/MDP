import React, { useState } from 'react';
import { IconButton, Tooltip } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PaletteIcon from '@mui/icons-material/Palette';
import TuneIcon from '@mui/icons-material/Tune';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import KeyboardIcon from '@mui/icons-material/Keyboard';
import ExtensionIcon from '@mui/icons-material/Extension';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import MinimizeIcon from '@mui/icons-material/Remove';
import MaximizeIcon from '@mui/icons-material/CropSquare';
import CloseIcon from '@mui/icons-material/Close';
import { isElectron } from '../../api/apiClient';
import { isMac } from '../../utils/osUtils';
import { closeSettings } from '../../features/settings/nav';
import { AppearanceSection } from './sections/AppearanceSection';
import { GeneralSection } from './sections/GeneralSection';
import { ProfileSection } from './sections/ProfileSection';
import { ShortcutsSection } from './sections/ShortcutsSection';
import { ModulesSection } from './sections/ModulesSection';
import { AiSpecSection } from './sections/AiSpecSection';
import { AboutSection } from './sections/AboutSection';
import './SettingsPage.css';

type SectionId = 'appearance' | 'general' | 'profile' | 'shortcuts' | 'modules' | 'ai' | 'about';

const NAV: { id: SectionId; label: string; Icon: typeof PaletteIcon }[] = [
  { id: 'appearance', label: 'Appearance', Icon: PaletteIcon },
  { id: 'general', label: 'General', Icon: TuneIcon },
  { id: 'profile', label: 'Author profile', Icon: PersonOutlineIcon },
  { id: 'shortcuts', label: 'Shortcuts', Icon: KeyboardIcon },
  { id: 'modules', label: 'Modules', Icon: ExtensionIcon },
  { id: 'ai', label: 'AI prompt', Icon: AutoAwesomeIcon },
  { id: 'about', label: 'About', Icon: InfoOutlinedIcon },
];

const winBtnSx = { minWidth: 0, width: 46, borderRadius: 0, color: 'var(--app-text-muted)', '&:hover': { backgroundColor: 'var(--app-bg-hover)', color: 'var(--app-text-strong)' } };

export const SettingsPage: React.FC = () => {
  const [section, setSection] = useState<SectionId>('appearance');

  // On macOS the window's traffic-light buttons sit at the top-left, so pad the
  // bar (matches MainHeader) to keep the Back button clear of them.
  const mac = isElectron() && isMac();

  return (
    <div className="settings-overlay">
      <div className="settings-topbar" style={{ paddingLeft: mac ? 80 : undefined }}>
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
          {section === 'general' && <GeneralSection />}
          {section === 'profile' && <ProfileSection />}
          {section === 'shortcuts' && <ShortcutsSection />}
          {section === 'modules' && <ModulesSection />}
          {section === 'ai' && <AiSpecSection />}
          {section === 'about' && <AboutSection />}
        </div>
      </div>
    </div>
  );
};
