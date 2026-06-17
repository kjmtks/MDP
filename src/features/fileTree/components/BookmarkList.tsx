import React, { useState, useEffect, useRef } from 'react';
import { Box, Typography, List, ListItem, ListItemButton, ListItemText, ListItemIcon, IconButton, Popover } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import type { Bookmark } from '../../../pages/EditorPage/hooks/useBookmarks';
import { BOOKMARK_ICON_KEYS, BOOKMARK_COLORS, bookmarkIconFor } from '../bookmarkConfig';
import { extractBookmarkTitle, extractBookmarkSubtitle, type BookmarkTitle } from '../bookmarkTitle';
import { apiClient } from '../../../api/apiClient';

// title + subtitle resolved from a bookmarked file's meta.
interface BookmarkMeta { title: BookmarkTitle; subtitle: string | null; }
const metaFor = (text: string): BookmarkMeta => ({
  title: extractBookmarkTitle(text),
  subtitle: extractBookmarkSubtitle(text),
});

// keyed by path; undefined = not yet loaded
type TitleState = Record<string, BookmarkMeta | undefined>;

interface BookmarkListProps {
  bookmarks: Bookmark[];
  onFileSelect: (path: string) => void;
  onRemove: (path: string) => void;
  onReorder: (from: number, to: number) => void;
  onUpdate: (path: string, changes: { icon?: string; color?: string }) => void;
}

export const BookmarkList: React.FC<BookmarkListProps> = ({ bookmarks, onFileSelect, onRemove, onReorder, onUpdate }) => {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [picker, setPicker] = useState<{ anchor: HTMLElement; path: string } | null>(null);
  const [titles, setTitles] = useState<TitleState>({});

  const bookmarksRef = useRef(bookmarks);
  useEffect(() => { bookmarksRef.current = bookmarks; }, [bookmarks]);

  // Keep titles in sync when a bookmarked slide is saved (e.g. its @title edited).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { path?: string; content?: string } | undefined;
      if (!detail?.path || detail.content == null) return;
      if (!bookmarksRef.current.some((b) => b.path === detail.path)) return;
      setTitles((prev) => ({ ...prev, [detail.path!]: metaFor(detail.content!) }));
    };
    window.addEventListener('mdp-file-saved', handler);
    return () => window.removeEventListener('mdp-file-saved', handler);
  }, []);

  // Load slide titles (from each file's @title meta) for bookmarks not yet cached.
  useEffect(() => {
    let cancelled = false;
    const missing = bookmarks.map((b) => b.path).filter((p) => !(p in titles));
    if (missing.length === 0) return;
    (async () => {
      const entries = await Promise.all(
        missing.map(async (path) => {
          try {
            const text = await apiClient.readFileText(path);
            return [path, metaFor(text)] as const;
          } catch {
            return [path, { title: { kind: 'none' }, subtitle: null } as BookmarkMeta] as const;
          }
        }),
      );
      if (cancelled) return;
      setTitles((prev) => {
        const next = { ...prev };
        for (const [p, meta] of entries) next[p] = meta;
        return next;
      });
    })();
    return () => { cancelled = true; };
  }, [bookmarks, titles]);

  if (bookmarks.length === 0) {
    return <Typography variant="body1" sx={{ color: 'var(--app-text-disabled)', textAlign: 'center', p: 2 }}>No bookmarks yet.</Typography>;
  }

  const pickerBookmark = picker ? bookmarks.find((b) => b.path === picker.path) : undefined;

  return (
    <List dense sx={{ p: 0 }}>
      {bookmarks.map((bm, index) => {
        const fileName = bm.path.split('/').pop() || bm.path;
        const meta = titles[bm.path];
        const title = meta?.title;
        // Show the file name while loading or when the file has no @title
        // (e.g. a non-slide file); (No Title) when @title is blank;
        // otherwise the rendered slide title.
        const primary =
          title === undefined || title.kind === 'none' ? (
            fileName
          ) : title.kind === 'empty' ? (
            '(No Title)'
          ) : (
            <span dangerouslySetInnerHTML={{ __html: title.html }} />
          );
        // Secondary line: the slide's @subtitle when set, otherwise the path.
        const secondary = meta?.subtitle
          ? <span dangerouslySetInnerHTML={{ __html: meta.subtitle }} />
          : bm.path;
        const Icon = bookmarkIconFor(bm.icon);
        return (
          <ListItem
            key={bm.path}
            disablePadding
            draggable
            onDragStart={() => setDraggedIndex(index)}
            onDragOver={(e) => { if (draggedIndex === null) return; e.preventDefault(); setOverIndex(index); }}
            onDrop={(e) => {
              if (draggedIndex === null) return; // let Dockview tab drags pass through
              e.preventDefault();
              if (draggedIndex !== index) onReorder(draggedIndex, index);
              setDraggedIndex(null); setOverIndex(null);
            }}
            onDragEnd={() => { setDraggedIndex(null); setOverIndex(null); }}
            secondaryAction={
              <IconButton edge="end" aria-label="remove bookmark" onClick={(e) => { e.stopPropagation(); onRemove(bm.path); }} size="small" sx={{ color: 'var(--app-text-disabled)', '&:hover': { color: 'var(--app-danger)' } }}>
                <CloseIcon fontSize="small" />
              </IconButton>
            }
            sx={{
              opacity: draggedIndex === index ? 0.4 : 1,
              borderTop: overIndex === index && draggedIndex !== null && draggedIndex !== index ? '2px solid var(--app-accent)' : '2px solid transparent',
              '&:hover .MuiListItemSecondaryAction-root': { opacity: 1 },
              '.MuiListItemSecondaryAction-root': { opacity: 0.3 },
            }}
          >
            <ListItemButton onClick={() => onFileSelect(bm.path)} sx={{ py: 0.5, borderRadius: 1, '&:hover': { bgcolor: 'var(--app-bg-hover)' } }}>
              <ListItemIcon
                sx={{ minWidth: 32 }}
                onClick={(e) => { e.stopPropagation(); setPicker({ anchor: e.currentTarget, path: bm.path }); }}
                title="Change icon / color"
              >
                <Icon fontSize="small" sx={{ color: bm.color }} />
              </ListItemIcon>
              <ListItemText
                primary={primary}
                secondary={secondary}
                slotProps={{ primary: { fontSize: '0.85rem', color: 'var(--app-text-secondary)' }, secondary: { fontSize: '0.7rem', color: 'var(--app-text-disabled)', sx: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } } }}
              />
            </ListItemButton>
          </ListItem>
        );
      })}

      <Popover
        open={!!picker}
        anchorEl={picker?.anchor}
        onClose={() => setPicker(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { sx: { bgcolor: 'var(--app-bg-panel)', color: 'var(--app-text-secondary)', border: '1px solid var(--app-border-subtle)', p: 1.5 } } }}
      >
        {pickerBookmark && (
          <Box sx={{ width: 180 }}>
            <Typography variant="caption" sx={{ color: 'var(--app-text-disabled)' }}>Icon</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0.5, mb: 1, mt: 0.5 }}>
              {BOOKMARK_ICON_KEYS.map((key) => {
                const Icon = bookmarkIconFor(key);
                const selected = key === pickerBookmark.icon;
                return (
                  <IconButton key={key} size="small" onClick={() => onUpdate(pickerBookmark.path, { icon: key })} sx={{ color: pickerBookmark.color, border: selected ? '1px solid var(--app-accent)' : '1px solid transparent', borderRadius: 1 }}>
                    <Icon fontSize="small" />
                  </IconButton>
                );
              })}
            </Box>
            <Typography variant="caption" sx={{ color: 'var(--app-text-disabled)' }}>Color</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 0.5, mt: 0.5 }}>
              {BOOKMARK_COLORS.map((c) => (
                <Box
                  key={c}
                  onClick={() => onUpdate(pickerBookmark.path, { color: c })}
                  sx={{ width: 16, height: 16, borderRadius: '50%', bgcolor: c, cursor: 'pointer', border: c === pickerBookmark.color ? '2px solid var(--app-text-strong)' : '2px solid transparent', boxShadow: '0 0 0 1px var(--app-border)' }}
                />
              ))}
            </Box>
          </Box>
        )}
      </Popover>
    </List>
  );
};
