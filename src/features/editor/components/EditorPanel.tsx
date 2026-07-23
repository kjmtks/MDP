import React, { useCallback, useState, useEffect, useRef } from 'react';
import SaveIcon from '@mui/icons-material/Save';
import UndoIcon from '@mui/icons-material/Undo';
import RedoIcon from '@mui/icons-material/Redo';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import TipsAndUpdatesIcon from '@mui/icons-material/TipsAndUpdates';
import FactCheckIcon from '@mui/icons-material/FactCheck';
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
import { useAppSettings } from '../../settings/AppSettingsContext';
import { matchAction } from '../../settings/shortcuts/matcher';
import { actionById } from '../../settings/shortcuts/registry';

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

const EditorPanelImpl: React.FC<EditorPanelProps> = ({
  currentFileName, currentFileType, editorRef, editorInitialValue,
  extensions, onChangeEditor, onEditorUpdate, onInsertText, onSave, onMoveSlide, isBookmarked, onToggleBookmark,
  bookmark, onUpdateBookmark
}) => {

  // Editor font size is a persisted app setting (per-workspace). Ctrl+wheel and
  // Ctrl +/- adjust it live.
  const { appThemeVariant, settings, update } = useAppSettings();
  const editorFontSize = settings.editorFontSize;
  const fontRef = useRef(editorFontSize);
  useEffect(() => { fontRef.current = editorFontSize; }, [editorFontSize]);
  const setFont = useCallback((v: number) => update({ editorFontSize: Math.max(10, Math.min(v, 40)) }), [update]);
  const [bookmarkPickerAnchor, setBookmarkPickerAnchor] = useState<HTMLElement | null>(null);
  const editorAreaRef = useRef<HTMLDivElement>(null);

  // Ctrl/Cmd + wheel = font zoom. Use a NATIVE non-passive listener (React's
  // onWheel is passive, so preventDefault there is ignored and the page would
  // zoom). Plain wheel is left entirely untouched so the editor scrolls normally.
  useEffect(() => {
    const el = editorAreaRef.current;
    if (!el) return;
    const onWheelNative = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setFont(fontRef.current + (e.deltaY > 0 ? -1 : 1));
    };
    el.addEventListener('wheel', onWheelNative, { passive: false });
    return () => el.removeEventListener('wheel', onWheelNative);
  }, [setFont]);

  useEffect(() => {
    const inc = actionById('global.editorFontIncrease');
    const dec = actionById('global.editorFontDecrease');
    const handleKeyDown = (e: KeyboardEvent) => {
      if (inc && matchAction(e, [inc], settings)) {
        e.preventDefault();
        setFont(fontRef.current + 1);
      } else if (dec && matchAction(e, [dec], settings)) {
        e.preventDefault();
        setFont(fontRef.current - 1);
      }
    };
    window.addEventListener('keydown', handleKeyDown, { passive: false });
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setFont, settings]);

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
        theme={appThemeVariant === 'light' ? 'light' : 'dark'}
        basicSetup={CODEMIRROR_BASIC_SETUP}
      />
    </Box>
  );

  return (
    <Box ref={editorAreaRef} sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'var(--app-bg-editor)', position: 'relative', overflow: 'hidden' }}>
      {!currentFileName ? (
        <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--app-text-disabled)', bgcolor: 'var(--app-bg-editor)' }}>
          <Typography>No file selected</Typography>
        </Box>
      ) : (
        <>
          {(currentFileType === 'markdown' || currentFileType === 'text') && (
            <Box sx={{ display: 'flex', alignItems: 'center', px: 2, py: 0.5, borderBottom: '1px solid var(--app-border)', bgcolor: 'var(--app-bg-panel)' }}>
              <Tooltip title="Save (Ctrl+S)">
                <IconButton size="small" onClick={onSave} sx={{ color: 'var(--app-text-muted)', '&:hover': { color: 'var(--app-text-strong)' } }}><SaveIcon fontSize="small" /></IconButton>
              </Tooltip>

              <Divider orientation="vertical" flexItem sx={{ mx: 1, my: 0.5, borderColor: 'var(--app-border-strong)' }} />

              <Tooltip title="Undo (Ctrl+Z)">
                <IconButton size="small" onClick={handleUndo} sx={{ color: 'var(--app-text-muted)', '&:hover': { color: 'var(--app-text-strong)' } }}><UndoIcon fontSize="small" /></IconButton>
              </Tooltip>
              <Tooltip title="Redo (Ctrl+Y)">
                <IconButton size="small" onClick={handleRedo} sx={{ color: 'var(--app-text-muted)', '&:hover': { color: 'var(--app-text-strong)' } }}><RedoIcon fontSize="small" /></IconButton>
              </Tooltip>

              {currentFileName.endsWith('.slide.md') && (
                <>
                  <Divider orientation="vertical" flexItem sx={{ mx: 1, my: 0.5, borderColor: 'var(--app-border-strong)' }} />
                  <Tooltip title="Previous Slide">
                    <IconButton size="small" onClick={handlePrevSlide} sx={{ color: 'var(--app-text-muted)', '&:hover': { color: 'var(--app-text-strong)' } }}><ArrowUpwardIcon fontSize="small" /></IconButton>
                  </Tooltip>
                  <Tooltip title="Next Slide">
                    <IconButton size="small" onClick={handleNextSlide} sx={{ color: 'var(--app-text-muted)', '&:hover': { color: 'var(--app-text-strong)' } }}><ArrowDownwardIcon fontSize="small" /></IconButton>
                  </Tooltip>

                  <Divider orientation="vertical" flexItem sx={{ mx: 1, my: 0.5, borderColor: 'var(--app-border-strong)' }} />
                  <Tooltip title="Suggest a module for the selection / current slide">
                    <IconButton size="small" onClick={() => window.dispatchEvent(new CustomEvent('mdp-suggest-module'))} sx={{ color: 'var(--app-text-muted)', '&:hover': { color: 'var(--app-text-strong)' } }}><TipsAndUpdatesIcon fontSize="small" /></IconButton>
                  </Tooltip>
                  <Tooltip title="Check this deck for problems (unknown modules/effects, unclosed regions, bad params…)">
                    <IconButton size="small" onClick={() => window.dispatchEvent(new CustomEvent('mdp-check-deck'))} sx={{ color: 'var(--app-text-muted)', '&:hover': { color: 'var(--app-text-strong)' } }}><FactCheckIcon fontSize="small" /></IconButton>
                  </Tooltip>
                </>
              )}
              {onToggleBookmark && (() => {
                const BmIcon = bookmark ? bookmarkIconFor(bookmark.icon) : BookmarkBorderIcon;
                const bmColor = bookmark?.color || 'var(--app-accent)';
                return (
                  <>
                    <Divider orientation="vertical" flexItem sx={{ mx: 1, my: 0.5, borderColor: 'var(--app-border-strong)' }} />
                    <Tooltip title={isBookmarked ? "Bookmark (icon / color / remove)" : "Add Bookmark"}>
                      <IconButton
                        size="small"
                        onClick={(e) => { if (isBookmarked) setBookmarkPickerAnchor(e.currentTarget); else onToggleBookmark(); }}
                        sx={{ color: isBookmarked ? bmColor : 'var(--app-text-muted)', '&:hover': { color: isBookmarked ? bmColor : 'var(--app-text-strong)' } }}
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
              <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'var(--app-bg-editor)' }}>
                {commonEditor}
              </Box>
            ) : (
              <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', bgcolor: 'var(--app-bg-editor)', color: 'var(--app-text-disabled)', gap: 1 }}>
                <Typography variant="h6">{currentFileType === 'limit-exceeded' ? "File Too Large" : "Editor Disabled"}</Typography>
                <Typography variant="body2">{currentFileType === 'image' ? "Image file" : currentFileType === 'pdf' ? "PDF file — see the preview pane" : currentFileType === 'video' ? "Video file — see the preview pane" : currentFileType === 'binary' ? "Binary file" : currentFileType === 'limit-exceeded' ? `Exceeds editor limit (${MAX_FILE_SIZE / 1024}KB)` : "Unknown file type"}</Typography>
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
        slotProps={{ paper: { sx: { bgcolor: 'var(--app-bg-panel)', color: 'var(--app-text-secondary)', border: '1px solid var(--app-border-subtle)', p: 1.5 } } }}
      >
        {bookmark && (
          <Box sx={{ width: 180 }}>
            <Typography variant="caption" sx={{ color: 'var(--app-text-disabled)' }}>Icon</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0.5, mb: 1, mt: 0.5 }}>
              {BOOKMARK_ICON_KEYS.map((key) => {
                const Icon = bookmarkIconFor(key);
                const selected = key === bookmark.icon;
                return (
                  <IconButton key={key} size="small" onClick={() => onUpdateBookmark?.({ icon: key })} sx={{ color: bookmark.color, border: selected ? '1px solid var(--app-accent)' : '1px solid transparent', borderRadius: 1 }}>
                    <Icon fontSize="small" />
                  </IconButton>
                );
              })}
            </Box>
            <Typography variant="caption" sx={{ color: 'var(--app-text-disabled)' }}>Color</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 0.5, mt: 0.5, mb: 1 }}>
              {BOOKMARK_COLORS.map((c) => (
                <Box
                  key={c}
                  onClick={() => onUpdateBookmark?.({ color: c })}
                  sx={{ width: 16, height: 16, borderRadius: '50%', bgcolor: c, cursor: 'pointer', border: c === bookmark.color ? '2px solid var(--app-text-strong)' : '2px solid transparent', boxShadow: '0 0 0 1px var(--app-border)' }}
                />
              ))}
            </Box>
            <Divider sx={{ borderColor: 'var(--app-border-subtle)', my: 1 }} />
            <Button
              size="small"
              fullWidth
              onClick={() => { onToggleBookmark?.(); setBookmarkPickerAnchor(null); }}
              sx={{ color: 'var(--app-danger)', textTransform: 'none', justifyContent: 'flex-start' }}
            >
              Remove Bookmark
            </Button>
          </Box>
        )}
      </Popover>
    </Box>
  );
};

// Memoised: the editor panel is a context consumer that the parent re-renders on
// every keystroke. With stable props (frozen value + useCallback'd handlers from
// FileEditorPanel) this lets the whole editor subtree skip re-rendering while
// typing — CodeMirror owns its own DOM and reports changes via onChange.
export const EditorPanel = React.memo(EditorPanelImpl);