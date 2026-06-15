import { useState, useCallback } from 'react';

export interface Bookmark {
  path: string;
  icon: string;
  color: string;
}

export const DEFAULT_BOOKMARK_ICON = 'bookmark';
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
        : { path: item.path, icon: item.icon || DEFAULT_BOOKMARK_ICON, color: item.color || DEFAULT_BOOKMARK_COLOR },
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

  const toggleBookmark = useCallback((path: string) => {
    setBookmarks((prev) => {
      const exists = prev.some((b) => b.path === path);
      const next = exists
        ? prev.filter((b) => b.path !== path)
        : [...prev, { path, icon: DEFAULT_BOOKMARK_ICON, color: DEFAULT_BOOKMARK_COLOR }];
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

  return { bookmarks, isBookmarked, toggleBookmark, reorderBookmarks, updateBookmark, persist };
};
