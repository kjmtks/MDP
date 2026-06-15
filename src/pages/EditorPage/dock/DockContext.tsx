import { createContext, useContext } from 'react';
import type { ViewUpdate } from '@uiw/react-codemirror';
import type { Extension } from '@codemirror/state';
import type { FileNode, FileType, SnippetsCategory } from '../../../types';
import type { Stroke } from '../../../features/drawing/components/DrawingOverlay';
import type { OpenTab } from '../../../features/fileTree/hooks/useFileManager';
import type { Bookmark } from '../hooks/useBookmarks';
import type { ImageEntry } from '../../../features/images/imageRegistry';

export interface SidebarSharedProps {
  currentFileName: string | null;
  currentFileType: FileType;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  slides: any[];
  currentSlideIndex: number;
  slideSize: { width: number; height: number };
  drawings: Record<number, Stroke[]>;
  fileTree: FileNode[];
  onSlideSelect: (index: number) => void;
  onFileSelect: (path: string, isBinary?: boolean) => void;
  onManualRefresh: () => void;
  onNav?: (dir: number) => void;
  handleOpenFolder?: () => void;
  bookmarks: Bookmark[];
  isBookmarked: (path: string) => boolean;
  onToggleBookmark: (path: string) => void;
  onReorderBookmark?: (from: number, to: number) => void;
  onUpdateBookmark?: (path: string, changes: { icon?: string; color?: string }) => void;
  onRenameFile?: (oldPath: string, newPath: string) => void;
  onDeleteFiles?: (paths: string[]) => void;
}

export interface PreviewSharedProps {
  effectiveFileType: FileType;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  slides: any[];
  currentSlideIndex: number;
  slideSize: { width: number; height: number };
  basePath: string;
  drawings: Record<number, Stroke[]>;
  mode: string;
  setMode: (mode: 'view' | 'pen' | 'laser') => void;
  showControls: boolean;
  moveSlide: (dir: number) => void;
  handleAddBlankSlide: (index: number) => void;
  clear: (index: number) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  send: (msg: any) => void;
  channelId: string;
  toolType: 'pen' | 'eraser' | 'select';
  setToolType: (t: 'pen' | 'eraser' | 'select') => void;
  penColor: string;
  setPenColor: (c: string) => void;
  penWidth: number;
  setPenWidth: (w: number) => void;
  canUndo: (index: number) => boolean;
  canRedo: (index: number) => boolean;
  undo: (index: number) => void;
  redo: (index: number) => void;
  stylusOnly: boolean;
  setStylusOnly: (v: boolean) => void;
  addStroke: (index: number, stroke: Stroke) => void;
  handleUpdateStrokes: (pageIndex: number, indices: number[], dx: number, dy: number) => void;
  // 'owner' when the preview is the host's primary surface (not in slideshow),
  // 'mirror' while the fullscreen slideshow owns interactive-module logic.
  moduleRole: 'owner' | 'mirror';

  // When set, the Preview panel shows this image (a library preview) instead of
  // the slides, with a button to return.
  previewImage?: string | null;
  onClosePreviewImage?: () => void;

  onEditDrawio?: () => void;
}

export interface EditorSharedProps {
  tabs: OpenTab[];
  activeTabIndex: number;
  currentFileName: string | null;
  effectiveFileType: FileType;
  markdown: string;
  lastUpdated: number;
  extensions: Extension[];
  switchTab: (index: number) => void;
  onTabClose: (e: React.MouseEvent, index: number) => void;
  reorderTabs: (start: number, end: number) => void;
  closeOtherTabs: (index: number) => void;
  closeAllTabs: () => void;
  updateTabContent: (path: string, val: string) => void;
  onEditorUpdate: (vu: ViewUpdate) => void;
  onInsertText: (text: string) => void;
  onSave: () => void;
  moveSlide: (dir: number) => void;
  isBookmarked: (path: string) => boolean;
  toggleBookmark: (path: string) => void;
  bookmarks: Bookmark[];
  updateBookmark: (path: string, changes: { icon?: string; color?: string }) => void;
  handleEditDirectDrawio: () => void;
}

export interface SnippetsShared {
  snippets: SnippetsCategory[];
  onInsertText: (text: string) => void;
}

export interface ImagesShared {
  fileImages: ImageEntry[];      // `@image` defs parsed from the current file
  libraryImages: ImageEntry[];   // shared workspace library (.images/registry.json)
  onInsertReference: (alias: string) => void;                       // ![image](@alias)
  onAddImage: (scope: 'file' | 'library', alias: string, value: string, description?: string, tags?: string[]) => void;
  onEditImage: (scope: 'file' | 'library', alias: string, value: string, description?: string, tags?: string[]) => void;
  onDeleteImage: (scope: 'file' | 'library', alias: string) => void;
  onMove: (alias: string, to: 'file' | 'library') => void;
  onEditDrawio?: (entry: ImageEntry) => void; // edit an SVG image in the drawio editor
  onPreview?: (entry: ImageEntry) => void;    // show the image in the Preview panel
  resolveThumb: (value: string) => string;   // resolve relative paths for <img src>
  focusAlias?: string | null;                // alias to scroll to / highlight
  editRequest?: { alias: string } | null;    // open the edit dialog for this alias
  onEditHandled?: () => void;                 // panel acked the edit request
}

export interface HeaderActions {
  onOpenFolder?: () => void;
  onSyncCatalog?: () => void;
  onSwitchToRemote: () => void;
  onOpenConnectDialog: () => void;
  onOpenPresenter: () => void;
  onToggleSlideshow: () => void;
  onPrint: () => void;
  onToggleOverview: () => void;
  isSlideOverview: boolean;
  canPresent: boolean;
}

export const SidebarContext = createContext<SidebarSharedProps | null>(null);
export const PreviewContext = createContext<PreviewSharedProps | null>(null);
export const EditorContext = createContext<EditorSharedProps | null>(null);
export const SnippetsContext = createContext<SnippetsShared | null>(null);
export const ImagesContext = createContext<ImagesShared | null>(null);
export const HeaderContext = createContext<HeaderActions | null>(null);

function use<T>(ctx: React.Context<T | null>, name: string): T {
  const value = useContext(ctx);
  if (!value) throw new Error(`${name} must be used within DockProvider`);
  return value;
}

export const useSidebar = () => use(SidebarContext, 'useSidebar');
export const usePreview = () => use(PreviewContext, 'usePreview');
export const useEditor = () => use(EditorContext, 'useEditor');
export const useSnippets = () => use(SnippetsContext, 'useSnippets');
export const useImages = () => use(ImagesContext, 'useImages');
export const useHeaderActions = () => use(HeaderContext, 'useHeaderActions');

export interface DockSlices {
  sidebar: SidebarSharedProps;
  preview: PreviewSharedProps;
  editor: EditorSharedProps;
  snippets: SnippetsShared;
  images: ImagesShared;
  headerActions: HeaderActions;
}
