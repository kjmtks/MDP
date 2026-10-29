import { FILES_PREFIX } from '../../api/base';
import React, { useState, useCallback, useRef, useMemo, useEffect, useSyncExternalStore } from 'react';
import { Typography, Button, Menu, MenuItem, Divider, Dialog, DialogTitle, DialogContent, DialogActions } from '@mui/material';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';

import { type SnippetsCategory, type ThemeOption, type FileType, getCustomItemStyle } from '../../types';

import { MainHeader } from '../../components/layout/MainHeader';
import { MODULES_DIR, EFFECTS_DIR, IMAGES_DIR, SNIPPETS_DIR, TEMPLATES_DIR, THEMES_DIR, FONTS_DIR } from '../../features/workspace/specialFolders';
import { scopeConfigDirs, collectScopedAssetPaths, lazyScopeDirs } from '../../features/workspace/mdpScope';
import { useEditLock } from '../../features/editor/hooks/useEditLock';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { type MdpContent, type MdpFontDefaults, parseContent, effectiveDisabledModules, effectiveAiNotes, effectiveStyleProfile, effectiveFonts, contentPath } from '../../features/workspace/mdpContent';
import { useWorkspaceFonts } from '../../features/fonts/useWorkspaceFonts';
import { useFontRequirementNotice } from '../../features/fonts/useFontRequirementNotice';
import { McpBridge, validateDeckText } from '../../features/mcp/McpBridge';
import { useAppSettings } from '../../features/settings/AppSettingsContext';
import { matchAction } from '../../features/settings/shortcuts/matcher';
import { ACTIONS_BY_SCOPE } from '../../features/settings/shortcuts/registry';
import { DrawioEditor } from '../../features/drawio/components/DrawioEditor';
import { ConnectDialog } from '../../features/remote/components/ConnectDialog';
import { storedRemoteView, storeRemoteView, type RemoteView } from '../../features/remote/liveRemote';
import { LayoutProbe } from '../../features/remote/LayoutProbe';
import { compareLayouts, type LayoutReport } from '../../features/remote/layoutCheck';
import { getFontState } from '../../features/fonts/fontRuntime';
import { RehearsalDialog } from '../../features/rehearsal/RehearsalDialog';
import {
  readRehearsals, upsertRehearsal, latestRehearsal, measuredTimesOf, narrationSignature, withMeasuredTimes, narrationRun,
  forgetMeasuredTimes, isNarrationRun, type MeasuredTime, type NarrationMeasure, type RehearsalFile, type RehearsalRun,
} from '../../features/rehearsal/rehearsalStore';
import type { DeckTimingInfo } from '../../features/rehearsal/TimeEstimatesPanel';
import { estimateDeckSeconds, formatClock, scriptKey, slideSeconds, slideTimeBasis } from '../../features/slide/talkTime';
import { setOpenDeck } from '../../features/slide/openDeckRuntime';
import { SuggestModuleDialog } from '../../features/modules/components/SuggestModuleDialog';
import { AddToGlossaryDialog } from '../../features/glossary/AddToGlossaryDialog';
import { AutoPlayView } from '../../features/autoplay/AutoPlayView';
import { usePresentingSession } from '../../features/slide/hooks/usePresentingSession';
import { getDeckGlossary, mergeGlossaries, setDeckGlossary, type GlossaryFile } from '../../features/glossary/glossary';
import { VideoExportDialog } from '../../features/video/VideoExportDialog';
import { VideoQueuePanel } from '../../features/video/VideoQueuePanel';
import { enqueueVideo, onVideoJobFinished } from '../../features/video/videoQueue';
import { refreshVideoFeature, subscribeVideoFeature, videoExportSupported, type VideoOptions } from '../../features/video/videoTypes';
import {
  getRecordingState, onRecordingSaved, preferredMic, recordingSupported, startRecording, stopRecording, subscribeRecording,
} from '../../features/recording/slideRecorder';
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
import { apiClient, isElectron, isMcpRenderer } from '../../api/apiClient';
import { clearAllModules, registerModule, getAllModuleSnippets, loadedModules, setDisabledModules } from '../../features/modules/moduleManager';
import { refreshModuleRegions } from '../../features/editor/extensions/ModuleRegionPlugin';
import { ModuleSettingsDialog } from '../../features/modules/components/ModuleSettingsDialog';
import { setWorkspaceSpeechProfiles } from '../../features/tts/speechProfiles';
import { loadedEffects } from '../../features/effects/effectManager';
import type { ModuleParam } from '../../utils/moduleParser';

// Common CSS easings offered in the transition/build settings dialog.
const FX_EASINGS = ['ease', 'linear', 'ease-in', 'ease-out', 'ease-in-out', 'cubic-bezier(0.4, 0, 0.2, 1)'];
import { clearAllEffects, registerEffect, getAllEffectSnippets } from '../../features/effects/effectManager';
import { applyModulesToMarkdown, parseArguments } from '../../features/modules/moduleProcessor';
import { moduleSyncBus } from '../../features/modules/moduleSyncBus';
import { markedPng } from '../../features/review/slideReference';
import type { SlideCopySource } from '../../features/review/useSlideCopyMenu';
import { useDeckReview, type ReviewEdit } from '../../features/review/useDeckReview';
import type { FocusBox } from '../../features/focus/focusTargets';
import { resolveImages, setLibraryImages, parseInFileImageDefs, type ImageEntry } from '../../features/images/imageRegistry';
import { addFileImageDef, editFileImageDef, deleteFileImageDef } from '../../features/images/imageDocEdits';
import { updateModuleTransforms, removeModuleDirectives, parseModuleDirectives, moveModuleDirective, getModuleDirectiveText, pasteModuleDirective, pasteModuleAt } from '../../features/modules/moduleDocEdits';
import { splitMarkdownToBlocks } from '../../features/slide/parser/slideParser';
import type { MotionSpec } from '../../features/slide/parser/SlideContext';
import { useDeckIndexBuilder } from '../../features/search/useDeckIndexBuilder';
import { prewarmSvgs, invalidateSvg } from '../../features/slide/inlineSvg';
import type { ManipRuntime } from '../../features/slide/components/ManipulationLayer';
import { storeLibraryImage, inlineLibraryImage, updateRegistry, deleteLibraryFile, rebaseLibraryValue } from '../../features/images/imageLibraryStore';
import { useBookmarks } from './hooks/useBookmarks';
import { useCatalogSync } from '../../features/catalog/hooks/useCatalogSync';
import { syncOfficialCatalog } from '../../features/catalog/syncService';
import { useSlideRasterizer } from '../../features/remote/capture/useSlideRasterizer';
import { useImageExport } from '../../features/export/useImageExport';
import { usePptxExport } from '../../features/export/usePptxExport';
import { DockProvider } from './dock/DockProvider';
import type { SidebarSharedProps, PreviewSharedProps, SnippetsShared, ImagesShared, HeaderActions, EditorSharedProps } from './dock/DockContext';
import { EditorDock } from './dock/EditorDock';
import { RESET_LAYOUT_EVENT, SHOW_PANEL_EVENT } from './dock/dockShared';
import { BASE_HEIGHT } from '../../constants';
import { sendFocus, useBusFocus } from '../../features/focus/focusBus';
import { cueInForce } from '../../features/focus/focusState';
import { inkLinesOf, insertInkMarker, replaceInkMarker, selectInkMarker } from '../../features/focus/inkDocEdits';
import { undo as editorUndo, redo as editorRedo } from '@codemirror/commands';
import { lineCues } from '../../features/autoplay/autoplay';
import { mdpBus } from '../../features/bus/mdpBus';
import { EDITOR_CHIP_EVENT, setChipFocus, type ChipFocus, type EditorChipDetail } from '../../features/editor/extensions/ScriptChipsPlugin';
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
  // What the presenter's focus chips point at on the slideshow's current slide.
  const showFocus = useBusFocus(currentSlideIndex);
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
    loadFile, handleSave, reloadFileFromDisk, syncTabsWithDisk, rebaseTab, handleOpenFolder, isModified,
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

    // The Configure (.mdp) dialog added or removed a workspace font (which re-reads
    // the font list, and so the @font-face CSS) or a skill: refresh the tree.
    const handleFontsChanged = () => handleManualRefresh();

    window.addEventListener('mdp-sync-start', handleSyncStart);
    window.addEventListener('mdp-sync-end', handleSyncEnd);
    window.addEventListener('mdp-fonts-changed', handleFontsChanged);
    window.addEventListener('mdp-refresh-tree', handleFontsChanged);

    return () => {
      window.removeEventListener('mdp-sync-start', handleSyncStart);
      window.removeEventListener('mdp-sync-end', handleSyncEnd);
      window.removeEventListener('mdp-fonts-changed', handleFontsChanged);
      window.removeEventListener('mdp-refresh-tree', handleFontsChanged);
    };
  }, [handleManualRefresh]);

  const handleManualSync = useCallback(async () => {
    const wantsToSync = await confirmDialog(
      'Download and update to the latest official assets (modules, themes, fonts, templates, snippets) from GitHub?',
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
  // IDENTITY-STABILIZED: tab switches and tree refreshes usually yield the SAME
  // chain; keeping the previous array reference then prevents every scope-keyed
  // effect (snippets, content.json, image registries, themes) from re-fetching and
  // — worse — bumping moduleEpoch, which re-parses the whole deck for nothing.
  const scopeDirsPrevRef = useRef<string[]>([]);
  const scopeDirs = useMemo(() => {
    const next = scopeConfigDirs(fileTree, currentFileName);
    if (next.join('\n') === scopeDirsPrevRef.current.join('\n')) return scopeDirsPrevRef.current;
    scopeDirsPrevRef.current = next;
    return next;
  }, [fileTree, currentFileName]);
  // A deck behind an SSH `.mdplink` lives in a subtree that is listed only as it
  // is expanded — and a tab restored at startup expands nothing. Load exactly the
  // deferred directories its `.mdp` scope needs (see lazyScopeDirs) so the chain
  // above can see them. One request per path at a time; a load clears the node's
  // `lazy` flag (even on failure), so this settles by itself.
  const scopeLoadsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const p of lazyScopeDirs(fileTree, currentFileName)) {
      if (scopeLoadsRef.current.has(p)) continue;
      scopeLoadsRef.current.add(p);
      loadLinkChildren(p).finally(() => scopeLoadsRef.current.delete(p));
    }
  }, [fileTree, currentFileName, loadLinkChildren]);
  // Publish the active deck's `.mdp` scope so the Settings overlay's AI-prompt
  // section (a sibling surface) can build a scope-correct themes list.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useEffect(() => { (window as any).__mdpScopeDirs = scopeDirs; }, [scopeDirs]);

  const modulePathsString = useMemo(
    () => collectScopedAssetPaths(fileTree, scopeDirs, 'modules', '.mdpmod.xml').sort().join(','),
    [fileTree, scopeDirs],
  );
  // The scope's `.mdp` folders behind an SSH link that are not listed yet: until they
  // are, the chain — and the modules it brings — is incomplete.
  const scopePendingDirs = useMemo(() => lazyScopeDirs(fileTree, currentFileName).length, [fileTree, currentFileName]);

  const effectPathsString = useMemo(
    () => collectScopedAssetPaths(fileTree, scopeDirs, 'effects', '.mdpfx.xml').sort().join(','),
    [fileTree, scopeDirs],
  );

  // TTS server profiles (`.mdp/tts-servers/*.json` along the scope chain): what a kind
  // of server takes beyond OpenAI's speech request (tts/speechOptions.ts). They
  // overlay the ones bundled with the app; re-read when one is saved.
  const ttsServerPathsString = useMemo(
    () => collectScopedAssetPaths(fileTree, scopeDirs, 'tts-servers', '.json').join(','),
    [fileTree, scopeDirs],
  );
  const [ttsServersEpoch, setTtsServersEpoch] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const paths = ttsServerPathsString ? ttsServerPathsString.split(',') : [];
    void Promise.all(paths.map((path) => apiClient.readFileText(path).catch(() => ''))).then((texts) => {
      if (!cancelled) setWorkspaceSpeechProfiles(texts.filter(Boolean));
    });
    return () => { cancelled = true; };
  }, [ttsServerPathsString, ttsServersEpoch]);

  // Glossaries (`.mdp/glossary/*.md` along the scope chain): how the narrator reads the
  // field's terms (features/glossary) — read again when one is saved, added or removed
  // (the tree's list of them changes) or an AI wrote one (glossaryChanged).
  const glossaryPathsString = useMemo(
    () => collectScopedAssetPaths(fileTree, scopeDirs, 'glossary', '.md').sort().join(','),
    [fileTree, scopeDirs],
  );
  const [glossaryEpoch, setGlossaryEpoch] = useState(0);
  const [glossaryFiles, setGlossaryFiles] = useState<GlossaryFile[]>([]);
  useEffect(() => {
    let cancelled = false;
    apiClient.getGlossaries(scopeDirs).then((files) => { if (!cancelled) setGlossaryFiles(files || []); })
      .catch(() => { if (!cancelled) setGlossaryFiles([]); });
    return () => { cancelled = true; };
  }, [scopeDirs, glossaryPathsString, glossaryEpoch]);
  useEffect(() => { setDeckGlossary(mergeGlossaries(glossaryFiles)); }, [glossaryFiles]);
  useEffect(() => {
    const onChanged = () => setGlossaryEpoch((e) => e + 1);
    window.addEventListener('mdp-glossary-changed', onChanged);
    return () => window.removeEventListener('mdp-glossary-changed', onChanged);
  }, []);

  // Incremented whenever modules/effects finish (re)loading. Threaded into slide
  // generation so slides parsed before registration are re-parsed once their
  // markdown transforms (and CSS) are available — otherwise they stay raw.
  const [moduleEpoch, setModuleEpoch] = useState(0);
  // Have the workspace's modules and effects finished registering at least once?
  // Only the headless MCP renderer reads it (see McpBridge): a spec / render call
  // that lands mid-load would describe an MDP with no modules. `moduleEpoch` is not
  // the same thing — other async assets bump it too, before modules are in.
  const [assetsReady, setAssetsReady] = useState(false);
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

  // Re-fetch workspace/file snippets (scoped to the active deck's `.mdp` chain),
  // then re-append the active module snippets. Triggered from Settings → Modules →
  // "Reload snippets" via a window event, and whenever the scope changes below.
  const reloadSnippets = useCallback(async () => {
    try {
      const data = await apiClient.getSnipets(scopeDirs);
      setSnipets(data);
    } catch (err) {
      console.error('Failed to reload snippets', err);
    }
    refreshModuleSnippets();
  }, [refreshModuleSnippets, scopeDirs]);

  // Custom snippets follow the active deck's `.mdp` scope (like modules/themes).
  useEffect(() => { void reloadSnippets(); }, [reloadSnippets]);

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
  const [scopeAiNotes, setScopeAiNotes] = useState('');
  const [scopeStyleProfile, setScopeStyleProfile] = useState('');
  // The folder's default fonts (content.json `fonts`, per-field cascade).
  const [scopeFontDefaults, setScopeFontDefaults] = useState<MdpFontDefaults>({});
  const disabledPrevRef = useRef<string>('');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const chain: MdpContent[] = [];
      for (const cdir of scopeDirs) {
        try { chain.push(parseContent(await apiClient.readFileText(contentPath(cdir)))); }
        catch { chain.push({}); }
      }
      if (cancelled) return;
      const disabled = effectiveDisabledModules(chain).sort();
      const aiNotes = effectiveAiNotes(chain);
      const style = effectiveStyleProfile(chain).text;
      const fontDefaults = effectiveFonts(chain);
      // Unchanged content → skip the moduleEpoch bump (it would re-parse the whole
      // deck) — this effect re-runs on every scope/tree change.
      const key = `${disabled.join('\n')} | ${aiNotes} | ${style} | ${JSON.stringify(fontDefaults)}`;
      if (key === disabledPrevRef.current) return;
      disabledPrevRef.current = key;
      setDisabledModules(disabled);
      setScopeAiNotes(aiNotes);
      setScopeStyleProfile(style);
      setScopeFontDefaults((prev) => (JSON.stringify(prev) === JSON.stringify(fontDefaults) ? prev : fontDefaults));
      // Published for the Settings → AI prompt overlay (a separate component) to read.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__mdpScopeAiNotes = aiNotes;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__mdpScopeStyleProfile = style;
      refreshModuleSnippets();
      setModuleEpoch((e) => e + 1);
    })();
    return () => { cancelled = true; };
  }, [scopeDirs, contentEpoch, refreshModuleSnippets]);

  // Workspace fonts (`.mdp/fonts` along the scope chain) + the folder's default
  // fonts → @font-face rules and variables, applied to this document and shared
  // with the capture / presenter / output windows (features/fonts).
  const { fonts: scopeFonts, fontSignature, requirements: fontRequirements, requirementsScope } =
    useWorkspaceFonts(scopeDirs, fileTree, scopeFontDefaults);
  // Fonts the folder declares (`.mdp/fonts/requirements.json`) but this computer
  // lacks: say so once, and offer to download the ones that can be.
  useFontRequirementNotice(fontRequirements, requirementsScope, scopeDirs);
  // Charts and mermaid diagrams bake text into images when a slide is generated —
  // regenerate once the font setup changes so they are drawn with the new fonts.
  const fontSigPrevRef = useRef(fontSignature);
  useEffect(() => {
    if (fontSigPrevRef.current === fontSignature) return;
    fontSigPrevRef.current = fontSignature;
    setModuleEpoch((e) => e + 1);
  }, [fontSignature]);
  // Published for the Settings → AI prompt overlay (a separate component).
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__mdpScopeFonts = { fonts: scopeFonts, defaults: scopeFontDefaults, requirements: fontRequirements };
  }, [scopeFonts, scopeFontDefaults, fontRequirements]);

  // Settings overlay (a separate component) asks the editor to sync the official
  // catalog or reload snippets via window events — the editor owns the file tree
  // and snippet state, so it performs the work and refreshes here.
  useEffect(() => {
    const onReload = () => { void reloadSnippets(); };
    window.addEventListener('mdp-reload-snippets', onReload);
    return () => window.removeEventListener('mdp-reload-snippets', onReload);
  }, [reloadSnippets]);

  const assetsLoadedRef = useRef(false);
  // True from the moment the scope's modules / effects are due to be (re)loaded until
  // they are registered again: in between, clearAllModules() has removed every
  // module's <style> — a PDF printed then lost them (a two-column slide came out as
  // one column, 2026-10-28) — and slides parsed then have raw directives. The MCP
  // tools wait for it (with the scope's deferred folders) before they render or print.
  // Loading = the scope's asset list (or the epoch) differs from the one last loaded —
  // true from the very render it changes — or a load is running.
  const assetsKey = `${modulePathsString}\n${effectPathsString}\n${hasSelectedFolder}\n${assetsEpoch}`;
  const [loadedAssetsKey, setLoadedAssetsKey] = useState<string | null>(null);
  const [assetsLoadRunning, setAssetsLoadRunning] = useState(false);
  const assetsRunRef = useRef(0);
  const modulesLoading = assetsLoadRunning || loadedAssetsKey !== assetsKey;
  useEffect(() => {
    let isCancelled = false;
    const key = assetsKey;

    const loadAllModules = async () => {
      if (isSyncingRef.current) { if (!isCancelled) setLoadedAssetsKey(key); return; }
      const run = ++assetsRunRef.current;
      setAssetsLoadRunning(true);
      try {
        await loadAssetsNow();
      } finally {
        if (assetsRunRef.current === run) setAssetsLoadRunning(false);
      }
    };

    const loadAssetsNow = async () => {
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
        setAssetsReady(true);
        refreshModuleSnippets();
        // Modules + effects are now registered (markdown transforms + CSS ready):
        // force a slide re-parse so anything rendered raw beforehand is fixed.
        setModuleEpoch((e) => e + 1);
        setLoadedAssetsKey(key);
        // …and let the editor add the ⚙ buttons it could not place before.
        window.dispatchEvent(new Event('mdp-modules-registered'));
      }
    };

    const timerId = setTimeout(() => {
      // Load again once the scope has NO asset paths left either (its `.mdp` folders
      // were deleted, or the deck moved out of their reach) — the ones registered
      // before must not stay in use.
      if (modulePathsString !== '' || effectPathsString !== '' || !hasSelectedFolder || assetsLoadedRef.current) {
        assetsLoadedRef.current = true;
        loadAllModules().catch(() => { if (!isCancelled) setLoadedAssetsKey(key); });
      } else {
        setAssetsReady(true);   // nothing to load (a folder with no assets)
        setLoadedAssetsKey(key);
      }
    }, 300);

    return () => {
      isCancelled = true;
      clearTimeout(timerId);
    };
    // assetsKey stands for the paths, the folder and the epoch listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modulePathsString, effectPathsString, hasSelectedFolder, refreshModuleSnippets, assetsEpoch]);
  const assetsPending = modulesLoading || scopePendingDirs > 0;

  // Back to MDP (window focus, the tab visible again): the open text tabs compared with
  // their files on disk. The author changed a deck on another computer (2026-10-29: a
  // footer line) and the tab here — unedited — kept showing the old one, the MCP tools
  // reading it too. A tab without unsaved edits reloads; one with them is kept and the
  // person told once per change (saving then asks what to do).
  useEffect(() => {
    let last = 0;
    let running = false;
    const told = new Map<string, string>();
    const nameOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);
    const check = async () => {
      if (running || Date.now() - last < 2000) return;
      running = true;
      last = Date.now();
      try {
        for (const r of await syncTabsWithDisk()) {
          if (r.state === 'reloaded') notify(`${nameOf(r.path)} changed on disk — reloaded.`, { severity: 'info' });
          else if (r.state === 'changedWhileEdited' && told.get(r.path) !== r.disk) {
            told.set(r.path, r.disk || '');
            reportError(`${nameOf(r.path)} changed on disk while you have unsaved edits here. Your edits are kept; saving will ask whether to overwrite or reload.`, { severity: 'warning' });
          }
        }
      } catch { /* a check that fails is tried again next time */ } finally { running = false; }
    };
    const onVisible = () => { if (!document.hidden) void check(); };
    const onFocus = () => { void check(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onVisible); };
  }, [syncTabsWithDisk]);

  const handleOpenFolderWithFlag = useCallback(async () => {
    await handleOpenFolder();
    setHasSelectedFolder(!!localStorage.getItem('mdp_root_path'));
  }, [handleOpenFolder]);

  const isImageFile = currentFileName?.match(/\.(png|jpe?g|gif|svg|webp)$/i);
  const isPdfFile = currentFileName?.toLowerCase().endsWith('.pdf');
  const isVideoFile = currentFileName?.match(/\.(mp4|m4v|webm|ogv|mov)$/i);
  const isSlideFile = currentFileName?.endsWith('.slide.md');

  let effectiveFileType = currentFileType;
  if (!currentFileName && markdown) {
    effectiveFileType = 'markdown';
  } else if (isImageFile) {
    effectiveFileType = 'image';
  } else if (isPdfFile) {
    effectiveFileType = 'pdf';
  } else if (isVideoFile) {
    effectiveFileType = 'video';
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
  const isPreviewableActive = effectiveFileType === 'image' || effectiveFileType === 'markdown' || effectiveFileType === 'doc' || effectiveFileType === 'pdf' || effectiveFileType === 'video';
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
  } = useDrawio(editorRef, setMarkdown, markdownRef, currentFileName);

  const processedMarkdown = useMemo(() => {
    if (!previewMarkdown) return '';
    // This runs during render, so a throw here would blank the whole editor. Guard
    // it: on any failure fall back to the raw markdown (unexpanded) so the preview
    // still shows the text and the user can fix the offending markup.
    try {
      // Resolve image aliases FIRST: strip `@image` def blocks and expand
      // `![alt](@alias)` references to real urls/data. Done before everything else
      // so modules, builds, marked, print and the remote rasterizer are all
      // alias-aware, and resolved data URIs get the data:→blob: optimization below.
      // Empty-authority form (`mdp-file:///…`) so a managed `.mdp/images/…` path
      // isn't parsed as an invalid dot-leading hostname (→ broken image). See the
      // mdp-file protocol handler.
      const imgPrefix = isElectron() ? 'mdp-file:///' : FILES_PREFIX;
      let md = resolveImages(previewMarkdown, imageLibrary, (p) => `${imgPrefix}${p.replace(/^\//, '')}`).markdown;
      // baseUrl for a module's `resolve(path)` — the previewed deck's folder served via
      // the platform scheme — so a module can turn a deck-relative asset (e.g. a
      // <video> src) into a loadable URL. Mirrors useSlideProcessor's baseUrl. Modules
      // are expanded HERE (upstream), so this is where resolve() must get the baseUrl.
      const mediaPrefix = isElectron() ? 'mdp-file://' : FILES_PREFIX;
      const lastSlash = previewFileName ? previewFileName.lastIndexOf('/') : -1;
      const moduleBaseUrl = (!previewFileName || lastSlash === -1) ? mediaPrefix : `${mediaPrefix}${previewFileName.substring(0, lastSlash)}/`;
      md = applyModulesToMarkdown(md, moduleBaseUrl);
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
    } catch (e) {
      console.error('[MDP] markdown pre-processing failed:', e);
      return previewMarkdown;
    }
    // moduleEpoch: re-run `applyModulesToMarkdown` when a module/effect is
    // (re)registered — e.g. saving a `*.mdpmod.xml` — so the pinned deck reflects
    // the new module <render>/<script> output live, not just its <style>.
  }, [previewMarkdown, imageLibrary, moduleEpoch, previewFileName]);

  // The answers toggle (preview toolbar / Export menu) overrides the deck's
  // `@answers` for the deck it was used on — e.g. hide them to print a handout.
  // Everything built from `slides` follows: preview, slideshow, presenter, PDF,
  // PowerPoint, images, video.
  const [answersToggle, setAnswersToggle] = useState<{ deck: string; mode: 'show' | 'hide' } | null>(null);
  const answersOverride = answersToggle && answersToggle.deck === (previewFileName || '') ? answersToggle.mode : null;

  // The previewed deck's rehearsal history (`.rehearsals.json`): the presenter's
  // "last time" marks, and the narrations measured for the time estimates — each
  // slide whose exact script was measured carries `measuredSec`, which talkTime
  // uses in place of the estimate from the script's length (overview, presenter,
  // rehearsal, video, MCP). `measured` keeps its identity while only rehearsals
  // are added, so the slides do too.
  const [deckTiming, setDeckTiming] = useState<{ deck: string; file: RehearsalFile; sig: string; measured: Map<string, MeasuredTime> } | null>(null);
  const applyTimingFile = useCallback((deck: string, file: RehearsalFile) => {
    const sig = narrationSignature(file);
    setDeckTiming((prev) => ({ deck, file, sig, measured: prev && prev.deck === deck && prev.sig === sig ? prev.measured : measuredTimesOf(file) }));
  }, []);
  useEffect(() => {
    if (!previewFileName || !/\.md$/i.test(previewFileName)) return undefined;
    let cancelled = false;
    void readRehearsals(previewFileName).then((f) => { if (!cancelled) applyTimingFile(previewFileName, f); });
    return () => { cancelled = true; };
  }, [previewFileName, applyTimingFile]);
  const timingFile = deckTiming && deckTiming.deck === previewFileName ? deckTiming.file : null;
  const measuredTimes = useMemo(
    () => (deckTiming && deckTiming.deck === previewFileName ? deckTiming.measured : new Map<string, MeasuredTime>()),
    [deckTiming, previewFileName],
  );

  const { baseUrl, globalContext, slides: parsedSlides, docHtml, slideSize: mdSlideSize, slideStyleVariables, themeCssUrl, slidesSource, slidesEpoch, hasAnswers, deckAnswersHidden, renderWithAnswers } = useSlideProcessor(
    previewFileName, previewFileType, processedMarkdown, lastUpdated, themes, moduleEpoch, previewMarkdown, answersOverride
  );
  const mdSlides = useMemo(() => withMeasuredTimes(parsedSlides, measuredTimes), [parsedSlides, measuredTimes]);
  const answersHidden = !!globalContext.answers?.hide;

  const imageSlides = useMemo(() => {
    if (previewFileType !== 'image' || !previewFileName) return null;
    const src = `${isElectron() ? 'mdp-file:///' : FILES_PREFIX}${previewFileName.split('/').map(encodeURIComponent).join('/')}?t=${lastUpdated}`;
    const html = `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#ffffff;"><img src="${src}" style="max-width:100%;max-height:100%;object-fit:contain;" /></div>`;
    return [{ html, raw: '', isHidden: false, isCover: false, pageNumber: 1, className: '', header: '', footer: '' }];
  }, [previewFileType, previewFileName, lastUpdated]);

  const videoSlides = useMemo(() => {
    if (previewFileType !== 'video' || !previewFileName) return null;
    const src = `${isElectron() ? 'mdp-file:///' : FILES_PREFIX}${previewFileName.split('/').map(encodeURIComponent).join('/')}?t=${lastUpdated}`;
    const html = `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#000;"><video src="${src}" controls playsinline preload="metadata" style="max-width:100%;max-height:100%;object-fit:contain;background:#000;"></video></div>`;
    return [{ html, raw: '', isHidden: false, isCover: false, pageNumber: 1, className: '', header: '', footer: '' }];
  }, [previewFileType, previewFileName, lastUpdated]);

  const slides = imageSlides ?? videoSlides ?? mdSlides;
  // For the Settings overlay (reading-speed calibration reads the open deck's
  // @script). References only — nothing is copied per parse.
  useEffect(() => { setOpenDeck({ fileName: currentFileName || '', slides, index: currentSlideIndex }); },
    [currentFileName, slides, currentSlideIndex]);
  const slideSize = useMemo(
    () => ((imageSlides || videoSlides) ? { width: (BASE_HEIGHT * 16) / 9, height: BASE_HEIGHT } : mdSlideSize),
    [imageSlides, videoSlides, mdSlideSize],
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

  // Load the image-alias library — CASCADING across the active deck's `.mdp` chain
  // (root→nearest): each `<dir>/.mdp/images/registry.json` is merged, NEAREST alias
  // winning. A registry's managed paths (`.mdp/images/<file>`) are rebased to ITS
  // own `.mdp/images/` location so a deeper library's files resolve correctly. The
  // ORIGIN (owning config dir) of each alias is recorded so edits/deletes go back to
  // the registry that defines it (never a merged write — that would cross-pollute).
  // Async like modules → bump moduleEpoch to force a re-parse once ready.
  const imageOriginRef = useRef<Record<string, string>>({});
  const imageMergePrevRef = useRef<string>('');
  const [imagesEpoch, setImagesEpoch] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const map: Record<string, string> = {};
      const desc: Record<string, string> = {};
      const tags: Record<string, string[]> = {};
      const origins: Record<string, string> = {};
      for (const cdir of scopeDirs) { // root→nearest; later overrides (scopeDirs falls back to root `.mdp`)
        try {
          const parsed = JSON.parse(await apiClient.readFileText(`${cdir}/images/registry.json`));
          // Descriptions/tags travel WITH their alias's defining registry — an
          // unpaired Object.assign would let a registry that only carries a stray
          // `descriptions[x]` override an alias it doesn't define.
          for (const [a, v] of Object.entries((parsed && parsed.images) || {})) {
            map[a] = typeof v === 'string' ? rebaseLibraryValue(v, cdir) : (v as string);
            origins[a] = cdir;
            const d = parsed.descriptions && parsed.descriptions[a];
            if (d) desc[a] = d; else delete desc[a];
            const t = parsed.tags && parsed.tags[a];
            if (t && t.length) tags[a] = t; else delete tags[a];
          }
        } catch { /* this `.mdp` has no library */ }
      }
      if (cancelled) return;
      imageOriginRef.current = origins;
      // Unchanged merge result → skip the state updates AND the moduleEpoch bump
      // (which would re-parse every slide). This effect re-runs on every tree
      // refresh / tab switch, almost always with identical registries.
      const key = JSON.stringify([map, desc, tags]);
      if (key === imageMergePrevRef.current) return;
      imageMergePrevRef.current = key;
      setImageLibrary(map);
      setImageLibraryDesc(desc);
      setImageLibraryTags(tags);
      setLibraryImages(map);
      setModuleEpoch((e) => e + 1);
    })();
    return () => { cancelled = true; };
  }, [fileTree, scopeDirs, imagesEpoch]);

  // Where library WRITES for `alias` go: the `.mdp` that already defines it, else
  // the active deck's NEAREST `.mdp`. Returns the merged-view value for a set.
  const scopeDirsRef = useRef(scopeDirs);
  useEffect(() => { scopeDirsRef.current = scopeDirs; }, [scopeDirs]);
  const libraryTargetDir = useCallback((alias: string) => {
    const dirs = scopeDirsRef.current;
    return imageOriginRef.current[alias] || dirs[dirs.length - 1] || '.mdp';
  }, []);
  const upsertLibraryImage = useCallback(async (alias: string, rawValue: string, description?: string, tags?: string[]) => {
    const cdir = libraryTargetDir(alias);
    // The edit dialog hands back the MERGED-VIEW value (e.g. `alice/.mdp/images/f`)
    // on metadata-only edits — LOCALIZE managed values back to the registry form
    // (`/.mdp/images/<f>`) so each registry stays portable with its folder.
    const localized = /(^|\/)\.mdp\/images\//.test(rawValue)
      ? rawValue.replace(/^.*\.mdp\/images\//, '/.mdp/images/')
      : rawValue;
    const stored = await storeLibraryImage(alias, localized, cdir); // '/.mdp/images/<f>' | url | path
    await updateRegistry(cdir, (reg) => {
      reg.images[alias] = stored;
      if (description) reg.descriptions[alias] = description; else delete reg.descriptions[alias];
      if (tags && tags.length) reg.tags[alias] = tags; else delete reg.tags[alias];
    });
    imageOriginRef.current[alias] = cdir;
    setImagesEpoch((e) => e + 1);
    return rebaseLibraryValue(stored, cdir);
  }, [libraryTargetDir]);
  const removeLibraryImage = useCallback(async (alias: string) => {
    const cdir = libraryTargetDir(alias);
    await updateRegistry(cdir, (reg) => {
      delete reg.images[alias];
      delete reg.descriptions[alias];
      delete reg.tags[alias];
    });
    setImagesEpoch((e) => e + 1);
  }, [libraryTargetDir]);

  const {
    isSlideshow, setIsSlideshow, slideshowRef, isSlideOverview, setIsSlideOverview,
    toggleSlideOverview, mode, setMode, showControls, setShowControls, moveSlide, toggleSlideshow,
    step, setStep, cuePos, cueAt, advanceBuild
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

  const { bookmarks, toggleBookmark, isBookmarked, reorderBookmarks, updateBookmark, renameBookmarks, forgetBookmarks } = useBookmarks();
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
        window.dispatchEvent(new Event('mdp-modules-registered'));
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
        // A library registry was saved in the editor (a hand-edit): merge the cascade
        // again (root→nearest, each registry's files rebased to ITS own
        // `.mdp/images/`; the merge re-parses the slides when the result changed).
        // Taking this ONE registry's raw map as the library dropped every other
        // `.mdp`'s aliases and pointed a nested `.mdp`'s files at the ROOT's
        // `.mdp/images/` — a same-named file there, or nothing.
        setImagesEpoch((e) => e + 1);
      } else if (path.includes(`${SNIPPETS_DIR}/`) || path.includes(`${TEMPLATES_DIR}/`) || path.includes(`${THEMES_DIR}/`) || path.includes(`${FONTS_DIR}/`)) {
        scheduleRefresh();
      } else if (/(^|\/)\.mdp\/tts-servers\/[^/]+\.json$/.test(path)) {
        setTtsServersEpoch((e) => e + 1);
      } else if (/(^|\/)\.mdp\/glossary\/[^/]+\.md$/.test(path)) {
        setGlossaryEpoch((e) => e + 1);
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

  // Locate one slide's text span in the editor document (slides split on `---`,
  // fenced code ignored). Shared by the presenter-side note / script write-back.
  const sliceSlideRange = useCallback((pageIndex: number) => {
    const view = editorRef.current?.view;
    if (!view) return null;

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
    return { view, startPos, endPos, slideText: doc.sliceString(startPos, endPos) };
  }, [editorRef]);

  const handleUpdateNote = useCallback((pageIndex: number, newNote: string) => {
    const range = sliceSlideRange(pageIndex);
    if (!range) return;
    const { view, startPos, endPos, slideText } = range;

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
  }, [sliceSlideRange]);

  // Presenter-side edit of the read-aloud `@script`. `scripts` holds one raw text
  // per existing `<!-- @script: … -->` block IN DOCUMENT ORDER, so a slide that
  // interleaves several script blocks with its content keeps that structure: the
  // i-th block is rewritten in place, an emptied one is dropped, and extra entries
  // (a slide that had no script yet) are appended at the end.
  const handleUpdateScript = useCallback((pageIndex: number, scripts: string[]) => {
    const range = sliceSlideRange(pageIndex);
    if (!range) return;
    const { view, startPos, endPos, slideText } = range;

    const open = '<' + '!-- @script:\n';
    const close = '\n--' + '>';
    const block = (body: string) => open + body.trim() + close;

    const scriptRegex = new RegExp('<' + '!--\\s*@script:[\\s\\S]*?--' + '>', 'g');
    let i = 0;
    // A dropped block leaves a sentinel so the blank lines around it collapse
    // back to a single paragraph break instead of a hole in the markdown.
    const GONE = '\u0000';
    let newSlideText = slideText.replace(scriptRegex, (match: string) => {
      const body = scripts[i++];
      if (body === undefined) return match;      // fewer drafts than blocks: keep
      return body.trim() ? block(body) : GONE;   // emptied out: drop the block
    }).replace(new RegExp('\\n*' + GONE + '\\n*', 'g'), '\n\n');
    // Drafts beyond the existing blocks (incl. a first script on a slide that had
    // none) are appended after the slide body.
    const extra = scripts.slice(i).filter((t) => t && t.trim());
    if (extra.length) {
      newSlideText = newSlideText.trimEnd() + '\n\n' + extra.map(block).join('\n\n') + '\n';
    }

    if (newSlideText === slideText) return;
    view.dispatch({ changes: { from: startPos, to: endPos, insert: newSlideText } });
  }, [sliceSlideRange]);

  const { rasterize, host: rasterHost } = useSlideRasterizer();
  const pptxTitle = useMemo(() => {
    const n = currentFileName?.split('/').pop() || 'MDP_Presentation';
    return n.replace(/\.slide\.md$/i, '').replace(/\.md$/i, '') || 'MDP_Presentation';
  }, [currentFileName]);
  const { exportPptx, exporting: pptxExporting } = usePptxExport({
    slides, slideSize, basePath, themeCssUrl, title: pptxTitle, rasterize, onSaved: () => fetchFileTree(),
  });

  const { exportImages, exporting: imageExporting } = useImageExport({
    slides, slideSize, basePath, themeCssUrl, deckPath: currentFileName, rasterize, onSaved: () => fetchFileTree(),
  });

  // Narrated video export: a queued job holds a SNAPSHOT of the open deck (slides,
  // styles, fonts, narrator) taken now, so editing — or queueing the next deck —
  // can go on while it renders. The file lands beside the deck.
  const [videoDialogOpen, setVideoDialogOpen] = useState(false);
  // The web build asks the server whether this user may (the administrator's
  // switch, which can change at any time — asked again whenever the tab regains focus).
  const videoAllowed = useSyncExternalStore(subscribeVideoFeature, videoExportSupported);
  useEffect(() => {
    if (isElectron()) return undefined;
    const ask = () => { void refreshVideoFeature(); };
    ask();
    window.addEventListener('focus', ask);
    return () => window.removeEventListener('focus', ask);
  }, []);
  const canExportVideo = videoAllowed && !!currentFileName?.endsWith('.slide.md') && mdSlides.length > 0;
  const queueVideo = useCallback((options: VideoOptions, tabStream?: MediaStream, output?: string): string | null => {
    if (!currentFileName) return null;
    const id = enqueueVideo({
      deckPath: currentFileName,
      output,
      slides: mdSlides.map((s, i) => {
        const d = s as { html?: string; raw?: string; stepCount?: number; isHidden?: boolean; className?: string; header?: string; footer?: string; pageNumber?: number; transition?: MotionSpec };
        return {
          html: d.html || '', raw: d.raw || '', stepCount: d.stepCount || 0, isHidden: !!d.isHidden,
          className: d.className, header: d.header, footer: d.footer, pageNumber: d.pageNumber ?? i + 1,
          transition: d.transition?.name, motion: d.transition,
          // Its time estimate now — what a measurement of the video is compared with.
          plannedSec: slideSeconds(s, appSettings.readingCharsPerMin || 320),
        };
      }),
      globalTransition: (globalContext as { transition?: MotionSpec } | undefined)?.transition?.name,
      globalMotion: (globalContext as { transition?: MotionSpec } | undefined)?.transition,
      slideSize: mdSlideSize,
      basePath,
      themeCssUrl,
      moduleCss: Object.values(loadedModules).map((m) => m.style).filter(Boolean).join('\n'),
      // The exact mode runs the modules' scripts and plays the effects in its own window.
      modules: Object.values(loadedModules),
      effects: Object.values(loadedEffects),
      fontCss: getFontState().css,
      tts: { ...appSettings.tts },
      cpm: appSettings.readingCharsPerMin || 320,
      // The deck's glossary as it is now — the job may run after another deck opens.
      glossary: getDeckGlossary(),
      options,
      tabStream,
    });
    setVideoDialogOpen(false);
    return id;
  }, [currentFileName, mdSlides, globalContext, mdSlideSize, basePath, themeCssUrl, appSettings.tts, appSettings.readingCharsPerMin]);
  // A finished video shows up in the file tree at once; what it measured (with
  // "Update the time estimates") goes into its deck's time estimates.
  const saveNarrationRef = useRef<((deckPath: string, m: NarrationMeasure) => Promise<string>) | null>(null);
  useEffect(() => {
    onVideoJobFinished((job) => {
      if (job.status !== 'done') return;
      fetchFileTree();
      if (job.result?.measure) void saveNarrationRef.current?.(job.deckPath, job.result.measure);
    });
    return () => onVideoJobFinished(null);
  }, [fetchFileTree]);

  const [remoteActive, setRemoteActive] = useState(false);
  const [remotePort, setRemotePort] = useState<number | null>(null);
  const [remoteIps, setRemoteIps] = useState<{ name: string; address: string }[]>([]);
  // What remote devices show (Connect dialog, remembered per computer): pictures of
  // the slides, or the live deck (the files it needs are granted to the devices of
  // this presentation — liveRemote.ts / app/remoteFiles.cjs).
  const [remoteView, setRemoteView] = useState<RemoteView>(() => storedRemoteView());
  const changeRemoteView = useCallback((v: RemoteView) => { setRemoteView(v); storeRemoteView(v); }, []);
  // A live remote asked whether it breaks the lines where this computer does: the
  // deck is measured here the same way (LayoutProbe) and the answer goes back.
  const [layoutJob, setLayoutJob] = useState<LayoutReport | null>(null);

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

  // Rehearsal history of the PREVIEWED deck (the one the presenter mirrors; loaded
  // with the slides above): the latest rehearsal is shipped to the presenter for
  // "last time" marks, and runs the presenter measures come back through
  // `handleRehearsalRun` to be persisted in the deck's `.rehearsals.json` sidecar
  // (see features/rehearsal/rehearsalStore).
  const lastRehearsal = useMemo(() => latestRehearsal(timingFile), [timingFile]);
  const handleRehearsalRun = useCallback(async (run: RehearsalRun) => {
    if (!previewFileName || !/\.md$/i.test(previewFileName)) return;
    try {
      const file = await upsertRehearsal(previewFileName, run);
      applyTimingFile(previewFileName, file);
      const n = file.runs.findIndex((r) => r.id === run.id) + 1;
      notify(`Rehearsal #${n} saved: ${formatClock(Math.round(run.totalSec))} spoken vs ${formatClock(Math.round(run.plannedTotalSec))} planned` +
        (run.complete ? '' : ` (stopped at slide ${run.lastSlide}/${run.slideCount})`), { title: 'Rehearsal' });
    } catch (e) {
      reportError('Failed to save the rehearsal run.', { detail: e });
    }
  }, [previewFileName, applyTimingFile]);

  // A narration measured for the time estimates (the auto-play, or a video job,
  // with "Update the time estimates") → a run in the deck's rehearsal history,
  // whose times the deck's slides then take. Returns what it did, for the auto-play.
  const readingCpm = appSettings.readingCharsPerMin || 320;
  const saveNarration = useCallback(async (deckPath: string, m: NarrationMeasure): Promise<string> => {
    const from = m.source === 'video' ? 'video' : 'narration';
    if (!m.slides.length) {
      const why = `Nothing measured from the ${from}: no slide with a script was played through.`;
      notify(why, { title: 'Time estimates' });
      return why;
    }
    try {
      const run = narrationRun(m, m.slideCount ?? 0, readingCpm);
      const file = await upsertRehearsal(deckPath, run);
      if (deckPath === previewFileName) applyTimingFile(deckPath, file);
      const n = run.slides.length;
      const msg = `Time estimates updated from the ${from}: ${n} slide${n === 1 ? '' : 's'}, ${formatClock(run.totalSec)} (estimated ${formatClock(run.plannedTotalSec)} before)`;
      notify(`${msg}.`, { title: 'Time estimates' });
      return msg;
    } catch (e) {
      reportError('Failed to save the measured times.', { detail: e });
      return 'The measured times could not be saved.';
    }
  }, [previewFileName, applyTimingFile, readingCpm]);
  useEffect(() => { saveNarrationRef.current = saveNarration; }, [saveNarration]);
  const forgetTimes = useCallback(async () => {
    if (!previewFileName) return;
    try { applyTimingFile(previewFileName, await forgetMeasuredTimes(previewFileName)); }
    catch (e) { reportError('Failed to forget the measured times.', { detail: e }); }
  }, [previewFileName, applyTimingFile]);

  // Recording the live presentation (the audience window + microphone → a video
  // beside the deck). REC in the slideshow controls, or from the presenter view.
  const recState = useSyncExternalStore(subscribeRecording, getRecordingState);
  const canRecord = recordingSupported() && !!currentFileName?.endsWith('.slide.md');
  const recordCommand = useCallback((action: 'start' | 'stop', micId?: string) => {
    if (action === 'stop') { void stopRecording(); return; }
    if (currentFileName) void startRecording(currentFileName, micId ?? preferredMic(), isSlideshow);
  }, [currentFileName, isSlideshow]);
  // A recording of this window ends with its slideshow — it would go on to film the editor.
  useEffect(() => {
    if (!isSlideshow && recState.status === 'recording' && recState.source === 'main') void stopRecording();
  }, [isSlideshow, recState.status, recState.source]);

  // The previewed deck's review: its findings, snapshots and flow, read again when
  // an MCP tool writes them. The flow's steps go to the presenter view too.
  // the previewed deck's .mdp chain (its personas and skills: the Review panel's "AI
  // review" box) — the open file's when it is the one previewed; a string key keeps
  // the array the same while the chain is
  const previewScopeKey = useMemo(() => (previewFileName && previewFileName !== currentFileName ? scopeConfigDirs(fileTree, previewFileName).join('\n') : ''), [fileTree, previewFileName, currentFileName]);
  const reviewScope = useMemo(() => (previewScopeKey ? previewScopeKey.split('\n') : scopeDirs), [previewScopeKey, scopeDirs]);
  const review = useDeckReview(previewFileType === 'markdown' ? previewFileName : null, slides, reviewScope);
  const flowSteps = review?.flow?.parsed.steps ?? null;
  const { channelId, token, send, imagePrep } = usePresentationSync(
    syncSlides, currentSlideIndex, slideSize, globalContext, baseUrl, themeCssUrl, lastUpdated, drawings,
    moveSlide, addStroke, clear, undo, redo, handleAddBlankSlide, updateStrokes, handleUpdateNote,
    remotePort, rasterize, remoteActive, basePath, isSlideOverview, toggleSlideOverview, selectSlideFromOverview,
    step, navLink, navBack, navForward, handleUpdateScript, handleRehearsalRun, lastRehearsal, recordCommand,
    remoteView, setLayoutJob, cuePos, cueAt, flowSteps,
  );
  // The presenter view shows the recorder's state (REC / elapsed time).
  useEffect(() => { send({ type: 'REC_STATE', state: recState, channelId }); }, [recState, send, channelId]);
  useEffect(() => { if (recState.error) reportError(recState.error, { title: 'Recording' }); }, [recState.error]);
  useEffect(() => {
    onRecordingSaved((path) => {
      fetchFileTree();
      notify(`Saved beside the deck: ${path.split('/').pop()}`, { title: 'Recording' });
    });
    return () => onRecordingSaved(null);
  }, [fetchFileTree]);

  const handleUpdateStrokes = useCallback((pageIndex: number, indices: number[], dx: number, dy: number) => {
    if (updateStrokes) updateStrokes(pageIndex, indices, dx, dy);
    if (channelId) send({ type: 'UPDATE_STROKES', pageIndex, indices, dx, dy, channelId });
  }, [updateStrokes, channelId, send]);

  // Open a `.drawio.svg` FILE in the draw.io editor. Defaults to the active tab
  // (toolbar "Edit Diagram" button — which passes a click event, hence the type
  // guard); the file tree passes an explicit path so a diagram can be edited
  // without first opening it as an image preview.
  const handleEditDirectDrawio = useCallback(async (pathArg?: unknown) => {
    const target = typeof pathArg === 'string' ? pathArg : currentFileName;
    if (!target) return;
    try {
      const text = await apiClient.readFileText(target);
      const bytes = new TextEncoder().encode(text);
      const binString = Array.from(bytes, (byte) => String.fromCodePoint(byte)).join("");
      const base64 = btoa(binString);

      setDirectDrawio({ path: target, content: base64 });
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
      // Decks that inline this SVG re-fetch it (the inline cache is keyed by
      // workspace path), so the preview shows the edited diagram at once.
      invalidateSvg(directDrawio.path);
      handleManualRefresh();
      // Refresh an image-preview tab of the file when one is open; a diagram
      // edited straight from the file tree does not get a tab forced open.
      if (tabs.some((t) => t.path === directDrawio.path)) loadFile(directDrawio.path, true);
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
    // Strip BOTH the hash and the query (`?file=…` deep link): the presenter gets
    // its content over the sync channel, and a file:// URL that keeps a query
    // string fails to load on Windows (ERR_FILE_NOT_FOUND) — so the popup must
    // open the bare index.html.
    const baseUrl = window.location.href.split('#')[0].split('?')[0];
    // A talk given from the presenter view starts here: every module at its
    // initial state (as when the slideshow starts).
    moduleSyncBus.resetAll();
    window.open(`${baseUrl}#/presenter?channel=${channelId}&token=${encodeURIComponent(token)}`, '_blank', 'width=1000,height=800');
  }, [channelId, token]);

  // The audience-facing OUTPUT WINDOW: slide only, no chrome, locked to the deck's
  // aspect ratio. Made for a single display — share/capture just this window (or a
  // screen region sized to it) and keep the presenter tool beside it, outside the
  // shared area. Opened at half the deck's pixel size, which fits any laptop.
  const openOutputWindow = useCallback(() => {
    const baseUrl = window.location.href.split('#')[0].split('?')[0];
    const w = Math.max(480, Math.round((slideSize.width || 1280) / 2));
    const h = Math.round(w * (slideSize.height || 720) / (slideSize.width || 1280));
    moduleSyncBus.resetAll();   // a show starts: every module at its initial state
    window.open(
      `${baseUrl}#/output?channel=${channelId}&token=${encodeURIComponent(token)}`,
      'mdp-output',
      `width=${w},height=${h}`,
    );
  }, [channelId, token, slideSize.width, slideSize.height]);

  const [rehearseOpen, setRehearseOpen] = useState(false);
  const [autoPlayOpen, setAutoPlayOpen] = useState(false);
  // A show in this window — the slideshow or the narrated auto-play: the screen
  // stays on, and the notifications wait until it ends.
  usePresentingSession(isSlideshow || autoPlayOpen, 'show', true);
  // The auto-play's slides: hidden ones are not played, as in the slideshow (the
  // numbers stay the deck's); each knows its place in the deck and its time estimate
  // now, for a measurement of the narration.
  const autoPlaySlides = useMemo(() => mdSlides.flatMap((s, i) => {
    const d = s as { html?: string; raw?: string; className?: string; header?: string; footer?: string; stepCount?: number; isHidden?: boolean; pageNumber?: number; transition?: MotionSpec };
    return d.isHidden ? [] : [{
      html: d.html || '', raw: d.raw || '', className: d.className, header: d.header, footer: d.footer,
      stepCount: d.stepCount || 0, pageNumber: d.pageNumber ?? i + 1, transition: d.transition,
      deckIndex: i, plannedSec: slideSeconds(s, readingCpm),
    }];
  }), [mdSlides, readingCpm]);
  // Where the deck's time estimates stand — the Timing tab of the auto-play and of
  // the video dialog; worked out only while one of them is open.
  const timingInfo = useMemo<DeckTimingInfo | null>(() => {
    if (!autoPlayOpen && !videoDialogOpen) return null;
    let scripted = 0;
    let measured = 0;
    for (const s of mdSlides as { raw?: string; isHidden?: boolean; measuredSec?: number }[]) {
      // A shown slide with a script (markers alone count: a timer is an activity), and no @time.
      if (s.isHidden || !scriptKey(s.raw || '')) continue;
      const basis = slideTimeBasis(s.raw || '', s.measuredSec);
      if (basis === 'time') continue;
      scripted++;
      if (basis === 'measured') measured++;
    }
    const last = (timingFile?.runs || [])
      .filter((r) => isNarrationRun(r) && (r.slides || []).some((x) => x && x.key))
      .sort((a, b) => String(b.endedAt || '').localeCompare(String(a.endedAt || '')))[0];
    return {
      estimateSec: estimateDeckSeconds(mdSlides, readingCpm), scripted, measured,
      ...(last ? { lastAt: last.endedAt, lastNarrator: last.narrator } : {}),
    };
  }, [autoPlayOpen, videoDialogOpen, mdSlides, readingCpm, timingFile]);
  // A piece of the open document replaced (the glossary's dialog removes a ruby it
  // took the term from) — only while it still reads `expect` there; one undoable edit.
  const replaceInEditor = useCallback((from: number, to: number, expect: string, text: string): boolean => {
    const view = editorRef.current?.view;
    if (!view || to > view.state.doc.length || view.state.sliceDoc(from, to) !== expect) return false;
    view.dispatch({ changes: { from, to, insert: text }, userEvent: 'input' });
    return true;
  }, [editorRef]);

  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestText, setSuggestText] = useState('');
  const openSuggestModule = useCallback(() => {
    // Analyze the editor selection, else the current slide's markdown.
    let text = '';
    const view = editorRef.current?.view;
    if (view) { const sel = view.state.selection.main; if (!sel.empty) text = view.state.sliceDoc(sel.from, sel.to); }
    if (!text) text = (mdSlides[currentSlideIndex] as { raw?: string })?.raw || '';
    setSuggestText(text);
    setSuggestOpen(true);
  }, [editorRef, mdSlides, currentSlideIndex]);

  // User-facing deck "Check": run the SAME deterministic validation the MCP lint uses
  // (unknown/disabled modules, unknown themes/effects, missing params, and unbalanced
  // `<!-- @end -->` regions — the mistakes that otherwise break a slide silently) and
  // surface the findings as a notification. Editor-only; nothing is changed.
  const runDeckCheck = useCallback(() => {
    const text = editorRef.current?.view?.state.doc.toString() ?? previewMarkdown ?? '';
    const { errors, warnings } = validateDeckText(text, themes, imageLibrary);
    if (!errors.length && !warnings.length) {
      notify('No problems found in this deck.', { title: 'Deck check', severity: 'success' });
      return;
    }
    const detail = [...errors.map((e) => `❌ ${e}`), ...warnings.map((w) => `⚠️ ${w}`)].join('\n\n');
    reportError(
      `${errors.length} error${errors.length === 1 ? '' : 's'}, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}.`,
      { title: 'Deck check', severity: errors.length ? 'error' : 'warning', detail },
    );
  }, [editorRef, previewMarkdown, themes, imageLibrary]);

  // The editor-panel toolbar triggers these via window events (keeps that panel
  // decoupled from EditorPage's callbacks).
  useEffect(() => {
    const onSuggest = () => openSuggestModule();
    const onCheck = () => runDeckCheck();
    window.addEventListener('mdp-suggest-module', onSuggest);
    window.addEventListener('mdp-check-deck', onCheck);
    return () => {
      window.removeEventListener('mdp-suggest-module', onSuggest);
      window.removeEventListener('mdp-check-deck', onCheck);
    };
  }, [openSuggestModule, runDeckCheck]);

  const handleSwitchToRemote = useCallback(() => {
    const baseUrl = window.location.href.split('#')[0];
    window.location.href = `${baseUrl}#/remote`;
  }, []);

  // Warm the inline-SVG cache when remote broadcasting starts so rasterized
  // slides (including never-previewed ones) have their drawio diagrams ready.
  useEffect(() => {
    if (remoteActive) void prewarmSvgs(slides.map((s) => (s as { html?: string }).html || ''), basePath);
  }, [remoteActive, slides, basePath]);

  const handlePrint = useCallback(async (to?: unknown) => {
    // `to` (MCP export_pdf): a workspace path to print into, without the dialog. A
    // click handler passes its event here — anything but a string means the dialog.
    const target = typeof to === 'string' ? to : '';
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

    // The paper size is PrintContainer's @page alone (the slide's box). A `size`
    // here would win with !important, and the slides would run across the pages.
    const dynamicPrintStyle = document.createElement('style');
    dynamicPrintStyle.id = 'dynamic-print-size';
    dynamicPrintStyle.innerHTML = `
      @media print {
        @page {
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
      if (target) {
        await apiClient.exportPdfTo(target);
      } else if (isElectron()) {
        await apiClient.exportPdf(safeTitle);
      } else {
        window.print();
      }
    } finally {
      // The MCP print is finished when the file is written.
      if (target) cleanup();
      // Always restore — even if export throws — so the off-screen print
      // container never stays mounted (a stuck giant blank area).
      setTimeout(cleanup, 1500);
      // Hard safety net in case the timer is ever lost.
      setTimeout(cleanup, 8000);
    }
  }, [currentFileName, appSettings.pdfNameSource, globalContext, slides, basePath]);

  const handleFileSelect = useCallback((path: string, isBinary?: boolean) => {
    const url = new URL(window.location.href);
    if (url.searchParams.has('url')) {
      url.searchParams.delete('url');
      window.history.replaceState({}, '', url.toString() || window.location.pathname);
    }
    // A draw.io diagram is a thing you EDIT, not a picture to look at: selecting
    // one opens it in the draw.io editor (saving writes the .drawio.svg back and
    // refreshes any deck that embeds it) instead of an image-preview tab.
    if (/\.drawio\.svg$/i.test(path)) { void handleEditDirectDrawio(path); return; }
    loadFile(path, isBinary);
  }, [loadFile, handleEditDirectDrawio]);

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
      // One line, never closing the comment; a value with `,` or `"` (a voice
      // description, a caption…) is quoted, with `\` and `"` escaped as
      // parseArguments reads them back.
      const argValue = (raw: string) => {
        const v = String(raw).replace(/\s*[\r\n]+\s*/g, ' ').replace(/-->/g, '->');
        return /[,"]/.test(v) ? `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : v;
      };
      const kv = (obj: Record<string, string>) => Object.entries(obj)
        .map(([k, v]) => `${k}: ${argValue(v)}`).join(', ');
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
    // Ink (the slide script's [[ink: …]]), reshaped on the preview: its marker
    // rewritten — or taken out — in one transaction; picked → the caret on it.
    onInkChange: (slide, nth, text) => {
      const view = editorRef.current?.view;
      if (!view || !replaceInkMarker(view, slide, nth, text)) return;
      flushManipPreview();
    },
    onInkSelect: (slide, nth) => {
      const view = editorRef.current?.view;
      if (view) selectInkMarker(view, slide, nth);
    },
    onInkUndo: (again) => {
      const view = editorRef.current?.view;
      if (!view) return;
      (again ? editorRedo : editorUndo)(view);
      flushManipPreview();
    },
    // A new ink drawn on the preview: the slide's narration lines (the one the caret is
    // in offered first), then its marker written right before the line picked.
    onInkLines: (slide) => {
      const view = editorRef.current?.view;
      return view ? inkLinesOf(view, slide) : null;
    },
    onInkCreate: (slide, line, text) => {
      const view = editorRef.current?.view;
      if (!view) return null;
      const nth = insertInkMarker(view, slide, line, text);
      flushManipPreview();
      return nth;
    },
  }), [editLayout, canEditLayout, snapOn, snapStep, editorRef, flushManipPreview]);

  // A file or a folder renamed / moved (its new path) or deleted in the file tree:
  // the open tabs and the bookmarks follow (also those inside a folder).
  const onPathRenamed = useCallback((oldPath: string, newPath: string) => {
    renameTab(oldPath, newPath);
    renameBookmarks(oldPath, newPath);
  }, [renameTab, renameBookmarks]);
  const onPathsDeleted = useCallback((paths: string[]) => {
    closeTabsByPaths(paths);
    forgetBookmarks(paths);
  }, [closeTabsByPaths, forgetBookmarks]);

  const sidebarSlice = useMemo<SidebarSharedProps>(() => ({
    currentFileName, currentFileType: previewFileType, slides, currentSlideIndex, slideSize,
    drawings, fileTree, lastUpdated, onSlideSelect: setCurrentSlideIndex, onFileSelect: handleFileSelect,
    onManualRefresh: handleManualRefresh, onLoadLinkChildren: loadLinkChildren, onNav: moveSlide, handleOpenFolder,
    bookmarks, isBookmarked, onToggleBookmark: toggleBookmark,
    onReorderBookmark: reorderBookmarks, onUpdateBookmark: updateBookmark,
    onRenameFile: onPathRenamed, onDeleteFiles: onPathsDeleted,
    onOpenDeck: handleOpenDeck,
  }), [currentFileName, previewFileType, slides, currentSlideIndex, slideSize, drawings, fileTree, lastUpdated,
    setCurrentSlideIndex, handleFileSelect, handleManualRefresh, loadLinkChildren, moveSlide, handleOpenFolder,
    bookmarks, isBookmarked, toggleBookmark, reorderBookmarks, updateBookmark, onPathRenamed, onPathsDeleted,
    handleOpenDeck]);

  // Chips in the editor's script (ScriptChipsPlugin), as in the presenter's script
  // pane: a focus cue is shown on its slide — the preview, the slideshow, the
  // presenter, the output window —, a lit chip clicked again takes it away; an event
  // marker fires its event on the app bus. The preview goes to that slide first, and
  // what is sent waits until it is shown there (the focus listens per slide; a module
  // must be mounted to answer an event).
  const chipStateRef = useRef({ slide: currentSlideIndex, focus: showFocus, deck: currentFileName === previewFileName, count: slides.length });
  useEffect(() => {
    chipStateRef.current = { slide: currentSlideIndex, focus: showFocus, deck: currentFileName === previewFileName, count: slides.length };
  }, [currentSlideIndex, showFocus, currentFileName, previewFileName, slides.length]);
  useEffect(() => {
    const onChip = (e: Event) => {
      const d = (e as CustomEvent<EditorChipDetail>).detail;
      const st = chipStateRef.current;
      if (!d || !st.deck || d.slide < 0 || d.slide >= st.count) return;
      const moved = d.slide !== st.slide;
      if (moved) setCurrentSlideIndex(d.slide);
      const act = () => {
        if (d.kind === 'focus') {
          const shown = moved ? null : st.focus;
          if (shown && cueInForce(shown, d.cue)) sendFocus({ slide: d.slide, remove: d.cue });
          else sendFocus({ slide: d.slide, cues: lineCues([d.cue]) });
        } else {
          mdpBus.emit(d.topic, { args: d.args });
        }
      };
      if (moved) window.setTimeout(act, d.kind === 'emit' ? 400 : 150);
      else act();
    };
    document.addEventListener(EDITOR_CHIP_EVENT, onChip);
    return () => document.removeEventListener(EDITOR_CHIP_EVENT, onChip);
  }, []);
  // Light the editor's chips of what is shown (only when that changes — rebuilding
  // the chips scans the document).
  const litRef = useRef<ChipFocus | null>(null);
  useEffect(() => {
    const view = editorRef.current?.view;
    const lit = currentFileName === previewFileName && showFocus ? { slide: currentSlideIndex, focus: showFocus } : null;
    if (!view || (!lit && !litRef.current)) return;
    litRef.current = lit;
    view.dispatch({ effects: setChipFocus.of(lit) });
  }, [showFocus, currentSlideIndex, currentFileName, previewFileName, editorRef]);

  // The preview's "Copy image": the slide as the MCP renders it (every build shown),
  // the long side up to 1280 px, the places pointed at framed in red.
  const slideCopyImage = useCallback(async (index: number, boxes: FocusBox[]) => {
    const slide = slides[index];
    if (!slide) throw new Error('No such slide.');
    const scale = Math.min(1.5, 1280 / Math.max(slideSize.width, slideSize.height));
    const { dataUrl } = await rasterize(slide, { width: slideSize.width, height: slideSize.height, scale, basePath, themeCssUrl });
    return markedPng(dataUrl, slideSize.width, boxes);
  }, [slides, slideSize, basePath, themeCssUrl, rasterize]);
  const copySlide = useMemo<SlideCopySource | undefined>(() => (previewFileType === 'markdown' && previewFileName
    ? { deckPath: previewFileName, slides, image: slideCopyImage } : undefined), [previewFileType, previewFileName, slides, slideCopyImage]);
  // The Review panel's edits — through the editor (one undoable change), only when
  // the previewed deck is the open tab.
  const reviewEdit = useMemo<ReviewEdit>(() => ({
    deckText: () => {
      if (!previewFileName || previewFileName !== currentFileName) return null;
      const view = editorRef.current?.view;
      return view ? view.state.doc.toString() : null;
    },
    putBack: (c) => {
      const view = editorRef.current?.view;
      if (!view || !previewFileName || previewFileName !== currentFileName) return;
      const doc = view.state.doc;
      const blocks = splitMarkdownToBlocks(doc.toString());
      const line = (n: number) => doc.line(Math.min(Math.max(1, n), doc.lines));
      let change: { from: number; to: number; insert: string } | null = null;
      if (c.status === 'changed' && c.slide && blocks[c.slide]) {
        const b = blocks[c.slide];
        const from = b.startLine <= doc.lines ? line(b.startLine).from : doc.length;
        change = { from, to: b.startLine <= b.endLine ? line(b.endLine).to : from, insert: c.before };
      } else if (c.status === 'added' && c.slide && blocks[c.slide]) {
        // its `---` line and its lines (from the end of the line before the `---`)
        const b = blocks[c.slide];
        const sep = b.startLine - 1;
        change = { from: sep >= 2 ? line(sep - 1).to : 0, to: b.startLine <= b.endLine ? line(b.endLine).to : line(sep).to, insert: '' };
      } else if (c.status === 'removed' && c.oldSlide) {
        const b = blocks[c.oldSlide];
        change = b && b.startLine <= doc.lines
          ? { from: line(b.startLine).from, to: line(b.startLine).from, insert: `${c.before}\n---\n` }
          : { from: doc.length, to: doc.length, insert: `\n---\n${c.before}` };
      }
      if (change) view.dispatch({ changes: change });
    },
    openFile: (path) => handleFileSelect(path),
  }), [previewFileName, currentFileName, editorRef, handleFileSelect]);
  const previewSlice = useMemo<PreviewSharedProps>(() => ({
    effectiveFileType: previewFileType, slides, currentSlideIndex, slideSize, basePath, drawings,
    focus: showFocus,
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
    copySlide,
    review, reviewEdit, gotoSlide: setCurrentSlideIndex,
  }), [previewFileType, slides, currentSlideIndex, slideSize, basePath, drawings, mode, setMode,
    showControls, moveSlide, handleAddBlankSlide, clear, send, channelId, toolType, setToolType,
    penColor, setPenColor, penWidth, setPenWidth, canUndo, canRedo, undo, redo, stylusOnly,
    setStylusOnly, addStroke, handleUpdateStrokes, isSlideshow, onEditDrawio, previewImage,
    manipulate, editLayout, canEditLayout, snapOn, livePreview, previewStale,
    currentFileName, effectiveFileType, markdownRef, reloadSlides,
    docHtml, previewFileName, lastUpdated, showFocus,
    navLink, navBack, navForward, navCanBack, navCanForward, copySlide, review, reviewEdit, setCurrentSlideIndex]);

  const snippetsSlice = useMemo<SnippetsShared>(() => ({
    snippets: snipets, onInsertText: handleInsertText,
  }), [snipets, handleInsertText]);

  // --- Image-alias panel ---
  const [imageFocusAlias, setImageFocusAlias] = useState<string | null>(null);
  // A request to open the edit dialog for an alias (from the editor's @image
  // [edit] widget). A fresh object each click; cleared once the panel handles it.
  const [imageEditRequest, setImageEditRequest] = useState<{ alias: string; nth?: number } | null>(null);

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
  // `nth`, `description`, `tags`: the file definition being edited (its words are kept).
  const [drawioImageEdit, setDrawioImageEdit] = useState<{ alias: string; scope: 'file' | 'library'; base64Xml: string; nth?: number; description?: string; tags?: string[] } | null>(null);
  // Creating/editing a drawio diagram from the Images panel's Add/Edit dialog.
  // `initial` is the existing SVG (data URI) to load, or '' for a blank diagram.
  const [drawioForAdd, setDrawioForAdd] = useState<{ initial: string } | null>(null);

  const handleEditImageDrawio = useCallback(async (entry: ImageEntry) => {
    try {
      const svg = entry.value.startsWith('data:') ? entry.value : await inlineLibraryImage(entry.value);
      setDrawioImageEdit({ alias: entry.alias, scope: entry.scope, base64Xml: svg, nth: entry.nth, description: entry.description, tags: entry.tags });
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
        const v = editorRef.current?.view; if (v) editFileImageDef(v, cur.alias, dataUri, cur.description, cur.tags, cur.nth);
      } else {
        const rebased = await upsertLibraryImage(cur.alias, dataUri, imageLibraryDescRef.current[cur.alias], imageLibraryTagsRef.current[cur.alias]);
        commitLibrary({ ...imageLibraryRef.current, [cur.alias]: rebased }, imageLibraryDescRef.current, imageLibraryTagsRef.current);
      }
    } catch (e) {
      reportError('Failed to save the diagram.', { detail: e });
    }
  }, [drawioImageEdit, commitLibrary, editorRef, upsertLibraryImage]);

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
      const nth = Number((e as CustomEvent).detail?.nth) || 0;
      setImageFocusAlias(alias);
      // Request the panel open the edit dialog for this alias (handled on mount,
      // so it works even when the panel was closed). New object → re-clickable.
      if (alias) setImageEditRequest({ alias, nth });
      window.dispatchEvent(new CustomEvent(SHOW_PANEL_EVENT, { detail: { id: 'images' } }));
    };
    document.addEventListener('open-image-manager', handler);
    return () => document.removeEventListener('open-image-manager', handler);
  }, []);

  const imagesSlice = useMemo<ImagesShared>(() => {
    // Use the debounced doc: the Images panel's in-file list doesn't need to
    // re-parse `@image` defs (a whole-doc regex) on every keystroke.
    const nthOf = new Map<string, number>();
    const fileImages: ImageEntry[] = parseInFileImageDefs(debouncedMarkdown).ranges.map((r) => {
      const nth = nthOf.get(r.alias) ?? 0;
      nthOf.set(r.alias, nth + 1);
      return { alias: r.alias, value: r.value, scope: 'file' as const, description: r.description, tags: r.tags, nth };
    });
    const libraryImagesArr: ImageEntry[] = Object.entries(imageLibrary).map(
      ([alias, value]) => ({ alias, value, scope: 'library' as const, description: imageLibraryDesc[alias], tags: imageLibraryTags[alias] }),
    );
    const view = () => editorRef.current?.view;
    const resolveThumb = (value: string) => {
      if (/^(data:|https?:|blob:)/.test(value)) return value;
      // Empty-authority form so a managed `.mdp/images/…` path isn't parsed as an
      // invalid dot-leading hostname (→ broken thumbnail). Managed/leading-slash
      // values are anchored at the workspace ROOT; other values are relative to the
      // deck's own folder (so a deck in a subfolder still resolves its own images).
      const prefix = isElectron() ? 'mdp-file:///' : FILES_PREFIX;
      const deckDir = baseUrl.replace(/^(mdp-file:\/\/+|\/files\/)/, '');
      const rootAnchored = value.startsWith('/') || /(^|\/)\.mdp\//.test(value);
      const rel = (rootAnchored ? value : `${deckDir}${value}`).replace(/^\//, '');
      return `${prefix}${rel}`;
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
            const rebased = await upsertLibraryImage(alias, value, description, tags);
            const next = { ...imageLibraryRef.current, [alias]: rebased };
            const nextDesc = { ...imageLibraryDescRef.current };
            if (description) nextDesc[alias] = description; else delete nextDesc[alias];
            const nextTags = { ...imageLibraryTagsRef.current };
            if (tags && tags.length) nextTags[alias] = tags; else delete nextTags[alias];
            commitLibrary(next, nextDesc, nextTags);
          } catch (e) { reportError('Failed to add the image to the library.', { detail: e }); }
        })();
      },
      onEditImage: (scope, alias, value, description, tags, nth) => {
        if (scope === 'file') { const v = view(); if (v) editFileImageDef(v, alias, value, description, tags, nth); return; }
        (async () => {
          try {
            const rebased = await upsertLibraryImage(alias, value, description, tags);
            const next = { ...imageLibraryRef.current, [alias]: rebased };
            const nextDesc = { ...imageLibraryDescRef.current };
            if (description) nextDesc[alias] = description; else delete nextDesc[alias];
            const nextTags = { ...imageLibraryTagsRef.current };
            if (tags && tags.length) nextTags[alias] = tags; else delete nextTags[alias];
            commitLibrary(next, nextDesc, nextTags);
          } catch (e) { reportError('Failed to update the library image.', { detail: e }); }
        })();
      },
      onDeleteImage: async (scope, alias, nth) => {
        // Say what the references show afterwards — another definition of the alias
        // may take over (this file's next one, or the shared library's).
        const inFile = fileImages.filter((e) => e.alias === alias);
        let msg = `Delete image alias “${alias}”? References to it will stop resolving.`;
        if (scope === 'file' && nth) msg = `Delete this duplicate definition of “${alias}”? It is not used — references show the first one.`;
        else if (scope === 'file' && inFile.length > 1) msg = `Delete image alias “${alias}”? References to it will show the next definition in this file instead.`;
        else if (scope === 'file' && imageLibraryRef.current[alias] != null) msg = `Delete image alias “${alias}”? References to it will show the shared library’s image instead.`;
        else if (scope === 'library' && inFile.length) msg = `Delete “${alias}” from the shared library? This deck uses its own “${alias}” and is not affected; other decks lose it.`;
        const ok = await confirmDialog(msg, { severity: 'warning', confirmText: 'Delete' });
        if (!ok) return;
        if (scope === 'file') { const v = view(); if (v) deleteFileImageDef(v, alias, nth); return; }
        try {
          const old = imageLibraryRef.current[alias];
          await removeLibraryImage(alias);
          const next = { ...imageLibraryRef.current }; delete next[alias];
          const nextDesc = { ...imageLibraryDescRef.current }; delete nextDesc[alias];
          const nextTags = { ...imageLibraryTagsRef.current }; delete nextTags[alias];
          commitLibrary(next, nextDesc, nextTags);
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
              const rebased = await upsertLibraryImage(alias, entry.value, entry.description, entry.tags); // write dest first
              const next = { ...imageLibraryRef.current, [alias]: rebased };
              const nextDesc = { ...imageLibraryDescRef.current };
              if (entry.description) nextDesc[alias] = entry.description; else delete nextDesc[alias];
              const nextTags = { ...imageLibraryTagsRef.current };
              if (entry.tags && entry.tags.length) nextTags[alias] = entry.tags; else delete nextTags[alias];
              commitLibrary(next, nextDesc, nextTags);
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
              await removeLibraryImage(alias);
              const next = { ...imageLibraryRef.current }; delete next[alias];
              const nextDesc = { ...imageLibraryDescRef.current }; delete nextDesc[alias];
              const nextTags = { ...imageLibraryTagsRef.current }; delete nextTags[alias];
              commitLibrary(next, nextDesc, nextTags);
            } catch (e) { reportError('Failed to move the image to the file.', { detail: e }); }
          })();
        }
      },
    };
  }, [debouncedMarkdown, imageLibrary, imageLibraryDesc, imageLibraryTags, imageFocusAlias, imageEditRequest, handleInsertText, baseUrl, commitLibrary, handleEditImageDrawio, editorRef, upsertLibraryImage, removeLibraryImage]);

  const headerSlice = useMemo<HeaderActions>(() => ({
    onOpenFolder: isElectron() ? handleOpenFolderWithFlag : undefined,
    onSyncCatalog: handleManualSync,
    onSwitchToRemote: handleSwitchToRemote,
    onOpenConnectDialog: openConnectDialog,
    onOpenPresenter: openPresenterTool,
    onOpenOutput: openOutputWindow,
    onRehearse: () => setRehearseOpen(true),
    onAutoPlay: () => setAutoPlayOpen(true),
    onSuggestModule: openSuggestModule,
    onToggleSlideshow: toggleSlideshow,
    onPrint: handlePrint,
    onExportPptx: () => { void exportPptx(); },
    onExportImages: () => { void exportImages(); },
    onExportVideo: canExportVideo ? () => setVideoDialogOpen(true) : undefined,
    imagesBusy: !!imageExporting,
    pptxBusy: !!pptxExporting,
    answers: hasAnswers && previewFileType === 'markdown' ? {
      hidden: answersHidden,
      onToggle: () => setAnswersToggle({ deck: previewFileName || '', mode: answersHidden ? 'show' : 'hide' }),
    } : undefined,
    onToggleOverview: toggleSlideOverview,
    isSlideOverview,
    canPresent: slides.length > 0,
  }), [handleOpenFolderWithFlag, handleManualSync, handleSwitchToRemote, openConnectDialog,
    openPresenterTool, openOutputWindow, openSuggestModule, toggleSlideshow, handlePrint, exportPptx, pptxExporting,
    exportImages, imageExporting, canExportVideo, toggleSlideOverview, isSlideOverview, slides.length,
    hasAnswers, answersHidden, previewFileType, previewFileName]);

  // Concurrent-edit lock: hold the active editable text file so a second
  // person on a shared server opens it read-only instead of clobbering.
  const lockable = !!currentFileName
    && (effectiveFileType === 'markdown' || effectiveFileType === 'text' || effectiveFileType === 'doc')
    && !isImageFile && !isPdfFile && !isVideoFile;
  const lockedBy = useEditLock(lockable ? currentFileName : null, lockable);
  const roExtensions = useMemo(
    () => (lockedBy ? [...extensions, EditorState.readOnly.of(true), EditorView.editable.of(false)] : extensions),
    [lockedBy, extensions]);

  const editorSlice: EditorSharedProps = {
    tabs, activeTabIndex, currentFileName, effectiveFileType, markdown, lastUpdated,
    extensions: roExtensions, switchTab, onTabClose: handleTabCloseClick,
    reorderTabs, closeOtherTabs, closeAllTabs, updateTabContent, onEditorUpdate,
    onInsertText: handleInsertText, onSave: handleSave, moveSlide,
    isBookmarked, toggleBookmark, bookmarks, updateBookmark, handleEditDirectDrawio,
  };

  return (
    <div className="container">
      {lockedBy && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 4000,
          background: "#b8860b", color: "#fff", textAlign: "center",
          font: "13px/2.2 system-ui, sans-serif" }}>
          🔒 {lockedBy} が編集中です—このファイルは閲覧のみです。
        </div>
      )}

      <DrawioEditor open={isDrawioModalOpen} onClose={() => setIsDrawioModalOpen(false)} initialBase64Xml={drawioEditTarget?.base64} onSave={handleDrawioSave} />
      <DrawioEditor open={!!directDrawio} onClose={() => setDirectDrawio(null)} initialBase64Xml={directDrawio?.content} onSave={handleDirectDrawioSave} />
      <DrawioEditor open={!!drawioImageEdit} onClose={() => setDrawioImageEdit(null)} initialBase64Xml={drawioImageEdit?.base64Xml} onSave={handleDrawioImageSave} />
      <DrawioEditor open={!!drawioForAdd} onClose={() => setDrawioForAdd(null)} initialBase64Xml={drawioForAdd?.initial || undefined} onSave={handleDrawioForAddSave} />

      <ConnectDialog open={isConnectDialogOpen} onClose={() => setIsConnectDialogOpen(false)} channelId={channelId} token={token} ipCandidates={remoteIps} port={remotePort}
        view={remoteView} onViewChange={changeRemoteView} liveSupported />
      {layoutJob && (
        <LayoutProbe
          key={layoutJob.id}
          slides={syncSlides} slideSize={slideSize} basePath={basePath} fontCss={getFontState().css}
          onDone={(pages) => {
            const { same, diffs } = compareLayouts(pages, layoutJob.pages);
            send({ type: 'LAYOUT_RESULT', payload: { id: layoutJob.id, slides: pages.length, same, diffs }, channelId }, 'remote');
            const where = [...new Set(diffs.map((d) => d.slide))];
            notify(diffs.length
              ? `The device breaks lines differently on slide${where.length > 1 ? 's' : ''} ${where.join(', ')} — the device shows where.`
              : `The device breaks every line where this computer does (${pages.length} slides).`, { title: 'Remote layout check' });
            console.log('[MDP] remote layout check', layoutJob.ua, { same, diffs });
            setLayoutJob(null);
          }}
          onError={(e) => {
            send({ type: 'LAYOUT_RESULT', payload: { id: layoutJob.id, slides: 0, same: 0, diffs: [], error: String((e as Error)?.message || e) }, channelId }, 'remote');
            setLayoutJob(null);
          }}
        />
      )}

      <RehearsalDialog open={rehearseOpen} onClose={() => setRehearseOpen(false)} onRun={handleRehearsalRun}
        slides={mdSlides.map((s) => ({ raw: (s as { raw?: string }).raw || '', measuredSec: (s as { measuredSec?: number }).measuredSec }))} />

      <SuggestModuleDialog open={suggestOpen} onClose={() => setSuggestOpen(false)} text={suggestText} onInsert={handleInsertText} />

      {/* the editor's "Add to glossary…" (Ctrl+Alt+Y): a term of the script into a glossary of the deck's folders */}
      <AddToGlossaryDialog chain={scopeDirs} onReplace={replaceInEditor} />

      {videoDialogOpen && currentFileName && (
        <VideoExportDialog open onClose={() => setVideoDialogOpen(false)} deckPath={currentFileName}
          slideSize={mdSlideSize} slideRaws={mdSlides.map((s) => (s as { raw?: string }).raw || '')}
          estimatedSeconds={estimateDeckSeconds(mdSlides, appSettings.readingCharsPerMin || 320)}
          timing={timingInfo} onForgetTimes={forgetTimes}
          onQueue={queueVideo} />
      )}
      <VideoQueuePanel onOpen={(p) => handleFileSelect(p)} />

      {/* Hidden slides are not played, as in the slideshow (the numbers stay the deck's).
          It starts at the slide being edited (a hidden one: the next shown). What it
          measures (Timing tab) becomes the deck's time estimates. */}
      <AutoPlayView open={autoPlayOpen} onClose={() => setAutoPlayOpen(false)} basePath={basePath} slideSize={mdSlideSize}
        globalTransition={globalContext.transition}
        startSlide={mdSlides.slice(0, currentSlideIndex).filter((s) => !(s as { isHidden?: boolean }).isHidden).length}
        slides={autoPlaySlides} timing={timingInfo} onForgetTimes={forgetTimes}
        onMeasured={previewFileName ? (m) => saveNarration(previewFileName, { ...m, slideCount: mdSlides.length }) : undefined} />

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

      {rasterHost}

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
              <SlideOverviewGrid slides={slides} currentSlideIndex={currentSlideIndex} slideSize={slideSize} drawings={drawings} onSelectSlide={selectSlideFromOverview} basePath={basePath} />
            </div>
          ) : (
            <>
              <SlideControls
                mode={mode} setMode={setMode} pageIndex={currentSlideIndex} totalSlides={slides.length} visible={showControls} onNav={moveSlide} onAddSlide={() => handleAddBlankSlide(currentSlideIndex)} onClearDrawing={() => { clear(currentSlideIndex); send({ type: 'CLEAR_DRAWING', channelId, pageIndex: currentSlideIndex }); }} onClose={() => { document.exitFullscreen(); setMode('view'); }} toolType={toolType} setToolType={setToolType} penColor={penColor} setPenColor={setPenColor} penWidth={penWidth} setPenWidth={setPenWidth} canUndo={canUndo(currentSlideIndex)} canRedo={canRedo(currentSlideIndex)} onUndo={() => undo(currentSlideIndex)} onRedo={() => redo(currentSlideIndex)} useLaserPointerMode={true} stylusOnly={stylusOnly} setStylusOnly={setStylusOnly} containerStyle={{ bottom: '20px' }}
                onHistoryBack={navBack} onHistoryForward={navForward} canHistoryBack={navCanBack} canHistoryForward={navCanForward}
                recording={canRecord ? recState : undefined} onToggleRecording={canRecord ? () => recordCommand(recState.status === 'recording' ? 'stop' : 'start') : undefined}
              />
              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <SlideEffectLayer
                  slides={slides}
                  index={currentSlideIndex}
                  step={step}
                  globalTransition={globalContext.transition}
                  onStepAutoAdvance={() => {
                    // Auto-advance to the NEXT BUILD only — no emphasis, never across
                    // the slide boundary (the last build stops; cross slides manually).
                    advanceBuild();
                  }}
                  renderSlide={(slide, idx, opts) => (
                    <SlideScaler width={slideSize.width} height={slideSize.height} marginRate={1}>
                      {slide && !slide.isHidden && (
                        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                          {/* Both frames of a transition stay `presenting`: flipping it re-runs the
                              slide's module scripts, which would restart the outgoing slide's
                              modules just as it leaves. Only input follows `interactive`. */}
                          <SlideView
                            html={slide.html} raw={slide.raw} basePath={basePath} pageNumber={slide.pageNumber} className={slide.className} isActive={true} slideSize={slideSize} isEnabledPointerEvents={opts.interactive && mode === 'view'} header={slide.header} footer={slide.footer} drawings={drawings[idx] || []} buildStep={opts.buildStep} onStepAutoAdvance={opts.onStepAutoAdvance} presenting slideIndex={idx} moduleRole="owner" onSlideLink={navLink}
                            focus={idx === currentSlideIndex ? showFocus : null}
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

      {/* MCP live-tools handler: the desktop app, and the shared server's headless
          renderer page (`?mcp=1`). Renders only hidden work surfaces (rasterizer +
          measurement mounts). */}
      {(isElectron() || isMcpRenderer()) && (
        <McpBridge ctx={{
          currentFileName, markdownRef, currentSlideIndex, setCurrentSlideIndex,
          slides, slideSize, basePath, themeCssUrl, scopeDirs, aiNotes: scopeAiNotes, styleProfile: scopeStyleProfile,
          slidesSource,
          fonts: scopeFonts, fontDefaults: scopeFontDefaults, fontRequirements,
          // Force the preview onto the current editor text (a frozen preview — live
          // preview off, or a layout-edit suppression — never catches up by itself).
          applyPreview: () => setPreviewSource({ fileName: currentFileName, fileType: effectiveFileType, md: markdownRef.current }),
          assetWritePolicy: appSettings.mcpAssetWrite,
          modulesReady: assetsReady,
          loadFile, handleInsertText, tabs, updateTabContent,
          saveActiveFile: handleSave, reloadFileFromDisk,
          onRefreshTree: handleManualRefresh,
          // Narrated video export (export_video): the same queue as the Export menu.
          queueVideo, ttsEngine: appSettings.tts.engine, readingCpm: appSettings.readingCharsPerMin || 320,
          // export_pdf / export_pptx: the Export menu's PDF and PowerPoint, saved into
          // the workspace; a handout = the PDF with the answers hidden for a moment.
          exportPdf: (rel: string) => handlePrint(rel),
          exportPptx: (rel: string) => exportPptx(rel),
          answers: { has: !!hasAnswers, hidden: answersHidden, deckHidden: deckAnswersHidden, toggle: answersToggle },
          setAnswersToggle,
          slidesWithAnswers: renderWithAnswers,
          // The module epoch the slides were parsed at, and whether the scope's
          // modules / effects (or its folders behind an SSH link) are still loading.
          slidesEpoch, moduleEpoch, assetsPending,
          // A tab against its file on disk; a merge's result made the tab's text.
          syncTabsWithDisk, rebaseTab, closeTabsByPaths,
        }} />
      )}

      {isElectron() && !hasSelectedFolder ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: '#222', color: 'white' }}>
          <Typography variant="h4" gutterBottom>Welcome to MDP</Typography>
          <Typography variant="body1" sx={{ color: '#888', mb: 4 }}>Select a workspace folder to start editing.</Typography>
          <Button variant="contained" size="large" startIcon={<FolderOpenIcon />} onClick={handleOpenFolderWithFlag}>
            Open Folder
          </Button>
        </div>
      ) : isSlideOverview && !isSlideshow ? (
        <SlideOverviewGrid slides={slides} currentSlideIndex={currentSlideIndex} slideSize={slideSize} drawings={drawings} onSelectSlide={selectSlideFromOverview} basePath={basePath} />
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