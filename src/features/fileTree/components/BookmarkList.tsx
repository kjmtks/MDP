import React, { useState, useEffect, useRef } from 'react';
import { Box, Typography, List, ListItem, ListItemButton, ListItemText, ListItemIcon, IconButton, Popover, Menu, MenuItem } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { SHOW_PANEL_EVENT } from '../../../pages/EditorPage/dock/dockShared';
import type { Bookmark } from '../../../pages/EditorPage/hooks/useBookmarks';
import { BOOKMARK_ICON_KEYS, BOOKMARK_COLORS, bookmarkIconFor } from '../bookmarkConfig';
import { extractBookmarkTitle, extractBookmarkSubtitle, type BookmarkTitle } from '../bookmarkTitle';
import { apiClient } from '../../../api/apiClient';
import { notify } from '../../../components/error/errorReporter';

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
  /** Whether a path is in the workspace as far as the file tree has been read: true /
   *  false — or null where it cannot tell (a folder not read yet). */
  presence?: (path: string) => boolean | null;
}

// Changed outside MDP (renamed, moved or deleted in the OS or on another computer):
// the bookmark is dimmed and struck through — after a moment, so the tree being
// re-read just after a rename in MDP (the bookmark already follows) never shows it.
const MISSING_TIP = 'Not found here — renamed, moved or deleted outside MDP? Remove this bookmark, or bookmark it again where it is now.';
const goneAfter = (missing: boolean, prop: string) => (missing ? `${prop} .3s ease .8s` : `${prop} .15s ease`);

// Show a file or a folder in the Explorer: open/focus the panel, then ask the file
// tree to expand the ancestors (and a folder itself), select it and scroll it into
// view. When the Explorer panel was CLOSED, its Sidebar mounts on a later commit —
// after this synchronous dispatch — so the request is also parked on a global the
// Explorer instance consumes on mount.
const revealInTree = (path: string) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__mdpPendingReveal = { path, ts: Date.now() };
  window.dispatchEvent(new CustomEvent(SHOW_PANEL_EVENT, { detail: { id: 'explorer' } }));
  window.dispatchEvent(new CustomEvent('mdp-reveal-in-tree', { detail: { path } }));
};

export const BookmarkList: React.FC<BookmarkListProps> = ({ bookmarks, onFileSelect, onRemove, onReorder, onUpdate, presence }) => {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [picker, setPicker] = useState<{ anchor: HTMLElement; path: string } | null>(null);
  const [titles, setTitles] = useState<TitleState>({});
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; path: string } | null>(null);

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

  // Load slide titles (from each file's @title meta) for bookmarks not yet cached
  // (a folder has none: it is shown by its name).
  useEffect(() => {
    let cancelled = false;
    const missing = bookmarks.filter((b) => b.kind !== 'folder').map((b) => b.path).filter((p) => !(p in titles));
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
        const folder = bm.kind === 'folder';
        const missing = presence?.(bm.path) === false;
        const meta = folder ? undefined : titles[bm.path];
        const title = meta?.title;
        // A folder: its name (a link's without ".mdplink") over the folder holding it.
        // A file: its name while loading or when it has no @title (e.g. a non-slide
        // file); (No Title) when @title is blank; otherwise the rendered slide title.
        const primary = folder ? (
          fileName.replace(/\.mdplink$/i, '')
        ) : title === undefined || title.kind === 'none' ? (
          fileName
        ) : title.kind === 'empty' ? (
          '(No Title)'
        ) : (
          <span dangerouslySetInnerHTML={{ __html: title.html }} />
        );
        // Secondary line: a folder's place; a slide's @subtitle when set, otherwise the path.
        const secondary = folder
          ? (bm.path.includes('/') ? bm.path.slice(0, bm.path.lastIndexOf('/')) : '(workspace)')
          : meta?.subtitle
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
            <ListItemButton
              // A folder opens in the file tree; a file opens in the editor — unless
              // it is gone from where the bookmark says.
              onClick={() => (missing
                ? notify(`Not found: ${bm.path} — renamed, moved or deleted outside MDP? Remove the bookmark, or bookmark it again where it is now.`, { severity: 'info', title: 'Bookmark not found' })
                : folder ? revealInTree(bm.path) : onFileSelect(bm.path))}
              title={missing ? MISSING_TIP : folder ? `Show ${bm.path} in the file tree` : undefined}
              onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, path: bm.path }); }}
              sx={{ py: 0.5, borderRadius: 1, '&:hover': { bgcolor: 'var(--app-bg-hover)' }, opacity: missing ? 0.45 : 1, transition: goneAfter(missing, 'opacity') }}>
              <ListItemIcon
                sx={{ minWidth: 32 }}
                onClick={(e) => { e.stopPropagation(); setPicker({ anchor: e.currentTarget, path: bm.path }); }}
                title="Change icon / color"
              >
                <Icon fontSize="small" sx={{ color: bm.color }} />
              </ListItemIcon>
              <ListItemText
                primary={(
                  <span style={{ textDecoration: 'line-through', textDecorationColor: missing ? 'currentColor' : 'transparent', transition: goneAfter(missing, 'text-decoration-color') }}>
                    {primary}
                  </span>
                )}
                secondary={secondary}
                slotProps={{ primary: { fontSize: '0.85rem', color: 'var(--app-text-secondary)' }, secondary: { fontSize: '0.7rem', color: 'var(--app-text-disabled)', sx: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } } }}
              />
            </ListItemButton>
          </ListItem>
        );
      })}

      <Menu
        open={ctxMenu !== null}
        onClose={() => setCtxMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={ctxMenu ? { top: ctxMenu.y, left: ctxMenu.x } : undefined}
        slotProps={{ paper: { sx: { bgcolor: 'var(--app-bg-panel)', color: 'var(--app-text-secondary)', border: '1px solid var(--app-border-subtle)' } } }}
      >
        <MenuItem onClick={() => { if (ctxMenu) revealInTree(ctxMenu.path); setCtxMenu(null); }}>
          <ListItemIcon><AccountTreeIcon fontSize="small" sx={{ color: 'var(--app-text-muted)' }} /></ListItemIcon>
          Reveal in file tree
        </MenuItem>
        <MenuItem onClick={() => { if (ctxMenu) onRemove(ctxMenu.path); setCtxMenu(null); }} sx={{ color: 'var(--app-danger)' }}>
          <ListItemIcon><DeleteOutlineIcon fontSize="small" sx={{ color: 'var(--app-danger)' }} /></ListItemIcon>
          Remove bookmark
        </MenuItem>
      </Menu>

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
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 0.5, mb: 1, mt: 0.5 }}>
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
