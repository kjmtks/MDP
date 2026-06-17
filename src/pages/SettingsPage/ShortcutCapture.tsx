import React, { useEffect } from 'react';
import { Dialog, DialogContent, Typography } from '@mui/material';
import { eventToCombo } from '../../features/settings/shortcuts/matcher';

interface Props {
  open: boolean;
  onCapture: (combo: string) => void;
  onCancel: () => void;
}

// Captures the next key combination. Esc (no modifiers) cancels.
export const ShortcutCapture: React.FC<Props> = ({ open, onCapture, onCancel }) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        onCancel();
        return;
      }
      const combo = eventToCombo(e);
      if (!combo) return; // bare modifier — keep waiting
      onCapture(combo);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true } as EventListenerOptions);
  }, [open, onCapture, onCancel]);

  return (
    <Dialog open={open} onClose={onCancel} slotProps={{ paper: { sx: { bgcolor: 'var(--app-bg-panel)', color: 'var(--app-text)', backgroundImage: 'none', border: '1px solid var(--app-border)' } } }}>
      <DialogContent sx={{ minWidth: 320, textAlign: 'center', py: 5 }}>
        <Typography sx={{ mb: 1, fontWeight: 600 }}>Press the key combination…</Typography>
        <Typography variant="caption" sx={{ color: 'var(--app-text-muted)' }}>Press Esc to cancel</Typography>
      </DialogContent>
    </Dialog>
  );
};
