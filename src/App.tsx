import { useState, useMemo, useCallback, useEffect, useRef } from 'react';

import PrintIcon from '@mui/icons-material/Print';
import RefreshIcon from '@mui/icons-material/Refresh';
import NoteAddIcon from '@mui/icons-material/NoteAdd';
import CreateNewFolderIcon from '@mui/icons-material/CreateNewFolder';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import EditIcon from '@mui/icons-material/Edit';
import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternate';
import GridViewIcon from '@mui/icons-material/GridView';
import PresentToAllIcon from '@mui/icons-material/PresentToAll';
import DevicesIcon from '@mui/icons-material/Devices'; 
import SaveIcon from '@mui/icons-material/Save';
import SmartphoneIcon from '@mui/icons-material/Smartphone';

import { Panel, Group, Separator } from 'react-resizable-panels';
import { Box, Tabs, Tab, Typography, Button, Stack, Tooltip, List, ListItem, ListItemButton, ListItemText, ListSubheader, Divider } from '@mui/material';
import CodeMirror, { ViewUpdate } from '@uiw/react-codemirror';
import type { DecorationSet, ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { markdown as markdownLang } from '@codemirror/lang-markdown';
import { EditorView, keymap, Decoration, ViewPlugin, WidgetType } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';

import { DrawioEditor } from './components/DrawioEditor';

import { splitMarkdownToBlocks, parseGlobalContext } from './utils/slideParser';
import { useSlideGenerator } from './hooks/useSlideGenerator';
import { SlideView } from './components/SlideView';
import { SlideThumbnail } from './components/SlideThumbnail';
import { SlideScaler } from './components/SlideScaler';

import { PresenterTool } from './components/PresenterTool';
import { type Stroke } from './components/DrawingOverlay';
import { useDrawing } from './hooks/useDrawing';
import { RemoteControl } from './components/RemoteControl';
import { ConnectDialog } from './components/ConnectDialog';
import { useSync, type SyncMessage } from './hooks/useSync';
import { SlideControls, type AppMode } from './components/SlideControls';

import './App.css';

const INITIAL_MARKDOWN = "";
const MAX_FILE_SIZE = 500 * 1024;
const BASE_HEIGHT = 720;

const CODEMIRROR_BASIC_SETUP = {
  lineNumbers: true,
  foldGutter: true,
  highlightActiveLine: true,
};

interface SnipetItem {
  label: string;
  text: string;
  description?: string;
  icon?: string;
}
interface SnipetsCategory {
  category: string;
  items: SnipetItem[];
}
interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  isBinary?: boolean;
  children?: FileNode[];
}
interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
  noScroll?: boolean;
}
type FileType = 'markdown' | 'image' | 'text' | 'binary' | 'limit-exceeded';


class DrawDataCollapseWidget extends WidgetType {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  eq(_other: DrawDataCollapseWidget) { return true; }
  ignoreEvent() { return false; }
  toDOM() {
    const span = document.createElement("span");
    span.textContent = "🖌️ Drawing Data (...)";
    span.style.cssText = `
      background-color: #333;
      color: #aaa;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.85em;
      user-select: none;
      border: 1px dashed #666;
      margin: 0 4px;
    `;
    return span;
  }
}

const drawingCollapsePlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) {
    this.decorations = this.build(view);
  }
  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = this.build(update.view);
    }
  }
  build(view: EditorView) {
    const builder = new RangeSetBuilder<Decoration>();
    const text = view.state.doc.toString();
    const regex = /<!--\s*@draw:([\s\S]*?)-->/g;
    let match;
    while ((match = regex.exec(text))) {
      const start = match.index;
      const end = start + match[0].length;
      const { from, to } = view.state.selection.main;
      const isCursorInside = (from >= start && from <= end) || (to >= start && to <= end);
      if (!isCursorInside) {
        builder.add(start, end, Decoration.replace({
          widget: new DrawDataCollapseWidget(),
        }));
      }
    }
    return builder.finish();
  }
}, {
  decorations: v => v.decorations
});

class CollapseWidget extends WidgetType {
  readonly base64: string;
  constructor(base64: string) {
    super();
    this.base64 = base64;
  }
  eq(other: CollapseWidget) { return other.base64 === this.base64; }
  ignoreEvent() { return true; }
  toDOM() {
    const wrapper = document.createElement("span");
    wrapper.style.cssText = "display: inline-flex; align-items: center; gap: 6px; vertical-align: middle; margin: 0 4px;";
    const textSpan = document.createElement("span");
    textSpan.textContent = "Drawio Data (...)";
    textSpan.style.cssText = `
      background-color: #444;
      color: #aaa;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.85em;
      user-select: none;
      border: 1px solid #555;
    `;
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.textContent = "Edit";
    editBtn.className = "cm-drawio-edit-btn";
    editBtn.dataset.base64 = this.base64;
    editBtn.style.cssText = `
      background-color: #1976d2;
      color: white;
      border: none;
      border-radius: 3px;
      padding: 2px 8px;
      font-size: 0.8em;
      cursor: pointer;
      line-height: 1.4;
      font-family: sans-serif;
    `;
    editBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const event = new CustomEvent('open-drawio-editor', {
        bubbles: true,
        detail: { base64: this.base64, target: editBtn } 
      });
      editBtn.dispatchEvent(event);
    };
    wrapper.appendChild(textSpan);
    wrapper.appendChild(editBtn);
    return wrapper;
  }
}

interface DrawioRange {
  from: number;
  to: number;
  base64: string;
}

const drawioCollapsePlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  ranges: DrawioRange[] = [];
  constructor(view: EditorView) {
    this.ranges = this.scan(view);
    this.decorations = this.build(view);
  }
  update(update: ViewUpdate) {
    if (update.docChanged) {
      this.ranges = this.scan(update.view);
    }
    if (update.docChanged || update.viewportChanged || update.selectionSet) {
      this.decorations = this.build(update.view);
    }
  }
  scan(view: EditorView) {
    const found: DrawioRange[] = [];
    const text = view.state.doc.toString();
    const regex = /!\[@drawio\]\(([^)]*)\)/g;
    let match;
    while ((match = regex.exec(text))) {
      const start = match.index;
      const length = match[0].length;
      const from = start + 11;
      const to = start + length - 1;
      found.push({ from, to, base64: match[1] });
    }
    return found;
  }
  build(view: EditorView) {
    const builder = new RangeSetBuilder<Decoration>();
    const { from: selFrom, to: selTo } = view.state.selection.main;
    for (const { from, to, base64 } of this.ranges) {
      const syntaxStart = from - 11;
      const syntaxEnd = to + 1;
      const isCursorInside = (selFrom >= syntaxStart && selFrom <= syntaxEnd) || 
                             (selTo >= syntaxStart && selTo <= syntaxEnd);
      if (!isCursorInside) {
        builder.add(from, to, Decoration.replace({
          widget: new CollapseWidget(base64),
        }));
      }
    }
    return builder.finish();
  }
}, {
  decorations: v => v.decorations
});


const determineFileType = (filename: string, isBinaryFromServer?: boolean): FileType => {
  const lower = filename.toLowerCase();
  if (/\.(md|markdown)$/.test(lower)) return 'markdown';
  if (/\.(png|jpe?g|gif|svg|webp|bmp|ico)$/.test(lower)) return 'image';
  if (isBinaryFromServer === true) {
    return 'binary';
  }
  return 'text';
};

const FileTreeItem = ({ node, level, onSelect }: { node: FileNode, level: number, onSelect: (node: FileNode) => void }) => {
  const [isOpen, setIsOpen] = useState(false);
  const isDir = node.type === 'directory';

  const handleClick = () => {
    if (isDir) {
      setIsOpen(!isOpen);
    } else {
      onSelect(node);
    }
  };
  return (
    <div>
      <div 
        onClick={handleClick}
        style={{ 
          paddingLeft: `${level * 1.5}rem`, 
          paddingTop: '4px', 
          paddingBottom: '4px',
          cursor: 'pointer',
          display: 'flex', 
          alignItems: 'center',
          color: isDir ? '#5e5e5e' : '#61afef',
          backgroundColor: 'transparent'
        }}
        className="file-tree-row"
      >
        <span style={{ marginRight: '8px', opacity: 0.7, fontSize: '0.8em' }}>
          {isDir ? (isOpen ? '▼' : '▶') : '•'}
        </span>
        <span style={{ fontWeight: isDir ? 'bold' : 'normal' }}>
          {node.name}
        </span>
      </div>
      {isDir && isOpen && node.children && (
        <div>
          {node.children.map((child) => (
            <FileTreeItem key={child.path} node={child} level={level + 1} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
};

function CustomTabPanel(props: TabPanelProps) {
  const { children, value, index, noScroll, ...other } = props;
  return (
    <div role="tabpanel" hidden={value !== index} {...other} style={{ height: '100%', overflow: 'hidden' }}>
      {value === index && (
        <Box sx={{ height: '100%', overflowY: noScroll ? 'hidden' : 'auto' }}>
          {children}
        </Box>
      )}
    </div>
  );
}

// -------------------------------------------------------------------------------------------------
function MainEditor() {
  const [markdown, setMarkdown] = useState<string>(INITIAL_MARKDOWN);
  const [editorInitialValue, setEditorInitialValue] = useState<string>(INITIAL_MARKDOWN);
  const [debouncedMarkdown, setDebouncedMarkdown] = useState<string>(INITIAL_MARKDOWN);
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [lastUpdated, setLastUpdated] = useState<number>(Date.now());
  const [snipets, setSnipets] = useState<SnipetsCategory[]>([]);
  const [templateContent, setTemplateContent] = useState<string>("# New Slide\n\nContent...");
  const [currentSlideIndex, setCurrentSlideIndex] = useState<number>(0);
  const [currentFileName, setCurrentFileName] = useState<string | null>(null);
  const [currentFileType, setCurrentFileType] = useState<FileType>('markdown');
  const [leftTabIndex, setLeftTabIndex] = useState(0);
  const [bottomTabIndex, setBottomTabIndex] = useState(0);
  const [isSlideshow, setIsSlideshow] = useState(false);
  const [isSlideOverview, setIsSlideOverview] = useState(false);
  const slideshowRef = useRef<HTMLDivElement>(null);
  const [isDrawioModalOpen, setIsDrawioModalOpen] = useState(false);
  const [drawioEditTarget, setDrawioEditTarget] = useState<{ base64: string, lineNo: number } | null>(null);
  const [drawioButtonPos, setDrawioButtonPos] = useState<{ top: number, left: number } | null>(null);
  const [syncRequestToken, setSyncRequestToken] = useState(0);
  const [isConnectDialogOpen, setIsConnectDialogOpen] = useState(false);
  const { drawings, addStroke, syncDrawings, insertPage, undo, redo, clear, canUndo, canRedo } = useDrawing();
  const [toolType, setToolType] = useState<'pen' | 'eraser'>('pen');
  const [penColor, setPenColor] = useState('#FF0000');
  const [penWidth, setPenWidth] = useState(3);
  const [stylusOnly, setStylusOnly] = useState(false);
  
  const [mode, setMode] = useState<AppMode>('view');
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [showControls, setShowControls] = useState(false);

  const lastWheelTime = useRef(0);
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const isSyncingFromEditor = useRef(false);
  const prevSlideIndexRef = useRef(currentSlideIndex);
  const markdownRef = useRef(INITIAL_MARKDOWN);

  const isLoadingFile = useRef<boolean>((() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return params.has('file');
  })());

  useEffect(() => {
    const isTouch = navigator.maxTouchPoints > 0;
    setIsTouchDevice(isTouch);
    if (isTouch) setShowControls(true);
  }, []);

  const baseUrl = useMemo(() => {
    if (!currentFileName) return '/files/';
    const lastSlashIndex = currentFileName.lastIndexOf('/');
    if (lastSlashIndex === -1) return '/files/';
    const dir = currentFileName.substring(0, lastSlashIndex);
    return `/files/${dir}/`;
  }, [currentFileName]);

  const blocks = useMemo(() => {
    if (currentFileType !== 'markdown') return [];
    return splitMarkdownToBlocks(debouncedMarkdown);
  }, [debouncedMarkdown, currentFileType]);

  const preambleRaw = blocks.length > 0 ? blocks[0].rawContent : "";
  const globalContext = useMemo(() => parseGlobalContext(preambleRaw), [preambleRaw]);

  const rawSlides = useSlideGenerator(blocks, globalContext, baseUrl, lastUpdated);
  const slides = useMemo(() => {
    const offset = blocks.length - rawSlides.length;
    let logicalPageCount = 0;
    return rawSlides.map((slide, index) => {
      const targetBlockIndex = index + offset;
      const rawContent = blocks[targetBlockIndex]?.rawContent || "";
      const isHidden = /<!--\s+@hide\s+-->/.test(rawContent);
      const isCover = /<!--\s+@cover\s+-->/i.test(rawContent);
      let pageNumber = null;
      if (!isHidden && !isCover) {
        logicalPageCount++;
        pageNumber = logicalPageCount;
      }
      return { ...slide, isHidden, isCover, pageNumber };
    });
  }, [rawSlides, blocks]);

  const slideSize = useMemo(() => {
    const [aspectW, aspectH] = globalContext.aspectRatio;
    const w = aspectW || 16;
    const h = aspectH || 9;
    const width = (BASE_HEIGHT * w) / h;
    return { width, height: BASE_HEIGHT };
  }, [globalContext.aspectRatio]);
  
  const slideStyleVariables = useMemo(() => ({
    '--slide-width': `${slideSize.width}px`,
    '--slide-height': `${slideSize.height}px`,
    '--slide-aspect-ratio': `${slideSize.width}/${slideSize.height}`,
  } as React.CSSProperties), [slideSize]);

  useEffect(() => {
    const handler = setTimeout(() => { setDebouncedMarkdown(markdown); }, 300);
    return () => clearTimeout(handler);
  }, [markdown]);
  
  useEffect(() => {
    const themeCss = globalContext.themeCss;
    const linkId = 'mdp-theme-style';
    let link = document.getElementById(linkId) as HTMLLinkElement;

    if (themeCss) {
      if (!link) {
        link = document.createElement('link');
        link.id = linkId;
        link.rel = 'stylesheet';
        document.head.appendChild(link);
      }
      let href = themeCss;
      if (!themeCss.match(/^(https?:|\/)/)) {
        href = `${baseUrl}${themeCss}`;
      }
      const separator = href.includes('?') ? '&' : '?';
      href = `${href}${separator}t=${lastUpdated}`;
      if (link.getAttribute('href') !== href) {
        link.href = href;
      }
    } else {
      if (link) {
        document.head.removeChild(link);
      }
    }
  }, [globalContext.themeCss, baseUrl, lastUpdated]);

  const moveSlide = useCallback((direction: number) => {
    let nextIndex = currentSlideIndex + direction;
    while (nextIndex >= 0 && nextIndex < slides.length && slides[nextIndex].isHidden) {
      nextIndex += direction;
    }
    if (nextIndex >= 0 && nextIndex < slides.length) {
      setCurrentSlideIndex(nextIndex);
    }
  }, [currentSlideIndex, slides]);

  const toggleSlideOverview = useCallback(() => {
    setIsSlideOverview(prev => !prev);
  }, []);

  const moveSlideRef = useRef(moveSlide);
  useEffect(() => { moveSlideRef.current = moveSlide; }, [moveSlide]);

  const channelId = useMemo(() => {
    const key = 'mdp-channel-id';
    let id = sessionStorage.getItem(key);
    if (!id) {
      id = `mdp-${Math.random().toString(36).slice(2, 8)}`;
      sessionStorage.setItem(key, id);
    }
    return id;
  }, []);
  
  const sendSyncData = useCallback((sendFn: (msg: SyncMessage) => void) => {
    let themeCssUrl = globalContext.themeCss;
    if (themeCssUrl && !themeCssUrl.match(/^(https?:|\/)/)) {
      themeCssUrl = `${baseUrl}${themeCssUrl}`;
    }
    
    sendFn({
      type: 'SYNC_STATE',
      channelId,
      payload: {
        slides,
        index: currentSlideIndex,
        slideSize,
        themeCssUrl,
        lastUpdated,
        allDrawings: drawings
      }
    });
  }, [channelId, slides, currentSlideIndex, slideSize, globalContext.themeCss, baseUrl, lastUpdated, drawings]);

  const handleAddBlankSlide = useCallback(async (insertAfterIndex: number) => {
    if (!currentFileName || !markdown) return;
    insertPage(insertAfterIndex + 1);
    const blockList = splitMarkdownToBlocks(markdown);
    const spliceIndex = insertAfterIndex + 2;
    const contents = blockList.map(b => b.rawContent);
    contents.splice(spliceIndex, 0, "\n\n");
    const newMarkdown = contents.join('\n---\n');
    setMarkdown(newMarkdown);
    markdownRef.current = newMarkdown;
    if (editorRef.current?.view) {
        const view = editorRef.current.view;
        view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: newMarkdown }
        });
    }
  }, [currentFileName, markdown, insertPage]);

  const { send } = useSync(channelId, useCallback((msg: SyncMessage) => {
    switch (msg.type) {
      case 'NAV': moveSlideRef.current(msg.direction); break;
      case 'REQUEST_SYNC': setSyncRequestToken(t => t + 1); break; 
      case 'DRAW_STROKE': addStroke(msg.pageIndex, msg.stroke, true); break;
      case 'CLEAR_DRAWING': clear(msg.pageIndex); break;
      case 'UNDO': undo(msg.pageIndex); break;
      case 'REDO': redo(msg.pageIndex); break;
      case 'ADD_BLANK_SLIDE': handleAddBlankSlide(msg.pageIndex); break;
    }
  }, [addStroke, clear, handleAddBlankSlide, redo, undo]));

  useEffect(() => {
    sendSyncData(send);
  }, [currentSlideIndex, drawings, sendSyncData, send, syncRequestToken]);

  const openPresenterTool = useCallback(() => {
    window.open(`/presenter?channel=${channelId}`, '_blank', 'width=1000,height=800');
  }, [channelId]);

  const handleSwitchToRemote = useCallback(() => {
    window.location.href = '/remote';
  }, []);

    const toggleSlideshow = useCallback(() => {
    if (!document.fullscreenElement) {
      setIsSlideshow(true);
      setMode('view');
      setShowControls(isTouchDevice);
      if (slides[currentSlideIndex]?.isHidden) {
        let nextIndex = currentSlideIndex + 1;
        while (nextIndex < slides.length && slides[nextIndex].isHidden) {
          nextIndex++;
        }
        if (nextIndex < slides.length) {
          setCurrentSlideIndex(nextIndex);
        }
      }
      setTimeout(() => {
        slideshowRef.current?.requestFullscreen().catch(err => {
          console.error(`Error attempting to enable full-screen mode: ${err.message}`);
          setIsSlideshow(false);
        });
      }, 10);
    } else {
      document.exitFullscreen();
      setMode('view');
    }
  }, [currentSlideIndex, slides, isTouchDevice]);

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  const fetchFileTree = useCallback(() => {
    fetch('/api/files')
      .then(res => res.json())
      .then(data => setFileTree(data))
      .catch(err => console.error("Failed to load file tree:", err));
  }, []);
  
  const handleManualRefresh = useCallback(() => {
    fetchFileTree();
    setLastUpdated(Date.now());
  }, [fetchFileTree]);

  const handleSaveDrawingsToMarkdown = useCallback(() => {
    if (!currentFileName || !markdown) return;
    const blocks = splitMarkdownToBlocks(markdown);
    const content = blocks.map((block, index) => {
      const slideIndex = index - 1; 
      if (slideIndex < 0) return block.rawContent;

      const strokes = drawings[slideIndex];
      const drawTagRegex = /<!--\s*@draw:([\s\S]*?)-->/;
      let text = block.rawContent;

      if (strokes && strokes.length > 0) {
        const json = JSON.stringify(strokes);
        const base64 = btoa(unescape(encodeURIComponent(json)));
        const drawTag = `<!-- @draw: ${base64} -->`;
        if (drawTagRegex.test(text)) {
          text = text.replace(drawTagRegex, drawTag);
        } else {
          text = text.trimEnd() + '\n\n' + drawTag + '\n';
        }
      } else {
        text = text.replace(drawTagRegex, '');
      }
      return text;
    }).join('\n---\n');
    if (editorRef.current?.view) {
      const view = editorRef.current.view;
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: content
        }
      });
    }
    setMarkdown(content);
    markdownRef.current = content;
    const originalTitle = document.title;
    document.title = "✅ Editor Updated with Drawings!";
    setTimeout(() => document.title = originalTitle, 2000);
  }, [currentFileName, markdown, drawings]);

  const loadFile = useCallback((fileName: string, isBinaryFromServer?: boolean, initialPage: number = 0) => {
    if (fileName.startsWith('http://') || fileName.startsWith('https://')) {
      alert("外部URLの読み込みはサポートしていません。");
      return;
    }
    isLoadingFile.current = true;
    const params = new URLSearchParams(window.location.search);
    params.set('file', fileName);
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.pushState(null, '', newUrl);
    setCurrentFileName(fileName);
    setCurrentSlideIndex(initialPage);
    const type = determineFileType(fileName, isBinaryFromServer);
    setCurrentFileType(type);
    if (type === 'image' || type === 'binary') {
      setMarkdown(""); 
      setDebouncedMarkdown("");
      setEditorInitialValue(""); 
      markdownRef.current = ""; 
      return;
    }
    const fetchPath = `/files/${fileName}`;
    fetch(fetchPath)
      .then(async res => {
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        const contentLength = res.headers.get('Content-Length');
        if (contentLength && parseInt(contentLength, 10) > MAX_FILE_SIZE) {
          throw new Error('FILE_TOO_LARGE');
        }
        const text = await res.text();
        if (text.length > MAX_FILE_SIZE) {
          throw new Error('FILE_TOO_LARGE');
        }
        return text;
      })
      .then(text => {
        setMarkdown(text);
        setDebouncedMarkdown(text);
        setEditorInitialValue(text);
        markdownRef.current = text;
        setLastUpdated(Date.now());
        prevSlideIndexRef.current = -1;
        const loadedBlocks = splitMarkdownToBlocks(text);
        const newDrawings: Record<number, Stroke[]> = {};
        loadedBlocks.slice(1).forEach((block, idx) => {
            const match = block.rawContent.match(/<!--\s*@draw:\s*([\s\S]*?)\s*-->/);
            if (match) {
                try {
                    const json = decodeURIComponent(escape(atob(match[1].trim())));
                    newDrawings[idx] = JSON.parse(json);
                } catch (e) { console.error("Drawing parse error", e); }
            }
        });
        syncDrawings(newDrawings);
        setTimeout(() => {
            isLoadingFile.current = false;
        }, 1000);
      })
      .catch(err => {
        isLoadingFile.current = false;
        if (err.message === 'FILE_TOO_LARGE') {
          setCurrentFileType('limit-exceeded');
          setMarkdown("");
          setDebouncedMarkdown("");
          setEditorInitialValue("");
          markdownRef.current = "";
        } else {
          console.error("Failed to fetch content:", err);
          alert(`ファイルの読み込みに失敗しました。\n(Error: ${err.message})`);
        }
      });
  }, [syncDrawings]);

  const handleCreate = useCallback(async (type: 'file' | 'directory') => {
    let name = prompt(type === 'file' ? "Enter new file name:" : "Enter new folder name:");
    if (!name) return;
    if (type === 'file' && !name.includes('.')) {
      name += '.md';
    }
    try {
      const res = await fetch('/api/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: name, type })
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create');
      }
      if (type === 'file') {
        await fetch('/api/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: name, content: templateContent })
        });
      }
      fetchFileTree();
      if (type === 'file') {
        loadFile(name, false);
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      alert(`Error creating ${type}: ${err.message}`);
    }
  }, [fetchFileTree, loadFile, templateContent]);

  const handleInsertText = useCallback((text: string) => {
    const view = editorRef.current?.view;
    if (!view) return;
    const transaction = view.state.replaceSelection(text);
    view.dispatch(transaction);
    view.focus();
  }, []);

  const handleSave = useCallback(async () => {
    if (!currentFileName || currentFileType === 'image' || currentFileType === 'binary' || currentFileType === 'limit-exceeded') return;
    try {
      const res = await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: currentFileName, content: markdown })
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Unknown error');
      }
      const originalTitle = document.title;
      document.title = "✅ Saved!";
      setTimeout(() => document.title = originalTitle, 2000);
      if (currentFileName.endsWith('.css')) {
        setLastUpdated(Date.now());
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      alert(`保存に失敗しました: ${err.message}`);
    }
  }, [currentFileName, markdown, currentFileType]);

  const handleCreateDrawio = useCallback(() => {
    setDrawioEditTarget(null);
    setIsDrawioModalOpen(true);
  }, []);
  const handleDrawioSave = useCallback((base64Xml: string) => {
    if (!drawioEditTarget || !editorRef.current?.view) {
        handleInsertText(`\n![@drawio](${base64Xml})\n`);
        return;
    }
    const view = editorRef.current.view;
    const line = view.state.doc.line(drawioEditTarget.lineNo);
    const newText = `![@drawio](${base64Xml})`;
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: newText }
    });
    const newDoc = view.state.doc.toString();
    setMarkdown(newDoc);
    markdownRef.current = newDoc;
    setDrawioButtonPos(null);
  }, [drawioEditTarget, handleInsertText]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        setIsSlideshow(false);
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    if (!isSlideshow) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isSlideshow) return;
      if (e.key === 'p') {
          setShowControls(prev => !prev);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); undo(currentSlideIndex); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'y') { e.preventDefault(); redo(currentSlideIndex); }
      if (showControls) {
          if (e.key === 'c') {
              clear(currentSlideIndex);
              send({ type: 'CLEAR_DRAWING', channelId, pageIndex: currentSlideIndex });
          }
          if (e.key === 'n') handleAddBlankSlide(currentSlideIndex);
      }
      if (['ArrowRight', 'ArrowDown', ' ', 'Enter', 'PageDown'].includes(e.key)) { e.preventDefault(); moveSlide(1); }
      else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); moveSlide(-1); }
    };
    const handleWheel = (e: WheelEvent) => {
      if (!isSlideshow) return; 
      if ((e.target as HTMLElement).closest('.cm-editor')) return;
      const now = Date.now();
      if (now - lastWheelTime.current < 10) return;
      if (e.deltaY > 0) { lastWheelTime.current = now; moveSlide(1); }
      else if (e.deltaY < 0) { lastWheelTime.current = now; moveSlide(-1); }
    };
    const handleClick = (e: MouseEvent) => {
      if (!isSlideshow) return;
      if ((e.target as HTMLElement).closest('.slide-controls-container')) return;
      if (e.button === 0 && mode === 'view') { moveSlide(1); }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('wheel', handleWheel);
    window.addEventListener('mousedown', handleClick);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('mousedown', handleClick);
    };
  }, [isSlideshow, moveSlide, undo, redo, currentSlideIndex, mode, clear, send, channelId, handleAddBlankSlide, showControls]);


  useEffect(() => {
    fetchFileTree();
    fetch('/api/config/snipets')
      .then(res => res.json())
      .then(data => setSnipets(data))
      .catch(err => console.error("Failed to load snipets:", err));
    fetch('/api/config/template')
      .then(res => res.text())
      .then(text => setTemplateContent(text))
      .catch(err => console.error("Failed to load template:", err));
    const params = new URLSearchParams(window.location.search);
    const fileUrl = params.get('file');
    
    if (fileUrl) {
      loadFile(fileUrl, undefined);
    }
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsHost = window.location.port === '5173' ? 'localhost:3000' : window.location.host;
    let ws: WebSocket;
    let retryTimer: ReturnType<typeof setTimeout>;
    let isUnmounting = false; 
    const connectWs = () => {
      if (isUnmounting) return;
      try {
        ws = new WebSocket(`${wsProtocol}//${wsHost}`);
        ws.onopen = () => console.log("Connected to file watcher");
        ws.onmessage = (event) => {
          if (event.data === 'file-change') {
            fetchFileTree();
          }
        };
        ws.onclose = () => {
          if (!isUnmounting) {
            retryTimer = setTimeout(connectWs, 5000);
          }
        };
      } catch (e) {
        console.error("WS connection error:", e);
        if (!isUnmounting) {
           retryTimer = setTimeout(connectWs, 5000);
        }
      }
    };
    connectWs();
    return () => { 
      isUnmounting = true;
      clearTimeout(retryTimer); 
      if (ws) {
        ws.onclose = null;
        ws.close(); 
      }
    };
  }, [fetchFileTree, loadFile]);

  const saveKeymap = useMemo(() => {
    return keymap.of([{ key: "Mod-s", run: () => { handleSave(); return true; }, preventDefault: true }]);
  }, [handleSave]);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleOpenDrawio = (e: any) => {
      const base64 = e.detail.base64;
      const target = e.detail.target as HTMLElement;
      const view = editorRef.current?.view;
      
      if (view && typeof base64 === 'string' && target) {
        try {
          const pos = view.posAtDOM(target);
          const line = view.state.doc.lineAt(pos);
          setDrawioEditTarget({ base64, lineNo: line.number });
          setIsDrawioModalOpen(true);
        } catch (err) {
          console.error("Failed to locate widget position:", err);
        }
      }
    };
    window.addEventListener('open-drawio-editor', handleOpenDrawio);
    return () => window.removeEventListener('open-drawio-editor', handleOpenDrawio);
  }, []);

  const extensions = useMemo(() => [
      markdownLang(), 
      EditorView.lineWrapping, 
      saveKeymap,
      drawioCollapsePlugin,
      drawingCollapsePlugin,
  ], [saveKeymap]);

  useEffect(() => {
    if (currentFileType !== 'markdown') return;
    if (isSyncingFromEditor.current) {
      isSyncingFromEditor.current = false;
      prevSlideIndexRef.current = currentSlideIndex;
      return;
    }
    if (editorRef.current?.view?.hasFocus) {
        prevSlideIndexRef.current = currentSlideIndex;
        return;
    }
    if (currentSlideIndex === prevSlideIndexRef.current) return;
    if (!editorRef.current?.view || !slides[currentSlideIndex]) return;
    const view = editorRef.current.view;
    const lineNo = slides[currentSlideIndex].range.startLine;
    if (lineNo > view.state.doc.lines) return;
    const linePos = view.state.doc.line(lineNo);
    view.dispatch({ selection: { anchor: linePos.from, head: linePos.from }, scrollIntoView: true });
    prevSlideIndexRef.current = currentSlideIndex;
    if (isLoadingFile.current) {
        setTimeout(() => { isLoadingFile.current = false; }, 150);
    }
  }, [currentSlideIndex, slides, currentFileType]);

  useEffect(() => {
    if (isSlideshow) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      if (e.key === 'p') {
          setShowControls(prev => !prev);
          setMode(prev => prev === 'pen' ? 'view' : 'pen');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSlideshow]);

  const handleLeftTabChange = (_: React.SyntheticEvent, newValue: number) => setLeftTabIndex(newValue);
  const handleBottomTabChange = (_: React.SyntheticEvent, newValue: number) => setBottomTabIndex(newValue);
  
  const onChangeEditor = useCallback((val: string) => {
    setMarkdown(val);
    markdownRef.current = val;
  }, []);

  const onEditorUpdate = useCallback((viewUpdate: ViewUpdate) => {
    if (currentFileType !== 'markdown') return;
    if (isLoadingFile.current) return;
    if (!viewUpdate.view.hasFocus) return;
    if (viewUpdate.selectionSet || viewUpdate.docChanged || viewUpdate.viewportChanged) {
        const state = viewUpdate.state;
        const head = state.selection.main.head;
        const line = state.doc.lineAt(head);
        const text = line.text;
        const match = text.match(/^!\[@drawio\]\((.*)\)$/);
        if (match) {
            const coords = viewUpdate.view.coordsAtPos(line.to);
            if (coords) {
                setDrawioButtonPos({ top: coords.top, left: coords.right + 20 });
                setDrawioEditTarget({ base64: match[1], lineNo: line.number });
            }
        } else { setDrawioButtonPos(null); setDrawioEditTarget(null); }
    }
    if (viewUpdate.docChanged) return;
    if (viewUpdate.selectionSet && slides.length > 0) {
      const state = viewUpdate.state;
      const head = state.selection.main.head;
      const line = state.doc.lineAt(head).number;
      
      const foundIndex = slides.findIndex(slide => 
        line >= slide.range.startLine && line <= slide.range.endLine
      );

      if (foundIndex !== -1 && foundIndex !== currentSlideIndex) {
        isSyncingFromEditor.current = true;
        setCurrentSlideIndex(foundIndex);
      }
    }
  }, [slides, currentSlideIndex, currentFileType]);

  const EmptyState = () => (
    <Box sx={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', bgcolor: '#202020', color: '#888', gap: 2 }}>
      <Typography variant="h5" color="#ccc">No File Selected</Typography>
      <Typography variant="body2">Select a file from the list on the left to start editing.</Typography>
    </Box>
  );

  return (
    <div className="container">
      <DrawioEditor 
        open={isDrawioModalOpen}
        onClose={() => setIsDrawioModalOpen(false)}
        initialBase64Xml={drawioEditTarget?.base64}
        onSave={handleDrawioSave}
      />
      {drawioButtonPos && (
        <Button
          variant="contained"
          color="primary"
          size="small"
          startIcon={<EditIcon />}
          style={{
            position: 'fixed',
            top: drawioButtonPos.top - 8,
            left: drawioButtonPos.left,
            zIndex: 1200, 
            padding: '2px 8px',
            fontSize: '0.75rem',
            minWidth: 'auto',
            textTransform: 'none',
            boxShadow: '0 2px 5px rgba(0,0,0,0.3)'
          }}
          onClick={() => setIsDrawioModalOpen(true)}
        >
          Edit Diagram
        </Button>
      )}
      
      <ConnectDialog 
        open={isConnectDialogOpen} 
        onClose={() => setIsConnectDialogOpen(false)} 
        channelId={channelId} 
      />

      <div className="print-container">
        <style>{`
          @media print {
            @page { size: ${slideSize.width}px ${slideSize.height}px; margin: 0; }
            .print-slide-page { width: ${slideSize.width}px !important; height: ${slideSize.height}px !important; }
            .print-slide-content { width: 100% !important; height: 100% !important; }
          }
        `}</style>
        {slides.map((slide, index) => (
          !slide.isHidden && (
            <div key={index} className="print-slide-page">
              <SlideView html={slide.html} pageNumber={slide.pageNumber} isActive={true} className={`print-slide-content ${slide.className || 'normal'}`} style={slideStyleVariables} slideSize={slideSize} header={slide.header} footer={slide.footer} drawings={drawings[index]} />
            </div>
          )
        ))}
      </div>

      {isSlideshow && (
        <div ref={slideshowRef} className={`slideshow-overlay ${mode === 'laser' ? 'laser-mode' : ''}`}>
          
          <SlideControls 
            mode={mode} setMode={setMode}
            pageIndex={currentSlideIndex} totalSlides={slides.length}
            visible={showControls}
            onNav={moveSlide}
            onAddSlide={() => handleAddBlankSlide(currentSlideIndex)}
            onSave={handleSaveDrawingsToMarkdown}
            onClearDrawing={() => { clear(currentSlideIndex); send({ type: 'CLEAR_DRAWING', channelId, pageIndex: currentSlideIndex }); }}
            onClose={() => { document.exitFullscreen(); setMode('view'); }}
            toolType={toolType} setToolType={setToolType}
            penColor={penColor} setPenColor={setPenColor}
            penWidth={penWidth} setPenWidth={setPenWidth}
            canUndo={canUndo(currentSlideIndex)} canRedo={canRedo(currentSlideIndex)}
            onUndo={() => undo(currentSlideIndex)} onRedo={() => redo(currentSlideIndex)}
            useLaserPointerMode={true}
            stylusOnly={stylusOnly}
            setStylusOnly={setStylusOnly}
            containerStyle={{ bottom: '20px' }}
          />

          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <SlideScaler width={slideSize.width} height={slideSize.height} marginRate={1}>
              {slides[currentSlideIndex] && !slides[currentSlideIndex].isHidden && (
                <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                    <SlideView 
                      html={slides[currentSlideIndex].html}
                      pageNumber={slides[currentSlideIndex].pageNumber}
                      className={slides[currentSlideIndex].className}
                      isActive={true}
                      slideSize={slideSize}
                      isEnabledPointerEvents={mode === 'view'}
                      header={slides[currentSlideIndex].header}
                      footer={slides[currentSlideIndex].footer}
                      drawings={drawings[currentSlideIndex] || []}
                      onAddStroke={(stroke) => {
                        addStroke(currentSlideIndex, stroke);
                        send({ type: 'DRAW_STROKE', channelId, pageIndex: currentSlideIndex, stroke });
                      }}
                      isInteracting={mode === 'pen'}
                      toolType={toolType}
                      color={penColor}
                      lineWidth={penWidth}
                      penOnly={stylusOnly}
                    />
                </div>
              )}
            </SlideScaler>
          </div>
        </div>
      )}

      <div className="header" style={{ display: 'flex', flexDirection: 'row', justifyContent: 'flex-start', alignItems: 'center', padding: '0 1rem', gap: '1rem', height: '40px' }}>
        <div style={{ color: '#fff', fontWeight: 'bold', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '14em', flexShrink: 0, textAlign: 'left', cursor: 'default' }} title={currentFileName || "MDP"}>
          MDP {currentFileName ? ` - ${currentFileName}` : ""}
        </div>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0 }}>
          
           <Tooltip title="Switch to Remote Mode">
            <span>
              <Button 
                variant="text" 
                size="small" 
                onClick={handleSwitchToRemote}
                sx={{ color: '#eee', minWidth: '40px' }}
              >
                <SmartphoneIcon />
              </Button>
            </span>
          </Tooltip>

          <Tooltip title="Connect Remote">
            <span>
              <Button 
                variant="text" 
                size="small" 
                onClick={() => setIsConnectDialogOpen(true)}
                disabled={!currentFileName}
                sx={{ 
                  color: '#eee', 
                  minWidth: '40px',
                  '&.Mui-disabled': { color: 'rgba(255, 255, 255, 0.3)' } 
                }}
              >
                <DevicesIcon />
              </Button>
            </span>
          </Tooltip>
          <Tooltip title="Save Drawings to Markdown">
            <span>
              <Button 
                variant="text" 
                size="small" 
                onClick={handleSaveDrawingsToMarkdown}
                disabled={!currentFileName || currentFileType !== 'markdown'}
                sx={{ 
                  color: '#eee', 
                  minWidth: '40px',
                  '&.Mui-disabled': { color: 'rgba(255, 255, 255, 0.3)' } 
                }}
              >
                <SaveIcon />
              </Button>
            </span>
          </Tooltip>
          <Tooltip title="Open Presenter View">
            <span>
              <Button 
                variant="text" 
                size="small" 
                onClick={openPresenterTool}
                disabled={!currentFileName || currentFileType !== 'markdown'}
                sx={{ 
                  color: '#eee', 
                  minWidth: '40px',
                  '&.Mui-disabled': { color: 'rgba(255, 255, 255, 0.3)' } 
                }}
              >
                <PresentToAllIcon />
              </Button>
            </span>
          </Tooltip>
          <Tooltip title="Start Slideshow (F5)"><Button variant="text" size="small" onClick={toggleSlideshow} disabled={!currentFileName || currentFileType !== 'markdown'} sx={{ color: '#eee', minWidth: '40px', '&.Mui-disabled': { color: 'rgba(255, 255, 255, 0.3)' } }}><PlayArrowIcon /></Button></Tooltip>
          <Tooltip title="Print / Export PDF"><Button variant="text" size="small" onClick={handlePrint} disabled={!currentFileName || currentFileType !== 'markdown'} sx={{ color: '#eee', minWidth: '40px', '&.Mui-disabled': { color: 'rgba(255, 255, 255, 0.3)' } }}><PrintIcon /></Button></Tooltip>
          
          <Tooltip title="Slide Overview">
             <Button 
               variant="text" 
               size="small" 
               onClick={toggleSlideOverview}
               disabled={!currentFileName || currentFileType !== 'markdown'}
               sx={{ color: isSlideOverview ? '#90caf9' : '#eee', minWidth: '40px', '&.Mui-disabled': { color: 'rgba(255, 255, 255, 0.3)' } }}
             >
               <GridViewIcon />
             </Button>
          </Tooltip>
        </Stack>
      </div>

      {isSlideOverview ? (
        <div style={{
          flex: 1,
          overflowY: 'auto',
          backgroundColor: '#202020',
          padding: '2rem',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: '2rem',
          alignContent: 'flex-start'
        }}>
          {slides.map((slide, index) => (
            <div 
              key={index} 
              onClick={() => { setCurrentSlideIndex(index); setIsSlideOverview(false); }}
              style={{ 
                cursor: 'pointer',
                transform: index === currentSlideIndex ? 'scale(1.02)' : 'none',
                border: index === currentSlideIndex ? '2px solid #3b82f6' : '2px solid transparent',
                borderRadius: '6px',
                transition: 'transform 0.1s',
                display: slide.isHidden ? 'none' : 'auto',
              }}
            >
              <div style={{ pointerEvents: 'none', background: 'white', opacity: slide.isHidden ? 0.5 : 1, width: '100%', aspectRatio: `${slideSize.width} / ${slideSize.height}` }}>
                <SlideScaler width={slideSize.width} height={slideSize.height}>
                  <SlideView
                    html={slide.html}
                    pageNumber={slide.pageNumber}
                    className={slide.className}
                    isActive={true}
                    slideSize={slideSize}
                    isEnabledPointerEvents={false}
                    header={slide.header}
                    footer={slide.footer}
                    drawings={drawings[index]} 
                  />
                </SlideScaler>
              </div>
              <div style={{ padding: '8px', textAlign: 'center', color: '#ccc', fontSize: '0.9rem', backgroundColor: '#2a2a2a' }}>
                  Slide {index + 1}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="content">
          <Group orientation="horizontal">
            <Panel defaultSize={200} className="thumbnail-list-panel">
              <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <Box sx={{ borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}>
                  <Tabs value={leftTabIndex} onChange={handleLeftTabChange} variant="fullWidth">
                    <Tab label="Thumbnail" />
                    <Tab label="Files" />
                  </Tabs>
                </Box>
                <Box sx={{ flexGrow: 1, overflow: 'hidden' }}>
                  <CustomTabPanel value={leftTabIndex} index={0}>
                    {currentFileName && currentFileType === 'markdown' ? (
                      <div className="thumbnail-list">
                        {slides.map((slide, index) => (
                          <div key={index} style={{ opacity: slide.isHidden ? 0.5 : 1, marginBottom: '20px' }}>
                            <SlideThumbnail
                              htmlContent={slide.html}
                              slideSize={slideSize}
                              className={slide.className}
                              isActive={index === currentSlideIndex}
                              onClick={() => setCurrentSlideIndex(index)}
                              isCover={slide.isCover}
                              isHidden={slide.isHidden}
                              pageNumber={slide.pageNumber}
                              header={slide.header}
                              footer={slide.footer}
                              drawings={drawings[index]}
                            />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <Box sx={{ p: 2, color: '#888', textAlign: 'center', fontSize: '0.8rem' }}>
                        {currentFileName ? "Thumbnails available for Markdown only." : "No file selected."}
                      </Box>
                    )}
                  </CustomTabPanel>
                  <CustomTabPanel value={leftTabIndex} index={1}>
                    <Stack direction="row" spacing={1} sx={{ p: 1, borderBottom: '1px solid #555', bgcolor: 'white' }}>
                      <Tooltip title="Refresh List"><Button variant="outlined" size="small" onClick={handleManualRefresh} sx={{ minWidth: '30px', px: 1, color: '#000', borderColor: '#555' }}><RefreshIcon fontSize="small" /></Button></Tooltip>
                      <Button variant="outlined" size="small" onClick={() => handleCreate('file')} sx={{ minWidth: '30px', px: 1, color: '#000', borderColor: '#555' }}><NoteAddIcon fontSize="small" /></Button>
                      <Button variant="outlined" size="small" onClick={() => handleCreate('directory')} sx={{ minWidth: '30px', px: 1, color: '#000', borderColor: '#555' }}><CreateNewFolderIcon fontSize="small" /></Button>
                      <Tooltip title="Add New Diagram"><Button variant="outlined" size="small" onClick={handleCreateDrawio} disabled={!currentFileName || currentFileType !== 'markdown'} sx={{ minWidth: '30px', px: 1, color: '#000', borderColor: '#555' }}><AddPhotoAlternateIcon fontSize="small" /></Button></Tooltip>
                    </Stack>
                    <Box sx={{ p: 1, color: '#e0e0e0', fontSize: '0.9rem', overflowY: 'auto', overflowX: 'hidden' }}>
                      {fileTree.length > 0 ? (
                        fileTree.map(node => (
                          <FileTreeItem 
                            key={node.path} 
                            node={node} 
                            level={0} 
                            onSelect={(n) => loadFile(n.path, n.isBinary)} 
                          />
                        ))
                      ) : (
                        <Typography variant="body2" color="textSecondary" sx={{p:2}}>Loading...</Typography>
                      )}
                    </Box>
                  </CustomTabPanel>
                </Box>
              </Box>
            </Panel>
            <Separator className="resize-handle" />
            <Panel minSize={40} className="detail-panel">
              <Group orientation="vertical">
                  <Panel minSize={30} className="preview-panel">
                    <div className="preview-pane" style={{ backgroundColor: '#333', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                      {!currentFileName ? ( <EmptyState /> ) : currentFileType === 'markdown' ? (
                        <>
                          <SlideControls 
                            mode={mode} setMode={setMode}
                            pageIndex={currentSlideIndex} totalSlides={slides.length}
                            visible={showControls}
                            onNav={moveSlide}
                            onAddSlide={() => handleAddBlankSlide(currentSlideIndex)}
                            onSave={handleSaveDrawingsToMarkdown}
                            onClearDrawing={() => { clear(currentSlideIndex); send({ type: 'CLEAR_DRAWING', channelId, pageIndex: currentSlideIndex }); }}
                            
                            toolType={toolType} setToolType={setToolType}
                            penColor={penColor} setPenColor={setPenColor}
                            penWidth={penWidth} setPenWidth={setPenWidth}
                            canUndo={canUndo(currentSlideIndex)} canRedo={canRedo(currentSlideIndex)}
                            onUndo={() => undo(currentSlideIndex)} onRedo={() => redo(currentSlideIndex)}
                            containerStyle={{ bottom: '20px' }}
                             stylusOnly={stylusOnly}
                             setStylusOnly={setStylusOnly}
                          />

                          <SlideScaler width={slideSize.width} height={slideSize.height}>
                            {slides.map((slide, index) => (
                              index === currentSlideIndex && (
                                <div key={index} style={{ position: 'relative', width: '100%', height: '100%' }}>
                                    <SlideView
                                      html={slide.html}
                                      pageNumber={slide.pageNumber}
                                      className={slide.className}
                                      isActive={true}
                                      slideSize={slideSize}
                                      isEnabledPointerEvents={mode === 'view'} 
                                      header={slide.header}
                                      footer={slide.footer}
                                      
                                      drawings={drawings[index] || []}
                                      onAddStroke={(stroke) => {
                                        addStroke(index, stroke);
                                        send({ type: 'DRAW_STROKE', channelId, pageIndex: index, stroke });
                                      }}
                                      isInteracting={mode === 'pen'}
                                      toolType={toolType}
                                      color={penColor}
                                      lineWidth={penWidth}
                                      penOnly={stylusOnly}
                                    />
                                </div>
                              )
                            ))}
                          </SlideScaler>
                        </>
                      ) : ( <Typography variant="body1" sx={{ color: '#888' }}> {currentFileType === 'text' ? "No preview" : "Preview not available"} </Typography> )}
                    </div>
                  </Panel>
                  
                  <Separator className="resize-handle-row" />
                  
                  <Panel defaultSize={400}>
                    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                      <Box sx={{ borderBottom: 1, borderColor: 'divider', flexShrink: 0, bgcolor: 'background.paper' }}>
                        <Tabs value={bottomTabIndex} onChange={handleBottomTabChange}>
                          <Tab label="Note" />
                          <Tab label="Editor" />
                        </Tabs>
                      </Box>
                      <Box sx={{ flexGrow: 1, overflow: 'hidden', bgcolor: 'white', position: 'relative' }}>
                        
                        <CustomTabPanel value={bottomTabIndex} index={0}>
                          {!currentFileName ? (
                            <Box sx={{ p: 3, color: '#aaa', textAlign: 'center' }}>No file selected.</Box>
                          ) : currentFileType === 'markdown' ? (
                            <div style={{ padding: '1rem', height: '100%', overflowY: 'auto' }}>
                                {slides[currentSlideIndex]?.noteHtml ? <div style={{ fontSize: '0.95rem', lineHeight: '1.7' }} dangerouslySetInnerHTML={{ __html: slides[currentSlideIndex].noteHtml }} /> : <Typography variant="body2" color="text.disabled" sx={{ fontStyle: 'italic' }}>No notes.</Typography>}
                            </div>
                          ) : (
                            <Box sx={{ p: 2, color: '#aaa', fontStyle: 'italic' }}>Notes available for Markdown files only.</Box>
                          )}
                        </CustomTabPanel>

                        <CustomTabPanel value={bottomTabIndex} index={1} noScroll={true}>
                          {!currentFileName ? (
                            <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', bgcolor: '#f5f5f5' }}>
                              <Typography>No file selected</Typography>
                            </Box>
                          ) : (currentFileType === 'markdown' || currentFileType === 'text') ? (
                            <Group orientation="horizontal" style={{ height: '100%' }}>
                              <Panel minSize={50} defaultSize={75}>
                                <CodeMirror
                                  ref={editorRef}
                                  value={editorInitialValue}
                                  height="100%"
                                  className="full-height-editor"
                                  extensions={extensions}
                                  onChange={onChangeEditor}
                                  onUpdate={onEditorUpdate}
                                  theme="dark"
                                  basicSetup={CODEMIRROR_BASIC_SETUP}
                                />
                              </Panel>
                              <Separator className="resize-handle" />
                              <Panel minSize={10} defaultSize={25}>
                                <Box sx={{ height: '100%', overflowY: 'auto', bgcolor: '#f7f7f7', borderLeft: '1px solid #ddd' }}>
                                  <List subheader={<li />}>
                                    {snipets.map((section) => (
                                      <li key={section.category}>
                                        <Box component="ul" sx={{ p: 0, m: 0 }}>
                                          <ListSubheader sx={{ bgcolor: '#eee', lineHeight: '30px', fontWeight: 'bold' }}>
                                            {section.category}
                                          </ListSubheader>
                                          {section.items.map((item) => (
                                            <ListItem key={item.label} disablePadding>
                                              <ListItemButton 
                                                onClick={() => handleInsertText(item.text)}
                                                sx={{ py: 0.5 }}
                                              >
                                                {item.icon && (
                                                  <div 
                                                    style={{ marginRight: '8px', display: 'flex', alignItems: 'center', width: '20px', height: '20px', fill: 'currentColor' }}
                                                    dangerouslySetInnerHTML={{ __html: item.icon }}
                                                  />
                                                )}
                                                <ListItemText 
                                                  primary={item.label} 
                                                  primaryTypographyProps={{ fontSize: '0.85rem' }}
                                                  secondary={item.description}
                                                  secondaryTypographyProps={{ fontSize: '0.7rem' }}
                                                />
                                              </ListItemButton>
                                            </ListItem>
                                          ))}
                                          <Divider />
                                        </Box>
                                      </li>
                                    ))}
                                  </List>
                                </Box>
                              </Panel>
                            </Group>
                          ) : (
                            <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', bgcolor: '#f5f5f5', color: '#999', gap: 1 }}>
                              <Typography variant="h6">{currentFileType === 'limit-exceeded' ? "File Too Large" : "Editor Disabled"}</Typography>
                              <Typography variant="body2">{currentFileType === 'image' ? "Image file" : currentFileType === 'binary' ? "Binary file" : currentFileType === 'limit-exceeded' ? `Exceeds editor limit (${MAX_FILE_SIZE / 1024}KB)` : "Unknown file type"}</Typography>
                            </Box>
                          )}
                        </CustomTabPanel>
                      </Box>
                    </Box>
                  </Panel>
              </Group>
            </Panel>
          </Group>
        </div>
      )}
    </div>
  );
}

export default function AppRouter() {
  const path = window.location.pathname;
  if (path === '/presenter') return <PresenterTool />;
  if (path === '/remote') return <RemoteControl />;
  return <MainEditor />;
}