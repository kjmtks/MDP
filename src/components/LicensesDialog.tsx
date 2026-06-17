import React from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button } from '@mui/material';

import licensesText from '../../public/ThirdPartyNotices.txt?raw';

interface LicensesDialogProps {
  open: boolean;
  onClose: () => void;
}

export const LicensesDialog: React.FC<LicensesDialogProps> = ({ open, onClose }) => {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth scroll="paper">
      <DialogTitle sx={{ bgcolor: 'var(--app-bg-panel)', color: 'var(--app-text-secondary)', borderBottom: '1px solid var(--app-border)' }}>
        Third-Party Licenses
      </DialogTitle>
      <DialogContent dividers sx={{ bgcolor: 'var(--app-bg-editor)', p: 0 }}>
        <pre style={{
          margin: 0, padding: '20px', color: 'var(--app-text-secondary)',
          fontFamily: 'monospace', fontSize: '0.85rem',
          whiteSpace: 'pre-wrap', wordWrap: 'break-word'
        }}>
          {licensesText || 'Cannot find license information.'}
        </pre>
      </DialogContent>
      <DialogActions sx={{ bgcolor: 'var(--app-bg-panel)', borderTop: '1px solid var(--app-border)' }}>
        <Button onClick={onClose} sx={{ color: 'var(--app-accent)', textTransform: 'none' }}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};
