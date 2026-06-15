import { useCallback, useEffect, useRef } from 'react';
import {
  DockviewReact,
  themeAbyss,
  type DockviewReadyEvent,
  type DockviewApi,
  type IDockviewPanelProps,
  type IDockviewPanelHeaderProps,
  type IWatermarkPanelProps,
} from 'dockview';
import 'dockview/dist/styles/dockview.css';

import {
  ExplorerPanel,
  ThumbnailsPanel,
  BookmarksPanel,
  SnippetsPanel,
  ImagesPanel,
  PreviewPanel,
  FileEditorPanel,
  FileTab,
} from './DockPanels';
import { EmptyState } from '../../../features/editor/components/EmptyState';
import { useEditor, type EditorSharedProps } from './DockContext';
import {
  LAYOUT_KEY, RESET_LAYOUT_EVENT, TOGGLE_PANEL_EVENT, SHOW_PANEL_EVENT, VISIBLE_PANELS_EVENT, REQUEST_VISIBLE_EVENT, STATIC_PANELS,
} from './dockShared';

const LEFT_GROUP_IDS = ['explorer', 'thumbnails', 'bookmarks', 'snippets', 'images'];

const FILE_PREFIX = 'file:';
const fileId = (tabId: string) => `${FILE_PREFIX}${tabId}`;
const baseName = (path: string) => path.split('/').pop() || path;
const isImagePath = (path: string) => /\.(png|jpe?g|gif|svg|webp|bmp|ico)$/i.test(path);

const components: Record<string, React.FunctionComponent<IDockviewPanelProps>> = {
  explorer: () => <ExplorerPanel />,
  thumbnails: () => <ThumbnailsPanel />,
  bookmarks: () => <BookmarksPanel />,
  snippets: () => <SnippetsPanel />,
  images: () => <ImagesPanel />,
  preview: () => <PreviewPanel />,
  fileEditor: (props) => <FileEditorPanel {...(props as IDockviewPanelProps<{ tabId: string }>)} />,
};

const tabComponents: Record<string, React.FunctionComponent<IDockviewPanelHeaderProps>> = {
  fileTab: (props) => <FileTab {...(props as IDockviewPanelHeaderProps<{ tabId: string }>)} />,
};

const watermarkComponent: React.FunctionComponent<IWatermarkPanelProps> = () => <EmptyState />;

function buildDefaultLayout(api: DockviewApi) {
  api.clear();
  // Three columns: [Thumbnails / Explorer] | [Preview / (editor)] | [Bookmarks / Images / Snippets].
  // The file editor docks BELOW Preview in the centre column (see reconcile()).
  // Centre column (Preview takes the remaining width).
  api.addPanel({ id: 'preview', component: 'preview', title: 'Preview' });
  // Left column: Thumbnails (top) over Explorer (bottom), ~300px wide.
  api.addPanel({ id: 'thumbnails', component: 'thumbnails', title: 'Thumbnails', position: { referencePanel: 'preview', direction: 'left' }, initialWidth: 300 });
  api.addPanel({ id: 'explorer', component: 'explorer', title: 'Explorer', position: { referencePanel: 'thumbnails', direction: 'below' } });
  // Right column: Bookmarks / Images / Snippets stacked, ~300px wide.
  api.addPanel({ id: 'bookmarks', component: 'bookmarks', title: 'Bookmarks', position: { referencePanel: 'preview', direction: 'right' }, initialWidth: 300 });
  api.addPanel({ id: 'images', component: 'images', title: 'Images', position: { referencePanel: 'bookmarks', direction: 'below' } });
  api.addPanel({ id: 'snippets', component: 'snippets', title: 'Snippets', position: { referencePanel: 'images', direction: 'below' } });
  api.getPanel('explorer')?.api.setActive();
}

function addStaticPanel(api: DockviewApi, id: string) {
  const meta = STATIC_PANELS.find(p => p.id === id);
  if (!meta || api.getPanel(id)) return;

  if (id === 'preview') {
    const fileAnchor = api.panels.find(p => p.id.startsWith(FILE_PREFIX))?.id;
    const leftAnchor = LEFT_GROUP_IDS.find(pid => api.getPanel(pid));
    const position = fileAnchor
      ? { referencePanel: fileAnchor, direction: 'above' as const }
      : leftAnchor
        ? { referencePanel: leftAnchor, direction: 'right' as const }
        : undefined;
    api.addPanel({ id, component: 'preview', title: meta.title, ...(position ? { position } : {}) });
    return;
  }

  const groupAnchor = LEFT_GROUP_IDS.filter(pid => pid !== id).find(pid => api.getPanel(pid));
  api.addPanel({
    id,
    component: id,
    title: meta.title,
    ...(groupAnchor ? { position: { referencePanel: groupAnchor, direction: 'within' as const } } : {}),
    ...(id === 'explorer' ? { initialWidth: 280 } : {}),
  });
}

function toggleStaticPanel(api: DockviewApi, id: string) {
  const existing = api.getPanel(id);
  if (existing) api.removePanel(existing);
  else addStaticPanel(api, id);
}

function broadcastVisiblePanels(api: DockviewApi) {
  const ids = api.panels.map(p => p.id);
  window.dispatchEvent(new CustomEvent(VISIBLE_PANELS_EVENT, { detail: { ids } }));
}

function reconcile(
  api: DockviewApi,
  editor: EditorSharedProps,
  syncing: { current: boolean },
  lastActive: { current: string | undefined },
) {
  const { tabs, activeTabIndex } = editor;
  syncing.current = true;
  try {
    const filePanels = api.panels.filter(p => p.id.startsWith(FILE_PREFIX));
    let anchorId: string | undefined = filePanels[0]?.id;

    for (const tab of tabs) {
      if (isImagePath(tab.path)) continue;
      const id = fileId(tab.id);
      const existing = api.getPanel(id);
      if (existing) {
        if (existing.title !== baseName(tab.path)) existing.api.setTitle(baseName(tab.path));
        continue;
      }
      const position = anchorId
        ? { referencePanel: anchorId, direction: 'within' as const }
        : api.getPanel('preview')
          ? { referencePanel: 'preview', direction: 'below' as const }
          : undefined;
      api.addPanel({
        id,
        component: 'fileEditor',
        tabComponent: 'fileTab',
        title: baseName(tab.path),
        params: { tabId: tab.id },
        renderer: 'always',
        ...(position ? { position } : {}),
      });
      if (!anchorId) anchorId = id;
    }

    for (const panel of api.panels.filter(p => p.id.startsWith(FILE_PREFIX))) {
      const tabId = (panel.params as { tabId?: string } | undefined)?.tabId;
      if (!tabs.some(t => t.id === tabId)) api.removePanel(panel);
    }

    const active = tabs[activeTabIndex];
    const desiredId = active ? fileId(active.id) : undefined;
    if (
      desiredId &&
      lastActive.current !== active!.id &&
      api.activePanel?.id !== desiredId
    ) {
      api.getPanel(desiredId)?.api.setActive();
    }
    lastActive.current = active?.id;
  } finally {
    syncing.current = false;
  }
}

export function EditorDock() {
  const apiRef = useRef<DockviewApi | null>(null);
  const syncingRef = useRef(false);
  const lastActiveRef = useRef<string | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement>(null);

  const editor = useEditor();
  const editorRef = useRef<EditorSharedProps>(editor);
  useEffect(() => { editorRef.current = editor; });

  const tabsKey = editor.tabs.map(t => t.id).join(',');

  // Force the Dockview grid to fill its live container. `api.fromJSON()` restores
  // the SAVED grid size (which may be from a smaller window), and Dockview's
  // internal observer only reacts to container-size CHANGES — so a stale/short
  // layout (or a reconcile that doesn't change the outer size) would otherwise
  // leave the grid too short, exposing the page background as a blank area.
  const fitLayout = useCallback(() => {
    const el = rootRef.current;
    const api = apiRef.current;
    if (el && api && el.clientWidth > 0 && el.clientHeight > 0) {
      api.layout(el.clientWidth, el.clientHeight, true);
    }
  }, []);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => fitLayout());
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitLayout]);

  const onReady = useCallback((event: DockviewReadyEvent) => {
    const api = event.api;
    apiRef.current = api;

    let restored = false;
    const saved = localStorage.getItem(LAYOUT_KEY);
    if (saved) {
      try {
        api.fromJSON(JSON.parse(saved));
        restored = !!api.getPanel('preview');
      } catch {
        restored = false;
      }
    }
    if (!restored) buildDefaultLayout(api);

    api.onDidActivePanelChange((panel) => {
      if (syncingRef.current || !panel || !panel.id.startsWith(FILE_PREFIX)) return;
      const tabId = (panel.params as { tabId?: string } | undefined)?.tabId;
      const idx = editorRef.current.tabs.findIndex(t => t.id === tabId);
      if (idx !== -1 && idx !== editorRef.current.activeTabIndex) editorRef.current.switchTab(idx);
    });

    api.onDidLayoutChange(() => {
      try {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(api.toJSON()));
      } catch {
        /* ignore quota / serialization errors */
      }
      broadcastVisiblePanels(api);
    });

    reconcile(api, editorRef.current, syncingRef, lastActiveRef);
    broadcastVisiblePanels(api);
    // Fit the restored/default layout to the real container (next frame, after
    // the DOM settles) so a stale saved grid size can't leave a blank gap.
    requestAnimationFrame(() => fitLayout());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleToggle = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id;
      if (apiRef.current && id) {
        toggleStaticPanel(apiRef.current, id);
        broadcastVisiblePanels(apiRef.current);
      }
    };
    const handleRequest = () => {
      if (apiRef.current) broadcastVisiblePanels(apiRef.current);
    };
    // Open (never close) a panel and activate it — used by the editor's
    // collapse-widget [edit] buttons (e.g. the @image manager).
    const handleShow = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id;
      const api = apiRef.current;
      if (!api || !id) return;
      if (!api.getPanel(id)) {
        addStaticPanel(api, id);
        broadcastVisiblePanels(api);
      }
      api.getPanel(id)?.api.setActive();
    };
    window.addEventListener(TOGGLE_PANEL_EVENT, handleToggle);
    window.addEventListener(SHOW_PANEL_EVENT, handleShow);
    window.addEventListener(REQUEST_VISIBLE_EVENT, handleRequest);
    return () => {
      window.removeEventListener(TOGGLE_PANEL_EVENT, handleToggle);
      window.removeEventListener(SHOW_PANEL_EVENT, handleShow);
      window.removeEventListener(REQUEST_VISIBLE_EVENT, handleRequest);
    };
  }, []);

  useEffect(() => {
    if (apiRef.current) reconcile(apiRef.current, editorRef.current, syncingRef, lastActiveRef);
    // Re-fit after a tab open/switch reconcile (Dockview can otherwise keep a
    // stale, too-short grid height — the blank-area-on-tab-switch bug).
    requestAnimationFrame(() => fitLayout());
  }, [tabsKey, editor.activeTabIndex, fitLayout]);

  useEffect(() => {
    const handleReset = () => {
      if (apiRef.current) {
        buildDefaultLayout(apiRef.current);
        reconcile(apiRef.current, editorRef.current, syncingRef, lastActiveRef);
        broadcastVisiblePanels(apiRef.current);
      }
      localStorage.removeItem(LAYOUT_KEY);
      // The freshly-rebuilt grid hasn't been measured yet, so panels (notably the
      // CodeMirror editor) render blank until a resize. Force a re-fit over the
      // next two frames so it paints immediately.
      requestAnimationFrame(() => requestAnimationFrame(() => fitLayout()));
    };
    window.addEventListener(RESET_LAYOUT_EVENT, handleReset);
    return () => window.removeEventListener(RESET_LAYOUT_EVENT, handleReset);
  }, [fitLayout]);

  return (
    <div ref={rootRef} style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', position: 'relative' }}>
      <DockviewReact
        components={components}
        tabComponents={tabComponents}
        watermarkComponent={watermarkComponent}
        onReady={onReady}
        theme={themeAbyss}
        className="mdp-dockview"
      />
    </div>
  );
}
