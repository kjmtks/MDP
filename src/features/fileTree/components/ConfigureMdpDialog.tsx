import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, Box, CircularProgress, Stack, TextField } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import { apiClient } from '../../../api/apiClient';
import { reportError, notify } from '../../../components/error/errorReporter';
import { loadedModules } from '../../modules/moduleManager';
import { type MdpContent, parseContent, contentPath, effectiveDisabledModules, effectiveAiNotes } from '../../workspace/mdpContent';
import { resolveMdpConfigDirs, collectScopedAssetPaths } from '../../workspace/mdpScope';
import { buildSlideSpecPrompt } from '../../ai/slideSpecPrompt';
import { parseMdmodXml, type ModuleConfig } from '../../../utils/moduleParser';
import { parseMdpfxXml, type EffectConfig } from '../../../utils/effectParser';
import { syncOfficialCatalog } from '../../catalog/syncService';
import type { FileNode } from '../../../types';

interface Props {
  open: boolean;
  // The `.mdp` directory being configured (e.g. '.mdp' or 'alice/.mdp').
  configDir: string | null;
  // The workspace tree (for resolving this `.mdp`'s cascade chain).
  fileTree: FileNode[];
  onClose: () => void;
}

const rowSx = {
  display: 'flex', alignItems: 'center', gap: 1.25, px: 1.5, py: 0.75, cursor: 'pointer',
  borderBottom: '1px solid var(--app-border-subtle)',
};

const authorFieldSx = {
  '& .MuiInputBase-input': { color: 'var(--app-text)', fontSize: '0.85rem' },
  '& .MuiInputLabel-root': { color: 'var(--app-text-disabled)' },
  '& .MuiInputLabel-root.Mui-focused': { color: 'var(--app-accent)' },
  '& .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--app-border-subtle)' },
};

// Configure a single `.mdp`'s content profile (currently: which modules are enabled
// for the decks beneath it). Choices are written to `<configDir>/content.json` and
// cascade (nearest `.mdp` wins). Read-only-aware: a save that fails (e.g. a NAS share
// you don't own) is reported and the dialog stays open.
export const ConfigureMdpDialog: React.FC<Props> = ({ open, configDir, fileTree, onClose }) => {
  const [content, setContent] = useState<MdpContent>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [promptBusy, setPromptBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);

  // Folder that OWNS this `.mdp` ('' = workspace root) and its full cascade chain.
  const ownerDir = (configDir || '').replace(/\/?\.mdp$/, '');
  const chain = useMemo(
    () => (configDir ? resolveMdpConfigDirs(fileTree, `${ownerDir ? ownerDir + '/' : ''}_probe`) : []),
    [configDir, fileTree, ownerDir],
  );

  // Build the AI authoring prompt for THIS folder's scope: built-in assets plus the
  // chain's custom modules/effects (nearest wins), minus modules disabled here.
  const copyScopedPrompt = async () => {
    if (!configDir || promptBusy) return;
    setPromptBusy(true);
    try {
      const [allMods, allFx, themes] = await Promise.all([
        apiClient.getModules(), apiClient.getEffects(), apiClient.getThemes(chain),
      ]);
      const modByName = new Map<string, ModuleConfig>();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await Promise.all(allMods.filter((m: any) => !m.isCustom).map(async (m: any) => {
        try { const d = parseMdmodXml(await apiClient.getModuleContent(m.path)); if (d) modByName.set(d.config.name, d.config); } catch { /* skip */ }
      }));
      for (const p of collectScopedAssetPaths(fileTree, chain, 'modules', '.mdpmod.xml')) {
        try { const d = parseMdmodXml(await apiClient.readFileText(p)); if (d) modByName.set(d.config.name, d.config); } catch { /* skip */ }
      }
      const contents: MdpContent[] = [];
      for (const cdir of chain) {
        try { contents.push(parseContent(await apiClient.readFileText(contentPath(cdir)))); } catch { contents.push({}); }
      }
      const disabled = new Set(effectiveDisabledModules(contents));
      const fxByName = new Map<string, EffectConfig>();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await Promise.all(allFx.filter((f: any) => !f.isCustom).map(async (f: any) => {
        try { const d = parseMdpfxXml(await apiClient.getEffectContent(f.path)); if (d) fxByName.set(d.config.name, d.config); } catch { /* skip */ }
      }));
      for (const p of collectScopedAssetPaths(fileTree, chain, 'effects', '.mdpfx.xml')) {
        try { const d = parseMdpfxXml(await apiClient.readFileText(p)); if (d) fxByName.set(d.config.name, d.config); } catch { /* skip */ }
      }
      const prompt = buildSlideSpecPrompt(
        [...modByName.values()].filter((c) => !disabled.has(c.name)),
        // Ancestors' saved notes + THIS dialog's live (possibly unsaved) notes.
        { effects: [...fxByName.values()], themes, aiNotes: effectiveAiNotes([...contents.slice(0, -1), content]) },
      );
      await navigator.clipboard.writeText(prompt);
      notify('Copied the AI prompt for this folder.');
    } catch (e) {
      reportError('Could not build the AI prompt.', { detail: e });
    } finally {
      setPromptBusy(false);
    }
  };

  // Download the official assets INTO this `.mdp` (internet required). The sync
  // events refresh the editor's tree/modules/themes automatically.
  const syncHere = async () => {
    if (syncBusy) return;
    setSyncBusy(true);
    try {
      await syncOfficialCatalog(ownerDir ? `${ownerDir}/` : '');
      notify(`Official assets downloaded into ${configDir}.`);
    } catch {
      reportError('Download failed — check your internet connection.');
    } finally {
      setSyncBusy(false);
    }
  };

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

  const setAuthorField = (k: 'name' | 'affiliation' | 'email', v: string) =>
    setContent((prev) => ({ ...prev, author: { ...(prev.author || {}), [k]: v } }));

  const save = async () => {
    if (!configDir || busy) return;
    setBusy(true);
    try {
      const mods = content.modules || {};
      const author = Object.fromEntries(Object.entries(content.author || {}).filter(([, v]) => String(v || '').trim()));
      const aiNotes = (content.aiNotes || '').trim();
      const payload: MdpContent = {
        version: 1,
        modules: Object.fromEntries(Object.entries(mods).filter(([, v]) => v === false)),
        ...(Object.keys(author).length ? { author } : {}),
        ...(aiNotes ? { aiNotes } : {}),
      };
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

        <Typography sx={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--app-text-strong)', mt: 2, mb: 0.5 }}>Author profile (this folder)</Typography>
        <Typography sx={{ fontSize: '0.72rem', color: 'var(--app-text-disabled)', mb: 1 }}>
          Pre-fills <code>@presenter / @affiliation / @contact</code> on decks created under this folder. Empty fields inherit from the parent <code>.mdp</code>, then the app-wide profile (Settings → Author profile).
        </Typography>
        <Stack direction="row" spacing={1}>
          <TextField label="Name" size="small" value={content.author?.name || ''} onChange={(e) => setAuthorField('name', e.target.value)} sx={{ ...authorFieldSx, flex: 1 }} />
          <TextField label="Affiliation" size="small" value={content.author?.affiliation || ''} onChange={(e) => setAuthorField('affiliation', e.target.value)} sx={{ ...authorFieldSx, flex: 1 }} />
          <TextField label="Email" size="small" value={content.author?.email || ''} onChange={(e) => setAuthorField('email', e.target.value)} sx={{ ...authorFieldSx, flex: 1 }} />
        </Stack>

        <Typography sx={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--app-text-strong)', mt: 2, mb: 0.5 }}>AI instructions (this folder)</Typography>
        <Typography sx={{ fontSize: '0.72rem', color: 'var(--app-text-disabled)', mb: 1 }}>
          House style for AIs authoring decks under this folder — appended to the slide spec (the “Copy AI prompt” button below and the MCP integration both include it). Accumulates with the parent <code>.mdp</code>'s instructions. E.g. “Use the lab template, keep to 12 slides, cite sources on each data slide.”
        </Typography>
        <TextField
          multiline minRows={3} maxRows={10} fullWidth size="small"
          placeholder="e.g. Formal Japanese (です・ます). One idea per slide. Prefer @callout for takeaways."
          value={content.aiNotes || ''}
          onChange={(e) => setContent((prev) => ({ ...prev, aiNotes: e.target.value }))}
          sx={authorFieldSx}
        />
      </DialogContent>
      <DialogContent sx={{ pt: 0 }}>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Button size="small" variant="outlined" startIcon={promptBusy ? <CircularProgress size={14} sx={{ color: 'var(--app-accent)' }} /> : <ContentCopyIcon fontSize="small" />}
            onClick={copyScopedPrompt} disabled={promptBusy}
            sx={{ textTransform: 'none', color: 'var(--app-text-secondary)', borderColor: 'var(--app-border-strong)' }}>
            Copy AI prompt (this folder)
          </Button>
          <Button size="small" variant="outlined" startIcon={syncBusy ? <CircularProgress size={14} sx={{ color: 'var(--app-accent)' }} /> : <CloudDownloadIcon fontSize="small" />}
            onClick={syncHere} disabled={syncBusy}
            sx={{ textTransform: 'none', color: 'var(--app-text-secondary)', borderColor: 'var(--app-border-strong)' }}>
            Get official assets into this folder
          </Button>
        </Stack>
        <Typography sx={{ fontSize: '0.72rem', color: 'var(--app-text-disabled)', mt: 1 }}>
          The prompt covers exactly what decks under this folder can use (its cascade: {chain.join(' → ') || '—'}).
          The download writes modules/themes/templates/snippets into this <code>.mdp</code> (internet required).
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ color: 'var(--app-text-muted)', textTransform: 'none' }}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={busy || loading} sx={{ textTransform: 'none', bgcolor: 'var(--app-accent)' }}>{busy ? 'Saving…' : 'Save'}</Button>
      </DialogActions>
    </Dialog>
  );
};
