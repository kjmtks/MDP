import React, { useState, useEffect } from 'react';
import { Dialog, DialogTitle, DialogContent, Typography, Box, IconButton, TextField, Button } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import QRCode from 'qrcode';

interface ConnectDialogProps {
  open: boolean;
  onClose: () => void;
  channelId: string;
}

export const ConnectDialog: React.FC<ConnectDialogProps> = ({ open, onClose, channelId }) => {
  const [copied, setCopied] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  
  const [hostname, setHostname] = useState(window.location.hostname);
  const [port, setPort] = useState(window.location.port);

  const remoteUrl = `${window.location.protocol}//${hostname}${port ? ':' + port : ''}/remote?channel=${channelId}`;

  useEffect(() => {
    if (open) {
      QRCode.toDataURL(remoteUrl, { width: 400, margin: 2 })
        .then(url => setQrCodeUrl(url))
        .catch(err => console.error(err));
    }
  }, [open, remoteUrl, channelId]);

  const handleCopy = () => {
    navigator.clipboard.writeText(channelId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        Connect Remote Device
        <IconButton
          aria-label="close"
          onClick={onClose}
          sx={{ position: 'absolute', right: 8, top: 8 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 4, py: 2 }}>
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <Typography variant="subtitle1" fontWeight="bold">Scan QR Code</Typography>
            {qrCodeUrl ? (
              <img src={qrCodeUrl} alt="QR Code" style={{ width: '100%', maxWidth: '250px', border: '1px solid #ddd', borderRadius: 8 }} />
            ) : (
              <Box sx={{ width: 200, height: 200, bgcolor: '#eee', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Generating...</Box>
            )}
            
            <Box sx={{ mt: 2, width: '100%' }}>
              <Typography variant="caption" color="textSecondary">
                If the QR code doesn't work (e.g. localhost), change the IP:
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, mt: 0.5 }}>
                <TextField 
                  label="Host / IP" 
                  value={hostname} 
                  onChange={(e) => setHostname(e.target.value)} 
                  size="small" 
                  fullWidth 
                />
                <TextField 
                  label="Port" 
                  value={port} 
                  onChange={(e) => setPort(e.target.value)} 
                  size="small" 
                  sx={{ width: 80 }} 
                />
              </Box>
            </Box>
          </Box>

          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 3 }}>
            <Box>
              <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                Or Enter Token Manually
              </Typography>
              <Typography variant="body2" color="textSecondary" gutterBottom>
                Open <b>/remote</b> on your device and enter this token:
              </Typography>
              
              <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                <TextField 
                  value={channelId} 
                  variant="outlined" 
                  fullWidth 
                  InputProps={{
                    readOnly: true,
                    style: { fontFamily: 'monospace', fontSize: '1.2rem', letterSpacing: '0.1em', textAlign: 'center', backgroundColor: '#f5f5f5' }
                  }}
                />
                <Button 
                  variant="contained" 
                  onClick={handleCopy} 
                  startIcon={<ContentCopyIcon />}
                  color={copied ? "success" : "primary"}
                  sx={{ minWidth: 100 }}
                >
                  {copied ? "Copied" : "Copy"}
                </Button>
              </Box>
            </Box>

            <Box>
              <Typography variant="caption" display="block" color="textSecondary">
                Direct URL:
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all', bgcolor: '#f9f9f9', p: 1, borderRadius: 1, border: '1px solid #eee' }}>
                {remoteUrl}
              </Typography>
            </Box>
          </Box>
        </Box>
      </DialogContent>
    </Dialog>
  );
};