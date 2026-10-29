import { useState, useCallback, useRef, useEffect, createRef, type RefObject } from 'react';
import type { FileNode, FileType } from '../../../types';
import { INITIAL_MARKDOWN, MAX_FILE_SIZE } from '../../../constants';
import { determineFileType } from '../../../utils/fileUtils';
import { splitMarkdownToBlocks } from '../../../features/slide/parser/slideParser';
import type { Stroke } from '../../drawing/components/DrawingOverlay';
import { apiClient } from '../../../api/apiClient';
import { registerModule } from '../../modules/moduleManager';
import { reportError, confirmDialog, choiceDialog } from '../../../components/error/errorReporter';
import { stripDrawingData } from '../../../utils/drawingBaseline';
import { urlForFile, urlForNoFile } from '../../../utils/fileUrl';

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

/** A tab compared with its file on disk (syncTabsWithDisk). `disk` = the file's text
 *  when it differs from what the tab loaded. */
export interface DiskSync {
  path: string;
  state: 'same' | 'reloaded' | 'changedWhileEdited' | 'missing';
  disk?: string;
}

/** What a save did. The editor's Ctrl+S ignores it; the MCP's save_deck reads it.
 *  `diskChanged`: the file had changed on disk since the tab loaded it and the save
 *  was told not to ask (`fromMcp`) — nothing was written; `disk` = the file's text. */
export interface SaveResult {
  status: 'saved' | 'nothing' | 'diskChanged' | 'cancelled' | 'reloaded' | 'error';
  path?: string;
  disk?: string;
  error?: string;
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

// A file's text as the editor holds it: each `@draw:` (a slide's drawing, base64)
// replaced by a short `@drawing:` id kept in the drawing map, and the slides' strokes
// decoded. Loading, reloading and the MCP's merge of a file changed on disk share it.
export function editorFormOf(rawText: string, reuseFrom = ''): { editorText: string; drawings: Record<number, Stroke[]> } {
  const map = getDrawingMap();
  // `reuseFrom` = the tab's own text: a drawing it already has keeps its id, so a
  // reload (or a merge) of a file whose drawings did not change gives the same editor
  // text for them. Only that tab's ids — another tab's must never be shared.
  const known = new Map<string, string>();
  for (const m of reuseFrom.matchAll(/<!--\s*@drawing:\s*([a-zA-Z0-9]+)\s*-->/g)) {
    const b64 = map.get(m[1]);
    if (b64 && !known.has(b64)) known.set(b64, m[1]);
  }
  const drawTagRegex = new RegExp('<' + '!--\\s*@draw:\\s*([\\s\\S]*?)\\s*--' + '>', 'g');
  const editorText = rawText.replace(drawTagRegex, (_m, base64) => {
    const b64 = String(base64).trim();
    let id = known.get(b64);
    if (!id) {
      id = Math.random().toString(36).substring(2, 10);
      map.set(id, b64);
    }
    return '<' + '!-- @drawing: ' + id + ' --' + '>';
  });
  const drawings: Record<number, Stroke[]> = {};
  splitMarkdownToBlocks(editorText).slice(1).forEach((block, idx) => {
    const m = block.rawContent.match(new RegExp('<' + '!--\\s*@drawing:\\s*([a-zA-Z0-9]+)\\s*--' + '>'));
    if (!m) return;
    const b64 = map.get(m[1]);
    if (!b64) return;
    try {
      const bin = atob(b64);
      const by = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) by[i] = bin.charCodeAt(i);
      drawings[idx] = JSON.parse(new TextDecoder().decode(by));
    } catch { /* ignore */ }
  });
  return { editorText, drawings };
}

// Replace a CodeMirror document with `next` by changing only the stretch that differs,
// so the caret and the scroll stay where they were (a reload from disk of a deck the
// person is looking at).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function replaceDocMinimal(view: any, next: string) {
  const cur: string = view.state.doc.toString();
  if (cur === next) return;
  let a = 0;
  while (a < cur.length && a < next.length && cur.charCodeAt(a) === next.charCodeAt(a)) a++;
  let b = 0;
  while (b < cur.length - a && b < next.length - a && cur.charCodeAt(cur.length - 1 - b) === next.charCodeAt(next.length - 1 - b)) b++;
  view.dispatch({ changes: { from: a, to: cur.length - b, insert: next.slice(a, next.length - b) } });
}

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
      // initialContent is stored CR-stripped and editor content is always LF, so a
      // direct compare is correct and avoids an O(document) `.replace` per keystroke.
      newTabs[prev.activeIndex] = {
        ...newTabs[prev.activeIndex],
        content: newContent,
        isModified: newContent !== newTabs[prev.activeIndex].initialContent
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

  // Lazily load the children of a deferred node (an SSH `.mdplink` or a remote
  // subdirectory) when it is first expanded, and splice them into the tree. The
  // node's `lazy` flag is always cleared afterwards (success or failure) so it is
  // not auto-retried; a manual Refresh re-defers it for another attempt.
  const loadLinkChildren = useCallback(async (targetPath: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const apply = (patch: (n: FileNode) => FileNode) => setFileTree(prev => {
      const walk = (nodes: FileNode[]): FileNode[] => nodes.map(n => {
        if (n.path === targetPath) return patch(n);
        if (n.children && (targetPath === n.path || targetPath.startsWith(n.path + '/'))) return { ...n, children: walk(n.children) };
        return n;
      });
      return walk(prev);
    });
    try {
      const sub = await apiClient.getSubTree(targetPath);
      apply(n => ({ ...n, children: sub.nodes || [], lazy: false, linkError: sub.error || undefined }));
    } catch (err) {
      apply(n => ({ ...n, lazy: false, linkError: (err as Error).message }));
    }
  }, []);

  // Force a slide re-render with fresh asset URLs (images get a new `?_t=` cache
  // buster), WITHOUT re-reading the file tree — for reflecting a file (e.g. an
  // image) that was replaced on disk at the same path.
  const reloadSlides = useCallback(() => {
    setLastUpdated(Date.now());
  }, []);

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
        window.history.pushState(null, '', urlForFile(nextTab.path));
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
          window.history.pushState(null, '', urlForNoFile());
          syncDrawings({});
          markdownRef.current = INITIAL_MARKDOWN;
        } else {
          const nextTab = newTabs[newIndex];
          setCurrentSlideIndex(nextTab.currentSlideIndex);
          syncDrawings(nextTab.drawings || {});
          window.history.pushState(null, '', urlForFile(nextTab.path));
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

    if (type === 'image' || type === 'binary' || type === 'pdf' || type === 'video') {
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
          window.history.pushState(null, '', urlForFile(fileName));
        }
        isLoadingFile.current = false;
      }, 0);
      return;
    }

    try {
      const text = await apiClient.readFileText(fileName);
      const estimatedByteLength = new Blob([text]).size;
      if (estimatedByteLength > MAX_FILE_SIZE) throw new Error('FILE_TOO_LARGE');

      const { editorText, drawings: newDrawings } = editorFormOf(text);

      const hasDraft = draftContent != null && draftContent !== editorText;
      const contentToUse = hasDraft ? draftContent! : editorText;

      // Store the baseline CR-stripped: the editor (CodeMirror) always reports LF
      // content, so a CR-free baseline lets the per-keystroke "modified?" check be a
      // direct compare instead of a whole-document `.replace(/\r/g, '')` each time.
      const newTab: OpenTab = { id: createTabId(), path: fileName, type, content: contentToUse, initialContent: editorText.replace(/\r/g, ''), isModified: hasDraft, currentSlideIndex: initialPage, drawings: newDrawings, editorRef: createRef() };

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
          window.history.pushState(null, '', urlForFile(fileName));
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

  // Reload a tab's content from raw disk text, discarding in-editor edits — the active
  // tab (its editor view, the live drawings, markdownRef) or a background one (its
  // state, and its view if mounted). Only the stretch that differs is replaced in the
  // editor, so the caret and the scroll stay.
  const reloadTabFromDisk = useCallback((rawText: string, tabId: string) => {
    const { tabs: openTabs, activeIndex } = stateRef.current;
    const old = openTabs.find(t => t.id === tabId);
    const { editorText, drawings: newDrawings } = editorFormOf(rawText, old ? `${old.initialContent}\n${old.content}` : '');
    const isActive = openTabs[activeIndex]?.id === tabId;
    const view = openTabs.find(t => t.id === tabId)?.editorRef.current?.view;
    setTabState(prev => {
      const tabs = [...prev.tabs];
      const i = tabs.findIndex(t => t.id === tabId);
      if (i !== -1) tabs[i] = { ...tabs[i], content: editorText, initialContent: editorText.replace(/\r/g, ''), isModified: false, drawings: newDrawings };
      return { tabs, activeIndex: prev.activeIndex };
    });
    if (isActive) markdownRef.current = editorText;
    if (view) replaceDocMinimal(view, editorText);
    if (isActive) syncDrawings(newDrawings);
    setLastUpdated(Date.now());
  }, [syncDrawings]);

  // Discard the in-editor edits of a tab and re-read its file from disk. Used by the
  // MCP reload_deck tool and by any "the file changed outside" flow.
  const reloadFileFromDisk = useCallback(async (filePath: string) => {
    const { tabs: openTabs } = stateRef.current;
    const tab = openTabs.find(t => t.path === filePath);
    if (!tab) throw new Error(`"${filePath}" is not open in the editor.`);
    const text = await apiClient.readFileText(filePath);
    reloadTabFromDisk(text, tab.id);
    // Drop any persisted draft too, so hot-exit restore can't resurrect the
    // edits we just discarded.
    const drafts = readDrafts();
    if (drafts[filePath] !== undefined) {
      delete drafts[filePath];
      writeDrafts(drafts);
    }
    return text;
  }, [reloadTabFromDisk]);

  // The text of each file as this editor last wrote it (drawing data stripped): the
  // tab's baseline catches up a render later, so a disk check in between must not
  // take the editor's own save for a change made outside.
  const lastSavedRef = useRef<Map<string, string>>(new Map());

  // `fromMcp`: an AI's save_deck — never a dialog: a file changed on disk since the
  // tab loaded it is reported back (`diskChanged`, with the disk's text) instead of
  // asking the person; `overwrite`: write anyway (the bridge has backed the file up).
  const handleSave = useCallback(async (opts?: { fromMcp?: boolean; overwrite?: boolean }): Promise<SaveResult> => {
    const fromMcp = !!(opts && typeof opts === 'object' && 'fromMcp' in opts && opts.fromMcp);
    const overwrite = !!(opts && typeof opts === 'object' && 'overwrite' in opts && opts.overwrite);
    const activeIdx = stateRef.current.activeIndex;
    if (activeIdx === -1) return { status: 'nothing' };
    const currentTab = stateRef.current.tabs[activeIdx];
    if (!currentTab) return { status: 'nothing' };

    const { path: saveFileName, type: saveFileType, content: saveMarkdown } = currentTab;
    if (saveFileType === 'image' || saveFileType === 'binary' || saveFileType === 'video' || saveFileType === 'limit-exceeded') return { status: 'nothing', path: saveFileName };

    // External-change guard: the file may have been edited/replaced on disk by
    // another program since we loaded or last saved it. Compare disk text (ignoring
    // drawing data) to our baseline; if it changed, ask before overwriting.
    let diskNow: string | null = null;
    try { diskNow = await apiClient.readFileText(saveFileName); } catch { /* new/unreadable → just save */ }
    if (diskNow != null && !overwrite && stripDrawingData(diskNow) !== stripDrawingData(currentTab.initialContent)) {
      if (fromMcp) return { status: 'diskChanged', path: saveFileName, disk: diskNow };
      const choice = await choiceDialog(
        'This file was changed on disk outside the editor since you opened it. Saving now would overwrite those external changes.',
        {
          title: 'File changed on disk',
          severity: 'warning',
          options: [
            { value: 'overwrite', label: 'Overwrite', variant: 'contained', color: 'warning' },
            { value: 'reload', label: 'Reload from disk', variant: 'outlined' },
            { value: 'cancel', label: 'Cancel', variant: 'text' },
          ],
        },
      );
      if (choice === 'reload') { reloadTabFromDisk(diskNow, currentTab.id); return { status: 'reloaded', path: saveFileName }; }
      if (choice !== 'overwrite') return { status: 'cancelled', path: saveFileName }; // cancel / dismissed → don't save
      // overwrite → fall through
    }

    try {
      const map = getDrawingMap();
      let textToSave = saveMarkdown;

      const anchorRegexGlobal = new RegExp('<' + '!--\\s*@drawing:\\s*([a-zA-Z0-9]+)\\s*--' + '>', 'g');
      textToSave = textToSave.replace(anchorRegexGlobal, (match, id) => {
          const base64 = map.get(id);
          return base64 ? '<' + '!-- @draw: ' + base64 + ' --' + '>' : match;
      });

      lastSavedRef.current.set(saveFileName, stripDrawingData(textToSave));
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
          newTabs[idx] = { ...newTabs[idx], initialContent: saveMarkdown.replace(/\r/g, ''), isModified: false };
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
      return { status: 'saved', path: saveFileName };
    } catch (err) {
      if (!fromMcp) reportError('Failed to save the file.', { detail: err });
      return { status: 'error', path: saveFileName, error: String((err as Error)?.message || err) };
    }
  }, [reloadTabFromDisk]);

  // The open text tabs compared with their files on disk — a file changed outside this
  // editor (the author fixing a deck on another computer, a program, an MCP file tool).
  // A tab WITHOUT unsaved edits is reloaded (nothing of the person's is lost); one WITH
  // them is kept as it is and reported (`changedWhileEdited`, with the disk's text) —
  // saving it then asks (the person) or answers `diskChanged` (an AI). `paths` = only
  // those tabs (default: every open text tab).
  const syncTabsWithDisk = useCallback(async (paths?: string[]): Promise<DiskSync[]> => {
    const want = paths ? new Set(paths) : null;
    const out: DiskSync[] = [];
    for (const tab of stateRef.current.tabs) {
      if (tab.type !== 'markdown' && tab.type !== 'text') continue;
      if (want && !want.has(tab.path)) continue;
      let disk: string;
      try { disk = await apiClient.readFileText(tab.path); }
      catch { out.push({ path: tab.path, state: 'missing' }); continue; }
      const now = stateRef.current.tabs.find(t => t.id === tab.id);   // it may have changed meanwhile
      if (!now) continue;
      const d = stripDrawingData(disk);
      if (d === stripDrawingData(now.initialContent) || d === lastSavedRef.current.get(now.path)) { out.push({ path: now.path, state: 'same' }); continue; }
      if (now.isModified) { out.push({ path: now.path, state: 'changedWhileEdited', disk }); continue; }
      reloadTabFromDisk(disk, now.id);
      out.push({ path: now.path, state: 'reloaded' });
    }
    return out;
  }, [reloadTabFromDisk]);

  // An AI's save_deck merged the file's changes on disk into the editor's: the merged
  // text goes into the tab (one undoable edit) and the disk's text (`baseline`, in the
  // editor's form — editorFormOf) becomes its baseline, so the save that follows sees
  // no outside change.
  const rebaseTab = useCallback((path: string, baseline: string, mergedEditorText: string) => {
    const tab = stateRef.current.tabs.find(t => t.path === path);
    if (!tab) throw new Error(`"${path}" is not open in the editor.`);
    setTabState(prev => {
      const tabs = [...prev.tabs];
      const i = tabs.findIndex(t => t.id === tab.id);
      if (i !== -1) tabs[i] = { ...tabs[i], initialContent: baseline.replace(/\r/g, ''), content: mergedEditorText, isModified: mergedEditorText !== baseline.replace(/\r/g, '') };
      return { tabs, activeIndex: prev.activeIndex };
    });
    if (stateRef.current.tabs[stateRef.current.activeIndex]?.id === tab.id) markdownRef.current = mergedEditorText;
    const view = tab.editorRef.current?.view;
    if (view) replaceDocMinimal(view, mergedEditorText);
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
      // initialContent is stored CR-stripped and editor content is always LF, so a
      // direct compare is correct and avoids an O(document) `.replace` per keystroke.
      newTabs[idx] = {
        ...newTabs[idx],
        content: newContent,
        isModified: newContent !== newTabs[idx].initialContent
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
          window.history.replaceState(null, '', urlForFile(nextTab.path));
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
          window.history.pushState(null, '', urlForNoFile());
          syncDrawings({});
          markdownRef.current = INITIAL_MARKDOWN;
        } else {
          const nextTab = newTabs[newActiveIndex];
          setCurrentSlideIndex(nextTab.currentSlideIndex);
          syncDrawings(nextTab.drawings || {});
          window.history.replaceState(null, '', urlForFile(nextTab.path));
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
      window.history.pushState(null, '', urlForFile(tabToKeep.path));
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
      window.history.pushState(null, '', urlForNoFile());
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
    fileTree, fetchFileTree, handleManualRefresh, loadLinkChildren, reloadSlides,
    lastUpdated, currentFileName, currentFileType,
    templateContent, setTemplateContent,
    markdownRef, isLoadingFile,
    loadFile, handleSave, reloadFileFromDisk, syncTabsWithDisk, rebaseTab,
    handleOpenFolder,
    isModified,
    tabs, setTabs: () => {}, activeTabIndex, switchTab, closeTab, updateTabContent,
    renameTab, closeTabsByPaths, reorderTabs, closeOtherTabs, closeAllTabs,
    persistDrafts, clearDrafts
  };
};