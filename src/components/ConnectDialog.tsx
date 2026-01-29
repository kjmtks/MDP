import React, { useState } from 'react';
import { Dialog, DialogTitle, DialogContent, Typography, Box, IconButton, TextField, Button } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';

interface ConnectDialogProps {
  open: boolean;
  onClose: () => void;
  channelId: string;
}

export const ConnectDialog: React.FC<ConnectDialogProps> = ({ open, onClose, channelId }) => {
  const [copied, setCopied] = useState(false);

  // 接続用URL（参考表示用）
  const remoteUrl = `${window.location.protocol}//${window.location.hostname}:${window.location.port}/remote`;

  const handleCopy = () => {
    navigator.clipboard.writeText(channelId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        Remote Connection
        <IconButton
          aria-label="close"
          onClick={onClose}
          sx={{ position: 'absolute', right: 8, top: 8 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, py: 2 }}>
          
          <Typography variant="body1">
            1. Open the following URL on your iPad:
          </Typography>
          <Box sx={{ bgcolor: '#f5f5f5', p: 1.5, borderRadius: 1, fontFamily: 'monospace', fontWeight: 'bold', textAlign: 'center' }}>
            {remoteUrl}
          </Box>

          <Typography variant="body1">
            2. Enter this Connection Token:
          </Typography>
          
          <Box sx={{ display: 'flex', gap: 1 }}>
            <TextField 
              value={channelId} 
              variant="outlined" 
              fullWidth 
              InputProps={{
                readOnly: true,
                style: { fontFamily: 'monospace', fontSize: '1.2rem', letterSpacing: '0.1em', textAlign: 'center' }
              }}
            />
            <Button 
              variant="contained" 
              onClick={handleCopy} 
              startIcon={<ContentCopyIcon />}
              color={copied ? "success" : "primary"}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </Box>
        </Box>
      </DialogContent>
    </Dialog>
  );
};