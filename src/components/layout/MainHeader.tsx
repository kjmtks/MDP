import React, { useState, useEffect } from 'react';
import { Stack, Tooltip, Button, Menu, MenuItem, Checkbox, ListItemText, ListItemIcon } from '@mui/material';
import ViewSidebarIcon from '@mui/icons-material/ViewSidebar';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import GridViewIcon from '@mui/icons-material/GridView';
import MinimizeIcon from '@mui/icons-material/Remove';
import MaximizeIcon from '@mui/icons-material/CropSquare';
import CloseIcon from '@mui/icons-material/Close';
import SettingsIcon from '@mui/icons-material/Settings';
import { isElectron } from '../../api/apiClient';
import { isMac } from '../../utils/osUtils';
import { openSettings } from '../../features/settings/nav';
import { STATIC_PANELS, TOGGLE_PANEL_EVENT, VISIBLE_PANELS_EVENT, REQUEST_VISIBLE_EVENT } from '../../pages/EditorPage/dock/dockShared';
import { darkMenuSlotProps } from '../../pages/EditorPage/dock/darkMenu';

interface MainHeaderProps {
  onResetLayout?: () => void;
  isSlideOverview?: boolean;
  onCloseOverview?: () => void;
}

export const MainHeader: React.FC<MainHeaderProps> = ({
  onResetLayout, isSlideOverview, onCloseOverview
}) => {
  const mac = isMac();

  const [viewMenuAnchor, setViewMenuAnchor] = useState<HTMLElement | null>(null);
  const [visiblePanels, setVisiblePanels] = useState<Set<string>>(new Set());

  useEffect(() => {
    const handler = (e: Event) => {
      const ids = (e as CustomEvent<{ ids: string[] }>).detail?.ids;
      if (ids) setVisiblePanels(new Set(ids));
    };
    window.addEventListener(VISIBLE_PANELS_EVENT, handler);
    window.dispatchEvent(new Event(REQUEST_VISIBLE_EVENT));
    return () => window.removeEventListener(VISIBLE_PANELS_EVENT, handler);
  }, []);

  const openViewMenu = (e: React.MouseEvent<HTMLElement>) => {
    window.dispatchEvent(new Event(REQUEST_VISIBLE_EVENT));
    setViewMenuAnchor(e.currentTarget);
  };
  const togglePanel = (id: string) => {
    window.dispatchEvent(new CustomEvent(TOGGLE_PANEL_EVENT, { detail: { id } }));
  };

  return (
    <div
      className="header"
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'row',
        justifyContent: 'flex-end',
        alignItems: 'center',
        padding: mac ? '0 0 0 80px' : '0 0 0 1rem',
        height: '40px',
        flexShrink: 0,
        boxSizing: 'border-box',
        backgroundColor: 'var(--app-bg-header)',
        color: 'var(--app-text)',
        WebkitAppRegion: 'drag',
        userSelect: 'none'
      } as React.CSSProperties}
    >
      <div
        style={{
          position: 'absolute',
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          pointerEvents: 'none'
        }}
      >
        {/* Monochrome logo (icon-mono) inlined so `currentColor` follows the app
            theme's text colour — stays visible on any theme (light/dark). */}
        <svg
          width="20" height="20" viewBox="0 0 512 512" role="img" aria-label="MDP Logo"
          fill="none" stroke="currentColor" strokeWidth={24} strokeLinecap="round" strokeLinejoin="round"
          style={{ color: 'var(--app-text, #eee)', flexShrink: 0 }}
        >
          <rect x="56" y="72" width="400" height="336" rx="84" />
          <path d="M186,408 L150,452" />
          <path d="M326,408 L362,452" />
          <path d="M176,200 L136,240 L176,280" />
          <path d="M336,200 L376,240 L336,280" />
          <path d="M288,184 L224,296" />
        </svg>
        <span style={{ fontWeight: 800, fontSize: '0.9rem', letterSpacing: '1px' }}>
          MDP
        </span>
      </div>
      <Stack
        direction="row"
        spacing={0.5}
        alignItems="center"
        sx={{ flexShrink: 0, pr: isElectron() ? 0 : 2 }}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        style={{ WebkitAppRegion: 'no-drag' } as any}
      >
        {isSlideOverview && (
          <Tooltip title="Close Slide Overview">
            <span>
              <Button variant="text" size="small" onClick={onCloseOverview} sx={{ color: '#fff', minWidth: '40px', bgcolor: 'rgba(255,255,255,0.12)', '&:hover': { color: '#fff', bgcolor: 'rgba(255,255,255,0.2)' } }}>
                <GridViewIcon />
              </Button>
            </span>
          </Tooltip>
        )}
        <Tooltip title="View / Panels">
          <span>
            <Button variant="text" size="small" onClick={openViewMenu} sx={{ color: 'var(--app-text-muted)', minWidth: '40px', '&:hover': { color: 'var(--app-text-strong)' } }}>
              <ViewSidebarIcon />
            </Button>
          </span>
        </Tooltip>
        <Menu anchorEl={viewMenuAnchor} open={Boolean(viewMenuAnchor)} onClose={() => setViewMenuAnchor(null)} slotProps={darkMenuSlotProps}>
          <MenuItem disabled sx={{ opacity: 1, fontWeight: 'bold', fontSize: '0.8rem' }}>Panels</MenuItem>
          {STATIC_PANELS.map(panel => (
            <MenuItem key={panel.id} onClick={() => togglePanel(panel.id)} dense>
              <Checkbox edge="start" size="small" checked={visiblePanels.has(panel.id)} tabIndex={-1} disableRipple sx={{ py: 0 }} />
              <ListItemText primary={panel.title} />
            </MenuItem>
          ))}
          {onResetLayout && [
            <MenuItem key="reset" onClick={() => { onResetLayout(); setViewMenuAnchor(null); }} dense>
              <ListItemIcon><RestartAltIcon fontSize="small" /></ListItemIcon>
              <ListItemText primary="Reset Layout" />
            </MenuItem>,
          ]}
        </Menu>
        <Tooltip title="Settings">
          <span>
            <Button
              variant="text"
              size="small"
              onClick={openSettings}
              sx={{ color: 'var(--app-text-muted)', minWidth: '40px', ml: 1, '&:hover': { color: 'var(--app-text-strong)' } }}
            >
              <SettingsIcon />
            </Button>
          </span>
        </Tooltip>

        {isElectron() && !mac && (
          <Stack direction="row" sx={{ height: '40px', ml: 1 }}>
            <Button
              variant="text"
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onClick={() => (window as any).electronAPI?.minimize()}
              sx={{ minWidth: '46px', borderRadius: 0, color: 'var(--app-text-muted)', '&:hover':{backgroundColor: 'var(--app-bg-hover)', color:'var(--app-text-strong)'} }}
            >
              <MinimizeIcon fontSize="small" />
            </Button>
            <Button
              variant="text"
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onClick={() => (window as any).electronAPI?.maximize()}
              sx={{ minWidth: '46px', borderRadius: 0, color: 'var(--app-text-muted)', '&:hover':{backgroundColor: 'var(--app-bg-hover)', color:'var(--app-text-strong)'} }}
            >
              <MaximizeIcon fontSize="small" style={{ transform: 'scale(0.8)' }} />
            </Button>
            <Button
              variant="text"
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onClick={() => (window as any).electronAPI?.close()}
              sx={{ minWidth: '46px', borderRadius: 0, color: 'var(--app-text-muted)', '&:hover':{backgroundColor: 'var(--app-danger)', color:'#fff'} }}
            >
              <CloseIcon fontSize="small" />
            </Button>
          </Stack>
        )}
      </Stack>
    </div>
  );
};