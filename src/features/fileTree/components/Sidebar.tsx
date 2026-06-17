import React, { useEffect, useRef, useState } from 'react';
import { Box, Tabs, Tab, Button, Typography, Menu, MenuItem, ListItemIcon, Dialog, DialogTitle, DialogContent, TextField, DialogActions, CircularProgress, Divider } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import NoteAddIcon from '@mui/icons-material/NoteAdd';
import CreateNewFolderIcon from '@mui/icons-material/CreateNewFolder';
import DeleteIcon from '@mui/icons-material/Delete';
import DriveFileRenameOutlineIcon from '@mui/icons-material/DriveFileRenameOutline';
import SlideshowIcon from '@mui/icons-material/Slideshow';
import { CustomTabPanel } from '../../../components/common/CustomTabPanel';
import { FileTreeItem } from './FileTreeItem';
import { SlideThumbnail } from '../../slide/components/SlideThumbnail';
import { type FileNode, type FileType } from '../../../types';
import type { Stroke } from '../../drawing/components/DrawingOverlay';
import type { Bookmark } from '../../../pages/EditorPage/hooks/useBookmarks';
import { BookmarkList } from './BookmarkList';
import { apiClient } from '../../../api/apiClient';
import { reportError } from '../../../components/error/errorReporter';
import defaultThemeContent from '../../../../public/themes/default.css?raw';
import defaultTemplateContent from '../../../../public/templates/default.slide.md?raw';
import defaultModuleContent from '../../../../public/default-module.mdpmod.xml?raw';
import defaultEffectContent from '../../../../public/default-effect.mdpfx.xml?raw';
import { MDP_DIR, SPECIAL_SUBFOLDERS } from '../../workspace/specialFolders';
import BookmarkIcon from '@mui/icons-material/Bookmark';
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder';
import { isFileTreeDrag } from '../dragUtils';

interface SidebarProps {
  currentFileName: string | null;
  currentFileType: FileType;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  slides: any[];
  currentSlideIndex: number;
  slideSize: { width: number; height: number };
  drawings: Record<number, Stroke[]>;
  fileTree: FileNode[];
  onSlideSelect: (index: number) => void;
  onFileSelect: (path: string, isBinary?: boolean) => void;
  onManualRefresh: () => void;
  onNav?: (dir: number) => void;
  handleOpenFolder?: () => void;
  bookmarks: Bookmark[];
  isBookmarked: (path: string) => boolean;
  onToggleBookmark: (path: string) => void;
  onReorderBookmark?: (from: number, to: number) => void;
  onUpdateBookmark?: (path: string, changes: { icon?: string; color?: string }) => void;
  onRenameFile?: (oldPath: string, newPath: string) => void;
  onDeleteFiles?: (paths: string[]) => void;

  section?: 'thumbnail' | 'files' | 'bookmarks';
}

// App-managed folders now live under a single `.mdp/` directory (e.g.
// `.mdp/modules`). The special SUBFOLDER names (no leading dot) get the
// specialized "New X File" treatment + placeholders; `.mdp/images` is hidden
// (managed via the Images panel).
const SPECIAL_PATHS = SPECIAL_SUBFOLDERS.map((s) => `${MDP_DIR}/${s}`);

const SECTION_INDEX: Record<'thumbnail' | 'files' | 'bookmarks', number> = {
  thumbnail: 0,
  files: 1,
  bookmarks: 2,
};

export const Sidebar: React.FC<SidebarProps> = ({
  currentFileName, currentFileType, slides, currentSlideIndex, slideSize,
  drawings, fileTree, onSlideSelect, onFileSelect,
  onManualRefresh, onNav,
  bookmarks, isBookmarked, onToggleBookmark, onReorderBookmark, onUpdateBookmark,
  onRenameFile, onDeleteFiles, section
}) => {
  const [leftTabIndex, setLeftTabIndex] = useState(0);
  const activeIndex = section ? SECTION_INDEX[section] : leftTabIndex;
  // Keep the active thumbnail in view (e.g. when the active slide changes on tab switch).
  const activeThumbRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    activeThumbRef.current?.scrollIntoView({ block: 'nearest' });
  }, [currentSlideIndex]);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const [contextMenu, setContextMenu] = useState<{ mouseX: number; mouseY: number; node?: FileNode; path: string; isFolder: boolean } | null>(null);
  const [nodeToRename, setNodeToRename] = useState<FileNode | null>(null);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [newName, setNewName] = useState('');

  const [dialogConfig, setDialogConfig] = useState<{
    open: boolean;
    type: 'file' | 'directory' | 'slide' | 'special';
    parentPath: string;
  }>({ open: false, type: 'file', parentPath: '' });
  const [newItemName, setNewItemName] = useState('');
  const [templates, setTemplates] = useState<{name: string, path: string, isCustom: boolean, description?: string}[]>([]);
  const [selectedTemplatePath, setSelectedTemplatePath] = useState<string>('');

  // Folders are auto-expanded ONLY when a file is newly created (the create flow
  // calls expandParentDir explicitly). Opening/switching tabs — including tabs
  // restored on app startup — never auto-expands.

  const visibleFileTree = React.useMemo(() => {
    const sortNodes = (a: FileNode, b: FileNode) =>
      a.type === b.type ? a.name.localeCompare(b.name) : (a.type === 'directory' ? -1 : 1);

    // Keep `.mdp` (the app-managed container) and all non-dot entries; hide every
    // other dotfile, plus the managed `.mdp/images` store.
    const filterNodes = (nodes: FileNode[], parentPath: string): FileNode[] => {
      return nodes
        .filter(n => {
          if (parentPath === MDP_DIR && n.name === 'images') return false;
          if (parentPath === '') return n.name === MDP_DIR || !n.name.startsWith('.');
          return !n.name.startsWith('.');
        })
        .map(n => {
          const fullPath = parentPath ? `${parentPath}/${n.name}` : n.name;
          return {
            ...n,
            isSpecial: fullPath === MDP_DIR || SPECIAL_PATHS.includes(fullPath),
            children: n.children ? filterNodes(n.children, fullPath) : undefined,
          };
        });
    };

    const processedTree = filterNodes(fileTree, '');

    // Ensure the `.mdp` container exists and exposes all special subfolders
    // (virtual placeholders when absent) so assets can be created on a fresh ws.
    let mdp = processedTree.find(n => n.name === MDP_DIR);
    if (!mdp) {
      mdp = { name: MDP_DIR, path: MDP_DIR, type: 'directory', isSpecial: true, isVirtual: true, children: [] };
      processedTree.push(mdp);
    }
    mdp.children = mdp.children || [];
    const childNames = new Set(mdp.children.map(c => c.name));
    SPECIAL_SUBFOLDERS.forEach(sub => {
      if (!childNames.has(sub)) {
        mdp!.children!.push({
          name: sub, path: `${MDP_DIR}/${sub}`, type: 'directory',
          isSpecial: true, isVirtual: true, children: [],
        });
      }
    });
    mdp.children.sort(sortNodes);

    processedTree.sort(sortNodes);
    return processedTree;
  }, [fileTree]);

  const allPaths = React.useMemo(() => {
    const set = new Set<string>();
    const walk = (nodes: FileNode[]) => {
      for (const n of nodes) {
        set.add(n.path);
        if (n.children) walk(n.children);
      }
    };
    walk(fileTree);
    return set;
  }, [fileTree]);

  const handleSelect = (e: React.MouseEvent, node: FileNode) => {
    e.stopPropagation();
    const newSelected = new Set(e.ctrlKey || e.metaKey ? selectedPaths : []);
    if (newSelected.has(node.path)) newSelected.delete(node.path);
    else newSelected.add(node.path);
    setSelectedPaths(newSelected);
    if (node.type === 'file' && !e.ctrlKey && !e.metaKey) {
      onFileSelect(node.path, node.isBinary);
    }
  };

  const handleDoubleClick = (node: FileNode) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (node.type === 'directory') handleToggleExpand(null as any, node.path);
    else onFileSelect(node.path, node.isBinary);
  };

  const handleToggleExpand = (e: React.MouseEvent | null, path: string) => {
    if (e) e.stopPropagation();
    const newExpanded = new Set(expandedDirs);
    if (newExpanded.has(path)) newExpanded.delete(path);
    else newExpanded.add(path);
    setExpandedDirs(newExpanded);
  };

  const expandParentDir = (path: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      let current = '';
      for (const part of path.split('/')) {
        current = current ? `${current}/${part}` : part;
        next.add(current);
      }
      return next;
    });
  };

  const withProcessing = async (task: () => Promise<void>) => {
    setIsProcessing(true);
    try {
      await task();
      onManualRefresh();
    } catch (e) {
      reportError('Operation failed.', { detail: e });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, node: FileNode) => {
    e.preventDefault(); e.stopPropagation();
    if (!selectedPaths.has(node.path)) setSelectedPaths(new Set([node.path]));
    setContextMenu({ mouseX: e.clientX + 2, mouseY: e.clientY - 6, node, path: node.path, isFolder: node.type === 'directory' });
  };

  const handleRootContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ mouseX: e.clientX + 2, mouseY: e.clientY - 6, path: '', isFolder: true });
  };

  const handleOpenDialog = async (type: 'file' | 'directory' | 'slide' | 'special') => {
    if (contextMenu) {
      // When invoked on a file, create the new item alongside it (in its folder).
      const parentPath = contextMenu.node?.type === 'file'
        ? contextMenu.path.substring(0, contextMenu.path.lastIndexOf('/'))
        : contextMenu.path;
      setDialogConfig({ open: true, type, parentPath });
      setNewItemName('');

      if (type === 'slide') {
        try {
          const tmpls = await apiClient.getTemplates();
          if (tmpls.length > 0) setSelectedTemplatePath(tmpls[0].path);
          setTemplates(tmpls);
          // Parse an optional <!-- @description ... --> meta from each template.
          const descRegex = new RegExp('<' + '!--\\s*@description\\s+([\\s\\S]*?)--' + '>');
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const withDesc = await Promise.all(tmpls.map(async (t: any) => {
            try {
              const content = await apiClient.getTemplateContent(t.path);
              const m = content.match(descRegex);
              return { ...t, description: m ? m[1].trim() : undefined };
            } catch { return t; }
          }));
          setTemplates(withDesc);
        } catch (e) { console.error(e); }
      }
    }
    setContextMenu(null);
  };

  const handleSubmitCreate = async () => {
    if (!newItemName.trim()) {
      setDialogConfig({ ...dialogConfig, open: false });
      return;
    }

    let finalName = newItemName.trim();
    const { type, parentPath } = dialogConfig;

    if (type === 'special') {
      const folder = parentPath;            // e.g. '.mdp/themes'
      const sub = folder.split('/').pop();  // 'themes'
      let content = '';
      if (sub === 'themes') {
        if (!finalName.endsWith('.css')) finalName += '.css';
        content = defaultThemeContent;
      } else if (sub === 'snippets') {
        if (!finalName.endsWith('.json')) finalName += '.json';
        content = '[\n  {\n    "category": "Custom",\n    "items": [\n      { "label": "New", "text": "text", "description": "desc" }\n    ]\n  }\n]';
      } else if (sub === 'templates') {
        if (!finalName.endsWith('.slide.md')) finalName += '.slide.md';
        content = defaultTemplateContent;
      } else if (sub === 'modules') {
        if (!finalName.endsWith('.mdpmod.xml')) finalName += '.mdpmod.xml';
        content = defaultModuleContent;
      } else if (sub === 'effects') {
        if (!finalName.endsWith('.mdpfx.xml')) finalName += '.mdpfx.xml';
        content = defaultEffectContent;
      }
      const newPath = `${folder}/${finalName}`;
      if (allPaths.has(newPath)) {
        reportError(`"${finalName}" already exists in /${folder}.`, { title: 'Cannot Create', severity: 'warning' });
        return;
      }
      await withProcessing(async () => {
        await apiClient.saveFile(newPath, content);
        expandParentDir(folder);
        onFileSelect(newPath);
      });
      setDialogConfig({ ...dialogConfig, open: false });
      return;
    }

    if (type === 'slide') {
      if (!finalName.endsWith('.slide.md')) finalName = finalName.replace(/\.md$/, '') + '.slide.md';
    } else if (type === 'file' && !finalName.includes('.')) {
      finalName += '.md';
    }
    const newPath = parentPath ? `${parentPath}/${finalName}` : finalName;
    if (allPaths.has(newPath)) {
      reportError(`"${finalName}" already exists${parentPath ? ` in /${parentPath}` : ''}.`, { title: 'Cannot Create', severity: 'warning' });
      return;
    }
    await withProcessing(async () => {
      if (type === 'slide') {
        const templateContent = await apiClient.getTemplateContent(selectedTemplatePath).catch(() => '');
        await apiClient.saveFile(newPath, templateContent);
        if (parentPath) expandParentDir(parentPath);
        onFileSelect(newPath);
      } else if (type === 'file' || type === 'directory') {
        await apiClient.createFile(newPath, type);
        if (parentPath) expandParentDir(parentPath);
        if (type === 'file') onFileSelect(newPath);
      }
    });

    setDialogConfig({ ...dialogConfig, open: false });
  };

  const handleRenameClick = () => {
    if (contextMenu && contextMenu.node) {
      setNodeToRename(contextMenu.node);
      setNewName(contextMenu.node.name);
      setRenameDialogOpen(true);
      setContextMenu(null);
    }
  };

  const executeRename = () => {
    if (nodeToRename && newName.trim()) {
      const oldPath = nodeToRename.path;
      const basePath = oldPath.substring(0, oldPath.lastIndexOf('/'));
      const newPath = basePath ? `${basePath}/${newName.trim()}` : newName.trim();
      withProcessing(async () => {
        await apiClient.renameFile(oldPath, newPath);
        onRenameFile?.(oldPath, newPath);

        if (nodeToRename.type === 'directory') {
          setExpandedDirs(prev => {
            const next = new Set(prev);
            if (next.has(oldPath)) {
              next.delete(oldPath);
              next.add(newPath);
            }
            Array.from(next).forEach(dir => {
              if (dir.startsWith(oldPath + '/')) {
                next.delete(dir);
                next.add(dir.replace(oldPath, newPath));
              }
            });
            return next;
          });
        }
      });
    }
    setRenameDialogOpen(false);
    setNodeToRename(null);
  };

  const executeDelete = () => {
    const paths = Array.from(selectedPaths);
    withProcessing(async () => {
      await apiClient.deleteFiles(paths);
      onDeleteFiles?.(paths);
    });
    setSelectedPaths(new Set());
    setDeleteDialogOpen(false);
  };

  const handleDragStart = (e: React.DragEvent, node: FileNode) => {
    e.stopPropagation();
    const pathsToMove = selectedPaths.has(node.path) ? Array.from(selectedPaths) : [node.path];
    e.dataTransfer.setData('application/json', JSON.stringify({ type: 'internal_move', paths: pathsToMove }));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, node?: FileNode) => {
    if (!isFileTreeDrag(e)) return; // let Dockview tab drags pass through
    e.preventDefault(); e.stopPropagation();
    if (node && node.type === 'directory') setDragOverPath(node.path);
    else setDragOverPath('');
  };

  const fileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const uploadEntry = async (entry: any, basePath: string) => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve) => entry.file(resolve));
      const base64 = await fileToBase64(file);
      await apiClient.saveFile(`${basePath}/${file.name}`.replace(/^\//, ''), base64, true);
    } else if (entry.isDirectory) {
      const targetDirPath = `${basePath}/${entry.name}`.replace(/^\//, '');
      await apiClient.createFile(targetDirPath, 'directory');
      const dirReader = entry.createReader();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const entries = await new Promise<any[]>((resolve) => dirReader.readEntries(resolve));
      for (const child of entries) await uploadEntry(child, targetDirPath);
    }
  };

  const handleDrop = async (e: React.DragEvent, targetNode?: FileNode) => {
    if (!isFileTreeDrag(e)) return; // let Dockview tab drags pass through
    e.preventDefault(); e.stopPropagation();
    setDragOverPath(null);
    const targetDir = targetNode ? (targetNode.type === 'directory' ? targetNode.path : targetNode.path.substring(0, targetNode.path.lastIndexOf('/'))) : '';

    try {
      const data = e.dataTransfer.getData('application/json');
      if (data) {
        const payload = JSON.parse(data);
        if (payload.type === 'internal_move') {
           if (payload.paths.some((p: string) => targetDir === p || targetDir.startsWith(p + '/'))) return;
           await withProcessing(() => apiClient.moveFile(payload.paths, targetDir));
           return;
        }
      }

      const items = e.dataTransfer.items;
      if (items && items.length > 0) {
        setIsProcessing(true);
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.kind === 'file') {
            const entry = item.webkitGetAsEntry();
            if (entry) await uploadEntry(entry, targetDir);
          }
        }
        onManualRefresh();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsProcessing(false);
    }
  };

  const ctxParts = contextMenu?.path ? contextMenu.path.split('/') : [];
  const ctxIsFile = contextMenu?.node?.type === 'file';
  // A file sitting directly inside a special folder (e.g. .mdp/themes/foo.css)
  // should offer that folder's specialized "New X File" instead of the generic
  // items. `ctxParts[1]` is the subfolder name ('themes').
  const ctxFileInSpecial = ctxIsFile && ctxParts.length === 3 && ctxParts[0] === MDP_DIR && (SPECIAL_SUBFOLDERS as readonly string[]).includes(ctxParts[1]);
  // The `.mdp` container itself is "special" (protected) but is not a leaf asset
  // folder, so it shows no "New X File" item.
  const ctxIsMdpRoot = contextMenu?.node?.name === MDP_DIR;
  const ctxShowGenericNew = !contextMenu?.node?.isSpecial && !ctxFileInSpecial && (contextMenu?.isFolder || ctxIsFile);

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', position: 'relative', bgcolor: '#252526', color: '#cccccc' }}>
      {!section && (
      <Box sx={{ height: 41, minHeight: 41, maxHeight: 41, flexShrink: 0, borderBottom: '1px solid #333333', bgcolor: '#1e1e1e', overflow: 'hidden', boxSizing: 'border-box', display: 'flex', alignItems: 'center' }}>
        <Tabs
          value={leftTabIndex} onChange={(_, val) => setLeftTabIndex(val)} variant="fullWidth"
          sx={{
            flex: 1, minHeight: 40, height: 40,
            '& .MuiTabs-indicator': { backgroundColor: '#3b82f6', height: '2px' },
            '& .MuiTab-root': { color: '#8ba0b2', '&.Mui-selected': { color: '#ffffff' } }
          }}
        >
          <Tab label="Thumbnail" />
          <Tab label="Files" />
          <Tab label="Bookmarks" />
        </Tabs>
      </Box>
      )}

      {isProcessing && (
        <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, bgcolor: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <CircularProgress color="primary" />
        </Box>
      )}

      <Box sx={{ flexGrow: 1, overflow: 'hidden' }}>
        <CustomTabPanel value={activeIndex} index={0}>
          {currentFileName && currentFileType === 'markdown' ? (
            <div
              className="thumbnail-list"
              tabIndex={0}
              style={{ outline: 'none' }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                  e.preventDefault();
                  onNav?.(1);
                } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  onNav?.(-1);
                }
              }}
            >
              {slides.map((slide, index) => (
                <div
                  key={index}
                  ref={index === currentSlideIndex ? activeThumbRef : undefined}
                  style={{ opacity: slide.isHidden ? 0.5 : 1, marginBottom: '20px' }}
                >
                  <SlideThumbnail
                    htmlContent={slide.html} slideSize={slideSize} className={slide.className}
                    isActive={index === currentSlideIndex} onClick={() => onSlideSelect(index)}
                    isCover={slide.isCover} isHidden={slide.isHidden} pageNumber={slide.pageNumber}
                    header={slide.header} footer={slide.footer} drawings={drawings[index]}
                  />
                </div>
              ))}
            </div>
          ) : (
            <Typography variant="body1" sx={{ color: '#888', textAlign: 'center', p: 2 }}>
              {currentFileName ? "Thumbnails available for Markdown only." : "No file selected."}
            </Typography>
          )}
        </CustomTabPanel>

        <CustomTabPanel value={activeIndex} index={1} noScroll>
          <Box
            onDragOver={handleDragOver} onDrop={handleDrop} onDragEnd={() => setDragOverPath(null)} onDragLeave={() => setDragOverPath(null)} onClick={() => setSelectedPaths(new Set())} onContextMenu={handleRootContextMenu}
            sx={{ p: 1, height: '100%', color: '#cccccc', fontSize: '0.9rem', overflowY: 'auto', bgcolor: '#252526', pb: 10, outline: dragOverPath === '' ? '2px dashed #3b82f6' : 'none', outlineOffset: '-2px' }}
          >
            {visibleFileTree.length > 0 ? (
              visibleFileTree.map(node => (
                <FileTreeItem
                  key={node.path} node={node} level={0}
                  selectedPaths={selectedPaths} expandedDirs={expandedDirs} dragOverPath={dragOverPath}
                  onSelect={handleSelect} onDoubleClick={handleDoubleClick} onToggleExpand={handleToggleExpand} onContextMenu={handleContextMenu}
                  onDragStart={handleDragStart} onDragOver={handleDragOver} onDrop={handleDrop}
                />
              ))
            ) : (
              <Typography variant="body1" sx={{ color: '#888', textAlign: 'center', p: 2, pointerEvents: 'none' }}>Drag & Drop files here</Typography>
            )}
          </Box>
        </CustomTabPanel>

        <CustomTabPanel value={activeIndex} index={2} noScroll>
          <Box sx={{ p: 1, height: '100%', color: '#cccccc', overflowY: 'auto', bgcolor: '#252526', pb: 10 }}>
            <BookmarkList
              bookmarks={bookmarks}
              onFileSelect={onFileSelect}
              onRemove={onToggleBookmark}
              onReorder={(from, to) => onReorderBookmark?.(from, to)}
              onUpdate={(path, changes) => onUpdateBookmark?.(path, changes)}
            />
          </Box>
        </CustomTabPanel>
      </Box>

      <Menu
        open={contextMenu !== null}
        onClose={() => setContextMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={contextMenu ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined}
      >
        {contextMenu?.node?.isSpecial && !ctxIsMdpRoot ? (
          <MenuItem onClick={() => handleOpenDialog('special')}>
            <ListItemIcon><NoteAddIcon fontSize="small" color="secondary" /></ListItemIcon>
            New {contextMenu.node.name.replace(/s$/, '')} File
          </MenuItem>
        ) : ctxFileInSpecial ? (
          <MenuItem onClick={() => handleOpenDialog('special')}>
            <ListItemIcon><NoteAddIcon fontSize="small" color="secondary" /></ListItemIcon>
            New {ctxParts[1].replace(/s$/, '')} File
          </MenuItem>
        ) : (
          ctxShowGenericNew && [
            <MenuItem key="new-slide" onClick={() => handleOpenDialog('slide')}>
              <ListItemIcon><SlideshowIcon fontSize="small" color="primary" /></ListItemIcon> New Slide
            </MenuItem>,
            <MenuItem key="new-file" onClick={() => handleOpenDialog('file')}>
              <ListItemIcon><NoteAddIcon fontSize="small" /></ListItemIcon> New File
            </MenuItem>,
            <MenuItem key="new-folder" onClick={() => handleOpenDialog('directory')}>
              <ListItemIcon><CreateNewFolderIcon fontSize="small" /></ListItemIcon> New Folder
            </MenuItem>
          ]
        )}
        {(ctxFileInSpecial || ctxShowGenericNew) && contextMenu?.node && <Divider />}

        {contextMenu?.node && !contextMenu.node.isSpecial && (
          <MenuItem onClick={handleRenameClick} disabled={selectedPaths.size > 1}>
            <ListItemIcon><DriveFileRenameOutlineIcon fontSize="small" /></ListItemIcon> Rename
          </MenuItem>
        )}
        {contextMenu?.node && contextMenu.node.type === 'file' && (
          <MenuItem onClick={() => { onToggleBookmark(contextMenu.path); setContextMenu(null); }}>
            <ListItemIcon>
              {isBookmarked(contextMenu.path) ? <BookmarkIcon fontSize="small" color="primary" /> : <BookmarkBorderIcon fontSize="small" />}
            </ListItemIcon>
            {isBookmarked(contextMenu.path) ? 'Remove Bookmark' : 'Add Bookmark'}
          </MenuItem>
        )}
        {contextMenu?.node && !contextMenu.node.isSpecial && (
          <MenuItem onClick={() => { setDeleteDialogOpen(true); setContextMenu(null); }} sx={{ color: 'error.main' }}>
            <ListItemIcon><DeleteIcon fontSize="small" color="error" /></ListItemIcon> Delete
          </MenuItem>
        )}
        <Divider />
        <MenuItem onClick={() => { onManualRefresh(); setContextMenu(null); }}>
          <ListItemIcon><RefreshIcon fontSize="small" /></ListItemIcon> Refresh
        </MenuItem>
      </Menu>

      <Dialog open={renameDialogOpen} onClose={() => setRenameDialogOpen(false)}>
        <DialogTitle>Rename</DialogTitle>
        <DialogContent>
          <TextField autoFocus margin="dense" label="New Name" fullWidth variant="standard" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && executeRename()} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameDialogOpen(false)}>Cancel</Button>
          <Button onClick={executeRename} variant="contained">Rename</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>Confirm Delete</DialogTitle>
        <DialogContent>
          <Typography>Are you sure you want to delete {selectedPaths.size} item(s)?</Typography>
          <Typography variant="caption" color="error">This action cannot be undone.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button onClick={executeDelete} variant="contained" color="error">Delete</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialogConfig.open} onClose={() => setDialogConfig({ ...dialogConfig, open: false })} fullWidth maxWidth="sm">
        <DialogTitle>
          Create New {
            dialogConfig.type === 'slide' ? 'Slide' :
            dialogConfig.type === 'file' ? 'File' :
            dialogConfig.type === 'special' ? 'Item' : 'Folder'
          }
          {dialogConfig.parentPath ? ` in /${dialogConfig.parentPath}` : ' in Root'}
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <TextField
            autoFocus
            label="Name"
            fullWidth
            variant="standard"
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSubmitCreate(); }}
          />
          {dialogConfig.type === 'slide' && templates.length > 0 && (
            <Box>
              <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mb: 1 }}>Template</Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 1, maxHeight: 320, overflowY: 'auto', pr: 0.5 }}>
                {templates.map(t => {
                  const selected = t.path === selectedTemplatePath;
                  const label = t.name.replace(/\.slide\.md$/i, '').replace(/\.md$/i, '');
                  return (
                    <Box
                      key={t.path}
                      onClick={() => setSelectedTemplatePath(t.path)}
                      sx={{
                        cursor: 'pointer', p: 1.5, borderRadius: 1.5,
                        border: selected ? '2px solid #3b82f6' : '1px solid #e0e0e0',
                        bgcolor: selected ? 'rgba(59,130,246,0.06)' : 'transparent',
                        display: 'flex', flexDirection: 'column', gap: 0.5, minHeight: 84,
                        transition: 'border-color 0.1s', '&:hover': { borderColor: '#3b82f6' },
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        <SlideshowIcon fontSize="small" sx={{ color: t.isCustom ? 'secondary.main' : 'primary.main' }} />
                        <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>{label}</Typography>
                      </Box>
                      {t.description && (
                        <Typography variant="caption" color="textSecondary" sx={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                          {t.description}
                        </Typography>
                      )}
                    </Box>
                  );
                })}
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogConfig({ ...dialogConfig, open: false })}>Cancel</Button>
          <Button variant="contained" onClick={handleSubmitCreate} disabled={!newItemName.trim()}>
            Create
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};