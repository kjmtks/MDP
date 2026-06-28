import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import type { ViewUpdate } from '@uiw/react-codemirror';
import { Box, Typography, Button, IconButton, Tooltip, Stack, List, ListItem, ListItemButton, ListItemText, ListSubheader, Divider, Menu, MenuItem, ListItemIcon, TextField, InputAdornment, CircularProgress } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import EditIcon from '@mui/icons-material/Edit';
import CloseIcon from '@mui/icons-material/Close';
import CloseFullscreenIcon from '@mui/icons-material/CloseFullscreen';
import ClearAllIcon from '@mui/icons-material/ClearAll';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import CachedIcon from '@mui/icons-material/Cached';
import SmartphoneIcon from '@mui/icons-material/Smartphone';
import DevicesIcon from '@mui/icons-material/Devices';
import PresentToAllIcon from '@mui/icons-material/PresentToAll';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PrintIcon from '@mui/icons-material/Print';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import SlideshowIcon from '@mui/icons-material/Slideshow';
import GridViewIcon from '@mui/icons-material/GridView';
import ControlCameraIcon from '@mui/icons-material/ControlCamera';
import GridOnIcon from '@mui/icons-material/GridOn';
import SyncIcon from '@mui/icons-material/Sync';
import SyncDisabledIcon from '@mui/icons-material/SyncDisabled';
import RefreshIcon from '@mui/icons-material/Refresh';
import type { IDockviewPanelProps, IDockviewPanelHeaderProps } from 'dockview';

import { darkMenuSlotProps } from './darkMenu';

import { Table, TableBody, TableRow, TableCell, Dialog, DialogTitle, DialogContent, DialogActions, ToggleButtonGroup, ToggleButton, Chip, Popover, Autocomplete } from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternate';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import InputIcon from '@mui/icons-material/Input';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import BrokenImageIcon from '@mui/icons-material/BrokenImage';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import CollectionsBookmarkOutlinedIcon from '@mui/icons-material/CollectionsBookmarkOutlined';
import AccountTreeIcon from '@mui/icons-material/AccountTree';

import { Sidebar } from '../../../features/fileTree/components/Sidebar';
import { EditorPanel } from '../../../features/editor/components/EditorPanel';
import { SlideView } from '../../../features/slide/components/SlideView';
import { PdfView } from '../../../features/pdf/PdfView';
import { SlideScaler } from '../../../features/slide/components/SlideScaler';
import { SlideControls } from '../../../features/drawing/components/SlideControls';
import { useSidebar, usePreview, useEditor, useSnippets, useImages, useHeaderActions } from './DockContext';
import type { EditorSharedProps } from './DockContext';
import type { OpenTab } from '../../../features/fileTree/hooks/useFileManager';
import type { ImageEntry } from '../../../features/images/imageRegistry';
import { compressImageToBase64 } from '../../../utils/imageUtils';


import { isElectron } from '../../../api/apiClient';

const toolbarSx = {
  display: 'flex', alignItems: 'center', gap: 0.5, px: 0.5, py: 0.25,
  bgcolor: 'var(--app-bg-editor)', borderBottom: '1px solid var(--app-border)', flexShrink: 0,
};
const toolBtnSx = { color: 'var(--app-text-muted)', '&:hover': { color: 'var(--app-text-strong)' }, '&.Mui-disabled': { color: 'var(--app-text-disabled)' } };

export const ExplorerPanel: React.FC = () => {
  const sidebar = useSidebar();
  const h = useHeaderActions();
  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'var(--app-bg-panel)' }}>
      {h.onOpenFolder && (
        <Box sx={toolbarSx}>
          <Tooltip title="Open Folder"><IconButton size="small" sx={toolBtnSx} onClick={h.onOpenFolder}><FolderOpenIcon fontSize="small" /></IconButton></Tooltip>
        </Box>
      )}
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <Sidebar {...sidebar} section="files" />
      </Box>
    </Box>
  );
};

export const ThumbnailsPanel: React.FC = () => {
  const sidebar = useSidebar();
  return <Sidebar {...sidebar} section="thumbnail" />;
};

export const BookmarksPanel: React.FC = () => {
  const sidebar = useSidebar();
  return <Sidebar {...sidebar} section="bookmarks" />;
};

export const SnippetsPanel: React.FC = () => {
  const { snippets, onInsertText } = useSnippets();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    // AND search: every whitespace-separated term must match (across label,
    // description, category).
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return snippets;
    return snippets
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => {
          const hay = `${item.label} ${item.description || ''} ${section.category}`.toLowerCase();
          return terms.every((t) => hay.includes(t));
        }),
      }))
      .filter((section) => section.items.length > 0);
  }, [snippets, query]);

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'var(--app-bg-panel)' }}>
      <Box sx={{ p: 0.75, borderBottom: '1px solid var(--app-border)' }}>
        <TextField
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search snippets…"
          size="small"
          fullWidth
          variant="outlined"
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start"><SearchIcon fontSize="small" sx={{ color: 'var(--app-text-disabled)' }} /></InputAdornment>
              ),
              sx: { color: 'var(--app-text-secondary)', fontSize: '0.8rem', bgcolor: 'var(--app-bg-editor)', '& fieldset': { borderColor: 'var(--app-border-subtle)' }, '&:hover fieldset': { borderColor: 'var(--app-border-strong)' } },
            },
          }}
        />
      </Box>
      <Box sx={{ flex: 1, overflowY: 'auto' }}>
        {filtered.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'var(--app-text-disabled)', textAlign: 'center', p: 2 }}>No matching snippets.</Typography>
        ) : (
        <List subheader={<li />} sx={{ p: 0 }}>
          {filtered.map((section) => (
            <li key={section.category}>
              <Box component="ul" sx={{ p: 0, m: 0 }}>
                <ListSubheader sx={{ bgcolor: 'var(--app-bg-editor)', color: 'var(--app-text-secondary)', lineHeight: '30px', fontWeight: 'bold', borderBottom: '1px solid var(--app-border)' }}>
                  {section.category}
                </ListSubheader>
                {section.items.map((item) => (
                  <ListItem key={item.label} disablePadding>
                    <ListItemButton onClick={() => onInsertText(item.text)} sx={{ py: 0.5, '&:hover': { bgcolor: 'var(--app-bg-hover)' } }}>
                      {item.icon && (
                        <div style={{ marginRight: '8px', display: 'flex', alignItems: 'center', width: '20px', height: '20px', fill: 'var(--app-text-secondary)' }} dangerouslySetInnerHTML={{ __html: item.icon }} />
                      )}
                      <ListItemText
                        primary={item.label}
                        slotProps={{
                          primary: { fontSize: '0.85rem', color: 'var(--app-text-secondary)', fontWeight: item.isCustom ? 'bold' : 'normal' },
                          secondary: { fontSize: '0.7rem', color: 'var(--app-text-disabled)' },
                        }}
                        secondary={item.description}
                      />
                    </ListItemButton>
                  </ListItem>
                ))}
                <Divider sx={{ borderColor: 'var(--app-border)' }} />
              </Box>
            </li>
          ))}
        </List>
        )}
      </Box>
    </Box>
  );
};

const isSvgValue = (value: string) =>
  value.startsWith('data:image/svg+xml') || /\.svg(\?|$)/i.test(value);

// Convert a file to an image value. SVGs (incl. drawio's editable .drawio.svg)
// are read AS-IS so the embedded XML survives; raster images are compressed.
function fileToImageValue(file: File): Promise<string> {
  if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }
  return compressImageToBase64(file);
}

// Extract an image from a drop / paste: an image file → data URI (SVG preserved),
// or pasted text that is an image URL / data URI.
async function imageFromTransfer(dt: DataTransfer | null): Promise<string | null> {
  if (!dt) return null;
  const files: File[] = [
    ...Array.from(dt.files || []),
    ...Array.from(dt.items || [])
      .filter((it) => it.kind === 'file')
      .map((it) => it.getAsFile())
      .filter((f): f is File => !!f),
  ];
  const imgFile = files.find((f) => f.type.startsWith('image/'));
  if (imgFile) { try { return await fileToImageValue(imgFile); } catch { return null; } }
  const text = (dt.getData('text/plain') || '').trim();
  if (/^(https?:\/\/|data:image\/)/.test(text)) return text;
  return null;
}

// True only for OS-file or image-URL drags — so Dockview tab drags (which carry
// just an empty text/plain) aren't intercepted by the Images panel drop zone.
const isImageDrag = (e: React.DragEvent) => {
  const t = e.dataTransfer?.types;
  return !!t && Array.from(t).some((x) => x === 'Files' || x === 'text/uri-list');
};

const scopeBtnSx = {
  color: 'var(--app-text-disabled)', fontSize: '0.72rem', textTransform: 'none', py: 0.4,
  '&.Mui-selected': {
    bgcolor: 'var(--app-accent)', color: 'var(--app-accent-contrast)',
    '&:hover': { bgcolor: 'color-mix(in srgb, var(--app-accent) 85%, black)' },
  },
};

const imgType = (value: string): string =>
  value.startsWith('data:') ? 'data' : /^https?:/.test(value) ? 'url' : 'path';

const imgSize = (value: string): string => {
  if (!value.startsWith('data:')) return '—';
  const b64 = value.split(',')[1] || '';
  const bytes = Math.floor((b64.length * 3) / 4);
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
};

const ImageRow: React.FC<{
  entry: ImageEntry; overrides: boolean; moveDisabled?: boolean; highlight: boolean; resolveThumb: (v: string) => string;
  onInsert: (alias: string) => void; onEdit: (e: ImageEntry) => void;
  onDelete: (e: ImageEntry) => void; onMove: (alias: string, to: 'file' | 'library') => void;
  onEditDrawio?: (e: ImageEntry) => void; onPreview?: (e: ImageEntry) => void;
}> = ({ entry, overrides, moveDisabled, highlight, resolveThumb, onInsert, onEdit, onDelete, onMove, onEditDrawio, onPreview }) => {
  const [broken, setBroken] = useState(false);
  const [hoverEl, setHoverEl] = useState<HTMLElement | null>(null);
  const src = resolveThumb(entry.value);
  // List detail: show size for inline data, otherwise the actual path/URL (so it
  // matches the edit dialog instead of showing a meaningless "—").
  const detail = entry.value.startsWith('data:') ? `${imgType(entry.value)} · ${imgSize(entry.value)}` : entry.value;
  return (
    <TableRow sx={{ bgcolor: highlight ? 'var(--app-accent-soft)' : undefined, '&:hover': { bgcolor: 'var(--app-bg-hover)' } }}>
      <TableCell sx={{ border: 0, p: 0.5, width: 48 }}>
        <Box onMouseEnter={(e) => setHoverEl(e.currentTarget)} onMouseLeave={() => setHoverEl(null)} sx={{ width: 40, height: 40 }}>
          {broken
            ? <BrokenImageIcon sx={{ color: 'var(--app-text-disabled)', width: 40, height: 40 }} />
            : <img src={src} onError={() => setBroken(true)} alt={entry.alias}
                style={{ width: 40, height: 40, objectFit: 'contain', background: '#fff', borderRadius: 4, cursor: 'zoom-in' }} />}
        </Box>
        {!broken && (
          <Popover open={!!hoverEl} anchorEl={hoverEl} onClose={() => setHoverEl(null)} disableRestoreFocus
            sx={{ pointerEvents: 'none' }} anchorOrigin={{ vertical: 'center', horizontal: 'right' }}
            transformOrigin={{ vertical: 'center', horizontal: 'left' }}
            slotProps={{ paper: { sx: { p: 0.5, ml: 1, bgcolor: 'var(--app-bg-editor)', border: '1px solid var(--app-border-strong)' } } }}>
            <img src={src} alt={entry.alias} style={{ maxWidth: 320, maxHeight: 320, objectFit: 'contain', background: '#fff', display: 'block' }} />
          </Popover>
        )}
      </TableCell>
      <TableCell sx={{ border: 0, p: 0.5 }}>
        <div style={{ color: 'var(--app-text)', fontSize: '0.82rem', fontWeight: 'bold', wordBreak: 'break-all' }}>{entry.alias}</div>
        <div style={{ color: 'var(--app-text-disabled)', fontSize: '0.68rem', wordBreak: 'break-all' }}>{detail}</div>
        {entry.description && <div style={{ color: 'var(--app-text-disabled)', fontSize: '0.66rem', fontStyle: 'italic', wordBreak: 'break-word' }}>{entry.description}</div>}
        {entry.tags && entry.tags.length > 0 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.25, mt: 0.25 }}>
            {entry.tags.map((t) => (
              <Chip key={t} label={t} size="small" sx={{ height: 16, fontSize: '0.6rem', color: 'var(--app-accent)', bgcolor: 'var(--app-accent-soft)' }} />
            ))}
          </Box>
        )}
        {overrides && <Chip label="overrides library" size="small" sx={{ height: 16, fontSize: '0.6rem', color: 'var(--app-warning)', bgcolor: 'var(--app-warning-soft)', mt: 0.25 }} />}
      </TableCell>
      <TableCell align="right" sx={{ border: 0, p: 0.25, whiteSpace: 'nowrap', width: '1%' }}>
        {onPreview && (
          <Tooltip title="Preview in panel"><IconButton size="small" sx={toolBtnSx} onClick={() => onPreview(entry)}><VisibilityIcon fontSize="small" /></IconButton></Tooltip>
        )}
        <Tooltip title="Insert reference"><IconButton size="small" sx={toolBtnSx} onClick={() => onInsert(entry.alias)}><InputIcon fontSize="small" /></IconButton></Tooltip>
        {onEditDrawio && isSvgValue(entry.value) && (
          <Tooltip title="Edit in drawio"><IconButton size="small" sx={toolBtnSx} onClick={() => onEditDrawio(entry)}><AccountTreeIcon fontSize="small" /></IconButton></Tooltip>
        )}
        <Tooltip title="Edit"><IconButton size="small" sx={toolBtnSx} onClick={() => onEdit(entry)}><EditIcon fontSize="small" /></IconButton></Tooltip>
        <Tooltip title={moveDisabled ? 'Cannot move: this alias exists in both this file and the library' : (entry.scope === 'file' ? 'Move to library' : 'Move to file')}>
          <span><IconButton size="small" sx={toolBtnSx} disabled={moveDisabled} onClick={() => onMove(entry.alias, entry.scope === 'file' ? 'library' : 'file')}><SwapHorizIcon fontSize="small" /></IconButton></span>
        </Tooltip>
        <Tooltip title="Delete"><IconButton size="small" sx={toolBtnSx} onClick={() => onDelete(entry)}><DeleteOutlineIcon fontSize="small" /></IconButton></Tooltip>
      </TableCell>
    </TableRow>
  );
};

export const ImagesPanel: React.FC = () => {
  const img = useImages();
  const [dialog, setDialog] = useState<null | { mode: 'add' | 'edit'; scope: 'file' | 'library'; alias: string; value: string; description: string; tags: string[] }>(null);
  const [dragOver, setDragOver] = useState(false);
  const [query, setQuery] = useState('');
  const panelFocused = useRef(false);

  const libAliases = useMemo(() => new Set(img.libraryImages.map((e) => e.alias)), [img.libraryImages]);
  const fileAliases = useMemo(() => new Set(img.fileImages.map((e) => e.alias)), [img.fileImages]);
  // All tags across file + library, for the dialog's tag autocomplete suggestions.
  const allTags = useMemo(
    () => Array.from(new Set([...img.fileImages, ...img.libraryImages].flatMap((e) => e.tags || []))).sort(),
    [img.fileImages, img.libraryImages],
  );

  // Filter an entry by the search query against alias, description and tags.
  // AND search: every whitespace-separated term must match somewhere.
  const matchesQuery = (e: ImageEntry) => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return true;
    const hay = `${e.alias} ${e.description || ''} ${(e.tags || []).join(' ')}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  };

  const openAddWithValue = (value: string) => setDialog({ mode: 'add', scope: 'file', alias: '', value, description: '', tags: [] });

  // Paste an image / image-URL anywhere on the (focused) panel → open the Add
  // dialog pre-filled. Ignored while a field is focused or the dialog is open.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (!panelFocused.current || dialog) return;
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;
      imageFromTransfer(e.clipboardData).then((v) => { if (v) openAddWithValue(v); });
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [dialog]);

  // Receive the SVG of a diagram created via "Create with drawio" → fill the dialog.
  useEffect(() => {
    const onResult = (e: Event) => {
      const value = (e as CustomEvent).detail?.value as string | undefined;
      if (value) setDialog((d) => (d ? { ...d, value } : { mode: 'add', scope: 'file', alias: '', value, description: '', tags: [] }));
    };
    window.addEventListener('mdp-drawio-image-result', onResult);
    return () => window.removeEventListener('mdp-drawio-image-result', onResult);
  }, []);

  // The editor's @image [edit] widget requested the edit dialog for an alias.
  useEffect(() => {
    const req = img.editRequest;
    if (!req) return;
    const entry = [...img.fileImages, ...img.libraryImages].find((e) => e.alias === req.alias);
    img.onEditHandled?.();
    if (entry) queueMicrotask(() => setDialog({ mode: 'edit', scope: entry.scope, alias: entry.alias, value: entry.value, description: entry.description || '', tags: entry.tags || [] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img.editRequest]);

  const submit = () => {
    if (!dialog) return;
    const alias = dialog.alias.trim();
    const value = dialog.value.trim();
    if (!alias || !value) return;
    const description = dialog.description.trim();
    const tags = dialog.tags.map((t) => t.trim()).filter(Boolean);
    if (dialog.mode === 'add') img.onAddImage(dialog.scope, alias, value, description, tags);
    else img.onEditImage(dialog.scope, alias, value, description, tags);
    setDialog(null);
  };

  const onUpload = async (file?: File) => {
    if (!file || !dialog) return;
    try { const data = await fileToImageValue(file); setDialog((d) => (d ? { ...d, value: data } : d)); } catch { /* ignore */ }
  };

  const renderSection = (title: string, entries: ImageEntry[], scope: 'file' | 'library') => {
    const visible = entries.filter(matchesQuery);
    return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', bgcolor: 'var(--app-bg-editor)', px: 1, py: 0.25, borderBottom: '1px solid var(--app-border)', position: 'sticky', top: 0, zIndex: 1 }}>
        <Typography sx={{ color: 'var(--app-text-secondary)', fontSize: '0.75rem', fontWeight: 'bold' }}>{title} ({query ? `${visible.length}/${entries.length}` : entries.length})</Typography>
        <Tooltip title={`Add image to ${scope === 'file' ? 'this file' : 'shared library'}`}>
          <IconButton size="small" sx={toolBtnSx} onClick={() => setDialog({ mode: 'add', scope, alias: '', value: '', description: '', tags: [] })}><AddPhotoAlternateIcon fontSize="small" /></IconButton>
        </Tooltip>
      </Box>
      {visible.length === 0
        ? <Typography sx={{ color: 'var(--app-text-disabled)', fontSize: '0.72rem', p: 1 }}>{query ? 'No matching images.' : 'No images.'}</Typography>
        : (
          <Box sx={{ overflowX: 'auto' }}>
          <Table size="small" sx={{ minWidth: 360 }}><TableBody>
            {visible.map((e) => (
              <ImageRow key={e.alias} entry={e} overrides={scope === 'file' && libAliases.has(e.alias)}
                moveDisabled={scope === 'file' ? libAliases.has(e.alias) : fileAliases.has(e.alias)} highlight={img.focusAlias === e.alias}
                resolveThumb={img.resolveThumb} onInsert={img.onInsertReference} onPreview={img.onPreview}
                onEdit={(en) => setDialog({ mode: 'edit', scope: en.scope, alias: en.alias, value: en.value, description: en.description || '', tags: en.tags || [] })}
                onDelete={(en) => img.onDeleteImage(en.scope, en.alias)} onMove={img.onMove} onEditDrawio={img.onEditDrawio} />
            ))}
          </TableBody></Table>
          </Box>
        )}
    </Box>
    );
  };

  const dialogIsData = !!dialog && dialog.value.startsWith('data:');

  return (
    <Box tabIndex={0}
      onFocus={() => { panelFocused.current = true; }}
      onBlur={() => { panelFocused.current = false; }}
      onDragOver={(e) => { if (!isImageDrag(e)) return; e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { if (!isImageDrag(e)) return; e.preventDefault(); setDragOver(false); imageFromTransfer(e.dataTransfer).then((v) => { if (v) openAddWithValue(v); }); }}
      sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'var(--app-bg-panel)', overflowY: 'auto', outline: 'none', position: 'relative', ...(dragOver ? { boxShadow: 'inset 0 0 0 2px var(--app-accent)' } : {}) }}>
      <Box sx={{ p: 0.75, borderBottom: '1px solid var(--app-border)', position: 'sticky', top: 0, zIndex: 2, bgcolor: 'var(--app-bg-panel)' }}>
        <TextField value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name / description / tag…"
          size="small" fullWidth variant="outlined"
          slotProps={{ input: {
            startAdornment: (<InputAdornment position="start"><SearchIcon fontSize="small" sx={{ color: 'var(--app-text-disabled)' }} /></InputAdornment>),
            sx: { color: 'var(--app-text-secondary)', fontSize: '0.8rem', bgcolor: 'var(--app-bg-editor)', '& fieldset': { borderColor: 'var(--app-border-subtle)' }, '&:hover fieldset': { borderColor: 'var(--app-border-strong)' } },
          } }} />
      </Box>
      {renderSection('In this file', img.fileImages, 'file')}
      {renderSection('Shared library', img.libraryImages, 'library')}
      <Typography sx={{ color: 'var(--app-text-disabled)', fontSize: '0.66rem', textAlign: 'center', p: 1 }}>
        Drop or paste an image / image URL here to add it.
      </Typography>

      <Dialog open={!!dialog} onClose={() => setDialog(null)} maxWidth="xs" fullWidth
        slotProps={{ paper: { sx: { bgcolor: 'var(--app-bg-panel)', color: 'var(--app-text-secondary)', backgroundImage: 'none' } } }}>
        <DialogTitle sx={{ fontSize: '0.95rem' }}>{dialog?.mode === 'add' ? 'Add image' : `Edit “${dialog?.alias}”`}</DialogTitle>
        <DialogContent
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); imageFromTransfer(e.dataTransfer).then((v) => { if (v) setDialog((d) => (d ? { ...d, value: v } : d)); }); }}
          onPaste={(e) => {
            const items = Array.from(e.clipboardData?.items || []);
            if (items.some((it) => it.kind === 'file' && it.type.startsWith('image/'))) {
              e.preventDefault();
              imageFromTransfer(e.clipboardData).then((v) => { if (v) setDialog((d) => (d ? { ...d, value: v } : d)); });
            }
          }}>
          <Stack spacing={1.5} sx={{ pt: 0.5 }}>
            {dialog?.mode === 'add' && (
              <Box>
                <Typography sx={{ color: 'var(--app-text-disabled)', fontSize: '0.72rem', mb: 0.5 }}>Where to store this image</Typography>
                <ToggleButtonGroup exclusive fullWidth size="small" value={dialog?.scope}
                  onChange={(_e, v) => v && setDialog((d) => (d ? { ...d, scope: v } : d))}>
                  <ToggleButton value="file" sx={scopeBtnSx}><InsertDriveFileOutlinedIcon fontSize="small" sx={{ mr: 0.5 }} />This file</ToggleButton>
                  <ToggleButton value="library" sx={scopeBtnSx}><CollectionsBookmarkOutlinedIcon fontSize="small" sx={{ mr: 0.5 }} />Shared library</ToggleButton>
                </ToggleButtonGroup>
                <Typography sx={{ color: 'var(--app-text-disabled)', fontSize: '0.66rem', mt: 0.5 }}>
                  {dialog?.scope === 'file' ? 'Embedded in this deck — travels with the file.' : 'Reusable across decks — saved under .mdp/images/.'}
                </Typography>
              </Box>
            )}
            <Box>
              <TextField label="Alias" size="small" fullWidth value={dialog?.alias || ''} disabled={dialog?.mode === 'edit'}
                onChange={(e) => setDialog((d) => (d ? { ...d, alias: e.target.value.replace(/[^\w-]/g, '') } : d))}
                variant="outlined"
                slotProps={{
                  inputLabel: { sx: { color: 'var(--app-text-disabled)', '&.Mui-disabled': { color: 'var(--app-text-disabled)' } } },
                  input: { sx: { color: 'var(--app-text-secondary)', '& .MuiInputBase-input.Mui-disabled': { WebkitTextFillColor: 'var(--app-text-disabled)' } } },
                }} />
              <Typography sx={{ color: 'var(--app-text-disabled)', fontSize: '0.68rem', mt: 0.4, ml: 0.25 }}>
                Reference as ![alt](@alias)
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {dialog?.value
                ? <img src={img.resolveThumb(dialog.value)} alt="preview" style={{ width: 48, height: 48, objectFit: 'contain', background: '#fff', borderRadius: 4 }} />
                : <Box sx={{ width: 48, height: 48, bgcolor: 'var(--app-bg-editor)', borderRadius: 1 }} />}
              <Button component="label" size="small" startIcon={<UploadFileIcon />} sx={{ color: 'var(--app-accent)' }}>
                Upload
                <input hidden type="file" accept="image/*" onChange={(e) => onUpload(e.target.files?.[0])} />
              </Button>
              <Button size="small" startIcon={<AccountTreeIcon />} sx={{ color: 'var(--app-accent)' }}
                onClick={() => window.dispatchEvent(new CustomEvent('mdp-open-drawio-for-image', { detail: { value: dialog?.value || '' } }))}>
                Diagram
              </Button>
            </Box>
            <TextField label="…or URL / path" size="small" value={dialogIsData ? '' : (dialog?.value || '')}
              placeholder={dialogIsData ? 'Using uploaded image data' : 'https://… or relative/path.png'}
              onChange={(e) => setDialog((d) => (d ? { ...d, value: e.target.value } : d))}
              variant="outlined"
              slotProps={{ inputLabel: { sx: { color: 'var(--app-text-disabled)' } }, input: { sx: { color: 'var(--app-text-secondary)' } } }} />
            <TextField label="Description (optional)" size="small" value={dialog?.description || ''}
              onChange={(e) => setDialog((d) => (d ? { ...d, description: e.target.value } : d))}
              multiline maxRows={3} variant="outlined"
              slotProps={{ inputLabel: { sx: { color: 'var(--app-text-disabled)' } }, input: { sx: { color: 'var(--app-text-secondary)' } } }} />
            {(
              <Autocomplete multiple freeSolo size="small" options={allTags} value={dialog?.tags || []}
                onChange={(_e, v) => setDialog((d) => (d ? { ...d, tags: v as string[] } : d))}
                renderTags={(value, getTagProps) => value.map((option, index) => (
                  <Chip {...getTagProps({ index })} key={option} label={option} size="small"
                    sx={{ color: 'var(--app-accent)', bgcolor: 'var(--app-accent-soft)' }} />
                ))}
                renderInput={(params) => (
                  <TextField {...params} label="Tags (optional)" placeholder="Add tag + Enter" variant="outlined"
                    slotProps={{ inputLabel: { sx: { color: 'var(--app-text-disabled)' } } }} sx={{ '& .MuiInputBase-input': { color: 'var(--app-text-secondary)' } }} />
                )} />
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)} sx={{ color: 'var(--app-text-muted)' }}>Cancel</Button>
          <Button onClick={submit} disabled={!dialog?.alias.trim() || !dialog?.value.trim()} variant="contained">
            {dialog?.mode === 'add' ? 'Add' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export const PreviewPanel: React.FC = () => {
  const p = usePreview();
  const h = useHeaderActions();
  const [exportAnchor, setExportAnchor] = useState<null | HTMLElement>(null);

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Stack direction="row" sx={toolbarSx} spacing={0.25}>
        { isElectron() ? ( <></> ) : (
          <Tooltip title="Switch to Remote Mode"><IconButton size="small" sx={toolBtnSx} onClick={h.onSwitchToRemote}><SmartphoneIcon fontSize="small" /></IconButton></Tooltip>
        ) }
        <Tooltip title="Connect Remote"><IconButton size="small" sx={toolBtnSx} onClick={h.onOpenConnectDialog}><DevicesIcon fontSize="small" /></IconButton></Tooltip>
        <Tooltip title={p.livePreview ? 'Live preview on — click to pause auto-parsing while typing' : 'Live preview paused — edits are not parsed until you apply'}>
          <span><IconButton size="small" sx={{ ...toolBtnSx, color: p.livePreview ? 'var(--app-accent)' : 'var(--app-warning)' }} onClick={p.onToggleLivePreview}>{p.livePreview ? <SyncIcon fontSize="small" /> : <SyncDisabledIcon fontSize="small" />}</IconButton></span>
        </Tooltip>
        {!p.livePreview && (
          <Tooltip title={p.previewStale ? 'Apply edits to the preview now' : 'Preview is up to date'}>
            <span><IconButton size="small" sx={{ ...toolBtnSx, color: p.previewStale ? 'var(--app-warning)' : 'var(--app-text-muted)' }} onClick={p.onApplyPreview}><RefreshIcon fontSize="small" /></IconButton></span>
          </Tooltip>
        )}
        <Tooltip title="Reload slides — re-fetch replaced images / referenced files (bypass cache)">
          <IconButton size="small" sx={toolBtnSx} onClick={p.onReloadSlides}><CachedIcon fontSize="small" /></IconButton>
        </Tooltip>
        <Tooltip title={p.canEditLayout ? 'Edit layout (move/resize/rotate modules)' : 'Edit layout — open the slide being previewed to enable'}>
          <span><IconButton size="small" sx={{ ...toolBtnSx, color: p.editLayout ? 'var(--app-accent)' : 'var(--app-text-muted)' }} disabled={!p.canEditLayout} onClick={p.onToggleEditLayout}><ControlCameraIcon fontSize="small" /></IconButton></span>
        </Tooltip>
        {p.editLayout && (
          <Tooltip title={`Grid snap ${p.snapOn ? 'on' : 'off'} (hold Alt to bypass)`}>
            <span><IconButton size="small" sx={{ ...toolBtnSx, color: p.snapOn ? 'var(--app-accent)' : 'var(--app-text-muted)' }} onClick={p.onToggleSnap}><GridOnIcon fontSize="small" /></IconButton></span>
          </Tooltip>
        )}
        <Box sx={{ flex: 1 }} />
        <Tooltip title="Open Presenter View"><span><IconButton size="small" sx={toolBtnSx} disabled={!h.canPresent} onClick={h.onOpenPresenter}><PresentToAllIcon fontSize="small" /></IconButton></span></Tooltip>
        <Tooltip title="Start Slideshow (F5)"><span><IconButton size="small" sx={toolBtnSx} disabled={!h.canPresent} onClick={h.onToggleSlideshow}><PlayArrowIcon fontSize="small" /></IconButton></span></Tooltip>
        <Tooltip title="Slide Overview"><span><IconButton size="small" sx={{ ...toolBtnSx, color: h.isSlideOverview ? 'var(--app-text-strong)' : 'var(--app-text-muted)' }} disabled={!h.canPresent} onClick={h.onToggleOverview}><GridViewIcon fontSize="small" /></IconButton></span></Tooltip>
        <Tooltip title="Export (PDF / PowerPoint)">
          <span><IconButton size="small" sx={toolBtnSx} disabled={!h.canPresent || h.pptxBusy} onClick={(e) => setExportAnchor(e.currentTarget)}>
            {h.pptxBusy ? <CircularProgress size={16} sx={{ color: 'var(--app-accent)' }} /> : <FileDownloadIcon fontSize="small" />}
          </IconButton></span>
        </Tooltip>
        <Menu anchorEl={exportAnchor} open={!!exportAnchor} onClose={() => setExportAnchor(null)}>
          <MenuItem onClick={() => { setExportAnchor(null); h.onPrint(); }} dense>
            <ListItemIcon><PrintIcon fontSize="small" /></ListItemIcon>Export PDF
          </MenuItem>
          {h.onExportPptx && <Divider />}
          {h.onExportPptx && (
            <MenuItem onClick={() => { setExportAnchor(null); h.onExportPptx!('image'); }} dense>
              <ListItemIcon><SlideshowIcon fontSize="small" /></ListItemIcon>PowerPoint — image (exact, math-perfect)
            </MenuItem>
          )}
          {h.onExportPptx && (
            <MenuItem onClick={() => { setExportAnchor(null); h.onExportPptx!('editable'); }} dense>
              <ListItemIcon><SlideshowIcon fontSize="small" /></ListItemIcon>PowerPoint — editable text (beta)
            </MenuItem>
          )}
        </Menu>
        {p.onEditDrawio && (
          <Button variant="text" size="small" startIcon={<EditIcon fontSize="small" />} onClick={p.onEditDrawio} sx={{ ...toolBtnSx, ml: 1, textTransform: 'none', fontSize: '0.75rem' }}>Edit Diagram</Button>
        )}
      </Stack>

      {p.previewImage ? (
        <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', backgroundColor: 'var(--app-bg-editor)' }}>
          {/* Dedicated bar so the control is never hidden behind a large image. */}
          <Box sx={{ flexShrink: 0, display: 'flex', alignItems: 'center', px: 1, py: 0.5, bgcolor: 'var(--app-bg-editor)', borderBottom: '1px solid var(--app-border)' }}>
            <Button size="small" startIcon={<CloseIcon fontSize="small" />} onClick={p.onClosePreviewImage}
              sx={{ color: 'var(--app-accent)', textTransform: 'none', fontSize: '0.78rem' }}>Back to slides</Button>
            <Typography sx={{ color: 'var(--app-text-disabled)', fontSize: '0.7rem', ml: 1 }}>Image preview</Typography>
          </Box>
          <Box sx={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', p: 2 }}>
            <img src={p.previewImage} alt="preview" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', background: '#fff', borderRadius: 4 }} />
          </Box>
        </Box>
      ) : p.effectiveFileType === 'pdf' && p.pdfPath ? (
        <PdfView path={p.pdfPath} version={p.previewVersion} />
      ) : p.effectiveFileType === 'doc' ? (
        <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <SlideView
            flow html={p.docHtml || ''} basePath={p.basePath} slideSize={p.slideSize}
            isActive isEnabledPointerEvents runScripts moduleRole={p.moduleRole} onSlideLink={p.onSlideLink}
          />
        </Box>
      ) : p.slides.length === 0 ? (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--app-bg-editor)' }}>
          <Typography variant="body1" sx={{ color: 'var(--app-text-disabled)' }}>No slide preview for this file.</Typography>
        </Box>
      ) : (
        <div
          className="preview-pane"
          tabIndex={0}
          onKeyDown={(e) => {
            if ((e.target as HTMLElement).closest?.('.mdp-interactive')) return;
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); p.moveSlide(1); }
            else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); p.moveSlide(-1); }
          }}
          style={{ flex: 1, minHeight: 0, backgroundColor: 'var(--app-bg-editor)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', outline: 'none' }}
        >
          <SlideControls
            mode={p.mode as 'view' | 'pen' | 'laser'} setMode={p.setMode} pageIndex={p.currentSlideIndex} totalSlides={p.slides.length}
            visible={p.showControls} onNav={p.moveSlide} onAddSlide={() => p.handleAddBlankSlide(p.currentSlideIndex)}
            onClearDrawing={() => { p.clear(p.currentSlideIndex); p.send({ type: 'CLEAR_DRAWING', channelId: p.channelId, pageIndex: p.currentSlideIndex }); }}
            toolType={p.toolType} setToolType={p.setToolType} penColor={p.penColor} setPenColor={p.setPenColor}
            penWidth={p.penWidth} setPenWidth={p.setPenWidth} canUndo={p.canUndo(p.currentSlideIndex)} canRedo={p.canRedo(p.currentSlideIndex)}
            onUndo={() => p.undo(p.currentSlideIndex)} onRedo={() => p.redo(p.currentSlideIndex)} containerStyle={{ bottom: '20px' }}
            stylusOnly={p.stylusOnly} setStylusOnly={p.setStylusOnly}
            onHistoryBack={p.onHistoryBack} onHistoryForward={p.onHistoryForward} canHistoryBack={p.canHistoryBack} canHistoryForward={p.canHistoryForward}
          />
          <SlideScaler width={p.slideSize.width} height={p.slideSize.height}>
            {p.slides.map((slide, index) => (
              index === p.currentSlideIndex && (
                <div key={index} style={{ position: 'relative', width: '100%', height: '100%' }}>
                  <SlideView
                    html={slide.html} raw={slide.raw} basePath={p.basePath} pageNumber={slide.pageNumber} className={slide.className}
                    isActive={true} slideSize={p.slideSize} isEnabledPointerEvents={p.mode === 'view'} header={slide.header} footer={slide.footer}
                    drawings={p.drawings[index] || []}
                    slideIndex={index} moduleRole={p.moduleRole}
                    manipulate={p.manipulate}
                    onSlideLink={p.onSlideLink}
                    onAddStroke={(stroke) => { p.addStroke(index, stroke); p.send({ type: 'DRAW_STROKE', channelId: p.channelId, pageIndex: index, stroke }); }}
                    isInteracting={p.mode === 'pen'} toolType={p.toolType} color={p.penColor} lineWidth={p.penWidth} penOnly={p.stylusOnly}
                    onUpdateStrokes={(indices, dx, dy) => p.handleUpdateStrokes(index, indices, dx, dy)}
                  />
                </div>
              )
            ))}
          </SlideScaler>
        </div>
      )}
    </Box>
  );
};

// Inner editor: receives a guaranteed tab so it can use hooks unconditionally, and
// is keyed by tab.id in the parent so it remounts (re-capturing content) if a
// Dockview panel is ever reused for a different tab.
const FileEditorPanelInner: React.FC<{ tab: OpenTab; e: EditorSharedProps; isActive: boolean }> = ({ tab, e, isActive }) => {
  // Freeze the value handed to CodeMirror at (re)mount: CodeMirror then OWNS the
  // document and reports edits out via onChange. Pushing the live `tab.content`
  // back in on every keystroke made @uiw/react-codemirror run `doc.toString()`
  // (O(document)) every keystroke and — with the fresh closures the old code passed
  // — reconfigure the whole editor every keystroke too. A Dockview remount re-runs
  // this initialiser, so unsaved edits (held in tab.content) are still restored.
  const [initialValue] = useState(tab.content);

  const { updateTabContent, onEditorUpdate, toggleBookmark, updateBookmark } = e;
  const path = tab.path;

  // Stable handlers so neither @uiw's config effect (keyed on onChange/onUpdate)
  // nor the memoised EditorPanel re-runs while typing.
  const onChangeEditor = useCallback((val: string) => updateTabContent(path, val), [updateTabContent, path]);
  const handleEditorUpdate = useCallback((vu: ViewUpdate) => { if (isActive) onEditorUpdate(vu); }, [onEditorUpdate, isActive]);
  const onToggleBookmark = useCallback(() => toggleBookmark(path), [toggleBookmark, path]);
  const onUpdateBookmark = useCallback((changes: { icon?: string; color?: string }) => updateBookmark(path, changes), [updateBookmark, path]);

  return (
    <EditorPanel
      currentFileName={path}
      currentFileType={tab.type}
      editorRef={tab.editorRef}
      editorInitialValue={initialValue}
      extensions={e.extensions}
      onChangeEditor={onChangeEditor}
      onEditorUpdate={handleEditorUpdate}
      onInsertText={e.onInsertText}
      onSave={e.onSave}
      onMoveSlide={e.moveSlide}
      isBookmarked={e.isBookmarked(path)}
      onToggleBookmark={onToggleBookmark}
      bookmark={e.bookmarks.find((b) => b.path === path)}
      onUpdateBookmark={onUpdateBookmark}
    />
  );
};

export const FileEditorPanel: React.FC<IDockviewPanelProps<{ tabId: string }>> = (props) => {
  const e = useEditor();
  const tab = e.tabs.find(t => t.id === props.params.tabId);

  if (!tab) return <div style={{ height: '100%', backgroundColor: 'var(--app-bg-editor)' }} />;

  const isActive = tab.path === e.currentFileName;

  return (
    <div style={{ height: '100%', backgroundColor: 'var(--app-bg-editor)' }}>
      <FileEditorPanelInner key={tab.id} tab={tab} e={e} isActive={isActive} />
    </div>
  );
};

export const FileTab: React.FC<IDockviewPanelHeaderProps<{ tabId: string }>> = (props) => {
  const e = useEditor();
  const tabId = props.params.tabId;
  const tab = e.tabs.find(t => t.id === tabId);
  const fileName = tab ? (tab.path.split('/').pop() || tab.path) : props.api.title || '';
  const isModified = tab?.isModified;

  const [menu, setMenu] = useState<{ mouseX: number; mouseY: number } | null>(null);
  const indexOf = () => e.tabs.findIndex(t => t.id === tabId);

  const handleClose = (ev: React.MouseEvent) => {
    ev.stopPropagation();
    const idx = indexOf();
    if (idx !== -1) e.onTabClose(ev, idx);
  };

  const handleContextMenu = (ev: React.MouseEvent) => {
    ev.preventDefault();
    ev.stopPropagation();
    setMenu({ mouseX: ev.clientX, mouseY: ev.clientY });
  };

  const runAndClose = (fn: () => void) => { fn(); setMenu(null); };

  return (
    <div className="mdp-file-tab" onContextMenu={handleContextMenu} style={{ display: 'flex', alignItems: 'center', height: '100%', padding: '0 4px 0 8px', maxWidth: 240 }}>
      <span style={{ fontSize: '0.8rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontStyle: isModified ? 'italic' : 'normal' }}>
        {fileName}{isModified ? ' •' : ''}
      </span>
      <IconButton size="small" onClick={handleClose} sx={{ ml: 0.5, p: 0.25, color: 'inherit', '&:hover': { bgcolor: 'var(--app-bg-hover)' } }}>
        <CloseIcon sx={{ fontSize: '0.9rem' }} />
      </IconButton>

      <Menu
        open={menu !== null}
        onClose={() => setMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={menu ? { top: menu.mouseY, left: menu.mouseX } : undefined}
        slotProps={darkMenuSlotProps}
      >
        <MenuItem onClick={(ev) => runAndClose(() => { const i = indexOf(); if (i !== -1) e.onTabClose(ev, i); })}>
          <ListItemIcon><CloseIcon fontSize="small" /></ListItemIcon> Close
        </MenuItem>
        <Divider />
        <MenuItem disabled={e.tabs.length <= 1} onClick={() => runAndClose(() => { const i = indexOf(); if (i !== -1) e.closeOtherTabs(i); })}>
          <ListItemIcon><CloseFullscreenIcon fontSize="small" /></ListItemIcon> Close Others
        </MenuItem>
        <MenuItem onClick={() => runAndClose(() => e.closeAllTabs())} sx={{ color: 'var(--app-danger)' }}>
          <ListItemIcon><ClearAllIcon fontSize="small" sx={{ color: 'var(--app-danger)' }} /></ListItemIcon> Close All
        </MenuItem>
      </Menu>
    </div>
  );
};
