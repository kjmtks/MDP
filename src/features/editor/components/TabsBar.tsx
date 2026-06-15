import React, { useState } from 'react';
import { Box, Typography, IconButton, Menu, MenuItem, ListItemIcon, Divider } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import CloseFullscreenIcon from '@mui/icons-material/CloseFullscreen';
import ClearAllIcon from '@mui/icons-material/ClearAll';
import type { OpenTab } from '../../fileTree/hooks/useFileManager';

interface TabsBarProps {
  tabs: OpenTab[];
  activeTabIndex: number;
  onTabClick: (index: number) => void;
  onTabClose: (e: React.MouseEvent, index: number) => void;
  onTabReorder?: (startIndex: number, endIndex: number) => void;
  onCloseOthers?: (index: number) => void;
  onCloseAll?: () => void;
}

export const TabsBar: React.FC<TabsBarProps> = ({
  tabs, activeTabIndex, onTabClick, onTabClose, onTabReorder, onCloseOthers, onCloseAll
}) => {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const [contextMenu, setContextMenu] = useState<{ mouseX: number; mouseY: number; index: number } | null>(null);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (draggedIndex !== null && draggedIndex !== dropIndex && onTabReorder) {
      onTabReorder(draggedIndex, dropIndex);
    }
    setDraggedIndex(null);
  };

  const handleContextMenu = (e: React.MouseEvent, index: number) => {
    e.preventDefault();
    setContextMenu({ mouseX: e.clientX, mouseY: e.clientY, index });
  };

  const handleCloseMenu = () => setContextMenu(null);

  return (
    <>
      <Box sx={{
        display: 'flex',
        bgcolor: '#252526',
        overflowX: 'auto',
        flexShrink: 0,
        '&::-webkit-scrollbar': { height: 4 },
        '&::-webkit-scrollbar-thumb': { bgcolor: '#555' }
      }}>
        {tabs.map((tab, index) => {
          const isActive = index === activeTabIndex;
          const fileName = tab.path.split('/').pop() || tab.path;
          return (
            <Box
              key={tab.id}
              draggable
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDrop={(e) => handleDrop(e, index)}
              onContextMenu={(e) => handleContextMenu(e, index)}
              onClick={() => onTabClick(index)}
              sx={{
                display: 'flex', alignItems: 'center', minWidth: 120, maxWidth: 200, height: 35,
                bgcolor: isActive ? '#1e1e1e' : '#2d2d2d', color: isActive ? '#ffffff' : '#8ba0b2',
                borderTop: isActive ? '2px solid #3b82f6' : '2px solid transparent',
                borderRight: '1px solid #1e1e1e', cursor: 'pointer', px: 1.5,
                opacity: draggedIndex === index ? 0.5 : 1,
                userSelect: 'none',
                transition: 'background-color 0.1s',
                '&:hover': { bgcolor: isActive ? '#1e1e1e' : '#2a2d2e' }
              }}
            >
              <Typography variant="body2" noWrap sx={{ flex: 1, fontSize: '0.8rem', fontStyle: tab.isModified ? 'italic' : 'normal' }}>
                {fileName}{tab.isModified ? ' •' : ''}
              </Typography>
              <IconButton
                size="small"
                onClick={(e) => { e.stopPropagation(); onTabClose(e, index); }}
                sx={{ ml: 0.5, p: 0.25, color: 'inherit', '&:hover': { bgcolor: 'rgba(255,255,255,0.1)' } }}
              >
                <CloseIcon sx={{ fontSize: '1rem' }} />
              </IconButton>
            </Box>
          );
        })}
      </Box>

      <Menu
        open={contextMenu !== null}
        onClose={handleCloseMenu}
        anchorReference="anchorPosition"
        anchorPosition={contextMenu ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined}
      >
        <MenuItem onClick={(e) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onTabClose(e as any, contextMenu!.index);
          handleCloseMenu();
        }}>
          <ListItemIcon><CloseIcon fontSize="small" /></ListItemIcon> Close
        </MenuItem>

        <Divider />

        <MenuItem
          onClick={() => {
            onCloseOthers?.(contextMenu!.index);
            handleCloseMenu();
          }}
          disabled={tabs.length <= 1}
        >
          <ListItemIcon><CloseFullscreenIcon fontSize="small" /></ListItemIcon> Close Others
        </MenuItem>

        <MenuItem
          onClick={() => {
            onCloseAll?.();
            handleCloseMenu();
          }}
          sx={{ color: 'error.main' }}
        >
          <ListItemIcon><ClearAllIcon fontSize="small" color="error" /></ListItemIcon> Close All
        </MenuItem>
      </Menu>
    </>
  );
};