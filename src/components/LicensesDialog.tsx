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
      <DialogTitle sx={{ bgcolor: '#252526', color: '#cccccc', borderBottom: '1px solid #333333' }}>
        Third-Party Licenses
      </DialogTitle>
      <DialogContent dividers sx={{ bgcolor: '#1e1e1e', p: 0 }}>
        <pre style={{
          margin: 0, padding: '20px', color: '#cccccc',
          fontFamily: 'monospace', fontSize: '0.85rem',
          whiteSpace: 'pre-wrap', wordWrap: 'break-word'
        }}>
          {licensesText || 'Cannot find license information.'}
        </pre>
      </DialogContent>
      <DialogActions sx={{ bgcolor: '#252526', borderTop: '1px solid #333333' }}>
        <Button onClick={onClose} sx={{ color: '#3b82f6', textTransform: 'none' }}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};