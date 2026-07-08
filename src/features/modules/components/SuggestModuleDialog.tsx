import React, { useMemo } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, IconButton, Chip, ThemeProvider, createTheme } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { loadedModules, isModuleDisabled } from '../moduleManager';
import { suggestModules } from '../../ai/slideSpecPrompt';
import { useAppSettings } from '../../settings/AppSettingsContext';

// A small in-editor helper: given the text the user selected (or the current
// slide), recommend modules that fit its content and let the user INSERT the
// chosen module's snippet at the cursor. Powered by the same content-signal
// heuristics + taxonomy tags as the MCP `suggest_modules` tool.
export const SuggestModuleDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  text: string;
  onInsert: (snippet: string) => void;
}> = ({ open, onClose, text, onInsert }) => {
  const { appThemeVariant } = useAppSettings();
  const muiTheme = useMemo(() => createTheme({ palette: { mode: appThemeVariant } }), [appThemeVariant]);
  const configs = useMemo(
    () => Object.values(loadedModules).map((m) => m.config).filter((c) => !isModuleDisabled(c.name)),
    // Recompute only while open (loadedModules is a stable registry object).
    [open],
  );
  const suggestions = useMemo(() => (open ? suggestModules(configs, text, { limit: 6 }) : []), [open, configs, text]);

  const snippetFor = (name: string): string => {
    const cfg = loadedModules[name]?.config;
    const snip = cfg?.snippets?.find((s: { text?: string }) => s && s.text)?.text;
    if (snip) return `\n${snip}\n`;
    // Fallback skeleton if the module ships no snippet.
    return cfg?.type === 'inline' ? `<!-- @${name} -->` : `\n<!-- @${name} -->\n\n<!-- @end -->\n`;
  };

  const insert = (name: string) => { onInsert(snippetFor(name)); onClose(); };

  const preview = (text || '').replace(/\s+/g, ' ').trim().slice(0, 120);

  return (
    <ThemeProvider theme={muiTheme}>
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth
      PaperProps={{ sx: { bgcolor: 'var(--app-bg-panel)', color: 'var(--app-text)' } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pr: 1 }}>
        Suggest a module
        <IconButton size="small" onClick={onClose}><CloseIcon fontSize="small" /></IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 12, color: 'var(--app-text-muted)' }}>
          Based on {preview ? <>the {text && text.length ? 'selection' : 'slide'}: “{preview}{preview.length >= 120 ? '…' : ''}”</> : 'the current slide'}
        </div>
        {suggestions.length === 0 ? (
          <div style={{ fontSize: 14, color: 'var(--app-text-muted)' }}>
            No module clearly fits — a plain heading, list, image or table may be best here.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {suggestions.map((s) => (
              <div key={s.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                padding: '8px 10px', borderRadius: 8, background: 'color-mix(in srgb, currentColor 5%, transparent)' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <code style={{ fontWeight: 700 }}>@{s.name}</code>
                    <Chip label={s.type} size="small" sx={{ height: 18, fontSize: 11 }} />
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--app-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {s.reason ? <span>{s.reason}. </span> : null}{s.description}
                  </div>
                </div>
                <Button size="small" variant="contained" onClick={() => insert(s.name)}
                  sx={{ textTransform: 'none', flexShrink: 0, bgcolor: 'var(--app-accent)' }}>Insert</Button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 2, py: 1.5 }}>
        <Button onClick={onClose} sx={{ textTransform: 'none', color: 'var(--app-text-muted)' }}>Close</Button>
      </DialogActions>
    </Dialog>
    </ThemeProvider>
  );
};
