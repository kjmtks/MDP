import React, { useEffect, useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Stack, Typography, FormControlLabel, Checkbox, TextField, LinearProgress } from '@mui/material';
import { apiClient } from '../../../api/apiClient';
import { confirmDialog } from '../../../components/error/errorReporter';

interface Props { open: boolean; onClose: () => void; }

type Info = { enabled: boolean; maxBytes: number; usedBytes: number; count: number };

const fmt = (b: number) => b >= 1024 * 1024 * 1024 ? `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`
  : b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB`
  : `${Math.max(0, Math.round(b / 1024))} KB`;

const fieldSx = {
  '& .MuiInputBase-input': { color: 'var(--app-text)', fontSize: '0.85rem' },
  '& .MuiInputLabel-root': { color: 'var(--app-text-disabled)' },
  '& .MuiInputLabel-root.Mui-focused': { color: 'var(--app-accent)' },
  '& .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--app-border-subtle)' },
};

// Offline cache for remote (`.mdplink` SSH) files: enable/disable, size cap, and a
// clear action. Files a slide references are cached on read (and via "Pin deck for
// offline"); when offline the cached copies are served.
export const OfflineCacheDialog: React.FC<Props> = ({ open, onClose }) => {
  const [info, setInfo] = useState<Info | null>(null);
  const [maxMb, setMaxMb] = useState('300');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    apiClient.getCacheInfo().then((i) => { setInfo(i); setMaxMb(String(Math.round(i.maxBytes / 1024 / 1024))); }).catch(() => {});
  }, [open]);

  const apply = async (cfg: { enabled?: boolean; maxBytes?: number }) => {
    setBusy(true);
    try { setInfo(await apiClient.setCacheConfig(cfg)); } finally { setBusy(false); }
  };

  const onClear = async () => {
    if (!(await confirmDialog('Delete all cached remote files? They will be re-downloaded when next needed (online).', { title: 'Clear offline cache', confirmText: 'Clear', cancelText: 'Cancel', severity: 'warning' }))) return;
    setBusy(true);
    try { setInfo(await apiClient.clearCache()); } finally { setBusy(false); }
  };

  const usedPct = info && info.maxBytes > 0 ? Math.min(100, (info.usedBytes / info.maxBytes) * 100) : 0;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs"
      slotProps={{ paper: { sx: { bgcolor: 'var(--app-bg-panel)', color: 'var(--app-text-secondary)' } } }}>
      <DialogTitle>Offline cache</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography sx={{ fontSize: '0.78rem', color: 'var(--app-text-disabled)' }}>
            Remote files behind a <b>.mdplink</b> (SSH) are cached on this machine when read, so the slides that reference them keep working offline. Local files are never cached.
          </Typography>

          <FormControlLabel
            control={<Checkbox size="small" checked={!!info?.enabled} disabled={busy || !info} onChange={(e) => apply({ enabled: e.target.checked })} sx={{ color: 'var(--app-text-muted)' }} />}
            label={<Typography sx={{ fontSize: '0.85rem', color: 'var(--app-text-secondary)' }}>Enable offline cache</Typography>}
          />

          <Stack direction="row" spacing={1} alignItems="center">
            <TextField label="Max size (MB)" size="small" value={maxMb} onChange={(e) => setMaxMb(e.target.value.replace(/[^\d]/g, ''))}
              onBlur={() => { const mb = Math.max(10, Number(maxMb) || 0); setMaxMb(String(mb)); apply({ maxBytes: mb * 1024 * 1024 }); }}
              sx={{ ...fieldSx, width: 140 }} disabled={busy} />
            <Typography sx={{ fontSize: '0.78rem', color: 'var(--app-text-disabled)' }}>
              Used: {info ? `${fmt(info.usedBytes)} · ${info.count} files` : '—'}
            </Typography>
          </Stack>
          <LinearProgress variant="determinate" value={usedPct} sx={{ height: 6, borderRadius: 3, bgcolor: 'var(--app-bg-editor)', '& .MuiLinearProgress-bar': { bgcolor: 'var(--app-accent)' } }} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClear} disabled={busy || !info || info.usedBytes === 0} sx={{ color: 'var(--app-danger)', textTransform: 'none', mr: 'auto' }}>Clear cache</Button>
        <Button onClick={onClose} sx={{ color: 'var(--app-text-muted)', textTransform: 'none' }}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};
