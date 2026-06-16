import React, { useEffect, useRef } from 'react';
import { Dialog, AppBar, Toolbar, Typography, IconButton, Box } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { isElectron } from '../../../api/apiClient';

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

  const drawioUrl = isElectron()
    ? 'app-asset://drawio/index.html?embed=1&ui=atlas&spin=1&proto=json&libraries=1&stealth=1'
    : '/drawio/index.html?embed=1&ui=atlas&spin=1&proto=json&libraries=1&stealth=1';

  useEffect(() => {
    // Only the OPEN editor may handle drawio iframe messages. All DrawioEditor
    // instances stay mounted (only `open` toggles), so without this gate every
    // instance's onSave fires on a single save — e.g. editing a library diagram
    // would also trigger the editor-insert instance and drop `![@drawio](…)` into
    // the document.
    if (!open) return;
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
             xml: msg.xml,
             embedImages: true,
             embedFonts: true
           }), '*');
        }
        if (msg.event === 'export') {
           let finalData = msg.data;

           if (finalData.startsWith('data:image/svg+xml')) {
             const b64 = finalData.split(',')[1] || finalData;
             const binStr = atob(b64);
             const bytes = new Uint8Array(binStr.length);
             for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
             finalData = new TextDecoder('utf-8').decode(bytes);
           }

           finalData = finalData
               .replace(/&nbsp;/g, '&#160;')
               .replace(/&copy;/g, '&#169;')
               .replace(/&reg;/g, '&#174;');

           const bytes = new TextEncoder().encode(finalData);
           const binString = Array.from(bytes, (byte) => String.fromCodePoint(byte)).join("");
           const base64Data = btoa(binString);
           const dataUri = `data:image/svg+xml;base64,${base64Data}`;

           onSave(dataUri);
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
  }, [open, initialBase64Xml, onClose, onSave]);

  return (
    <Dialog
      open={open}
      fullScreen
      onClose={onClose}
      disableRestoreFocus
      disableEnforceFocus
      disableAutoFocus
      sx={{
        top: isElectron() ? '32px' : 0,
      }}
      slotProps={{
        paper: {
          sx: {
            height: isElectron() ? 'calc(100% - 32px)' : '100%',
            maxHeight: isElectron() ? 'calc(100% - 32px)' : '100%',
          }
        }
      }}
    >
      <AppBar sx={{ position: 'relative', bgcolor: '#333', flexShrink: 0, zIndex: 1300 }}>
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