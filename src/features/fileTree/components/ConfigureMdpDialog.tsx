import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, Box, CircularProgress } from '@mui/material';
import { apiClient } from '../../../api/apiClient';
import { reportError, notify } from '../../../components/error/errorReporter';
import { loadedModules } from '../../modules/moduleManager';
import { type MdpContent, parseContent, contentPath } from '../../workspace/mdpContent';

interface Props {
  open: boolean;
  // The `.mdp` directory being configured (e.g. '.mdp' or 'alice/.mdp').
  configDir: string | null;
  onClose: () => void;
}

const rowSx = {
  display: 'flex', alignItems: 'center', gap: 1.25, px: 1.5, py: 0.75, cursor: 'pointer',
  borderBottom: '1px solid var(--app-border-subtle)',
};

// Configure a single `.mdp`'s content profile (currently: which modules are enabled
// for the decks beneath it). Choices are written to `<configDir>/content.json` and
// cascade (nearest `.mdp` wins). Read-only-aware: a save that fails (e.g. a NAS share
// you don't own) is reported and the dialog stays open.
export const ConfigureMdpDialog: React.FC<Props> = ({ open, configDir, onClose }) => {
  const [content, setContent] = useState<MdpContent>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  // The modules currently registered (the active scope) — the togglable set.
  const modules = useMemo(
    () => Object.values(loadedModules).map((m) => m.config).sort((a, b) => a.name.localeCompare(b.name)),
    // re-evaluate each open (the registry is mutable)
    [open],
  );

  useEffect(() => {
    if (!open || !configDir) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try { const text = await apiClient.readFileText(contentPath(configDir)); if (!cancelled) setContent(parseContent(text)); }
      catch { if (!cancelled) setContent({}); }     // no content.json yet
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [open, configDir]);

  // A module is "enabled here" unless this `.mdp` explicitly disables it.
  const enabledHere = (name: string) => content.modules?.[name] !== false;
  const toggle = (name: string, enabled: boolean) => {
    setContent((prev) => {
      const mods = { ...(prev.modules || {}) };
      if (enabled) delete mods[name];   // back to inherit (default enabled)
      else mods[name] = false;          // disabled for this folder's subtree
      return { ...prev, modules: mods };
    });
  };

  const save = async () => {
    if (!configDir || busy) return;
    setBusy(true);
    try {
      const mods = content.modules || {};
      const payload: MdpContent = { version: 1, modules: Object.fromEntries(Object.entries(mods).filter(([, v]) => v === false)) };
      await apiClient.saveFile(contentPath(configDir), JSON.stringify(payload, null, 2));
      window.dispatchEvent(new CustomEvent('mdp-content-changed'));
      notify('Saved .mdp configuration.');
      onClose();
    } catch (e) {
      reportError('Could not save — this .mdp may be read-only (e.g. a NAS share you don’t own).', { detail: e });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm"
      slotProps={{ paper: { sx: { bgcolor: 'var(--app-bg-panel)', color: 'var(--app-text-secondary)' } } }}>
      <DialogTitle>Configure <code style={{ fontSize: '0.85em' }}>{configDir}</code></DialogTitle>
      <DialogContent>
        <Typography sx={{ fontSize: '0.78rem', color: 'var(--app-text-disabled)', mb: 1.5 }}>
          Enable or disable modules for the decks beneath this folder. Choices cascade — a nearer <code>.mdp</code> overrides a further one. Unchecked = its <code>{'<!-- @name -->'}</code> directives render as nothing and it offers no snippets.
        </Typography>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={22} sx={{ color: 'var(--app-accent)' }} /></Box>
        ) : (
          <Box sx={{ border: '1px solid var(--app-border)', borderRadius: 1.5, overflow: 'hidden', bgcolor: 'var(--app-bg-elevated)' }}>
            {modules.length === 0 && <Typography sx={{ px: 1.5, py: 1.25, color: 'var(--app-text-disabled)' }}>No modules loaded in this scope.</Typography>}
            {modules.map((m) => (
              <Box component="label" key={m.name} sx={rowSx}>
                <input type="checkbox" checked={enabledHere(m.name)} onChange={(e) => toggle(m.name, e.target.checked)} />
                <span style={{ fontWeight: 600, color: 'var(--app-text-strong)', minWidth: 110 }}>{m.name}</span>
                <span style={{ fontSize: '0.72rem', color: 'var(--app-text-disabled)', textTransform: 'uppercase', minWidth: 44 }}>{m.type}</span>
                <span style={{ fontSize: '0.8rem', color: 'var(--app-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.description}</span>
              </Box>
            ))}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ color: 'var(--app-text-muted)', textTransform: 'none' }}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={busy || loading} sx={{ textTransform: 'none', bgcolor: 'var(--app-accent)' }}>{busy ? 'Saving…' : 'Save'}</Button>
      </DialogActions>
    </Dialog>
  );
};
