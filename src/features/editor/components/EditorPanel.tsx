import React, { useCallback, useState, useEffect } from 'react';
import SaveIcon from '@mui/icons-material/Save';
import UndoIcon from '@mui/icons-material/Undo';
import RedoIcon from '@mui/icons-material/Redo';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder';
import { Box, Typography, Divider, IconButton, Tooltip, Popover, Button } from '@mui/material';
import type { Bookmark } from '../../../pages/EditorPage/hooks/useBookmarks';
import { BOOKMARK_ICON_KEYS, BOOKMARK_COLORS, bookmarkIconFor } from '../../fileTree/bookmarkConfig';
import CodeMirror, { ViewUpdate, type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import type { Extension } from '@codemirror/state';
import { undo, redo } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';

import { type FileType } from '../../../types';
import { MAX_FILE_SIZE, CODEMIRROR_BASIC_SETUP } from '../../../constants';
import { apiClient } from '../../../api/apiClient';

interface EditorPanelProps {
  currentFileName: string | null;
  currentFileType: FileType;
  editorRef: React.RefObject<ReactCodeMirrorRef | null>;
  editorInitialValue: string;
  extensions: Extension[];
  onChangeEditor: (val: string) => void;
  onEditorUpdate: (viewUpdate: ViewUpdate) => void;
  onInsertText: (text: string) => void;
  onSave: () => void;
  onMoveSlide?: (direction: number) => void;
  isBookmarked?: boolean;
  onToggleBookmark?: () => void;
  bookmark?: Bookmark;
  onUpdateBookmark?: (changes: { icon?: string; color?: string }) => void;
}

export const EditorPanel: React.FC<EditorPanelProps> = ({
  currentFileName, currentFileType, editorRef, editorInitialValue,
  extensions, onChangeEditor, onEditorUpdate, onInsertText, onSave, onMoveSlide, isBookmarked, onToggleBookmark,
  bookmark, onUpdateBookmark
}) => {

  const [editorFontSize, setEditorFontSize] = useState(16);
  const [bookmarkPickerAnchor, setBookmarkPickerAnchor] = useState<HTMLElement | null>(null);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setEditorFontSize(prev => Math.max(10, Math.min(prev + (e.deltaY > 0 ? -1 : 1), 40)));
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === ';' || e.key === '=')) {
        e.preventDefault();
        setEditorFontSize(prev => Math.min(prev + 1, 40));
      } else if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        setEditorFontSize(prev => Math.max(10, prev - 1));
      }
    };
    window.addEventListener('keydown', handleKeyDown, { passive: false });
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleUndo = useCallback(() => {
    if (editorRef.current?.view) undo(editorRef.current.view);
  }, [editorRef]);

  const handleRedo = useCallback(() => {
    if (editorRef.current?.view) redo(editorRef.current.view);
  }, [editorRef]);

  const handlePrevSlide = useCallback(() => {
    const view = editorRef.current?.view;
    if (!view) return;
    const doc = view.state.doc;
    const pos = view.state.selection.main.head;
    const currentLineNumber = doc.lineAt(pos).number;

    const hrLines: number[] = [];
    for (let i = 1; i <= doc.lines; i++) {
      if (doc.line(i).text.trim() === '---') hrLines.push(i);
    }

    const prevHrs = hrLines.filter(line => line < currentLineNumber);
    let targetLineNumber = 1;
    if (prevHrs.length >= 2) {
      targetLineNumber = prevHrs[prevHrs.length - 2] + 1;
    } else if (prevHrs.length === 1) {
      targetLineNumber = 1;
    }

    const targetPos = doc.line(targetLineNumber).from;
    view.dispatch({
      selection: { anchor: targetPos, head: targetPos },
      effects: EditorView.scrollIntoView(targetPos, { y: "start" })
    });
    view.focus();
    if (onMoveSlide) onMoveSlide(-1);
  }, [editorRef, onMoveSlide]);

  const handleNextSlide = useCallback(() => {
    const view = editorRef.current?.view;
    if (!view) return;
    const doc = view.state.doc;
    const pos = view.state.selection.main.head;
    const currentLineNumber = doc.lineAt(pos).number;

    const hrLines: number[] = [];
    for (let i = 1; i <= doc.lines; i++) {
      if (doc.line(i).text.trim() === '---') hrLines.push(i);
    }

    const nextHrs = hrLines.filter(line => line > currentLineNumber);
    let targetLineNumber = doc.lines;
    if (nextHrs.length > 0) {
      targetLineNumber = nextHrs[0] + 1;
      if (targetLineNumber > doc.lines) targetLineNumber = doc.lines;
    }

    const targetPos = doc.line(targetLineNumber).from;
    view.dispatch({
      selection: { anchor: targetPos, head: targetPos },
      effects: EditorView.scrollIntoView(targetPos, { y: "start" })
    });
    view.focus();
    if (onMoveSlide) onMoveSlide(1);
  }, [editorRef, onMoveSlide]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes('application/json')) return;
    e.preventDefault();
    e.stopPropagation();

    try {
      const data = e.dataTransfer.getData('application/json');
      if (data) {
        const payload = JSON.parse(data);
        if (payload.type === 'internal_move' && payload.paths && payload.paths.length > 0) {
          const view = editorRef.current?.view;
          if (!view || !currentFileName) return;

          const getRelativePath = (from: string, to: string) => {
            const fromParts = from.split('/');
            fromParts.pop();
            const toParts = to.split('/');

            while (fromParts.length > 0 && toParts.length > 0 && fromParts[0] === toParts[0]) {
              fromParts.shift();
              toParts.shift();
            }

            const up = fromParts.map(() => '..').join('/');
            const down = toParts.join('/');

            if (up === '' && down === '') return './';
            if (up === '') return './' + down;
            return up + '/' + down;
          };

          let insertText = '';

          if (e.ctrlKey || e.metaKey) {
            for (const p of payload.paths) {
              try {
                if (p.match(/\.(png|jpe?g|gif|svg|webp)$/i)) {
                  const base64 = await apiClient.getFileAsDataUrl(p);
                  insertText += `![](${base64})\n`;
                } else {
                  const text = await apiClient.readFileText(p);
                  const ext = p.split('.').pop() || '';
                  insertText += `\n\`\`\`${ext}\n${text}\n\`\`\`\n`;
                }
              } catch (err) {
                console.error("Failed to fetch file data for inline embedding", err);
              }
            }
          } else {
            payload.paths.forEach((p: string) => {
              const relPath = getRelativePath(currentFileName, p);
              if (p.match(/\.(png|jpe?g|gif|svg|webp)$/i)) {
                insertText += `![](${relPath})\n`;
              } else {
                insertText += `[${p.split('/').pop()}](${relPath})\n`;
              }
            });
          }

          if (insertText) {
             const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
             if (pos !== null) {
               view.dispatch({
                 changes: { from: pos, insert: insertText }
               });
             } else {
               onInsertText(insertText);
             }
          }
        }
      }
    } catch (err) {
      console.error("Drop failed:", err);
    }
  }, [currentFileName, editorRef, onInsertText]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (Array.from(e.dataTransfer.types).includes('application/json')) {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
    }
  }, []);

  const commonEditor = (
    <Box sx={{ height: '100%', flex: 1, overflow: 'hidden', fontSize: `${editorFontSize}px` }} onDropCapture={handleDrop} onDragOverCapture={handleDragOver}>
      <CodeMirror
        ref={editorRef}
        value={editorInitialValue}
        height="100%"
        className="full-height-editor"
        extensions={extensions}
        onChange={onChangeEditor}
        onUpdate={onEditorUpdate}
        theme="dark"
        basicSetup={CODEMIRROR_BASIC_SETUP}
      />
    </Box>
  );

  return (
    <Box onWheel={handleWheel} sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'white', position: 'relative', overflow: 'hidden' }}>
      {!currentFileName ? (
        <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', bgcolor: '#f5f5f5' }}>
          <Typography>No file selected</Typography>
        </Box>
      ) : (
        <>
          {(currentFileType === 'markdown' || currentFileType === 'text') && (
            <Box sx={{ display: 'flex', alignItems: 'center', px: 2, py: 0.5, borderBottom: '1px solid #333333', bgcolor: '#252526' }}>
              <Tooltip title="Save (Ctrl+S)">
                <IconButton size="small" onClick={onSave} sx={{ color: '#aaa', '&:hover': { color: '#fff' } }}><SaveIcon fontSize="small" /></IconButton>
              </Tooltip>

              <Divider orientation="vertical" flexItem sx={{ mx: 1, my: 0.5, borderColor: '#444' }} />

              <Tooltip title="Undo (Ctrl+Z)">
                <IconButton size="small" onClick={handleUndo} sx={{ color: '#aaa', '&:hover': { color: '#fff' } }}><UndoIcon fontSize="small" /></IconButton>
              </Tooltip>
              <Tooltip title="Redo (Ctrl+Y)">
                <IconButton size="small" onClick={handleRedo} sx={{ color: '#aaa', '&:hover': { color: '#fff' } }}><RedoIcon fontSize="small" /></IconButton>
              </Tooltip>

              {currentFileName.endsWith('.slide.md') && (
                <>
                  <Divider orientation="vertical" flexItem sx={{ mx: 1, my: 0.5, borderColor: '#444' }} />
                  <Tooltip title="Previous Slide">
                    <IconButton size="small" onClick={handlePrevSlide} sx={{ color: '#aaa', '&:hover': { color: '#fff' } }}><ArrowUpwardIcon fontSize="small" /></IconButton>
                  </Tooltip>
                  <Tooltip title="Next Slide">
                    <IconButton size="small" onClick={handleNextSlide} sx={{ color: '#aaa', '&:hover': { color: '#fff' } }}><ArrowDownwardIcon fontSize="small" /></IconButton>
                  </Tooltip>
                </>
              )}
              {onToggleBookmark && (() => {
                const BmIcon = bookmark ? bookmarkIconFor(bookmark.icon) : BookmarkBorderIcon;
                const bmColor = bookmark?.color || '#3b82f6';
                return (
                  <>
                    <Divider orientation="vertical" flexItem sx={{ mx: 1, my: 0.5, borderColor: '#444' }} />
                    <Tooltip title={isBookmarked ? "Bookmark (icon / color / remove)" : "Add Bookmark"}>
                      <IconButton
                        size="small"
                        onClick={(e) => { if (isBookmarked) setBookmarkPickerAnchor(e.currentTarget); else onToggleBookmark(); }}
                        sx={{ color: isBookmarked ? bmColor : '#aaa', '&:hover': { color: isBookmarked ? bmColor : '#fff' } }}
                      >
                        <BmIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </>
                );
              })()}
            </Box>
          )}

          <Box sx={{ flex: 1, height: 0 }}>
            {(currentFileType === 'markdown' || currentFileType === 'text') ? (
              <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: '#1e1e1e' }}>
                {commonEditor}
              </Box>
            ) : (
              <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', bgcolor: '#f5f5f5', color: '#999', gap: 1 }}>
                <Typography variant="h6">{currentFileType === 'limit-exceeded' ? "File Too Large" : "Editor Disabled"}</Typography>
                <Typography variant="body2">{currentFileType === 'image' ? "Image file" : currentFileType === 'binary' ? "Binary file" : currentFileType === 'limit-exceeded' ? `Exceeds editor limit (${MAX_FILE_SIZE / 1024}KB)` : "Unknown file type"}</Typography>
              </Box>
            )}
          </Box>
        </>
      )}

      <Popover
        open={!!bookmarkPickerAnchor}
        anchorEl={bookmarkPickerAnchor}
        onClose={() => setBookmarkPickerAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { sx: { bgcolor: '#252526', color: '#ccc', border: '1px solid #3c3c3c', p: 1.5 } } }}
      >
        {bookmark && (
          <Box sx={{ width: 180 }}>
            <Typography variant="caption" sx={{ color: '#8ba0b2' }}>Icon</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0.5, mb: 1, mt: 0.5 }}>
              {BOOKMARK_ICON_KEYS.map((key) => {
                const Icon = bookmarkIconFor(key);
                const selected = key === bookmark.icon;
                return (
                  <IconButton key={key} size="small" onClick={() => onUpdateBookmark?.({ icon: key })} sx={{ color: bookmark.color, border: selected ? '1px solid #3b82f6' : '1px solid transparent', borderRadius: 1 }}>
                    <Icon fontSize="small" />
                  </IconButton>
                );
              })}
            </Box>
            <Typography variant="caption" sx={{ color: '#8ba0b2' }}>Color</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 0.5, mt: 0.5, mb: 1 }}>
              {BOOKMARK_COLORS.map((c) => (
                <Box
                  key={c}
                  onClick={() => onUpdateBookmark?.({ color: c })}
                  sx={{ width: 16, height: 16, borderRadius: '50%', bgcolor: c, cursor: 'pointer', border: c === bookmark.color ? '2px solid #fff' : '2px solid transparent', boxShadow: '0 0 0 1px rgba(255,255,255,0.2)' }}
                />
              ))}
            </Box>
            <Divider sx={{ borderColor: '#3c3c3c', my: 1 }} />
            <Button
              size="small"
              fullWidth
              onClick={() => { onToggleBookmark?.(); setBookmarkPickerAnchor(null); }}
              sx={{ color: '#ef4444', textTransform: 'none', justifyContent: 'flex-start' }}
            >
              Remove Bookmark
            </Button>
          </Box>
        )}
      </Popover>
    </Box>
  );
};