import { useState, useCallback, useRef, useEffect, createRef, type RefObject } from 'react';
import type { FileNode, FileType } from '../../../types';
import { INITIAL_MARKDOWN, MAX_FILE_SIZE } from '../../../constants';
import { determineFileType } from '../../../utils/fileUtils';
import { splitMarkdownToBlocks } from '../../../features/slide/parser/slideParser';
import type { Stroke } from '../../drawing/components/DrawingOverlay';
import { apiClient } from '../../../api/apiClient';
import { registerModule } from '../../modules/moduleManager';
import { reportError, confirmDialog } from '../../../components/error/errorReporter';

interface UseFileManagerProps {
  setCurrentSlideIndex: (idx: number) => void;
  syncDrawings: (drawings: Record<number, Stroke[]>) => void;
  onFileLoaded?: () => void;
  drawings?: Record<number, Stroke[]>;
  // Latest active slide index, so it can be saved onto the outgoing tab.
  currentSlideIndexRef: RefObject<number>;
}

export interface OpenTab {
  id: string;
  path: string;
  type: FileType;
  content: string;
  initialContent: string;
  isModified: boolean;
  currentSlideIndex: number;
  drawings: Record<number, Stroke[]>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editorRef: RefObject<any>;
}

interface TabState {
  tabs: OpenTab[];
  activeIndex: number;
}

const getDrawingMap = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!(window as any).__drawingMap) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__drawingMap = new Map<string, string>();
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).__drawingMap as Map<string, string>;
};

const createTabId = () => `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

// Unsaved-changes drafts kept in localStorage so the editor can be restored
// (VSCode-style hot exit) on the next launch.
const DRAFTS_KEY = 'mdp_unsaved_drafts';
const DRAFTABLE: FileType[] = ['markdown'];

const readDrafts = (): Record<string, string> => {
  try { return JSON.parse(localStorage.getItem(DRAFTS_KEY) || '{}') || {}; } catch { return {}; }
};
const writeDrafts = (drafts: Record<string, string>) => {
  try { localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts)); } catch { /* ignore */ }
};

export const useFileManager = ({ setCurrentSlideIndex, syncDrawings, onFileLoaded, drawings, currentSlideIndexRef }: UseFileManagerProps) => {
  const [tabState, setTabState] = useState<TabState>({ tabs: [], activeIndex: -1 });

  const stateRef = useRef<TabState>(tabState);
  useEffect(() => { stateRef.current = tabState; }, [tabState]);

  const currentDrawingsRef = useRef<Record<number, Stroke[]>>({});
  useEffect(() => {
    if (drawings) currentDrawingsRef.current = drawings;
  }, [drawings]);

  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [lastUpdated, setLastUpdated] = useState<number>(() => Date.now());
  const [templateContent, setTemplateContent] = useState<string>("# New Slide\n\nContent...");
  const markdownRef = useRef(INITIAL_MARKDOWN);
  const isLoadingFile = useRef<boolean>(false);

  const tabs = tabState.tabs;
  const activeTabIndex = tabState.activeIndex;
  const activeTab = tabs[activeTabIndex];

  const currentFileName = activeTab?.path || null;
  const currentFileType = activeTab?.type || 'markdown';
  const markdown = activeTab?.content || INITIAL_MARKDOWN;
  const editorInitialValue = activeTab?.initialContent || INITIAL_MARKDOWN;
  const isModified = activeTab?.isModified || false;

  // Persist the set of open files (+ active) so they can be reopened on next launch.
  const openPathsKey = tabState.tabs.map(t => t.path).join('\n');
  const activePath = activeTab?.path ?? null;
  useEffect(() => {
    try {
      localStorage.setItem('mdp_open_files', JSON.stringify({
        paths: openPathsKey ? openPathsKey.split('\n') : [],
        active: activePath,
      }));
    } catch { /* ignore */ }
  }, [openPathsKey, activePath]);

  const [debouncedMarkdown, setDebouncedMarkdown] = useState<string>(markdown);

  // A file SWITCH/CLOSE must reflect in the debounced value immediately, or
  // `currentFileName` jumps to the new tab while `debouncedMarkdown` lingers on
  // the previous tab's content for ~300ms — so the preview briefly renders the
  // old file's slides (e.g. an unrelated image) under the new file's name.
  // Adjust during render (React's recommended pattern, same as the preview-source
  // adjustment in EditorPage) so the new content is in place before paint.
  const debouncedPathRef = useRef(currentFileName);
  if (debouncedPathRef.current !== currentFileName) {
    debouncedPathRef.current = currentFileName;
    setDebouncedMarkdown(markdown);
  }

  // Intra-file edits stay throttled (debounced re-parsing while typing).
  useEffect(() => {
    if (debouncedMarkdown === markdown) return;
    const handler = setTimeout(() => { setDebouncedMarkdown(markdown); }, 300);
    return () => clearTimeout(handler);
  }, [markdown, debouncedMarkdown]);

  const setMarkdown = useCallback((newContent: string) => {
    setTabState(prev => {
      if (prev.activeIndex === -1) return prev;
      const newTabs = [...prev.tabs];
      const cleanNew = newContent.replace(/\r/g, '');
      const cleanInitial = newTabs[prev.activeIndex].initialContent.replace(/\r/g, '');
      newTabs[prev.activeIndex] = {
        ...newTabs[prev.activeIndex],
        content: newContent,
        isModified: cleanNew !== cleanInitial
      };
      return { tabs: newTabs, activeIndex: prev.activeIndex };
    });
    markdownRef.current = newContent;
  }, []);

  const fetchFileTree = useCallback(() => {
    apiClient.getFileTree()
      .then(data => setFileTree(data))
      .catch(err => console.error("Failed to fetch file tree:", err));
  }, []);

  const handleManualRefresh = useCallback(() => {
    fetchFileTree();
    setLastUpdated(Date.now());
  }, [fetchFileTree]);

  const switchTab = useCallback((index: number) => {
    setTabState(prev => {
      if (index < 0 || index >= prev.tabs.length || index === prev.activeIndex) return prev;

      const newTabs = [...prev.tabs];
      if (prev.activeIndex !== -1 && newTabs[prev.activeIndex]) {
        // Save the slide the user was on so it is restored when returning here.
        newTabs[prev.activeIndex] = { ...newTabs[prev.activeIndex], drawings: currentDrawingsRef.current, currentSlideIndex: currentSlideIndexRef.current };
      }

      const nextTab = newTabs[index];

      setTimeout(() => {
        setCurrentSlideIndex(nextTab.currentSlideIndex);
        syncDrawings(nextTab.drawings || {});
        const params = new URLSearchParams(window.location.search);
        params.set('file', nextTab.path);
        window.history.pushState(null, '', `${window.location.pathname}?${params.toString()}`);
        markdownRef.current = nextTab.content;
      }, 0);

      return { tabs: newTabs, activeIndex: index };
    });
  }, [setCurrentSlideIndex, syncDrawings]);

  const closeTab = useCallback((index: number) => {
    setTabState(prev => {
      const newTabs = prev.tabs.filter((_, i) => i !== index);
      let newIndex = prev.activeIndex;

      if (newTabs.length === 0) {
        newIndex = -1;
      } else if (prev.activeIndex === index) {
        newIndex = Math.max(0, index - 1);
      } else if (prev.activeIndex > index) {
        newIndex--;
      }

      setTimeout(() => {
        if (newIndex === -1) {
          window.history.pushState(null, '', window.location.pathname);
          syncDrawings({});
          markdownRef.current = INITIAL_MARKDOWN;
        } else {
          const nextTab = newTabs[newIndex];
          setCurrentSlideIndex(nextTab.currentSlideIndex);
          syncDrawings(nextTab.drawings || {});
          const params = new URLSearchParams(window.location.search);
          params.set('file', nextTab.path);
          window.history.pushState(null, '', `${window.location.pathname}?${params.toString()}`);
          markdownRef.current = nextTab.content;
        }
      }, 0);

      return { tabs: newTabs, activeIndex: newIndex };
    });
  }, [setCurrentSlideIndex, syncDrawings]);

  // `background: true` opens the tab WITHOUT making it active (used by session
  // restore so reopening a previously-open image tab doesn't briefly flash its
  // preview, then stay as a landing spot when other tabs close). The active tab
  // is loaded normally (background omitted) and ends up focused.
  const loadFile = useCallback(async (fileName: string, isBinaryFromServer?: boolean, initialPage: number = 0, draftContent?: string, background: boolean = false) => {
    if (fileName.startsWith('http://') || fileName.startsWith('https://')) {
      reportError('External URLs cannot be loaded.', { severity: 'warning' });
      return;
    }

    const existingIndex = stateRef.current.tabs.findIndex(t => t.path === fileName);
    if (existingIndex !== -1) {
      if (!background) switchTab(existingIndex);
      return;
    }

    isLoadingFile.current = true;
    const type = determineFileType(fileName, isBinaryFromServer);

    if (type === 'image' || type === 'binary') {
      const newTab: OpenTab = { id: createTabId(), path: fileName, type, content: "", initialContent: "", isModified: false, currentSlideIndex: 0, drawings: {}, editorRef: createRef() };
      setTabState(prev => {
        if (prev.tabs.some(t => t.path === fileName)) return prev;
        const newTabs = [...prev.tabs];
        if (prev.activeIndex !== -1 && newTabs[prev.activeIndex]) {
          newTabs[prev.activeIndex] = { ...newTabs[prev.activeIndex], drawings: currentDrawingsRef.current, currentSlideIndex: currentSlideIndexRef.current };
        }
        newTabs.push(newTab);
        return { tabs: newTabs, activeIndex: background ? prev.activeIndex : newTabs.length - 1 };
      });
      setTimeout(() => {
        if (!background) {
          setCurrentSlideIndex(0);
          syncDrawings({});
          const params = new URLSearchParams(window.location.search);
          params.set('file', fileName);
          window.history.pushState(null, '', `${window.location.pathname}?${params.toString()}`);
        }
        isLoadingFile.current = false;
      }, 0);
      return;
    }

    try {
      const text = await apiClient.readFileText(fileName);
      const estimatedByteLength = new Blob([text]).size;
      if (estimatedByteLength > MAX_FILE_SIZE) throw new Error('FILE_TOO_LARGE');

      const map = getDrawingMap();
      let editorText = text;
      const drawTagRegex = new RegExp('<' + '!--\\s*@draw:\\s*([\\s\\S]*?)\\s*--' + '>', 'g');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      editorText = editorText.replace(drawTagRegex, (_: any, base64: any) => {
          const id = Math.random().toString(36).substring(2, 10);
          map.set(id, base64.trim());
          return '<' + '!-- @drawing: ' + id + ' --' + '>';
      });

      const loadedBlocks = splitMarkdownToBlocks(editorText);
      const newDrawings: Record<number, Stroke[]> = {};
      loadedBlocks.slice(1).forEach((block, idx) => {
          const anchorRegex = new RegExp('<' + '!--\\s*@drawing:\\s*([a-zA-Z0-9]+)\\s*--' + '>');
          const anchorMatch = block.rawContent.match(anchorRegex);
          if (anchorMatch) {
              const id = anchorMatch[1];
              const base64 = map.get(id);
              if (base64) {
                  try {
                      const binString = atob(base64);
                      const bytes = new Uint8Array(binString.length);
                      for (let i = 0; i < binString.length; i++) bytes[i] = binString.charCodeAt(i);
                      const json = new TextDecoder().decode(bytes);
                      newDrawings[idx] = JSON.parse(json);
                  } catch (e) { console.error("Drawing parse error", e); }
              }
          }
      });

      const hasDraft = draftContent != null && draftContent !== editorText;
      const contentToUse = hasDraft ? draftContent! : editorText;

      const newTab: OpenTab = { id: createTabId(), path: fileName, type, content: contentToUse, initialContent: editorText, isModified: hasDraft, currentSlideIndex: initialPage, drawings: newDrawings, editorRef: createRef() };

      setTabState(prev => {
        if (prev.tabs.some(t => t.path === fileName)) return prev;
        const newTabs = [...prev.tabs];
        if (prev.activeIndex !== -1 && newTabs[prev.activeIndex]) {
          newTabs[prev.activeIndex] = { ...newTabs[prev.activeIndex], drawings: currentDrawingsRef.current, currentSlideIndex: currentSlideIndexRef.current };
        }
        newTabs.push(newTab);
        return { tabs: newTabs, activeIndex: background ? prev.activeIndex : newTabs.length - 1 };
      });

      if (!background) markdownRef.current = contentToUse;
      setLastUpdated(Date.now());

      setTimeout(() => {
        if (!background) {
          setCurrentSlideIndex(initialPage);
          syncDrawings(newDrawings);
          const params = new URLSearchParams(window.location.search);
          params.set('file', fileName);
          window.history.pushState(null, '', `${window.location.pathname}?${params.toString()}`);
          onFileLoaded?.();
        }
        isLoadingFile.current = false;
      }, 0);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      isLoadingFile.current = false;
      if (err.message === 'FILE_TOO_LARGE') {
        const newTab: OpenTab = { id: createTabId(), path: fileName, type: 'limit-exceeded', content: "", initialContent: "", isModified: false, currentSlideIndex: 0, drawings: {}, editorRef: createRef() };
        setTabState(prev => {
          if (prev.tabs.some(t => t.path === fileName)) return prev;
          const newTabs = [...prev.tabs];
          if (prev.activeIndex !== -1 && newTabs[prev.activeIndex]) {
            newTabs[prev.activeIndex] = { ...newTabs[prev.activeIndex], drawings: currentDrawingsRef.current };
          }
          newTabs.push(newTab);
          return { tabs: newTabs, activeIndex: background ? prev.activeIndex : newTabs.length - 1 };
        });
        if (!background) setTimeout(() => { setCurrentSlideIndex(0); syncDrawings({}); }, 0);
      } else {
        reportError('Failed to load the file. It may have been deleted or renamed.', { detail: err });
      }
    }
  }, [switchTab, setCurrentSlideIndex, syncDrawings, onFileLoaded]);

  const handleSave = useCallback(async () => {
    const activeIdx = stateRef.current.activeIndex;
    if (activeIdx === -1) return;
    const currentTab = stateRef.current.tabs[activeIdx];
    if (!currentTab) return;

    const { path: saveFileName, type: saveFileType, content: saveMarkdown } = currentTab;
    if (saveFileType === 'image' || saveFileType === 'binary' || saveFileType === 'limit-exceeded') return;

    try {
      const map = getDrawingMap();
      let textToSave = saveMarkdown;

      const anchorRegexGlobal = new RegExp('<' + '!--\\s*@drawing:\\s*([a-zA-Z0-9]+)\\s*--' + '>', 'g');
      textToSave = textToSave.replace(anchorRegexGlobal, (match, id) => {
          const base64 = map.get(id);
          return base64 ? '<' + '!-- @draw: ' + base64 + ' --' + '>' : match;
      });

      await apiClient.saveFile(saveFileName, textToSave);
      window.dispatchEvent(new CustomEvent('mdp-file-saved', {
        detail: { path: saveFileName, content: textToSave }
      }));
      if (saveFileName.endsWith('.mdpmod')) {
        registerModule(textToSave);
      }

      setTabState(prev => {
        const newTabs = [...prev.tabs];
        const idx = newTabs.findIndex(t => t.path === saveFileName);
        if (idx !== -1) {
          newTabs[idx] = { ...newTabs[idx], initialContent: saveMarkdown, isModified: false };
        }
        return { tabs: newTabs, activeIndex: prev.activeIndex };
      });

      const drafts = readDrafts();
      if (drafts[saveFileName] !== undefined) {
        delete drafts[saveFileName];
        writeDrafts(drafts);
      }

      const originalTitle = document.title;
      document.title = "✅ Saved!";
      setTimeout(() => document.title = originalTitle, 2000);
      if (saveFileName.endsWith('.css')) setLastUpdated(Date.now());
    } catch (err) { reportError('Failed to save the file.', { detail: err }); }
  }, []);

  const handleOpenFolder = useCallback(async () => {
    try {
      const result = await apiClient.openFolder();
      if (result && result.path) {
        localStorage.setItem('mdp_root_path', result.path);
        // Per-workspace app settings (.mdp/settings.json) reload on this signal.
        window.dispatchEvent(new Event('mdp-workspace-changed'));
        setFileTree(result.tree);
        setTabState({ tabs: [], activeIndex: -1 });
      }
    } catch (err) { console.error("Failed to open folder:", err); }
  }, []);

const updateTabContent = useCallback((path: string, newContent: string) => {
    setTabState(prev => {
      const idx = prev.tabs.findIndex(t => t.path === path);
      if (idx === -1) return prev;
      const newTabs = [...prev.tabs];
      const cleanNew = newContent.replace(/\r/g, '');
      const cleanInitial = newTabs[idx].initialContent.replace(/\r/g, '');
      newTabs[idx] = {
        ...newTabs[idx],
        content: newContent,
        isModified: cleanNew !== cleanInitial
      };
      return { tabs: newTabs, activeIndex: prev.activeIndex };
    });
    if (path === stateRef.current.tabs[stateRef.current.activeIndex]?.path) {
        markdownRef.current = newContent;
    }
  }, []);

  const renameTab = useCallback((oldPath: string, newPath: string) => {
    setTabState(prev => {
      let changed = false;
      const newTabs = prev.tabs.map(tab => {
        if (tab.path === oldPath || tab.path.startsWith(oldPath + '/')) {
          changed = true;
          return {
            ...tab,
            path: tab.path.replace(oldPath, newPath)
          };
        }
        return tab;
      });

      if (!changed) return prev;

      setTimeout(() => {
        if (prev.activeIndex !== -1) {
          const nextTab = newTabs[prev.activeIndex];
          const params = new URLSearchParams(window.location.search);
          params.set('file', nextTab.path);
          window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
          markdownRef.current = nextTab.content;
        }
      }, 0);

      return { tabs: newTabs, activeIndex: prev.activeIndex };
    });
  }, []);

  const closeTabsByPaths = useCallback((pathsToDelete: string[]) => {
    setTabState(prev => {
      const newTabs = prev.tabs.filter(tab =>
        !pathsToDelete.some(p => tab.path === p || tab.path.startsWith(p + '/'))
      );

      if (newTabs.length === prev.tabs.length) return prev;

      let newActiveIndex = prev.activeIndex;
      const currentActiveTab = prev.tabs[prev.activeIndex];

      if (newTabs.length === 0) {
        newActiveIndex = -1;
      } else if (currentActiveTab && pathsToDelete.some(p => currentActiveTab.path === p || currentActiveTab.path.startsWith(p + '/'))) {
        newActiveIndex = Math.max(0, Math.min(prev.activeIndex, newTabs.length - 1));
      } else if (currentActiveTab) {
        newActiveIndex = newTabs.findIndex(t => t.id === currentActiveTab.id);
      }

      setTimeout(() => {
        if (newActiveIndex === -1) {
          window.history.pushState(null, '', window.location.pathname);
          syncDrawings({});
          markdownRef.current = INITIAL_MARKDOWN;
        } else {
          const nextTab = newTabs[newActiveIndex];
          setCurrentSlideIndex(nextTab.currentSlideIndex);
          syncDrawings(nextTab.drawings || {});
          const params = new URLSearchParams(window.location.search);
          params.set('file', nextTab.path);
          window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
          markdownRef.current = nextTab.content;
        }
      }, 0);

      return { tabs: newTabs, activeIndex: newActiveIndex };
    });
  }, [setCurrentSlideIndex, syncDrawings]);

  const reorderTabs = useCallback((startIndex: number, endIndex: number) => {
    setTabState(prev => {
      const newTabs = [...prev.tabs];
      const [movedTab] = newTabs.splice(startIndex, 1);
      newTabs.splice(endIndex, 0, movedTab);

      let newActiveIndex = prev.activeIndex;
      if (prev.activeIndex === startIndex) {
        newActiveIndex = endIndex;
      } else if (startIndex < prev.activeIndex && endIndex >= prev.activeIndex) {
        newActiveIndex--;
      } else if (startIndex > prev.activeIndex && endIndex <= prev.activeIndex) {
        newActiveIndex++;
      }

      return { tabs: newTabs, activeIndex: newActiveIndex };
    });
  }, []);

  const closeOtherTabs = useCallback(async (indexToKeep: number) => {
    const tabToKeep = stateRef.current.tabs[indexToKeep];
    if (!tabToKeep) return;

    const hasUnsavedOthers = stateRef.current.tabs.some(t => t.id !== tabToKeep.id && t.isModified);
    if (hasUnsavedOthers) {
      const ok = await confirmDialog('There are unsaved changes in other tabs. Close them without saving?', {
        title: 'Close Other Tabs', confirmText: 'Close', cancelText: 'Cancel', severity: 'warning',
      });
      if (!ok) return;
    }

    setTimeout(() => {
      setCurrentSlideIndex(tabToKeep.currentSlideIndex);
      syncDrawings(tabToKeep.drawings || {});
      const params = new URLSearchParams(window.location.search);
      params.set('file', tabToKeep.path);
      window.history.pushState(null, '', `${window.location.pathname}?${params.toString()}`);
      markdownRef.current = tabToKeep.content;
    }, 0);

    setTabState({ tabs: [tabToKeep], activeIndex: 0 });
  }, [setCurrentSlideIndex, syncDrawings, markdownRef]);

  const closeAllTabs = useCallback(async () => {
    const hasUnsaved = stateRef.current.tabs.some(t => t.isModified);
    if (hasUnsaved) {
      const ok = await confirmDialog('There are unsaved changes. Close all tabs without saving?', {
        title: 'Close All Tabs', confirmText: 'Close All', cancelText: 'Cancel', severity: 'warning',
      });
      if (!ok) return;
    }

    setTimeout(() => {
      window.history.pushState(null, '', window.location.pathname);
      syncDrawings({});
      markdownRef.current = INITIAL_MARKDOWN;
    }, 0);

    setTabState({ tabs: [], activeIndex: -1 });
  }, [syncDrawings, markdownRef]);

  // Snapshot every modified text tab into localStorage so it can be restored
  // after the app is closed without saving.
  const persistDrafts = useCallback(() => {
    const drafts: Record<string, string> = {};
    for (const tab of stateRef.current.tabs) {
      if (tab.isModified && DRAFTABLE.includes(tab.type)) {
        drafts[tab.path] = tab.content;
      }
    }
    writeDrafts(drafts);
  }, []);

  const clearDrafts = useCallback(() => {
    writeDrafts({});
  }, []);

  return {
    markdown, setMarkdown, editorInitialValue, debouncedMarkdown,
    fileTree, fetchFileTree, handleManualRefresh,
    lastUpdated, currentFileName, currentFileType,
    templateContent, setTemplateContent,
    markdownRef, isLoadingFile,
    loadFile, handleSave,
    handleOpenFolder,
    isModified,
    tabs, setTabs: () => {}, activeTabIndex, switchTab, closeTab, updateTabContent,
    renameTab, closeTabsByPaths, reorderTabs, closeOtherTabs, closeAllTabs,
    persistDrafts, clearDrafts
  };
};