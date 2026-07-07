import React from 'react';
import { Box, Typography, CircularProgress } from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import ImageIcon from '@mui/icons-material/Image';
import SlideshowIcon from '@mui/icons-material/Slideshow';
import ArticleIcon from '@mui/icons-material/Article';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import CloudIcon from '@mui/icons-material/Cloud';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import FolderSpecialIcon from '@mui/icons-material/FolderSpecial';
import type { FileNode } from '../../../types';
import { isFileTreeDrag } from '../dragUtils';

interface FileTreeItemProps {
  node: FileNode;
  level: number;
  selectedPaths: Set<string>;
  expandedDirs: Set<string>;
  dragOverPath: string | null;
  loadingLinks?: Set<string>;
  onSelect: (e: React.MouseEvent, node: FileNode) => void;
  onDoubleClick: (node: FileNode) => void;
  onToggleExpand: (e: React.MouseEvent, path: string) => void;
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void;
  onDragStart: (e: React.DragEvent, node: FileNode) => void;
  onDragOver: (e: React.DragEvent, node: FileNode) => void;
  onDrop: (e: React.DragEvent, node: FileNode) => void;
}

export const FileTreeItem: React.FC<FileTreeItemProps> = ({
  node, level, selectedPaths, expandedDirs, dragOverPath, loadingLinks,
  onSelect, onDoubleClick, onToggleExpand, onContextMenu,
  onDragStart, onDragOver, onDrop
}) => {
  const isDir = node.type === 'directory';
  const isOpen = expandedDirs.has(node.path);
  const isLoading = !!loadingLinks?.has(node.path);
  const isSelected = selectedPaths.has(node.path);
  const isDragOver = dragOverPath === node.path;

  const isSlide = !isDir && node.name.endsWith('.slide.md');
  const isMarkdown = !isDir && !isSlide && node.name.endsWith('.md');
  const isPdf = !isDir && /\.pdf$/i.test(node.name);

  let Icon = isDir ? (isOpen ? FolderOpenIcon : FolderIcon) : InsertDriveFileIcon;
  if (isSlide) Icon = SlideshowIcon;
  else if (isMarkdown) Icon = ArticleIcon;
  else if (isPdf) Icon = PictureAsPdfIcon;
  else if (!isDir && node.isBinary) Icon = ImageIcon;
  // A `.mdplink` is shown as a directory: SSH links get a cloud, local links a
  // special-folder badge. An unreachable target gets a "broken" variant.
  if (node.isLink) {
    if (node.linkError) Icon = node.linkType === 'ssh' ? CloudOffIcon : LinkOffIcon;
    else Icon = node.linkType === 'ssh' ? CloudIcon : FolderSpecialIcon;
  }

  // A `.mdp` content-profile folder at ANY level gets the same purple as the root
  // one (root is also `isSpecial`); per-folder `.mdp`s should look identical. The
  // app-managed `.mdp/mcp-backups` folder shares that purple so it reads as MDP's.
  const isMdp = isDir && (node.name === '.mdp' || /(^|\/)\.mdp\/mcp-backups$/.test(node.path || ''));

  let iconColor = 'var(--app-text-secondary)';
  if (node.isSpecial || isMdp) iconColor = '#a855f7';
  else if (isDir) iconColor = '#60a5fa';
  else if (isSlide) iconColor = '#fb923c';
  else if (isMarkdown) iconColor = 'var(--app-text-muted)';
  else if (isPdf) iconColor = '#ef4444';
  else if (!isDir && node.isBinary) iconColor = 'var(--app-text-disabled)';
  if (node.isLink) iconColor = node.linkError ? 'var(--app-danger, #f04747)' : '#34d399';
  // Sealed (`.git` / `.mdpignore`) folders are inert — show them greyed out.
  if (node.sealed) iconColor = 'var(--app-text-disabled)';

  return (
    <div style={{ opacity: node.isVirtual ? 0.6 : 1 }}>
      <Box
        data-tree-path={node.path}
        onClick={(e) => onSelect(e, node)}
        onDoubleClick={() => onDoubleClick(node)}
        onContextMenu={(e) => onContextMenu(e, node)}
        title={node.isLink ? (node.linkError ? `Link error: ${node.linkError}` : `${node.linkType === 'ssh' ? 'SSH' : 'Local'} link`) : undefined}
        draggable
        onDragStart={(e) => onDragStart(e, node)}
        onDragOver={(e) => { if (!isFileTreeDrag(e)) return; e.preventDefault(); e.stopPropagation(); onDragOver(e, node); }}
        onDrop={(e) => { if (!isFileTreeDrag(e)) return; e.preventDefault(); e.stopPropagation(); onDrop(e, node); }}
        sx={{
          display: 'flex', alignItems: 'center', py: 0.5, pr: 1,
          pl: `${level * 16 + 8}px`,
          cursor: 'pointer', userSelect: 'none',
          width: '100%',
          boxSizing: 'border-box',
          backgroundColor: isSelected ? 'var(--app-bg-hover)' : 'transparent',
          outline: isDragOver ? '1px dashed var(--app-accent)' : 'none',
          outlineOffset: '-1px',
          color: node.sealed ? 'var(--app-text-disabled)' : (isDir ? 'var(--app-text-secondary)' : 'var(--app-text-muted)'),
          '&:hover': { backgroundColor: 'var(--app-bg-hover)' }
        }}
      >
        <Box
          onClick={(e) => isDir && !node.sealed && onToggleExpand(e, node.path)}
          sx={{
            width: 16,
            minWidth: 16,
            flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center', mr: 0.5, opacity: 0.7, '&:hover': { opacity: 1 }
          }}
        >
          {/* Sealed (`.mdpignore`) dirs show no caret — they are not expandable. */}
          {isLoading ? <CircularProgress size={10} sx={{ color: 'var(--app-text-muted)' }} /> : (isDir && !node.sealed ? (isOpen ? '▼' : '▶') : '')}
        </Box>

        <Icon sx={{ fontSize: 18, mr: 1, flexShrink: 0, color: iconColor }} />

        <Typography variant="body2" sx={{
          fontSize: '0.85rem',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          flex: 1,
          minWidth: 0
        }}>
          {node.name}
        </Typography>
      </Box>

      {isDir && isOpen && node.children && (
        <Box>
          {node.children.map((child) => (
            <FileTreeItem
              key={child.path} node={child} level={level + 1}
              selectedPaths={selectedPaths} expandedDirs={expandedDirs} dragOverPath={dragOverPath} loadingLinks={loadingLinks}
              onSelect={onSelect} onDoubleClick={onDoubleClick} onToggleExpand={onToggleExpand} onContextMenu={onContextMenu}
              onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop}
            />
          ))}
          {isLoading && node.children.length === 0 && (
            <Typography variant="body2" sx={{ pl: `${(level + 1) * 16 + 28}px`, py: 0.5, fontSize: '0.8rem', color: 'var(--app-text-disabled)', fontStyle: 'italic' }}>
              Loading…
            </Typography>
          )}
        </Box>
      )}
    </div>
  );
};