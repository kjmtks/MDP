import React, { useEffect, useRef } from 'react';
import { Dialog, AppBar, Toolbar, Typography, IconButton, Box } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';

interface DrawioEditorProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: string) => void;
  initialBase64Xml?: string;
}
const decodeBase64 = (str: string) => {
  try {
    return decodeURIComponent(escape(atob(str)));
  } catch (e) {
    console.error("Base64 decode error", e);
    return "";
  }
};

export const DrawioEditor: React.FC<DrawioEditorProps> = ({ open, onClose, onSave, initialBase64Xml }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const origin = typeof window !== 'undefined' && window.location.port === '5173' 
    ? 'http://localhost:3000' 
    : '';
  const drawioUrl = `${origin}/drawio/index.html?embed=1&ui=atlas&spin=1&proto=json&libraries=1&offline=1`;
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!event.data || typeof event.data !== 'string') return;
      try {
        const msg = JSON.parse(event.data);
        if (msg.event === 'init') {
          let xml = "";
          if (initialBase64Xml) {
            if (initialBase64Xml.startsWith('data:')) {
               xml = initialBase64Xml;
            } else {
               xml = decodeBase64(initialBase64Xml);
            }
          }
          iframeRef.current?.contentWindow?.postMessage(JSON.stringify({
            action: 'load',
            autosave: 0, 
            xml: xml
          }), '*');
        }
        if (msg.event === 'save') {
           iframeRef.current?.contentWindow?.postMessage(JSON.stringify({
             action: 'export',
             format: 'xmlsvg',
             spin: 'Saving...',
             xml: msg.xml
           }), '*');
        }
        if (msg.event === 'export') {
           onSave(msg.data); 
           onClose();
        }
        if (msg.event === 'exit') {
          onClose();
        }
      } catch {
        // ignore
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [initialBase64Xml, onClose, onSave]);

  return (
    <Dialog 
      open={open} 
      fullScreen 
      onClose={onClose}
    >
      <AppBar sx={{ position: 'relative', bgcolor: '#333', flexShrink: 0 }}>
        <Toolbar variant="dense">
          <IconButton edge="start" color="inherit" onClick={onClose} aria-label="close">
            <CloseIcon />
          </IconButton>
          <Typography sx={{ ml: 2, flex: 1 }} variant="h6" component="div">
            Diagram Editor
          </Typography>
        </Toolbar>
      </AppBar>
      <Box sx={{ flexGrow: 1, width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
        <iframe
          ref={iframeRef}
          src={drawioUrl}
          style={{ 
            width: '100%', 
            height: '100%', 
            border: 'none',
            display: 'block',
            position: 'absolute',
            top: 0,
            left: 0
          }}
          title="drawio-editor"
        />
      </Box>
    </Dialog>
  );
};