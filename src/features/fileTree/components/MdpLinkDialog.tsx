import React, { useEffect, useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button, ToggleButtonGroup, ToggleButton, Stack, Typography, InputAdornment, IconButton } from '@mui/material';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import { apiClient, isElectron } from '../../../api/apiClient';
import { reportError } from '../../../components/error/errorReporter';

interface Props {
  open: boolean;
  // Create mode: directory the link is created in ('' = root).
  parentPath?: string;
  // Edit mode: the existing `.mdplink` path (its config is loaded and saved back).
  editPath?: string;
  onClose: () => void;
  onCreated: () => void;   // refresh the tree
}

const fieldSx = {
  '& .MuiInputBase-input': { color: 'var(--app-text-secondary)', fontSize: '0.85rem' },
  '& .MuiInputLabel-root': { color: 'var(--app-text-disabled)' },
  '& .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--app-border-subtle)' },
  '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--app-border-strong)' },
};

const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const baseOf = (p: string) => (p.split('/').pop() || '').replace(/\.mdplink$/i, '');

// Parse a `.mdplink`'s JSON, tolerating hand-edited Windows paths with unescaped
// backslashes (e.g. "C:\Users\me\.ssh\id" — invalid JSON). Mirrors the backend:
// escape every backslash (preserving any already-escaped pairs) and retry.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parseLinkLenient = (text: string): any => {
  try { return JSON.parse(text); }
  catch {
    const NUL = String.fromCharCode(0);
    return JSON.parse(text.split('\\\\').join(NUL).split('\\').join('\\\\').split(NUL).join('\\\\'));
  }
};

// Create or edit a `.mdplink` file — a symbolic-link-like pointer to another
// directory, LOCAL or a REMOTE dir over SSH/SFTP (with key-file auth). The link's
// <name> is the virtual directory name shown in the tree.
export const MdpLinkDialog: React.FC<Props> = ({ open, parentPath = '', editPath, onClose, onCreated }) => {
  const isEdit = !!editPath;
  const [name, setName] = useState('link');
  const [kind, setKind] = useState<'local' | 'ssh'>('local');
  const [localPath, setLocalPath] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [user, setUser] = useState('');
  const [remotePath, setRemotePath] = useState('');
  const [identityFile, setIdentityFile] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);

  // Load the existing config when opened in edit mode.
  useEffect(() => {
    if (!open) return;
    if (!editPath) {
      setName('link'); setKind('local'); setLocalPath(''); setHost(''); setPort('22'); setUser(''); setRemotePath(''); setIdentityFile(''); setPassphrase('');
      return;
    }
    let cancelled = false;
    (async () => {
      setName(baseOf(editPath));
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cfg: any = parseLinkLenient((await apiClient.getLinkConfig(editPath)) || '{}');
        if (cancelled) return;
        const t = (cfg.type || (cfg.host ? 'ssh' : 'local')) as 'local' | 'ssh';
        setKind(t);
        if (t === 'ssh') {
          setHost(cfg.host || ''); setPort(String(cfg.port || 22)); setUser(cfg.user || cfg.username || '');
          setRemotePath(cfg.path || ''); setIdentityFile(cfg.identityFile || cfg.privateKey || ''); setPassphrase(cfg.passphrase || '');
        } else {
          setLocalPath(cfg.path || '');
        }
      } catch (e) { if (!cancelled) reportError('Could not read the link configuration.', { detail: e }); }
    })();
    return () => { cancelled = true; };
  }, [open, editPath]);

  const canSubmit = name.trim() && (kind === 'local' ? localPath.trim() : (host.trim() && remotePath.trim()));

  const browseKey = async () => {
    const p = await apiClient.pickFile({ title: 'Select SSH private key', filters: [{ name: 'All files', extensions: ['*'] }] });
    // Store with forward slashes so the saved `.mdplink` is valid JSON without any
    // backslash-escaping (Windows accepts forward slashes in paths just fine).
    if (p) setIdentityFile(p.replace(/\\/g, '/'));
  };

  const submit = async () => {
    if (!canSubmit || busy) return;
    const cfg = kind === 'local'
      ? { type: 'local', path: localPath.trim() }
      : { type: 'ssh', host: host.trim(), port: Number(port) || 22, user: user.trim() || undefined,
          path: remotePath.trim(), identityFile: identityFile.trim() || undefined, passphrase: passphrase || undefined };
    const base = name.trim().replace(/\.mdplink$/i, '').replace(/[\\/:*?"<>|]/g, '_');
    const parent = isEdit ? dirOf(editPath!) : parentPath;
    const newPath = `${parent ? parent + '/' : ''}${base}.mdplink`;
    setBusy(true);
    try {
      await apiClient.setLinkConfig(newPath, JSON.stringify(cfg, null, 2));
      // A name change in edit mode means the file was renamed — drop the old one.
      if (isEdit && newPath !== editPath) await apiClient.deleteFiles([editPath!]);
      onCreated();
      onClose();
    } catch (e) {
      reportError(`Failed to ${isEdit ? 'update' : 'create'} the link.`, { detail: e });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm"
      slotProps={{ paper: { sx: { bgcolor: 'var(--app-bg-panel)', color: 'var(--app-text-secondary)' } } }}>
      <DialogTitle>{isEdit ? 'Link settings' : 'Add Link (.mdplink)'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography sx={{ fontSize: '0.78rem', color: 'var(--app-text-disabled)' }}>
            The link shows in the tree as a folder named <b>{(name.trim() || 'link').replace(/\.mdplink$/i, '')}</b> whose contents are the target's.
            {isEdit ? '' : (parentPath ? ` Created in /${parentPath}.` : ' Created at the workspace root.')}
          </Typography>
          <TextField label="Name (virtual folder)" size="small" value={name} onChange={(e) => setName(e.target.value)}
            helperText={`File: ${(name.trim() || 'link').replace(/\.mdplink$/i, '')}.mdplink`} sx={fieldSx} />

          <ToggleButtonGroup exclusive size="small" value={kind} onChange={(_, v) => v && setKind(v)}>
            <ToggleButton value="local" sx={{ textTransform: 'none', color: 'var(--app-text-secondary)' }}>Local folder</ToggleButton>
            <ToggleButton value="ssh" sx={{ textTransform: 'none', color: 'var(--app-text-secondary)' }}>SSH remote</ToggleButton>
          </ToggleButtonGroup>

          {kind === 'local' ? (
            <TextField label="Target folder path" size="small" value={localPath} onChange={(e) => setLocalPath(e.target.value)}
              placeholder="D:/shared/decks  or  ../sibling-folder" sx={fieldSx} />
          ) : (
            <>
              <Stack direction="row" spacing={1}>
                <TextField label="Host" size="small" value={host} onChange={(e) => setHost(e.target.value)} placeholder="example.com" sx={{ ...fieldSx, flex: 2 }} />
                <TextField label="Port" size="small" value={port} onChange={(e) => setPort(e.target.value)} sx={{ ...fieldSx, flex: 1 }} />
                <TextField label="User" size="small" value={user} onChange={(e) => setUser(e.target.value)} placeholder="tatke" sx={{ ...fieldSx, flex: 2 }} />
              </Stack>
              <TextField label="Remote folder path" size="small" value={remotePath} onChange={(e) => setRemotePath(e.target.value)} placeholder="/home/tatke/decks" sx={fieldSx} />
              <TextField label="SSH key file (identity file)" size="small" value={identityFile} onChange={(e) => setIdentityFile(e.target.value)}
                placeholder="C:/Users/tatke/.ssh/id_ed25519  (~ allowed)" sx={fieldSx}
                slotProps={isElectron() ? { input: { endAdornment: (
                  <InputAdornment position="end">
                    <IconButton size="small" title="Browse…" onClick={browseKey} sx={{ color: 'var(--app-text-muted)' }}><FolderOpenIcon fontSize="small" /></IconButton>
                  </InputAdornment>
                ) } } : undefined} />
              <TextField label="Key passphrase (optional)" size="small" type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} sx={fieldSx} />
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ color: 'var(--app-text-muted)', textTransform: 'none' }}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={!canSubmit || busy}
          sx={{ textTransform: 'none', bgcolor: 'var(--app-accent)' }}>{busy ? 'Saving…' : (isEdit ? 'Save' : 'Create')}</Button>
      </DialogActions>
    </Dialog>
  );
};
