import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { Typography, Button, Menu, MenuItem, Divider, Dialog, DialogTitle, DialogContent, DialogActions } from '@mui/material';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';

import { type SnippetsCategory, type ThemeOption, type FileType, getCustomItemStyle } from '../../types';

import { MainHeader } from '../../components/layout/MainHeader';
import { MODULES_DIR, EFFECTS_DIR, IMAGES_DIR, SNIPPETS_DIR, TEMPLATES_DIR, THEMES_DIR } from '../../features/workspace/specialFolders';
import { scopeConfigDirs, collectScopedAssetPaths } from '../../features/workspace/mdpScope';
import { type MdpContent, parseContent, effectiveDisabledModules, contentPath } from '../../features/workspace/mdpContent';
import { useAppSettings } from '../../features/settings/AppSettingsContext';
import { matchAction } from '../../features/settings/shortcuts/matcher';
import { ACTIONS_BY_SCOPE } from '../../features/settings/shortcuts/registry';
import { DrawioEditor } from '../../features/drawio/components/DrawioEditor';
import { ConnectDialog } from '../../features/remote/components/ConnectDialog';
import { PrintContainer } from '../../features/slide/components/PrintContainer';
import { SlideOverviewGrid } from '../../features/slide/components/SlideOverviewGrid';

import { SlideView } from '../../features/slide/components/SlideView';
import { SlideEffectLayer } from '../../features/slide/components/SlideEffectLayer';
import { SlideScaler } from '../../features/slide/components/SlideScaler';
import { SlideControls } from '../../features/drawing/components/SlideControls';

import { useDrawing } from '../../features/drawing/hooks/useDrawing';
import { usePresentation } from '../../features/slide/hooks/usePresentation';
import { useFileManager } from '../../features/fileTree/hooks/useFileManager';
import { useAppInit } from './hooks/useAppInit';
import { usePresentationSync } from '../../features/remote/hooks/usePresentationSync';
import { useShortcuts } from './hooks/useShortcuts';
import { useSlideNavigation } from './hooks/useSlideNavigation';
import { useSlideProcessor } from '../../features/slide/hooks/useSlideProcessor';
import { useDrawio } from '../../features/drawio/hooks/useDrawio';
import { useAppActions } from './hooks/useAppActions';
import { useEditorIntegration } from '../../features/editor/hooks/useEditorIntegration';
import { apiClient, isElectron } from '../../api/apiClient';
import { clearAllModules, registerModule, getAllModuleSnippets, loadedModules, setDisabledModules } from '../../features/modules/moduleManager';
import { refreshModuleRegions } from '../../features/editor/extensions/ModuleRegionPlugin';
import { ModuleSettingsDialog } from '../../features/modules/components/ModuleSettingsDialog';
import { loadedEffects } from '../../features/effects/effectManager';
import type { ModuleParam } from '../../utils/moduleParser';

// Common CSS easings offered in the transition/build settings dialog.
const FX_EASINGS = ['ease', 'linear', 'ease-in', 'ease-out', 'ease-in-out', 'cubic-bezier(0.4, 0, 0.2, 1)'];
import { clearAllEffects, registerEffect, getAllEffectSnippets } from '../../features/effects/effectManager';
import { applyModulesToMarkdown, parseArguments } from '../../features/modules/moduleProcessor';
import { resolveImages, setLibraryImages, clearLibraryImages, parseInFileImageDefs, type ImageEntry } from '../../features/images/imageRegistry';
import { addFileImageDef, editFileImageDef, deleteFileImageDef } from '../../features/images/imageDocEdits';
import { updateModuleTransforms, removeModuleDirectives, parseModuleDirectives, moveModuleDirective, getModuleDirectiveText, pasteModuleDirective, pasteModuleAt } from '../../features/modules/moduleDocEdits';
import { splitMarkdownToBlocks } from '../../features/slide/parser/slideParser';
import { readTagsFromDoc, upsertTags } from '../../features/slide/parser/tagDocEdits';
import { splitTags } from '../../features/slide/parser/tags';
import { useDeckIndexBuilder } from '../../features/search/useDeckIndexBuilder';
import { deckIndexStore } from '../../features/search/deckIndexStore';
import { allTagsOf } from '../../features/search/searchEngine';
import { TagSettingsDialog } from '../../features/search/components/TagSettingsDialog';
import { prewarmSvgs } from '../../features/slide/inlineSvg';
import type { ManipRuntime } from '../../features/slide/components/ManipulationLayer';
import { storeLibraryImage, inlineLibraryImage, saveRegistry, deleteLibraryFile } from '../../features/images/imageLibraryStore';
import { useBookmarks } from './hooks/useBookmarks';
import { useCatalogSync } from '../../features/catalog/hooks/useCatalogSync';
import { syncOfficialCatalog } from '../../features/catalog/syncService';
import { useSlideRasterizer } from '../../features/remote/capture/useSlideRasterizer';
import { usePptxExport, type PptxMode } from '../../features/export/usePptxExport';
import { DockProvider } from './dock/DockProvider';
import type { SidebarSharedProps, PreviewSharedProps, SnippetsShared, ImagesShared, HeaderActions, EditorSharedProps } from './dock/DockContext';
import { EditorDock } from './dock/EditorDock';
import { RESET_LAYOUT_EVENT, SHOW_PANEL_EVENT } from './dock/dockShared';
import { BASE_HEIGHT } from '../../constants';
import { reportError, notify, confirmDialog, choiceDialog } from '../../components/error/errorReporter';

import '../../App.css';
import './EditorPage.css';

const blobUrlCache = new Map<string, string>();

function getBlobUrlFromBase64(dataUrl: string) {
  if (blobUrlCache.has(dataUrl)) return blobUrlCache.get(dataUrl)!;
  try {
    const match = dataUrl.match(/^data:(image\/[^;]+);base64,(.*)$/);
    if (!match) return dataUrl;
    const bstr = atob(match[2]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) u8arr[n] = bstr.charCodeAt(n);
    const url = URL.createObjectURL(new Blob([u8arr], { type: match[1] }));
    blobUrlCache.set(dataUrl, url);
    return url;
  } catch (e) {
    console.error("Blob URL conversion failed:", e);
    return dataUrl;
  }
}

export default function EditorPage() {
  const [currentSlideIndex, setCurrentSlideIndex] = useState<number>(0);
  const [prevSlidesLength, setPrevSlidesLength] = useState<number>(0);
  const [snipets, setSnipets] = useState<SnippetsCategory[]>([]);
  const [themes, setThemes] = useState<ThemeOption[]>([]);
  const [isConnectDialogOpen, setIsConnectDialogOpen] = useState(false);
  const [directDrawio, setDirectDrawio] = useState<{path: string, content: string} | null>(null);
  const [themeMenuAnchor, setThemeMenuAnchor] = useState<HTMLElement | null>(null);

  const [hasSelectedFolder, setHasSelectedFolder] = useState<boolean>(() => {
    return !!localStorage.getItem('mdp_root_path');
  });

  const { drawings, addStroke, updateStrokes, syncDrawings, insertPage, undo, redo, clear, canUndo, canRedo } = useDrawing();
  const [toolType, setToolType] = useState<'pen' | 'eraser' | 'select'>('pen');
  const [penColor, setPenColor] = useState('#FF0000');
  const [penWidth, setPenWidth] = useState(3);
  const [stylusOnly, setStylusOnly] = useState(false);

  const prevSlideIndexRef = useRef(0);
  // Holds the latest active slide index so tab switches can save it back onto
  // the outgoing tab (and restore it when that tab is reactivated).
  const currentSlideIndexRef = useRef(currentSlideIndex);
  useEffect(() => { currentSlideIndexRef.current = currentSlideIndex; }, [currentSlideIndex]);

  const {
    markdown, setMarkdown, debouncedMarkdown,
    fileTree, fetchFileTree, handleManualRefresh, loadLinkChildren, reloadSlides,
    lastUpdated, currentFileName, currentFileType,
    setTemplateContent, markdownRef, isLoadingFile,
    loadFile, handleSave, handleOpenFolder, isModified,
    tabs, activeTabIndex, closeTab, switchTab, updateTabContent,
    renameTab, closeTabsByPaths, reorderTabs, closeOtherTabs, closeAllTabs,
    persistDrafts, clearDrafts
  } = useFileManager({
    setCurrentSlideIndex, syncDrawings,
    onFileLoaded: useCallback(() => { prevSlideIndexRef.current = -1; }, []),
    drawings, currentSlideIndexRef
  });

  const { settings: appSettings } = useAppSettings();

  const tabsRef = useRef(tabs);
  const activeTabIndexRef = useRef(activeTabIndex);
  useEffect(() => { tabsRef.current = tabs; activeTabIndexRef.current = activeTabIndex; }, [tabs, activeTabIndex]);

  const editorRef = useMemo(() => ({
    get current() {
      const activeTab = tabsRef.current[activeTabIndexRef.current];
      return activeTab?.editorRef?.current || null;
    }
  }), []);

  const [tabToClose, setTabToClose] = useState<number | null>(null);

  const isSyncingRef = useRef(false);
  // Bumped after a catalog sync to force a full module/effect re-registration
  // (a sync can overwrite existing files in place, leaving their paths unchanged).
  const [assetsEpoch, setAssetsEpoch] = useState(0);

  const handleTabCloseClick = useCallback((e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    if (tabs[index].isModified) {
      setTabToClose(index);
    } else {
      closeTab(index);
    }
  }, [tabs, closeTab]);

  const handleConfirmCloseTab = async (save: boolean) => {
    if (tabToClose === null) return;
    const targetIndex = tabToClose;
    const targetTab = tabs[targetIndex];
    setTabToClose(null);

    if (save) {
      try {
        let textToSave = targetTab.content;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const map = (window as any).__drawingMap as Map<string, string>;
        if (map) {
          const drawRegex = new RegExp('<' + '!--\\s*@drawing:\\s*([a-zA-Z0-9]+)\\s*--' + '>', 'g');
          textToSave = textToSave.replace(drawRegex, (match, id) => {
            const base64 = map.get(id);
            return base64 ? '<' + '!-- @draw: ' + base64 + ' --' + '>' : match;
          });
        }
        await apiClient.saveFile(targetTab.path, textToSave);
      } catch (err) {
        reportError('Failed to save the file.', { detail: err });
        return;
      }
    }
    closeTab(targetIndex);
  };

  useCatalogSync(fileTree, handleManualRefresh);
  // Build / maintain the workspace deck search index (title/subtitle/tags + body).
  useDeckIndexBuilder(fileTree);

  useEffect(() => {
    const handleSyncStart = () => {
      isSyncingRef.current = true;
    };
    const handleSyncEnd = () => {
      isSyncingRef.current = false;
      // A sync may rewrite existing module/effect files in place (same paths), so
      // force a full re-registration in addition to refreshing the file tree.
      setAssetsEpoch((e) => e + 1);
      handleManualRefresh();
    };

    window.addEventListener('mdp-sync-start', handleSyncStart);
    window.addEventListener('mdp-sync-end', handleSyncEnd);

    return () => {
      window.removeEventListener('mdp-sync-start', handleSyncStart);
      window.removeEventListener('mdp-sync-end', handleSyncEnd);
    };
  }, [handleManualRefresh]);

  const handleManualSync = useCallback(async () => {
    const wantsToSync = await confirmDialog(
      'Download and update to the latest official assets (modules, themes, templates, snippets) from GitHub?',
      { title: 'Sync Official Assets', confirmText: 'Download', cancelText: 'Cancel' }
    );
    if (!wantsToSync) return;
    try {
      await syncOfficialCatalog();
      notify('MDP official assets updated successfully.');
      handleManualRefresh();
    } catch (err) {
      reportError('Sync failed. Please check your network connection.', { detail: err });
    }
  }, [handleManualRefresh]);

  useEffect(() => {
    if (isElectron()) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).electronAPI?.setModified?.(isModified);
    }
  }, [isModified]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isModified && !isElectron()) {
        // Keep the unsaved work so it can be restored on the next visit.
        persistDrafts();
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isModified, persistDrafts]);

  useEffect(() => {
    if (!isElectron()) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).electronAPI;
    if (!api?.onAppCloseRequest) return;
    return api.onAppCloseRequest(async () => {
      const choice = await choiceDialog(
        'You have unsaved changes. Keep them as drafts so they are restored next time, or discard them?',
        {
          title: 'Unsaved Changes',
          severity: 'warning',
          options: [
            { value: 'keep', label: 'Keep Drafts & Quit', variant: 'contained', color: 'primary' },
            { value: 'discard', label: 'Discard & Quit', color: 'error' },
            { value: 'cancel', label: 'Cancel' },
          ],
        },
      );
      if (choice === 'keep') {
        persistDrafts();
        api.confirmAppClose();
      } else if (choice === 'discard') {
        clearDrafts();
        api.confirmAppClose();
      }
    });
  }, [persistDrafts, clearDrafts]);

  // App-managed folders now live under `.mdp/` (`.mdp/modules`, `.mdp/effects`, …).
  // `.mdp` cascade: modules/effects come from the active file's `.mdp` CHAIN
  // (root→nearest, nearest wins by basename), not just the workspace-root `.mdp`,
  // so a `.mdp` placed in a subfolder governs the decks beneath it. Driven by
  // `currentFileName`; because assets (themes etc.) live UNDER their `.mdp`, editing
  // one still resolves to that deck's scope. Falls back to the root `.mdp` when
  // nothing is open (preserves pre-deck loading).
  const scopeDirs = useMemo(() => scopeConfigDirs(fileTree, currentFileName), [fileTree, currentFileName]);
  // Publish the active deck's `.mdp` scope so the Settings overlay's AI-prompt
  // section (a sibling surface) can build a scope-correct themes list.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useEffect(() => { (window as any).__mdpScopeDirs = scopeDirs; }, [scopeDirs]);

  const modulePathsString = useMemo(
    () => collectScopedAssetPaths(fileTree, scopeDirs, 'modules', '.mdpmod.xml').sort().join(','),
    [fileTree, scopeDirs],
  );

  const effectPathsString = useMemo(
    () => collectScopedAssetPaths(fileTree, scopeDirs, 'effects', '.mdpfx.xml').sort().join(','),
    [fileTree, scopeDirs],
  );

  // Incremented whenever modules/effects finish (re)loading. Threaded into slide
  // generation so slides parsed before registration are re-parsed once their
  // markdown transforms (and CSS) are available — otherwise they stay raw.
  const [moduleEpoch, setModuleEpoch] = useState(0);
  // Modules load asynchronously after the editor mounts; when they (re)load, ask
  // the editor to re-scan so block/inline module directives get coloured/foldable
  // (the initial scan ran before any module was registered).
  useEffect(() => { refreshModuleRegions(editorRef.current?.view); }, [moduleEpoch, editorRef]);

  // Workspace-shared image-alias library (.mdp/images/registry.json). In-file `@image`
  // defs override these on alias conflict (see resolveImages).
  const [imageLibrary, setImageLibrary] = useState<Record<string, string>>({});
  // Optional human descriptions for library aliases (alias → text).
  const [imageLibraryDesc, setImageLibraryDesc] = useState<Record<string, string>>({});
  // Optional tags for library aliases (alias → tag list), for search/filter.
  const [imageLibraryTags, setImageLibraryTags] = useState<Record<string, string[]>>({});
  // Image shown in the Preview panel instead of the slides (library preview).
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // On-preview module manipulation (edit-layout mode).
  const [editLayout, setEditLayout] = useState(false);
  const [snapOn, setSnapOn] = useState(true);
  const snapStep = 1; // percent

  // Live preview. When OFF, editor changes stop advancing the preview source, so
  // no re-parse/re-render happens while typing (avoids heavy mid-edit parses).
  // The preview freezes at the last applied markdown until re-enabled or applied.
  const [livePreview, setLivePreview] = useState(true);
  // The exact editor doc produced by the LAST overlay transform commit. Used to
  // detect a pure move/resize/rotate change and suppress the slide re-render
  // (which would re-create inline drawio = flicker, and reset other elements).
  const lastManipDocRef = useRef<string | null>(null);
  // Render-phase guard: when this key (active file + edit-layout) changes we clear
  // the suppress baseline above so stale suppression can't blank the preview.
  const manipBaselineKeyRef = useRef<string>('');

  // A library-image preview overlays the slides in the Preview panel. Dismiss it
  // when the active file changes, otherwise switching to a slide/image tab keeps
  // showing the lingering image (the slide preview never appears until the user
  // clicks "Back to slides").
  useEffect(() => { setPreviewImage(null); }, [currentFileName]);

  // Re-merge module/effect snippets into the snippet list (excluding disabled
  // modules). Shared by initial load, catalog sync, file-save and the
  // enabled-modules toggle so the snippet list always matches the active modules.
  const refreshModuleSnippets = useCallback(() => {
    const allModSnips = [...getAllModuleSnippets(), ...getAllEffectSnippets()];
    setSnipets(prev => {
      const cleanPrev = prev.map(c => ({
        ...c,
        items: c.items.filter(item => !item.isModule)
      })).filter(c => c.items.length > 0);
      allModSnips.forEach(snip => {
        const catName = snip.category || 'Custom Modules';
        const cat = cleanPrev.find(c => c.category === catName);
        if (cat) cat.items.push(snip);
        else cleanPrev.push({ category: catName, items: [snip] });
      });
      return cleanPrev;
    });
  }, []);

  // Re-fetch workspace/file snippets, then re-append the active module snippets.
  // Triggered from Settings → Modules → "Reload snippets" via a window event.
  const reloadSnippets = useCallback(async () => {
    try {
      const data = await apiClient.getSnipets();
      setSnipets(data);
    } catch (err) {
      console.error('Failed to reload snippets', err);
    }
    refreshModuleSnippets();
  }, [refreshModuleSnippets]);

  // Module enable/disable is per-folder: resolve the DISABLED set from the active
  // deck's `.mdp` chain (`<dir>/content.json`, nearest explicit wins), apply it,
  // re-merge snippets and re-parse so the preview reflects it live. Re-runs on scope
  // change and when the Configure (.mdp) dialog edits a content.json.
  const [contentEpoch, setContentEpoch] = useState(0);
  useEffect(() => {
    const onChanged = () => setContentEpoch((e) => e + 1);
    window.addEventListener('mdp-content-changed', onChanged);
    return () => window.removeEventListener('mdp-content-changed', onChanged);
  }, []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const chain: MdpContent[] = [];
      for (const cdir of scopeDirs) {
        try { chain.push(parseContent(await apiClient.readFileText(contentPath(cdir)))); }
        catch { chain.push({}); }
      }
      if (cancelled) return;
      setDisabledModules(effectiveDisabledModules(chain));
      refreshModuleSnippets();
      setModuleEpoch((e) => e + 1);
    })();
    return () => { cancelled = true; };
  }, [scopeDirs, contentEpoch, refreshModuleSnippets]);

  // Settings overlay (a separate component) asks the editor to sync the official
  // catalog or reload snippets via window events — the editor owns the file tree
  // and snippet state, so it performs the work and refreshes here.
  useEffect(() => {
    const onReload = () => { void reloadSnippets(); };
    window.addEventListener('mdp-reload-snippets', onReload);
    return () => window.removeEventListener('mdp-reload-snippets', onReload);
  }, [reloadSnippets]);

  useEffect(() => {
    let isCancelled = false;

    const loadAllModules = async () => {
      if (isSyncingRef.current) return;

      clearAllModules();
      clearAllEffects();

      try {
        const defaultModules = await apiClient.getModules();
        for (const mod of defaultModules) {
          if (!mod.isCustom) {
            const content = await apiClient.getModuleContent(mod.path);
            if (content && !isCancelled) {
              registerModule(content);
            }
          }
        }
      } catch (err) {
        console.error("Failed to load default modules", err);
      }

      if (modulePathsString) {
        const pathsToLoad = modulePathsString.split(',');
        for (const path of pathsToLoad) {
          if (isCancelled) return;
          try {
            const content = await apiClient.readFileText(path);
            registerModule(content);
          } catch (err) {
            console.error(`Failed to load workspace module: ${path}`, err);
          }
        }
      }

      // Effects (.effect folder + bundled defaults) — registered separately from
      // modules; they never transform markdown, only provide transition/build CSS+JS.
      try {
        const defaultEffects = await apiClient.getEffects();
        for (const fx of defaultEffects) {
          if (!fx.isCustom) {
            const content = await apiClient.getEffectContent(fx.path);
            if (content && !isCancelled) {
              registerEffect(content);
            }
          }
        }
      } catch (err) {
        console.error("Failed to load default effects", err);
      }

      if (effectPathsString) {
        const pathsToLoad = effectPathsString.split(',');
        for (const path of pathsToLoad) {
          if (isCancelled) return;
          try {
            const content = await apiClient.readFileText(path);
            registerEffect(content);
          } catch (err) {
            console.error(`Failed to load workspace effect: ${path}`, err);
          }
        }
      }

      if (!isCancelled) {
        refreshModuleSnippets();
        // Modules + effects are now registered (markdown transforms + CSS ready):
        // force a slide re-parse so anything rendered raw beforehand is fixed.
        setModuleEpoch((e) => e + 1);
      }
    };

    const timerId = setTimeout(() => {
      if (modulePathsString !== '' || effectPathsString !== '' || !hasSelectedFolder) {
        loadAllModules();
      }
    }, 300);

    return () => {
      isCancelled = true;
      clearTimeout(timerId);
    };
  }, [modulePathsString, effectPathsString, hasSelectedFolder, refreshModuleSnippets, assetsEpoch]);

  const handleOpenFolderWithFlag = useCallback(async () => {
    await handleOpenFolder();
    setHasSelectedFolder(!!localStorage.getItem('mdp_root_path'));
  }, [handleOpenFolder]);

  const isImageFile = currentFileName?.match(/\.(png|jpe?g|gif|svg|webp)$/i);
  const isPdfFile = currentFileName?.toLowerCase().endsWith('.pdf');
  const isSlideFile = currentFileName?.endsWith('.slide.md');

  let effectiveFileType = currentFileType;
  if (!currentFileName && markdown) {
    effectiveFileType = 'markdown';
  } else if (isImageFile) {
    effectiveFileType = 'image';
  } else if (isPdfFile) {
    effectiveFileType = 'pdf';
  } else if (isSlideFile) {
    effectiveFileType = 'markdown';
  } else if (currentFileName?.match(/\.(md|markdown)$/i) || currentFileType === 'markdown') {
    // A plain markdown file (not a `.slide.md` deck) → rendered as a scrollable document.
    effectiveFileType = 'doc';
  }

  // --- Pinned preview source -------------------------------------------------
  // The preview (and everything derived from `slides`: thumbnails, slideshow,
  // presenter, remote, print) follows ONLY slide and image files. While a
  // non-previewable text file is active — e.g. a theme `.css`, a `*.mdpmod.xml`
  // module or a `*.mdpfx.xml` effect — the preview keeps rendering the last
  // slide/image so theme/module/effect edits can be previewed live against a
  // real deck. The editor pane still follows the active tab; saving the
  // edited asset bumps `lastUpdated` / reloads modules (`moduleEpoch`), which
  // re-runs the live pipeline below against the pinned source.
  const isPreviewableActive = effectiveFileType === 'image' || effectiveFileType === 'markdown' || effectiveFileType === 'doc' || effectiveFileType === 'pdf';
  const [previewSource, setPreviewSource] = useState<{ fileName: string | null; fileType: FileType; md: string }>(
    () => isPreviewableActive
      ? { fileName: currentFileName, fileType: effectiveFileType, md: debouncedMarkdown }
      : { fileName: null, fileType: 'markdown', md: '' }
  );
  // Adjust during render (React-recommended) so switching to a slide updates the
  // preview without a one-frame lag; a non-previewable active tab leaves it frozen.
  // While editing layout, a debounced doc that EXACTLY equals the overlay's last
  // transform commit is a pure move/resize/rotate — the live DOM is already
  // correct (applyLive), so we skip the slide re-render (no inline-drawio
  // re-creation flicker, no resetting other manip elements). Typing / undo /
  // manual edits differ → normal re-render. Flushed when edit-layout turns off,
  // the file changes, or slideshow/overview starts (effect below).
  // Clear the transform-suppress baseline when the active file or edit-layout
  // changes. Done DURING render (a ref write, before the manipSuppress test below)
  // so the change is seen THIS pass — an effect would run too late and a ref write
  // wouldn't re-trigger. Otherwise the baseline (set after the last transform
  // commit, and often still == the doc) keeps suppressing LEGITIMATE re-renders:
  // returning to a slide after editing a module file leaves the preview blank
  // ("No slide preview"), and a module delete never shows. The genuine
  // transform-commit suppression is unaffected — that path re-seeds the baseline
  // and neither key changes in between.
  const manipBaselineKey = `${currentFileName}|${editLayout}`;
  if (manipBaselineKeyRef.current !== manipBaselineKey) {
    manipBaselineKeyRef.current = manipBaselineKey;
    lastManipDocRef.current = null;
  }
  const fileChanged = previewSource.fileName !== currentFileName || previewSource.fileType !== effectiveFileType;
  const mdChanged = previewSource.md !== debouncedMarkdown;
  // Compare against the IMMEDIATE editor doc (`markdown`), not the debounced one:
  // onCommit flushes previewSource to the committed doc, and `markdown` updates in
  // the same batch — so this is true right after a transform commit (suppressing
  // the lagging debounced markdown from reverting the flush) but false for typing
  // (which moves `markdown` away from the baseline → normal re-render).
  const manipSuppress = editLayout && mdChanged && !fileChanged && markdown === lastManipDocRef.current;
  // When live preview is off, freeze the preview on editor changes (no re-parse).
  // A file switch still updates so the preview follows the active tab.
  const liveSuppress = !livePreview && mdChanged && !fileChanged;
  if (isPreviewableActive && (fileChanged || (mdChanged && !manipSuppress && !liveSuppress))) {
    setPreviewSource({ fileName: currentFileName, fileType: effectiveFileType, md: debouncedMarkdown });
  } else if (!isPreviewableActive && previewSource.fileType !== 'markdown') {
    // Never KEEP a pinned image / document / pdf while a non-previewable file
    // (css / module / effect / other text) is active. Pinning exists so
    // theme/module/effect edits preview against the last real slide DECK — an
    // image/doc/pdf is not a deck, and retaining it leaves a stale, unrelated
    // preview after switching to (or closing a tab onto) a text file. Drop it so
    // the preview falls back to the empty state instead. Converges: once the type
    // is 'markdown' (a deck) this branch no longer fires.
    setPreviewSource({ fileName: null, fileType: 'markdown', md: '' });
  }
  // The frozen preview is "stale" when the editor content differs from what's
  // shown (drives the Apply button's highlight).
  const previewStale = !livePreview && markdown !== previewSource.md && !fileChanged;
  const previewFileName = previewSource.fileName;
  const previewFileType = previewSource.fileType;
  const previewMarkdown = previewSource.md;

  const basePath = useMemo(() => {
    if (!previewFileName) return '';
    const parts = previewFileName.split('/');
    parts.pop();
    return parts.join('/');
  }, [previewFileName]);

  const {
    isDrawioModalOpen, setIsDrawioModalOpen, drawioEditTarget,
    setDrawioButtonPos, setDrawioEditTarget, handleDrawioSave
  } = useDrawio(editorRef, setMarkdown, markdownRef);

  const processedMarkdown = useMemo(() => {
    if (!previewMarkdown) return '';
    // Resolve image aliases FIRST: strip `@image` def blocks and expand
    // `![alt](@alias)` references to real urls/data. Done before everything else
    // so modules, builds, marked, print and the remote rasterizer are all
    // alias-aware, and resolved data URIs get the data:→blob: optimization below.
    const imgPrefix = isElectron() ? 'mdp-file://' : '/files/';
    let md = resolveImages(previewMarkdown, imageLibrary, (p) => `${imgPrefix}${p.replace(/^\//, '')}`).markdown;
    md = applyModulesToMarkdown(md);
    md = md.replace(/([，．、。])\$/g, '$1 $');
    md = md.replace(/\$([^\x20-\x7E\s])/g, '$ $1');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return md.replace(/!\[([^\]]*)\]\((data:image\/[^)]+)\)/g, (m: any, alt: any, dataUrl: any) => {
      // Keep SVG (drawio) data-URIs as-is so SlideView can INLINE them (theme-
      // styleable text, no <object> reload flicker). Only raster data-URIs get
      // the blob-URL optimization. Blobbing SVGs would render them as opaque
      // <img>, defeating inlining.
      if (/^data:image\/svg/i.test(dataUrl)) return m;
      const blobUrl = getBlobUrlFromBase64(dataUrl);
      return `![${alt}](${blobUrl})`;
    });
    // moduleEpoch: re-run `applyModulesToMarkdown` when a module/effect is
    // (re)registered — e.g. saving a `*.mdpmod.xml` — so the pinned deck reflects
    // the new module <render>/<script> output live, not just its <style>.
  }, [previewMarkdown, imageLibrary, moduleEpoch]);

  const { baseUrl, globalContext, slides: mdSlides, docHtml, slideSize: mdSlideSize, slideStyleVariables, themeCssUrl } = useSlideProcessor(
    previewFileName, previewFileType, processedMarkdown, lastUpdated, themes, moduleEpoch
  );

  const imageSlides = useMemo(() => {
    if (previewFileType !== 'image' || !previewFileName) return null;
    const src = `${isElectron() ? 'mdp-file://' : '/files/'}${previewFileName.split('/').map(encodeURIComponent).join('/')}?t=${lastUpdated}`;
    const html = `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#ffffff;"><img src="${src}" style="max-width:100%;max-height:100%;object-fit:contain;" /></div>`;
    return [{ html, raw: '', isHidden: false, isCover: false, pageNumber: 1, className: '', header: '', footer: '' }];
  }, [previewFileType, previewFileName, lastUpdated]);

  const slides = imageSlides ?? mdSlides;
  const slideSize = useMemo(
    () => (imageSlides ? { width: (BASE_HEIGHT * 16) / 9, height: BASE_HEIGHT } : mdSlideSize),
    [imageSlides, mdSlideSize],
  );

  if (slides.length !== prevSlidesLength) {
    setPrevSlidesLength(slides.length);
    if (slides.length > 0 && currentSlideIndex >= slides.length) {
      setCurrentSlideIndex(slides.length - 1);
    } else if (slides.length === 0 && currentSlideIndex > 0) {
      setCurrentSlideIndex(0);
    }
  }

  useAppInit(fetchFileTree, loadFile, setTemplateContent, setSnipets, setThemes);

  // Re-fetch the theme list whenever the file tree changes OR the active deck's
  // `.mdp` scope changes — themes cascade like modules (root→nearest, nearest wins),
  // so newly added/scoped themes show up in the @theme selector and resolve.
  useEffect(() => {
    apiClient.getThemes(scopeDirs).then(setThemes).catch(err => console.error('Failed to load themes', err));
  }, [fileTree, scopeDirs]);

  // Load the image-alias library — now CASCADING across the active deck's `.mdp`
  // chain (root→nearest): each `<dir>/.mdp/images/registry.json` is merged, NEAREST
  // alias winning. A registry's managed paths (`.mdp/images/<file>`) are rebased to
  // ITS own `.mdp/images/` location so a deeper library's files resolve correctly.
  // Async like modules → bump moduleEpoch to force a re-parse once ready.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const map: Record<string, string> = {};
      const desc: Record<string, string> = {};
      const tags: Record<string, string[]> = {};
      for (const cdir of scopeDirs) { // root→nearest; later overrides (scopeDirs falls back to root `.mdp`)
        try {
          const parsed = JSON.parse(await apiClient.readFileText(`${cdir}/images/registry.json`));
          const rebase = (v: string) => typeof v === 'string' ? v.replace(/^\/?\.mdp\/images\//, `${cdir}/images/`) : v;
          for (const [a, v] of Object.entries((parsed && parsed.images) || {})) map[a] = rebase(v as string);
          Object.assign(desc, (parsed && parsed.descriptions) || {});
          Object.assign(tags, (parsed && parsed.tags) || {});
        } catch { /* this `.mdp` has no library */ }
      }
      if (cancelled) return;
      setImageLibrary(map);
      setImageLibraryDesc(desc);
      setImageLibraryTags(tags);
      setLibraryImages(map);
      setModuleEpoch((e) => e + 1);
    })();
    return () => { cancelled = true; };
  }, [fileTree, scopeDirs]);

  const {
    isSlideshow, setIsSlideshow, slideshowRef, isSlideOverview, setIsSlideOverview,
    toggleSlideOverview, mode, setMode, showControls, setShowControls, moveSlide, toggleSlideshow,
    step, setStep
  } = usePresentation(slides, currentSlideIndex, setCurrentSlideIndex);

  // The transform-only suppress above can leave `slides` (used by slideshow /
  // overview / presenter / remote) lagging the doc. Flush to the latest doc
  // whenever those surfaces activate so they're never stale.
  useEffect(() => {
    if (isSlideshow || isSlideOverview) {
      setPreviewSource((prev) => (prev.md === debouncedMarkdown ? prev : { ...prev, md: debouncedMarkdown }));
    }
  }, [isSlideshow, isSlideOverview, debouncedMarkdown]);

  const { handleAddBlankSlide, handleSaveDrawingsToMarkdown } = useAppActions({
    currentFileName, markdown, setMarkdown, markdownRef, editorRef, drawings, insertPage, syncDrawings
  });

  const { bookmarks, toggleBookmark, isBookmarked, reorderBookmarks, updateBookmark } = useBookmarks();
  const isInitialMount = useRef(true);
  const autoSaveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let refreshTimer: number | null = null;
    const scheduleRefresh = () => {
      if (isSyncingRef.current) return;
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        fetchFileTree();
      }, 500);
    };

    const handleFileSaved = async (e: Event) => {
      if (isSyncingRef.current) return;

      const { path, content } = (e as CustomEvent).detail;

      if (path.includes(`${MODULES_DIR}/`) && path.endsWith('.mdpmod.xml')) {
        const mod = registerModule(content);
        if (mod) {
          const allModSnips = getAllModuleSnippets();
          setSnipets(prev => {
            const cleanPrev = prev.map(c => ({
              ...c,
              items: c.items.filter(item => !item.isModule)
            })).filter(c => c.items.length > 0);

            allModSnips.forEach(snip => {
              const catName = snip.category || 'Custom Modules';
              const cat = cleanPrev.find(c => c.category === catName);
              if (cat) cat.items.push(snip);
              else cleanPrev.push({ category: catName, items: [snip] });
            });
            return cleanPrev;
          });
        }
        // Re-apply modules to the pinned deck so <render>/<script> changes show
        // live (registerModule already swapped the <style> for CSS changes).
        setModuleEpoch((e) => e + 1);
      } else if (path.includes(`${EFFECTS_DIR}/`) && path.endsWith('.mdpfx.xml')) {
        // Re-register the edited effect so its CSS/JS updates live, then refresh
        // snippets (effect snippets share the isModule flag).
        registerEffect(content);
        const allModSnips = [...getAllModuleSnippets(), ...getAllEffectSnippets()];
        setSnipets(prev => {
          const cleanPrev = prev.map(c => ({
            ...c,
            items: c.items.filter(item => !item.isModule)
          })).filter(c => c.items.length > 0);
          allModSnips.forEach(snip => {
            const catName = snip.category || 'Custom Modules';
            const cat = cleanPrev.find(c => c.category === catName);
            if (cat) cat.items.push(snip);
            else cleanPrev.push({ category: catName, items: [snip] });
          });
          return cleanPrev;
        });
        // Re-render the pinned deck so the effect's updated build/transition
        // CSS+JS re-applies live.
        setModuleEpoch((e) => e + 1);
      } else if (path === `${IMAGES_DIR}/registry.json` || path.endsWith(`/${IMAGES_DIR}/registry.json`)) {
        // The shared image-alias library changed (panel write or hand-edit):
        // reload it and force a slide re-parse.
        try {
          const parsed = JSON.parse(content);
          const map: Record<string, string> = (parsed && parsed.images) || {};
          const desc: Record<string, string> = (parsed && parsed.descriptions) || {};
          const tags: Record<string, string[]> = (parsed && parsed.tags) || {};
          setImageLibrary(map);
          setImageLibraryDesc(desc);
          setImageLibraryTags(tags);
          setLibraryImages(map);
          setModuleEpoch((e) => e + 1);
        } catch { /* ignore malformed registry */ }
      } else if (path.includes(`${SNIPPETS_DIR}/`) || path.includes(`${TEMPLATES_DIR}/`) || path.includes(`${THEMES_DIR}/`)) {
        scheduleRefresh();
      }
    };

    window.addEventListener('mdp-file-saved', handleFileSaved);
    return () => {
      window.removeEventListener('mdp-file-saved', handleFileSaved);
      if (refreshTimer) window.clearTimeout(refreshTimer);
    };
  }, [fetchFileTree, setSnipets]);

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    if (autoSaveTimerRef.current) {
      window.clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = window.setTimeout(() => {
      handleSaveDrawingsToMarkdown();
      console.log("Drawings auto-saved!");
    }, 2000);
    return () => {
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawings]);

  const handleUpdateNote = useCallback((pageIndex: number, newNote: string) => {
    const view = editorRef.current?.view;
    if (!view) return;

    const doc = view.state.doc;
    let startLine = 1;
    let endLine = doc.lines;
    let currentBlock = 0;
    let inCodeBlock = false;
    const targetBlock = pageIndex + 1;

    for (let i = 1; i <= doc.lines; i++) {
      const text = doc.line(i).text.trim();
      if (text.startsWith('```')) inCodeBlock = !inCodeBlock;
      if (!inCodeBlock && /^---$/.test(text)) {
        if (currentBlock === targetBlock) { endLine = i - 1; break; }
        currentBlock++;
        if (currentBlock === targetBlock) { startLine = i + 1; }
      }
    }

    const startPos = doc.line(startLine).from;
    const endPos = Math.max(startPos, doc.line(endLine).to);
    const slideText = doc.sliceString(startPos, endPos);

    let newSlideText = slideText;

    const noteRegex = new RegExp('<' + '!--\\s*@note:([\\s\\S]*?)--' + '>', 'g');
    const match = slideText.match(noteRegex);

    const prefix = '<' + '!-- @note:\n';
    const suffix = '\n--' + '>';

    if (match) {
      const lastMatch = match[match.length - 1];
      const replaceIndex = slideText.lastIndexOf(lastMatch);
      const replacement = prefix + newNote + suffix;
      newSlideText = slideText.substring(0, replaceIndex) + replacement + slideText.substring(replaceIndex + lastMatch.length);
    } else {
      const appended = '\n\n' + prefix + newNote + suffix + '\n';
      newSlideText = slideText.trimEnd() + appended;
    }

    view.dispatch({ changes: { from: startPos, to: endPos, insert: newSlideText } });
  }, [editorRef]);

  const { rasterize, host: rasterHost } = useSlideRasterizer();
  const pptxTitle = useMemo(() => {
    const n = currentFileName?.split('/').pop() || 'MDP_Presentation';
    return n.replace(/\.slide\.md$/i, '').replace(/\.md$/i, '') || 'MDP_Presentation';
  }, [currentFileName]);
  const { exportPptx, exporting: pptxExporting, host: pptxHost } = usePptxExport({
    slides, slideSize, basePath, themeCssUrl, title: pptxTitle, rasterize, onSaved: () => fetchFileTree(),
  });

  const [remoteActive, setRemoteActive] = useState(false);
  const [remotePort, setRemotePort] = useState<number | null>(null);
  const [remoteIps, setRemoteIps] = useState<{ name: string; address: string }[]>([]);

  const activateRemote = useCallback(async () => {
    setRemoteActive(true);
    if (isElectron()) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const info = await (window as any).electronAPI?.startRemoteServer?.();
        if (info) { setRemotePort(info.port); setRemoteIps(info.ips || []); }
      } catch (e) {
        reportError('Failed to start the remote server.', { detail: e });
      }
    }
  }, []);

  // For remote/rasterization, inline-data images are converted to blob: in the editor
  // for performance; rewrite them back to data: so they resolve off the editor document.
  const syncSlides = useMemo(() => {
    const reverse = new Map<string, string>();
    blobUrlCache.forEach((blob, data) => reverse.set(blob, data));
    if (reverse.size === 0) return slides;
    return slides.map((s) => {
      if (!s.html || !s.html.includes('blob:')) return s;
      return { ...s, html: s.html.replace(/blob:[^"')\s]+/g, (m: string) => reverse.get(m) || m) };
    });
  }, [slides]);

  const selectSlideFromOverview = useCallback((idx: number) => {
    setStep(0);
    setCurrentSlideIndex(idx);
    setIsSlideOverview(false);
  }, [setIsSlideOverview, setStep, setCurrentSlideIndex]);

  // Open a deck and jump to a slide. loadFile seeks a freshly-opened deck via
  // initialPage; an already-open deck only switches tabs, so re-seek after.
  const handleOpenDeck = useCallback((path: string, slideIndex?: number) => {
    const alreadyOpen = tabsRef.current.some((t) => t.path === path);
    loadFile(path, false, slideIndex ?? 0);
    if (alreadyOpen && slideIndex != null) setTimeout(() => setCurrentSlideIndex(slideIndex), 0);
  }, [loadFile, setCurrentSlideIndex]);

  // Slide hyperlinks (`[x](#5 | #id | deck.slide.md#…)`) + back/forward history.
  // Destructured into stable callbacks so effect/memo deps don't fight the object identity.
  const { onSlideLink: navLink, historyBack: navBack, historyForward: navForward, canBack: navCanBack, canForward: navCanForward } = useSlideNavigation({
    slides, currentFileName, currentSlideIndex, setCurrentSlideIndex, setStep, openDeck: handleOpenDeck,
  });

  const { channelId, token, send, imagePrep } = usePresentationSync(
    syncSlides, currentSlideIndex, slideSize, globalContext, baseUrl, themeCssUrl, lastUpdated, drawings,
    moveSlide, addStroke, clear, undo, redo, handleAddBlankSlide, updateStrokes, handleUpdateNote,
    remotePort, rasterize, remoteActive, basePath, isSlideOverview, toggleSlideOverview, selectSlideFromOverview,
    step, navLink, navBack, navForward
  );

  const handleUpdateStrokes = useCallback((pageIndex: number, indices: number[], dx: number, dy: number) => {
    if (updateStrokes) updateStrokes(pageIndex, indices, dx, dy);
    if (channelId) send({ type: 'UPDATE_STROKES', pageIndex, indices, dx, dy, channelId });
  }, [updateStrokes, channelId, send]);

  const handleEditDirectDrawio = useCallback(async () => {
    if (!currentFileName) return;
    try {
      const text = await apiClient.readFileText(currentFileName);
      const bytes = new TextEncoder().encode(text);
      const binString = Array.from(bytes, (byte) => String.fromCodePoint(byte)).join("");
      const base64 = btoa(binString);

      setDirectDrawio({ path: currentFileName, content: base64 });
    } catch (e) {
      reportError('Failed to open the diagram for editing.', { detail: e });
    }
  }, [currentFileName]);

  const openConnectDialog = useCallback(() => {
    activateRemote();
    setIsConnectDialogOpen(true);
  }, [activateRemote]);

  const handleDirectDrawioSave = async (dataUri: string) => {
    if (!directDrawio) return;
    try {
      let svgText = dataUri;
      if (dataUri.startsWith('data:image/svg+xml;base64,')) {
        const base64 = dataUri.split(',')[1];
        const binStr = atob(base64);
        const bytes = new Uint8Array(binStr.length);
        for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
        svgText = new TextDecoder('utf-8').decode(bytes);
      }
      await apiClient.saveFile(directDrawio.path, svgText);
      setDirectDrawio(null);
      handleManualRefresh();
      loadFile(directDrawio.path, true);
    } catch (e) {
      reportError('Failed to save the diagram.', { detail: e });
    }
  };

  useShortcuts(
    isSlideshow, setIsSlideshow, mode, setMode, showControls, setShowControls,
    currentSlideIndex, moveSlide, undo, redo, clear, handleAddBlankSlide, send, channelId
  );

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const action = matchAction(e, ACTIONS_BY_SCOPE.global, appSettings);
      if (action?.id === 'global.slideshowToggle') {
        e.preventDefault();
        if (!isSlideshow) toggleSlideshow();
      } else if (action?.id === 'global.overviewExit' && isSlideOverview) {
        e.preventDefault();
        setIsSlideOverview(false);
      } else if (action?.id === 'global.historyBack') {
        e.preventDefault();
        navBack();
      } else if (action?.id === 'global.historyForward') {
        e.preventDefault();
        navForward();
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown, { passive: false });
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isSlideshow, toggleSlideshow, isSlideOverview, setIsSlideOverview, appSettings, navBack, navForward]);

  const { onEditorUpdate, extensions, handleInsertText } = useEditorIntegration({
    editorRef, currentFileName,
    currentFileType: effectiveFileType, currentSlideIndex, setCurrentSlideIndex, slides,
    isLoadingFile, prevSlideIndexRef, setDrawioButtonPos, setDrawioEditTarget,
    handleSave, setMarkdown, markdownRef
  });

  const openPresenterTool = useCallback(() => {
    const baseUrl = window.location.href.split('#')[0];
    window.open(`${baseUrl}#/presenter?channel=${channelId}&token=${encodeURIComponent(token)}`, '_blank', 'width=1000,height=800');
  }, [channelId, token]);

  const handleSwitchToRemote = useCallback(() => {
    const baseUrl = window.location.href.split('#')[0];
    window.location.href = `${baseUrl}#/remote`;
  }, []);

  // Warm the inline-SVG cache when remote broadcasting starts so rasterized
  // slides (including never-previewed ones) have their drawio diagrams ready.
  useEffect(() => {
    if (remoteActive) void prewarmSvgs(slides.map((s) => (s as { html?: string }).html || ''), basePath);
  }, [remoteActive, slides, basePath]);

  const handlePrint = useCallback(async () => {
    const originalTitle = document.title;
    let baseName = 'MDP_Presentation';
    const deckTitle = (globalContext.meta?.title || '').trim();
    if (appSettings.pdfNameSource === 'title' && deckTitle) {
      // Use the deck's @title as the default PDF name (per the General setting).
      baseName = deckTitle;
    } else if (currentFileName) {
      baseName = currentFileName.split('/').pop() || 'MDP_Presentation';
      baseName = baseName.replace(/\.slide\.md$/i, '').replace(/\.md$/i, '');
    }
    const safeTitle = baseName.replace(/[\\/:*?"<>|\n\r\t]/g, '_').trim() || 'MDP_Presentation';
    document.title = safeTitle;

    // Warm the inline-SVG cache so drawio on never-previewed slides is ready
    // before the print container captures (no missing/late diagrams).
    try { await prewarmSvgs(slides.map((s) => (s as { html?: string }).html || ''), basePath); } catch { /* ignore */ }

    // Defensive: clear any print styles a previous (interrupted) print may have
    // left behind, so the off-screen print container can never get stuck visible.
    document.getElementById('preload-print-style')?.remove();
    document.getElementById('dynamic-print-size')?.remove();

    const preloadStyle = document.createElement('style');
    preloadStyle.id = 'preload-print-style';
    preloadStyle.innerHTML = `
      @media screen {
        .print-container {
          display: block !important;
          position: absolute !important;
          top: 0; left: 0;
          width: 100vw !important;
          height: 100vh !important;
          opacity: 0.01 !important;
          z-index: -9999 !important;
          pointer-events: none !important;
          overflow: hidden !important;
        }
      }
    `;
    document.head.appendChild(preloadStyle);

    await document.fonts.ready;

    const printImages = Array.from(document.querySelectorAll('.print-container img')) as HTMLImageElement[];
    await Promise.all(printImages.map(img => {
      if (img.complete && img.naturalHeight !== 0) return Promise.resolve();
      return new Promise(resolve => {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
      });
    }));

    await new Promise(resolve => setTimeout(resolve, 800));

    const currentText = markdown || '';
    const aspectRegex = new RegExp("<" + "!--\\s*@aspect\\s+([0-9.]+:[0-9.]+)\\s*--" + ">");
    const aspectMatch = currentText.match(aspectRegex);
    const ratioStr = aspectMatch ? aspectMatch[1] : '16:9';

    const pageWidth = 1920;
    let pageHeight = 1080;

    const ratioParts = ratioStr.split(':');
    if (ratioParts.length === 2) {
      const rw = parseFloat(ratioParts[0]);
      const rh = parseFloat(ratioParts[1]);
      if (!isNaN(rw) && !isNaN(rh) && rw > 0) {
        pageHeight = Math.round((pageWidth / rw) * rh);
      }
    }

    const dynamicPrintStyle = document.createElement('style');
    dynamicPrintStyle.id = 'dynamic-print-size';
    dynamicPrintStyle.innerHTML = `
      @media print {
        @page {
          size: ${pageWidth}px ${pageHeight}px !important;
          margin: 0 !important;
        }
        * {
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        .print-container {
          opacity: 1 !important;
          display: block !important;
          visibility: visible !important;
        }
      }
    `;
    document.head.appendChild(dynamicPrintStyle);

    const cleanup = () => {
      document.title = originalTitle;
      document.getElementById('dynamic-print-size')?.remove();
      document.getElementById('preload-print-style')?.remove();
    };
    try {
      if (isElectron()) {
        await apiClient.exportPdf(safeTitle);
      } else {
        window.print();
      }
    } finally {
      // Always restore — even if export throws — so the off-screen print
      // container never stays mounted (a stuck giant blank area).
      setTimeout(cleanup, 1500);
      // Hard safety net in case the timer is ever lost.
      setTimeout(cleanup, 8000);
    }
  }, [currentFileName, markdown, appSettings.pdfNameSource, globalContext]);

  const handleFileSelect = useCallback((path: string, isBinary?: boolean) => {
    const url = new URL(window.location.href);
    if (url.searchParams.has('url')) {
      url.searchParams.delete('url');
      window.history.replaceState({}, '', url.toString() || window.location.pathname);
    }
    loadFile(path, isBinary);
  }, [loadFile]);

  useEffect(() => {
    const handleOpenThemeSelector = (e: Event) => {
      const customEvent = e as CustomEvent;
      setThemeMenuAnchor(customEvent.detail.target);
    };
    document.addEventListener('open-theme-selector', handleOpenThemeSelector);
    return () => document.removeEventListener('open-theme-selector', handleOpenThemeSelector);
  }, []);

  // --- Module / effect settings dialog (the ⚙ button on a directive) ---------
  const [moduleSettings, setModuleSettings] = useState<{
    name: string; kind: 'module' | 'transition' | 'build';
    params: ModuleParam[]; values: Record<string, string>;
    from: number; to: number; original: string;
  } | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail as { name: string; args: string; from: number; to: number; original: string };
      const fxOpts = Object.keys(loadedEffects).sort().map((n) => ({ value: n, label: n }));
      const easeOpts = FX_EASINGS.map((x) => ({ value: x, label: x }));

      if (d.name === 'transition') {
        // `<!-- @transition <effect> key: val, … -->` — effect name is positional.
        const m = (d.args || '').trim().match(/^(\S+)?\s*([\s\S]*)$/);
        const effectName = m?.[1] || '';
        const rest = parseArguments(m?.[2] || '');
        // Use the selected effect's own (rich) params; fall back to generic
        // duration/easing if the effect is unknown/not yet loaded.
        const fxParams = (loadedEffects[effectName]?.config.parameters || []).filter((p) => p.name !== 'effect');
        const params: ModuleParam[] = [
          { name: 'effect', type: 'select', label: 'Effect', options: fxOpts, default: '' },
          ...fxParams,
        ];
        if (!fxParams.length) params.push(
          { name: 'duration', type: 'number', label: 'Duration (ms)', min: 0, integer: true },
          { name: 'easing', type: 'select', label: 'Easing', options: easeOpts },
        );
        setModuleSettings({ name: 'transition', kind: 'transition', params, values: { effect: effectName, ...rest }, from: d.from, to: d.to, original: d.original });
        return;
      }
      if (d.name === 'build') {
        const parsed = parseArguments(d.args || '');
        if (parsed.step != null && parsed.enter == null) parsed.enter = parsed.step;
        delete parsed.step;
        const params: ModuleParam[] = [
          { name: 'enter', type: 'number', label: 'Enter step', description: 'Step at which this appears', min: 1, integer: true, default: '1' },
          { name: 'emphasis', type: 'number', label: 'Emphasis step', min: 1, integer: true },
          { name: 'exit', type: 'number', label: 'Exit step', min: 1, integer: true },
          { name: 'effect', type: 'select', label: 'Enter effect', options: fxOpts, default: 'fade' },
          { name: 'emphasisEffect', type: 'select', label: 'Emphasis effect', options: fxOpts },
          { name: 'exitEffect', type: 'select', label: 'Exit effect', options: fxOpts },
          { name: 'duration', type: 'text', label: 'Duration', description: 'e.g. 0.5s' },
          { name: 'easing', type: 'select', label: 'Easing', options: easeOpts },
          { name: 'stagger', type: 'text', label: 'Stagger', description: 'e.g. 0.1s between items' },
          { name: 'auto', type: 'number', label: 'Auto-advance (ms)', min: 0, integer: true },
        ];
        setModuleSettings({ name: 'build', kind: 'build', params, values: parsed, from: d.from, to: d.to, original: d.original });
        return;
      }

      const mod = loadedModules[d.name];
      if (!mod) return;
      setModuleSettings({
        name: d.name, kind: 'module',
        params: mod.config.parameters || [],
        values: parseArguments(d.args || ''),
        from: d.from, to: d.to, original: d.original,
      });
    };
    document.addEventListener('open-module-settings', handler);
    return () => document.removeEventListener('open-module-settings', handler);
  }, []);

  const handleModuleSettingsSave = useCallback((vals: Record<string, string>) => {
    const view = editorRef.current?.view;
    setModuleSettings((st) => {
      if (!view || !st) return null;
      // Preserve any original args the dialog doesn't manage — notably the manip
      // transform args (x/y/w/h/rot) and `id` — so editing parameters via the
      // dialog never resets a module's on-preview position/size. Declared params
      // come solely from the dialog (which already omits defaults).
      const declared = new Set(st.params.map((p) => p.name));
      const preserved = Object.fromEntries(
        Object.entries(st.values).filter(([k]) => !declared.has(k)),
      );
      const merged = { ...preserved, ...vals };
      const kv = (obj: Record<string, string>) => Object.entries(obj)
        .map(([k, v]) => `${k}: ${/,/.test(v) ? `"${v}"` : v}`).join(', ');
      let directive: string;
      if (st.kind === 'transition') {
        // Effect name is positional, not a `key: value` arg.
        const effect = (vals.effect || st.values.effect || 'fade').trim();
        const rest: Record<string, string> = {};
        Object.entries(merged).forEach(([k, v]) => { if (k !== 'effect') rest[k] = v; });
        const restStr = kv(rest);
        directive = `<!-- @transition ${effect}${restStr ? ' ' + restStr : ''} -->`;
      } else {
        // Modules and @build: standard `<!-- @name key: value, … -->`.
        const argStr = kv(merged);
        directive = `<!-- @${st.name}${argStr ? ' ' + argStr : ''} -->`;
      }
      const doc = view.state.doc;
      let from = st.from, to = st.to;
      // Positions may be stale if the doc changed while the dialog was open —
      // fall back to locating the original directive text.
      if (doc.sliceString(from, to) !== st.original) {
        const idx = doc.toString().indexOf(st.original);
        if (idx === -1) return null;
        from = idx; to = idx + st.original.length;
      }
      view.dispatch({ changes: { from, to, insert: directive } });
      return null;
    });
  }, [editorRef]);

  // --- Tag settings dialog (the 🏷 button on the meta-page `@tags` directive) ----
  const [tagSettings, setTagSettings] = useState<{ tags: string[]; suggestions: string[] } | null>(null);
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail as { value?: string };
      setTagSettings({ tags: splitTags(d.value || ''), suggestions: allTagsOf(deckIndexStore.getEntries()) });
    };
    document.addEventListener('open-tag-settings', handler);
    return () => document.removeEventListener('open-tag-settings', handler);
  }, []);
  const handleTagSettingsSave = useCallback((tags: string[]) => {
    const view = editorRef.current?.view;
    if (view) upsertTags(view, tags);
    setTagSettings(null);
  }, [editorRef]);

  const handleThemeChange = (newThemeName: string) => {
    if (editorRef.current?.view) {
      const view = editorRef.current.view;
      const text = view.state.doc.toString();
      const themeRegex = new RegExp("<" + "!--\\s*@theme\\s+([^>]+?)\\s*--" + ">");
      const match = text.match(themeRegex);
      const newThemeTag = "<" + "!-- @theme " + newThemeName + " --" + ">";

      if (match && match.index !== undefined) {
         view.dispatch({
           changes: { from: match.index, to: match.index + match[0].length, insert: newThemeTag }
         });
      } else {
         view.dispatch({
           changes: { from: 0, insert: newThemeTag + "\n" }
         });
      }
    }
    setThemeMenuAnchor(null);
  };

  const onEditDrawio = currentFileName?.match(/\.drawio\.svg$/i) ? handleEditDirectDrawio : undefined;

  // Edit-layout requires the previewed slide to BE the active editor tab, so the
  // transform write-back lands in the right document and the (live) preview
  // reflects it. Under preview-pinning they can diverge — then the toggle is off.
  const canEditLayout = previewFileType === 'markdown' && previewFileName === currentFileName;
  // After a manip doc edit (commit/delete/reorder/paste), bake the new doc into the
  // preview source immediately so it reflects on the FIRST action (the debounced
  // markdown lags one edit behind) and doesn't revert on slide navigation. The
  // manipSuppress baseline (compared against the immediate `markdown`) then stops
  // the lagging debounced update from briefly reverting the flush.
  const flushManipPreview = useCallback(() => {
    const view = editorRef.current?.view;
    if (!view) return;
    const doc = view.state.doc.toString();
    lastManipDocRef.current = doc;
    setPreviewSource((prev) => (prev.md === doc ? prev : { ...prev, md: doc }));
  }, [editorRef]);
  const manipulate = useMemo<ManipRuntime>(() => ({
    enabled: editLayout && canEditLayout,
    snap: snapOn,
    snapStep,
    onCommit: (edits) => {
      const view = editorRef.current?.view;
      if (!view) return;
      updateModuleTransforms(view, edits);
      flushManipPreview();
    },
    onDelete: (sels) => {
      const view = editorRef.current?.view;
      if (!view) return;
      removeModuleDirectives(view, sels);
      flushManipPreview();
    },
    // Reorder: move the module's directive block earlier/later in the document.
    onReorder: (sel, dir) => {
      const view = editorRef.current?.view;
      if (!view) return null;
      const newOrd = moveModuleDirective(view, sel, dir);
      flushManipPreview();
      return newOrd;
    },
    // Copy: hand the module's directive source text back to the overlay clipboard.
    onCopyText: (sel) => {
      const view = editorRef.current?.view;
      return view ? getModuleDirectiveText(view.state.doc.toString(), sel) : null;
    },
    // Paste: insert an offset copy after the target module, return its new ord.
    onPaste: (afterSel, text) => {
      const view = editorRef.current?.view;
      if (!view) return null;
      const newOrd = pasteModuleDirective(view, afterSel, text);
      flushManipPreview();
      return newOrd;
    },
    // Paste on empty canvas: drop the copy into the CURRENT slide at the clicked
    // (x, y) %. Block 0 is the meta page, so slide i lives in blocks[i + 1].
    onPasteAt: (text, x, y) => {
      const view = editorRef.current?.view;
      if (!view) return null;
      const doc = view.state.doc;
      const blocks = splitMarkdownToBlocks(doc.toString());
      const block = blocks[currentSlideIndexRef.current + 1] || blocks[blocks.length - 1];
      if (!block) return null;
      const offset = doc.line(Math.min(block.endLine, doc.lines)).to;
      const newOrd = pasteModuleAt(view, offset, text, x, y);
      flushManipPreview();
      return newOrd;
    },
    // Selecting a module on the preview jumps the editor cursor to its directive.
    onSelect: (sel) => {
      const view = editorRef.current?.view;
      if (!view || sel.ord == null) return;
      const dir = parseModuleDirectives(view.state.doc.toString()).find((d) => d.ord === sel.ord);
      if (!dir) return;
      view.dispatch({ selection: { anchor: dir.openFrom, head: dir.openFrom }, scrollIntoView: true });
      view.focus();
    },
    // Context-menu "Property" → open that module's settings dialog.
    onRequestProperty: (sel) => {
      const view = editorRef.current?.view;
      if (!view || sel.ord == null) return;
      const doc = view.state.doc.toString();
      const dir = parseModuleDirectives(doc).find((d) => d.ord === sel.ord);
      if (!dir) return;
      const mod = loadedModules[dir.name];
      if (!mod) return;
      setModuleSettings({
        name: dir.name, kind: 'module',
        params: mod.config.parameters || [],
        values: dir.args,
        from: dir.openFrom, to: dir.openTo,
        original: doc.slice(dir.openFrom, dir.openTo),
      });
    },
  }), [editLayout, canEditLayout, snapOn, snapStep, editorRef, flushManipPreview]);

  // --- Slide tags (current deck) ---
  // Parse the active deck's tags from the (debounced) doc. Using debouncedMarkdown
  // avoids re-parsing — and re-rendering the sidebar — on every keystroke.
  const currentDeckTags = useMemo(
    () => (currentFileName?.endsWith('.slide.md') ? readTagsFromDoc(debouncedMarkdown) : []),
    [currentFileName, debouncedMarkdown],
  );
  // Tag edits write to the ACTIVE editor tab's doc, so only allow them when the
  // previewed deck IS the active deck (same guard as canEditLayout).
  const canEditTags = !!currentFileName?.endsWith('.slide.md') && previewFileName === currentFileName;
  const handleSetDeckTags = useCallback((tags: string[]) => {
    const view = editorRef.current?.view;
    if (view) upsertTags(view, tags);
  }, [editorRef]);

  const sidebarSlice = useMemo<SidebarSharedProps>(() => ({
    currentFileName, currentFileType: previewFileType, slides, currentSlideIndex, slideSize,
    drawings, fileTree, onSlideSelect: setCurrentSlideIndex, onFileSelect: handleFileSelect,
    onManualRefresh: handleManualRefresh, onLoadLinkChildren: loadLinkChildren, onNav: moveSlide, handleOpenFolder,
    bookmarks, isBookmarked, onToggleBookmark: toggleBookmark,
    onReorderBookmark: reorderBookmarks, onUpdateBookmark: updateBookmark,
    onRenameFile: renameTab, onDeleteFiles: closeTabsByPaths,
    onOpenDeck: handleOpenDeck, canEditTags, currentDeckTags, onSetDeckTags: handleSetDeckTags,
  }), [currentFileName, previewFileType, slides, currentSlideIndex, slideSize, drawings, fileTree,
    setCurrentSlideIndex, handleFileSelect, handleManualRefresh, loadLinkChildren, moveSlide, handleOpenFolder,
    bookmarks, isBookmarked, toggleBookmark, reorderBookmarks, updateBookmark, renameTab, closeTabsByPaths,
    handleOpenDeck, canEditTags, currentDeckTags, handleSetDeckTags]);

  const previewSlice = useMemo<PreviewSharedProps>(() => ({
    effectiveFileType: previewFileType, slides, currentSlideIndex, slideSize, basePath, drawings,
    mode, setMode, showControls, moveSlide, handleAddBlankSlide, clear, send, channelId,
    toolType, setToolType, penColor, setPenColor, penWidth, setPenWidth,
    canUndo, canRedo, undo, redo, stylusOnly, setStylusOnly, addStroke, handleUpdateStrokes,
    // While the fullscreen slideshow is active it owns interactive-module logic,
    // so the (hidden) editor preview must mirror to avoid double-running it.
    moduleRole: isSlideshow ? 'mirror' : 'owner',
    previewImage,
    onClosePreviewImage: () => setPreviewImage(null),
    docHtml,
    pdfPath: previewFileType === 'pdf' ? previewFileName : null,
    previewVersion: lastUpdated,
    onEditDrawio,
    // Slide hyperlinks + navigation history (back/forward).
    onSlideLink: navLink,
    onHistoryBack: navBack, onHistoryForward: navForward,
    canHistoryBack: navCanBack, canHistoryForward: navCanForward,
    manipulate, editLayout, canEditLayout, snapOn,
    onToggleEditLayout: () => setEditLayout((v) => !v),
    onToggleSnap: () => setSnapOn((v) => !v),
    livePreview, previewStale,
    onToggleLivePreview: () => setLivePreview((v) => !v),
    // Render the current editor content once, even while live preview is off.
    onApplyPreview: () => setPreviewSource({ fileName: currentFileName, fileType: effectiveFileType, md: markdownRef.current }),
    onReloadSlides: reloadSlides,
  }), [previewFileType, slides, currentSlideIndex, slideSize, basePath, drawings, mode, setMode,
    showControls, moveSlide, handleAddBlankSlide, clear, send, channelId, toolType, setToolType,
    penColor, setPenColor, penWidth, setPenWidth, canUndo, canRedo, undo, redo, stylusOnly,
    setStylusOnly, addStroke, handleUpdateStrokes, isSlideshow, onEditDrawio, previewImage,
    manipulate, editLayout, canEditLayout, snapOn, livePreview, previewStale,
    currentFileName, effectiveFileType, markdownRef, reloadSlides,
    docHtml, previewFileName, lastUpdated,
    navLink, navBack, navForward, navCanBack, navCanForward]);

  const snippetsSlice = useMemo<SnippetsShared>(() => ({
    snippets: snipets, onInsertText: handleInsertText,
  }), [snipets, handleInsertText]);

  // --- Image-alias panel ---
  const [imageFocusAlias, setImageFocusAlias] = useState<string | null>(null);
  // A request to open the edit dialog for an alias (from the editor's @image
  // [edit] widget). A fresh object each click; cleared once the panel handles it.
  const [imageEditRequest, setImageEditRequest] = useState<{ alias: string } | null>(null);

  // Commit a new library map to memory (state + registry singleton) and force a
  // slide re-parse. Persisting the small registry.json is the caller's job (it
  // also writes per-image binary files via the imageLibraryStore helpers).
  const commitLibrary = useCallback((map: Record<string, string>, desc: Record<string, string>, tags: Record<string, string[]>) => {
    setImageLibrary(map);
    setImageLibraryDesc(desc);
    setImageLibraryTags(tags);
    setLibraryImages(map);
    setModuleEpoch((e) => e + 1);
  }, []);

  const imageLibraryRef = useRef(imageLibrary);
  useEffect(() => { imageLibraryRef.current = imageLibrary; }, [imageLibrary]);
  const imageLibraryDescRef = useRef(imageLibraryDesc);
  useEffect(() => { imageLibraryDescRef.current = imageLibraryDesc; }, [imageLibraryDesc]);
  const imageLibraryTagsRef = useRef(imageLibraryTags);
  useEffect(() => { imageLibraryTagsRef.current = imageLibraryTags; }, [imageLibraryTags]);

  // Editing an existing SVG (drawio) image alias in the drawio editor.
  const [drawioImageEdit, setDrawioImageEdit] = useState<{ alias: string; scope: 'file' | 'library'; base64Xml: string } | null>(null);
  // Creating/editing a drawio diagram from the Images panel's Add/Edit dialog.
  // `initial` is the existing SVG (data URI) to load, or '' for a blank diagram.
  const [drawioForAdd, setDrawioForAdd] = useState<{ initial: string } | null>(null);

  const handleEditImageDrawio = useCallback(async (entry: ImageEntry) => {
    try {
      const svg = entry.value.startsWith('data:') ? entry.value : await inlineLibraryImage(entry.value);
      setDrawioImageEdit({ alias: entry.alias, scope: entry.scope, base64Xml: svg });
    } catch (e) {
      reportError('Failed to open the diagram for editing.', { detail: e });
    }
  }, []);

  const handleDrawioImageSave = useCallback(async (dataUri: string) => {
    const cur = drawioImageEdit;
    setDrawioImageEdit(null);
    if (!cur) return;
    try {
      if (cur.scope === 'file') {
        const v = editorRef.current?.view; if (v) editFileImageDef(v, cur.alias, dataUri);
      } else {
        const stored = await storeLibraryImage(cur.alias, dataUri);
        const next = { ...imageLibraryRef.current, [cur.alias]: stored };
        commitLibrary(next, imageLibraryDescRef.current, imageLibraryTagsRef.current);
        await saveRegistry(next, imageLibraryDescRef.current, imageLibraryTagsRef.current);
      }
    } catch (e) {
      reportError('Failed to save the diagram.', { detail: e });
    }
  }, [drawioImageEdit, commitLibrary, editorRef]);

  // The Add dialog asked to create/edit a diagram; hand the saved SVG back to it.
  const handleDrawioForAddSave = useCallback((dataUri: string) => {
    setDrawioForAdd(null);
    window.dispatchEvent(new CustomEvent('mdp-drawio-image-result', { detail: { value: dataUri } }));
  }, []);

  useEffect(() => {
    const open = (e: Event) => {
      const value = (e as CustomEvent).detail?.value as string | undefined;
      // If the dialog already holds an SVG (editing an existing diagram), open it
      // in drawio instead of a blank canvas; resolve a library path to its data.
      (async () => {
        let initial = '';
        if (value && (value.startsWith('data:image/svg+xml') || /\.svg(\?|$)/i.test(value))) {
          initial = value.startsWith('data:') ? value : await inlineLibraryImage(value);
        }
        setDrawioForAdd({ initial });
      })();
    };
    window.addEventListener('mdp-open-drawio-for-image', open);
    return () => window.removeEventListener('mdp-open-drawio-for-image', open);
  }, []);

  // Open the Images panel (if hidden) and focus the alias clicked in the editor.
  useEffect(() => {
    const handler = (e: Event) => {
      const alias = (e as CustomEvent).detail?.alias ?? null;
      setImageFocusAlias(alias);
      // Request the panel open the edit dialog for this alias (handled on mount,
      // so it works even when the panel was closed). New object → re-clickable.
      if (alias) setImageEditRequest({ alias });
      window.dispatchEvent(new CustomEvent(SHOW_PANEL_EVENT, { detail: { id: 'images' } }));
    };
    document.addEventListener('open-image-manager', handler);
    return () => document.removeEventListener('open-image-manager', handler);
  }, []);

  const imagesSlice = useMemo<ImagesShared>(() => {
    // Use the debounced doc: the Images panel's in-file list doesn't need to
    // re-parse `@image` defs (a whole-doc regex) on every keystroke.
    const fileImages: ImageEntry[] = parseInFileImageDefs(debouncedMarkdown).ranges.map(
      (r) => ({ alias: r.alias, value: r.value, scope: 'file' as const, description: r.description, tags: r.tags }),
    );
    const libraryImagesArr: ImageEntry[] = Object.entries(imageLibrary).map(
      ([alias, value]) => ({ alias, value, scope: 'library' as const, description: imageLibraryDesc[alias], tags: imageLibraryTags[alias] }),
    );
    const view = () => editorRef.current?.view;
    const resolveThumb = (value: string) => {
      if (/^(data:|https?:|blob:)/.test(value)) return value;
      const prefix = isElectron() ? 'mdp-file://' : '/files/';
      return value.startsWith('/') ? `${prefix}${value.slice(1)}` : `${baseUrl}${value}`;
    };

    return {
      fileImages,
      libraryImages: libraryImagesArr,
      focusAlias: imageFocusAlias,
      editRequest: imageEditRequest,
      onEditHandled: () => setImageEditRequest(null),
      onEditDrawio: handleEditImageDrawio,
      onPreview: (entry) => { setPreviewImage(resolveThumb(entry.value)); window.dispatchEvent(new CustomEvent(SHOW_PANEL_EVENT, { detail: { id: 'preview' } })); },
      onInsertReference: (alias) => handleInsertText(`![image](@${alias})`),
      resolveThumb,
      // --- library writes go through imageLibraryStore: data images become
      //     individual .mdp/images/<alias>.<ext> files, registry.json stays small ---
      onAddImage: (scope, alias, value, description, tags) => {
        if (scope === 'file') { const v = view(); if (v) addFileImageDef(v, alias, value, description, tags); return; }
        (async () => {
          try {
            const stored = await storeLibraryImage(alias, value);
            const next = { ...imageLibraryRef.current, [alias]: stored };
            const nextDesc = { ...imageLibraryDescRef.current };
            if (description) nextDesc[alias] = description; else delete nextDesc[alias];
            const nextTags = { ...imageLibraryTagsRef.current };
            if (tags && tags.length) nextTags[alias] = tags; else delete nextTags[alias];
            commitLibrary(next, nextDesc, nextTags);
            await saveRegistry(next, nextDesc, nextTags);
          } catch (e) { reportError('Failed to add the image to the library.', { detail: e }); }
        })();
      },
      onEditImage: (scope, alias, value, description, tags) => {
        if (scope === 'file') { const v = view(); if (v) editFileImageDef(v, alias, value, description, tags); return; }
        (async () => {
          try {
            const stored = await storeLibraryImage(alias, value);
            const next = { ...imageLibraryRef.current, [alias]: stored };
            const nextDesc = { ...imageLibraryDescRef.current };
            if (description) nextDesc[alias] = description; else delete nextDesc[alias];
            const nextTags = { ...imageLibraryTagsRef.current };
            if (tags && tags.length) nextTags[alias] = tags; else delete nextTags[alias];
            commitLibrary(next, nextDesc, nextTags);
            await saveRegistry(next, nextDesc, nextTags);
          } catch (e) { reportError('Failed to update the library image.', { detail: e }); }
        })();
      },
      onDeleteImage: async (scope, alias) => {
        const ok = await confirmDialog(`Delete image alias “${alias}”? References to it will stop resolving.`, { severity: 'warning', confirmText: 'Delete' });
        if (!ok) return;
        if (scope === 'file') { const v = view(); if (v) deleteFileImageDef(v, alias); return; }
        try {
          const old = imageLibraryRef.current[alias];
          const next = { ...imageLibraryRef.current }; delete next[alias];
          const nextDesc = { ...imageLibraryDescRef.current }; delete nextDesc[alias];
          const nextTags = { ...imageLibraryTagsRef.current }; delete nextTags[alias];
          commitLibrary(next, nextDesc, nextTags);
          await saveRegistry(next, nextDesc, nextTags);
          if (old) await deleteLibraryFile(old);
        } catch (e) { reportError('Failed to delete the library image.', { detail: e }); }
      },
      onMove: (alias, to) => {
        const v = view();
        if (to === 'library') {
          const entry = fileImages.find((e) => e.alias === alias);
          if (!entry) return;
          (async () => {
            try {
              const stored = await storeLibraryImage(alias, entry.value); // write dest first
              const next = { ...imageLibraryRef.current, [alias]: stored };
              const nextDesc = { ...imageLibraryDescRef.current };
              if (entry.description) nextDesc[alias] = entry.description; else delete nextDesc[alias];
              const nextTags = { ...imageLibraryTagsRef.current };
              if (entry.tags && entry.tags.length) nextTags[alias] = entry.tags; else delete nextTags[alias];
              commitLibrary(next, nextDesc, nextTags);
              await saveRegistry(next, nextDesc, nextTags);
              if (v) deleteFileImageDef(v, alias); // then remove source
            } catch (e) { reportError('Failed to move the image to the library.', { detail: e }); }
          })();
        } else {
          const value = imageLibraryRef.current[alias];
          if (value == null) return;
          (async () => {
            try {
              const inlined = await inlineLibraryImage(value); // self-contained data/URL
              if (v) addFileImageDef(v, alias, inlined, imageLibraryDescRef.current[alias], imageLibraryTagsRef.current[alias]); // write dest first
              const next = { ...imageLibraryRef.current }; delete next[alias];
              const nextDesc = { ...imageLibraryDescRef.current }; delete nextDesc[alias];
              const nextTags = { ...imageLibraryTagsRef.current }; delete nextTags[alias];
              commitLibrary(next, nextDesc, nextTags);
              await saveRegistry(next, nextDesc, nextTags);
            } catch (e) { reportError('Failed to move the image to the file.', { detail: e }); }
          })();
        }
      },
    };
  }, [debouncedMarkdown, imageLibrary, imageLibraryDesc, imageLibraryTags, imageFocusAlias, imageEditRequest, handleInsertText, baseUrl, commitLibrary, handleEditImageDrawio, editorRef]);

  const headerSlice = useMemo<HeaderActions>(() => ({
    onOpenFolder: isElectron() ? handleOpenFolderWithFlag : undefined,
    onSyncCatalog: handleManualSync,
    onSwitchToRemote: handleSwitchToRemote,
    onOpenConnectDialog: openConnectDialog,
    onOpenPresenter: openPresenterTool,
    onToggleSlideshow: toggleSlideshow,
    onPrint: handlePrint,
    onExportPptx: (mode: PptxMode) => { void exportPptx(mode); },
    pptxBusy: !!pptxExporting,
    onToggleOverview: toggleSlideOverview,
    isSlideOverview,
    canPresent: slides.length > 0,
  }), [handleOpenFolderWithFlag, handleManualSync, handleSwitchToRemote, openConnectDialog,
    openPresenterTool, toggleSlideshow, handlePrint, exportPptx, pptxExporting, toggleSlideOverview, isSlideOverview, slides.length]);

  const editorSlice: EditorSharedProps = {
    tabs, activeTabIndex, currentFileName, effectiveFileType, markdown, lastUpdated,
    extensions, switchTab, onTabClose: handleTabCloseClick,
    reorderTabs, closeOtherTabs, closeAllTabs, updateTabContent, onEditorUpdate,
    onInsertText: handleInsertText, onSave: handleSave, moveSlide,
    isBookmarked, toggleBookmark, bookmarks, updateBookmark, handleEditDirectDrawio,
  };

  return (
    <div className="container">
      <DrawioEditor open={isDrawioModalOpen} onClose={() => setIsDrawioModalOpen(false)} initialBase64Xml={drawioEditTarget?.base64} onSave={handleDrawioSave} />
      <DrawioEditor open={!!directDrawio} onClose={() => setDirectDrawio(null)} initialBase64Xml={directDrawio?.content} onSave={handleDirectDrawioSave} />
      <DrawioEditor open={!!drawioImageEdit} onClose={() => setDrawioImageEdit(null)} initialBase64Xml={drawioImageEdit?.base64Xml} onSave={handleDrawioImageSave} />
      <DrawioEditor open={!!drawioForAdd} onClose={() => setDrawioForAdd(null)} initialBase64Xml={drawioForAdd?.initial || undefined} onSave={handleDrawioForAddSave} />

      <ConnectDialog open={isConnectDialogOpen} onClose={() => setIsConnectDialogOpen(false)} channelId={channelId} token={token} ipCandidates={remoteIps} port={remotePort} />

      {moduleSettings && (
        <ModuleSettingsDialog
          open
          moduleName={moduleSettings.name}
          params={moduleSettings.params}
          initialValues={moduleSettings.values}
          // In-file `@image` entries (active tab) first — they override the
          // shared library on alias conflict — then the shared library, each
          // with its thumbnail / description / tags for the searchable picker.
          imageEntries={(() => {
            const seen = new Set<string>();
            return [...imagesSlice.fileImages, ...imagesSlice.libraryImages]
              .filter((e) => (seen.has(e.alias) ? false : (seen.add(e.alias), true)));
          })()}
          resolveThumb={imagesSlice.resolveThumb}
          onClose={() => setModuleSettings(null)}
          onSave={handleModuleSettingsSave}
        />
      )}

      {tagSettings && (
        <TagSettingsDialog
          open
          initialTags={tagSettings.tags}
          suggestedTags={tagSettings.suggestions}
          onClose={() => setTagSettings(null)}
          onSave={handleTagSettingsSave}
        />
      )}

      {rasterHost}
      {pptxHost}

      {imagePrep && (
        <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 2000, background: 'rgba(30,30,30,0.92)', color: '#fff', padding: '10px 18px', borderRadius: 8, fontSize: '0.85rem', boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}>
          Preparing remote slides… {imagePrep.done}/{imagePrep.total}
        </div>
      )}

      <Menu
        anchorEl={themeMenuAnchor}
        open={Boolean(themeMenuAnchor)}
        onClose={() => setThemeMenuAnchor(null)}
      >
        <MenuItem disabled sx={{ opacity: 1, fontWeight: 'bold', color: 'primary.main', fontSize: '0.85rem' }}>
          Select Theme
        </MenuItem>
        <Divider />
        {themes.map(t => (
          <MenuItem
            key={t.path}
            onClick={() => handleThemeChange(t.name)}
            sx={getCustomItemStyle(t.isCustom)}
          >
            {t.name}
          </MenuItem>
        ))}
      </Menu>
      <PrintContainer slides={slides} slideSize={slideSize} slideStyleVariables={slideStyleVariables} drawings={drawings} />

      {isSlideshow && (
        <div ref={slideshowRef} className={`slideshow-overlay ${mode === 'laser' ? 'laser-mode' : ''}`}>
          {isSlideOverview ? (
            // Overview during the presentation: fill the overlay with the slide
            // grid so it shows on top of the slideshow; selecting jumps to a slide.
            <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
              <SlideOverviewGrid slides={slides} currentSlideIndex={currentSlideIndex} slideSize={slideSize} drawings={drawings} onSelectSlide={selectSlideFromOverview} />
            </div>
          ) : (
            <>
              <SlideControls
                mode={mode} setMode={setMode} pageIndex={currentSlideIndex} totalSlides={slides.length} visible={showControls} onNav={moveSlide} onAddSlide={() => handleAddBlankSlide(currentSlideIndex)} onClearDrawing={() => { clear(currentSlideIndex); send({ type: 'CLEAR_DRAWING', channelId, pageIndex: currentSlideIndex }); }} onClose={() => { document.exitFullscreen(); setMode('view'); }} toolType={toolType} setToolType={setToolType} penColor={penColor} setPenColor={setPenColor} penWidth={penWidth} setPenWidth={setPenWidth} canUndo={canUndo(currentSlideIndex)} canRedo={canRedo(currentSlideIndex)} onUndo={() => undo(currentSlideIndex)} onRedo={() => redo(currentSlideIndex)} useLaserPointerMode={true} stylusOnly={stylusOnly} setStylusOnly={setStylusOnly} containerStyle={{ bottom: '20px' }}
                onHistoryBack={navBack} onHistoryForward={navForward} canHistoryBack={navCanBack} canHistoryForward={navCanForward}
              />
              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <SlideEffectLayer
                  slides={slides}
                  index={currentSlideIndex}
                  step={step}
                  globalTransition={globalContext.transition}
                  onStepAutoAdvance={() => {
                    // Auto-advance to the NEXT BUILD only — don't cross the slide
                    // boundary (the last build stops; cross slides manually).
                    const sc = (slides[currentSlideIndex] as { stepCount?: number })?.stepCount || 0;
                    if (step < sc) moveSlide(1);
                  }}
                  renderSlide={(slide, idx, opts) => (
                    <SlideScaler width={slideSize.width} height={slideSize.height} marginRate={1}>
                      {slide && !slide.isHidden && (
                        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                          <SlideView
                            html={slide.html} raw={slide.raw} basePath={basePath} pageNumber={slide.pageNumber} className={slide.className} isActive={true} slideSize={slideSize} isEnabledPointerEvents={opts.interactive && mode === 'view'} header={slide.header} footer={slide.footer} drawings={drawings[idx] || []} buildStep={opts.buildStep} onStepAutoAdvance={opts.onStepAutoAdvance} presenting={opts.interactive} slideIndex={idx} moduleRole="owner" onSlideLink={navLink}
                            onAddStroke={opts.interactive ? (stroke) => { addStroke(idx, stroke); send({ type: 'DRAW_STROKE', channelId, pageIndex: idx, stroke }); } : undefined}
                            isInteracting={opts.interactive && mode === 'pen'} toolType={toolType} color={penColor} lineWidth={penWidth} penOnly={stylusOnly}
                            onUpdateStrokes={opts.interactive ? (indices, dx, dy) => handleUpdateStrokes(idx, indices, dx, dy) : undefined}
                          />
                        </div>
                      )}
                    </SlideScaler>
                  )}
                />
              </div>
            </>
          )}
        </div>
      )}

      <MainHeader onResetLayout={() => window.dispatchEvent(new Event(RESET_LAYOUT_EVENT))} isSlideOverview={isSlideOverview} onCloseOverview={() => setIsSlideOverview(false)} />

      {isElectron() && !hasSelectedFolder ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: '#222', color: 'white' }}>
          <Typography variant="h4" gutterBottom>Welcome to MDP</Typography>
          <Typography variant="body1" sx={{ color: '#888', mb: 4 }}>Select a workspace folder to start editing.</Typography>
          <Button variant="contained" size="large" startIcon={<FolderOpenIcon />} onClick={handleOpenFolderWithFlag}>
            Open Folder
          </Button>
        </div>
      ) : isSlideOverview && !isSlideshow ? (
        <SlideOverviewGrid slides={slides} currentSlideIndex={currentSlideIndex} slideSize={slideSize} drawings={drawings} onSelectSlide={selectSlideFromOverview} />
      ) : (
        <DockProvider sidebar={sidebarSlice} preview={previewSlice} editor={editorSlice} snippets={snippetsSlice} images={imagesSlice} headerActions={headerSlice}>
          <div className="content">
            <EditorDock />
          </div>
        </DockProvider>
      )}

      <Dialog open={tabToClose !== null} onClose={() => setTabToClose(null)}>
        <DialogTitle>Unsaved Changes</DialogTitle>
        <DialogContent>
          <Typography>
            "{tabToClose !== null ? tabs[tabToClose]?.path.split('/').pop() : ''}" has unsaved changes. Do you want to save it before closing?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTabToClose(null)}>Cancel</Button>
          <Button onClick={() => handleConfirmCloseTab(false)} color="error">Don't Save</Button>
          <Button onClick={() => handleConfirmCloseTab(true)} variant="contained" color="primary">Save</Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}