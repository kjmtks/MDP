import { useState, useCallback } from 'react';

export interface Bookmark {
  path: string;
  icon: string;
  color: string;
  /** What it marks: a file (opened when clicked) or a folder (shown, opened, in the
   *  file tree). Absent = a file — bookmarks were files only until 2026-10-18. */
  kind?: 'file' | 'folder';
}

export type BookmarkKind = 'file' | 'folder';

export const DEFAULT_BOOKMARK_ICON = 'bookmark';
export const DEFAULT_FOLDER_BOOKMARK_ICON = 'folder';
export const DEFAULT_BOOKMARK_COLOR = '#3b82f6';

function loadInitial(): Bookmark[] {
  try {
    const saved = localStorage.getItem('mdp_bookmarks');
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) =>
      typeof item === 'string'
        ? { path: item, icon: DEFAULT_BOOKMARK_ICON, color: DEFAULT_BOOKMARK_COLOR }
        : {
          path: item.path, icon: item.icon || DEFAULT_BOOKMARK_ICON, color: item.color || DEFAULT_BOOKMARK_COLOR,
          ...(item.kind === 'folder' ? { kind: 'folder' as const } : {}),
        },
    ).filter((b) => !!b.path);
  } catch (e) {
    console.error('Failed to load bookmarks', e);
    return [];
  }
}

export const useBookmarks = () => {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(loadInitial);

  const persist = useCallback((next: Bookmark[]) => {
    setBookmarks(next);
    try {
      localStorage.setItem('mdp_bookmarks', JSON.stringify(next));
    } catch (e) {
      console.error('Failed to save bookmarks', e);
    }
  }, []);

  const isBookmarked = useCallback((path: string) => bookmarks.some((b) => b.path === path), [bookmarks]);

  /** Add (or take out) a bookmark of `path` — a folder's gets the folder icon. */
  const toggleBookmark = useCallback((path: string, kind: BookmarkKind = 'file') => {
    setBookmarks((prev) => {
      const exists = prev.some((b) => b.path === path);
      const next = exists
        ? prev.filter((b) => b.path !== path)
        : [...prev, kind === 'folder'
          ? { path, icon: DEFAULT_FOLDER_BOOKMARK_ICON, color: DEFAULT_BOOKMARK_COLOR, kind }
          : { path, icon: DEFAULT_BOOKMARK_ICON, color: DEFAULT_BOOKMARK_COLOR }];
      try { localStorage.setItem('mdp_bookmarks', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const reorderBookmarks = useCallback((from: number, to: number) => {
    setBookmarks((prev) => {
      if (from < 0 || from >= prev.length || to < 0 || to >= prev.length || from === to) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      try { localStorage.setItem('mdp_bookmarks', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const updateBookmark = useCallback((path: string, changes: Partial<Pick<Bookmark, 'icon' | 'color'>>) => {
    setBookmarks((prev) => {
      const next = prev.map((b) => (b.path === path ? { ...b, ...changes } : b));
      try { localStorage.setItem('mdp_bookmarks', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  /** A file or a folder renamed or moved in MDP: its bookmark — and, for a folder,
   *  the bookmarks of everything inside it — follow to the new path. */
  const renameBookmarks = useCallback((oldPath: string, newPath: string) => {
    setBookmarks((prev) => {
      let changed = false;
      const moved = prev.map((b) => {
        if (b.path !== oldPath && !b.path.startsWith(`${oldPath}/`)) return b;
        changed = true;
        return { ...b, path: newPath + b.path.slice(oldPath.length) };
      });
      if (!changed) return prev;
      // One bookmark per path (an old one of a place that was gone may meet it).
      const next = moved.filter((b, i) => moved.findIndex((c) => c.path === b.path) === i);
      try { localStorage.setItem('mdp_bookmarks', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  /** Deleted in MDP: their bookmarks — and those inside a deleted folder — go. */
  const forgetBookmarks = useCallback((paths: string[]) => {
    setBookmarks((prev) => {
      const next = prev.filter((b) => !paths.some((p) => b.path === p || b.path.startsWith(`${p}/`)));
      if (next.length === prev.length) return prev;
      try { localStorage.setItem('mdp_bookmarks', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  return { bookmarks, isBookmarked, toggleBookmark, reorderBookmarks, updateBookmark, renameBookmarks, forgetBookmarks, persist };
};
