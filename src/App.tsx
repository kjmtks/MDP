import { useState, useMemo, useCallback, useEffect, useRef } from 'react';

import PrintIcon from '@mui/icons-material/Print';
import RefreshIcon from '@mui/icons-material/Refresh';
import NoteAddIcon from '@mui/icons-material/NoteAdd';
import CreateNewFolderIcon from '@mui/icons-material/CreateNewFolder';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';

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
import './App.css';

const INITIAL_MARKDOWN = "";
const MAX_FILE_SIZE = 500 * 1024;
const BASE_HEIGHT = 720;

interface ShortcutItem {
  label: string;
  text: string;
  description?: string;
}
interface SnipetsCategory {
  category: string;
  items: ShortcutItem[];
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


class CollapseWidget extends WidgetType {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  eq(_other: CollapseWidget) { return true; }
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
    editBtn.style.cssText = `
      background-color: #1976d2;
      color: white;
      border: none;
      border-radius: 3px;
      padding: 2px 8px;
      font-size: 0.5em;
      cursor: pointer;
      line-height: 1.0;
      font-family: sans-serif;
    `;
    editBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const event = new CustomEvent('open-drawio-editor', {
        bubbles: true,
        detail: { target: editBtn } 
      });
      window.dispatchEvent(event);
    };
    wrapper.appendChild(textSpan);
    wrapper.appendChild(editBtn);
    return wrapper;
  }
}

const drawioCollapsePlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  ranges: { from: number, to: number }[] = [];
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
    const found = [];
    const text = view.state.doc.toString();
    const regex = /!\[@drawio\]\([^)]*\)/g;
    let match;
    while ((match = regex.exec(text))) {
      const start = match.index;
      const length = match[0].length;
      const from = start + 11;
      const to = start + length - 1;
      found.push({ from, to });
    }
    return found;
  }
  build(view: EditorView) {
    const builder = new RangeSetBuilder<Decoration>();
    const { from: selFrom, to: selTo } = view.state.selection.main;
    for (const { from, to } of this.ranges) {
      const syntaxStart = from - 11;
      const syntaxEnd = to + 1;
      const isCursorInside = (selFrom >= syntaxStart && selFrom <= syntaxEnd) || 
                             (selTo >= syntaxStart && selTo <= syntaxEnd);
      if (!isCursorInside) {
        builder.add(from, to, Decoration.replace({
          widget: new CollapseWidget(),
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
function App() {
  const [markdown, setMarkdown] = useState<string>(INITIAL_MARKDOWN);
  const [editorInitialValue, setEditorInitialValue] = useState<string>(INITIAL_MARKDOWN);
  const [debouncedMarkdown, setDebouncedMarkdown] = useState<string>(INITIAL_MARKDOWN);
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [lastUpdated, setLastUpdated] = useState<number>(Date.now());
  const [snipets, setSnipets] = useState<SnipetsCategory[]>([]);
  const [templateContent, setTemplateContent] = useState<string>("# New Slide\n\nContent...");
  const [currentSlideIndex, setCurrentSlideIndex] = useState<number>(1);
  const [currentFileName, setCurrentFileName] = useState<string | null>(null);
  const [currentFileType, setCurrentFileType] = useState<FileType>('markdown');
  const [leftTabIndex, setLeftTabIndex] = useState(0);
  const [bottomTabIndex, setBottomTabIndex] = useState(1);
  const [isSlideshow, setIsSlideshow] = useState(false);
  const slideshowRef = useRef<HTMLDivElement>(null);
  const [isLaserPointer, setIsLaserPointer] = useState(false);
  const [isDrawioModalOpen, setIsDrawioModalOpen] = useState(false);
  const [drawioEditTarget, setDrawioEditTarget] = useState<{ base64: string, lineNo: number } | null>(null);

  const lastWheelTime = useRef(0);
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const isSyncingFromEditor = useRef(false);
  const prevSlideIndexRef = useRef(currentSlideIndex);
  const markdownRef = useRef(INITIAL_MARKDOWN);

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

  const toggleSlideshow = useCallback(() => {
    if (!document.fullscreenElement) {
      setIsSlideshow(true);
      setIsLaserPointer(false);
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
      setIsLaserPointer(false);
    }
  }, [currentSlideIndex, slides]);

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

  const loadFile = useCallback((fileName: string, isBinaryFromServer?: boolean, initialPage: number = 0) => {
    if (fileName.startsWith('http://') || fileName.startsWith('https://')) {
      alert("外部URLの読み込みはサポートしていません。");
      return;
    }
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
        setLastUpdated(Date.now());
        prevSlideIndexRef.current = -1;
      })
      .catch(err => {
        if (err.message === 'FILE_TOO_LARGE') {
          setCurrentFileType('limit-exceeded');
          setMarkdown("");
          setDebouncedMarkdown("");
          setEditorInitialValue("");
        } else {
          console.error("Failed to fetch content:", err);
          alert(`ファイルの読み込みに失敗しました。\n(Error: ${err.message})`);
        }
      });
  }, []);

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
      if (['ArrowRight', 'ArrowDown', ' ', 'Enter', 'PageDown'].includes(e.key)) {
        e.preventDefault();
        moveSlide(1);
      } else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) {
        e.preventDefault();
        moveSlide(-1);
      } else if (e.key === 'b') {
        setIsLaserPointer(prev => !prev);
      }
    };
    const handleWheel = (e: WheelEvent) => {
      const now = Date.now();
      if (now - lastWheelTime.current < 0) return;
      if (e.deltaY > 0) {
        lastWheelTime.current = now;
        moveSlide(1);
      } else if (e.deltaY < 0) {
        lastWheelTime.current = now;
        moveSlide(-1);
      }
    };
    const handleClick = (e: MouseEvent) => {
      if (e.button === 0 && isLaserPointer) {
        moveSlide(1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('wheel', handleWheel);
    window.addEventListener('mousedown', handleClick);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('mousedown', handleClick);
    };
  }, [isLaserPointer, isSlideshow, moveSlide]);

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
    const connectWs = () => {
      try {
        ws = new WebSocket(`${wsProtocol}//${wsHost}`);
        ws.onopen = () => console.log("Connected to file watcher");
        ws.onmessage = (event) => {
          if (event.data === 'file-change') {
            fetchFileTree();
          }
        };
        ws.onclose = () => setTimeout(connectWs, 5000);
      } catch (e) {
        console.error("WS connection error:", e);
      }
    };
    connectWs();
    return () => { if (ws) ws.close(); };
  }, [fetchFileTree, loadFile]);

  const saveKeymap = useMemo(() => {
    return keymap.of([{ key: "Mod-s", run: () => { handleSave(); return true; }, preventDefault: true }]);
  }, [handleSave]);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleOpenDrawio = (e: any) => {
      const target = e.detail.target as HTMLElement; 
      const view = editorRef.current?.view;
      if (view && target) {
        try {
          const pos = view.posAtDOM(target);
          const line = view.state.doc.lineAt(pos);
          const text = line.text;
          const match = text.match(/!\[@drawio\]\(([^)]*)\)/);
          if (match) {
             const base64 = match[1];
             setDrawioEditTarget({ base64, lineNo: line.number });
             setIsDrawioModalOpen(true);
          }
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
  ], [saveKeymap]);

  useEffect(() => {
    if (currentFileType !== 'markdown') return;
    if (isSyncingFromEditor.current) {
      isSyncingFromEditor.current = false;
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

  }, [currentSlideIndex, slides, currentFileType]);


  const handleLeftTabChange = (_: React.SyntheticEvent, newValue: number) => setLeftTabIndex(newValue);
  const handleBottomTabChange = (_: React.SyntheticEvent, newValue: number) => setBottomTabIndex(newValue);
  const onChangeEditor = useCallback((val: string) => setMarkdown(val), []);
  const onEditorUpdate = useCallback((viewUpdate: ViewUpdate) => {
    if (currentFileType !== 'markdown') return;
    if (!viewUpdate.view.hasFocus) return;
    if (slides.length === 0) return;
    if (viewUpdate.selectionSet) {
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
    <Box sx={{ 
      height: '100%', 
      width: '100%',
      display: 'flex', 
      flexDirection: 'column', 
      alignItems: 'center', 
      justifyContent: 'center', 
      bgcolor: '#202020', 
      color: '#888',
      gap: 2
    }}>
      <Typography variant="h5" color="#ccc">No File Selected</Typography>
      <Typography variant="body2">
        Select a file from the list on the left to start editing.
      </Typography>
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
      <div className="print-container">
        <style>{`
          @media print {
            @page {
              size: ${slideSize.width}px ${slideSize.height}px;
              margin: 0;
            }
            .print-slide-page {
              width: ${slideSize.width}px !important;
              height: ${slideSize.height}px !important;
            }
          }
        `}</style>
        {slides.map((slide, index) => (
          !slide.isHidden && (
            <div key={index} className="print-slide-page">
              <SlideView 
                html={slide.html}
                pageNumber={slide.pageNumber}
                className={slide.className}
                isActive={true}
                slideSize={slideSize}
              />
            </div>
          )
        ))}
      </div>

      {isSlideshow && (
        <div 
          ref={slideshowRef} 
          className={`slideshow-overlay ${isLaserPointer ? 'laser-mode' : ''}`}
        >
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <SlideScaler width={slideSize.width} height={slideSize.height} marginRate={1}>
              {slides[currentSlideIndex] && !slides[currentSlideIndex].isHidden && (
                <SlideView
                  html={slides[currentSlideIndex].html}
                  pageNumber={slides[currentSlideIndex].pageNumber}
                  className={slides[currentSlideIndex].className}
                  isActive={true}
                  slideSize={slideSize}
                  isEnabledPointerEvents={!isLaserPointer}
                />
              )}
            </SlideScaler>
          </div>
        </div>
      )}

      <div className="header" style={{ 
        display: 'flex', 
        flexDirection: 'row',
        justifyContent: 'flex-start',
        alignItems: 'center', 
        padding: '0 1rem',
        gap: '1rem',
        height: '40px' 
      }}>
        
        <div style={{ 
          color: '#fff', 
          fontWeight: 'bold', 
          whiteSpace: 'nowrap', 
          overflow: 'hidden', 
          textOverflow: 'ellipsis',
          width: '14em',
          maxWidth: '14em', 
          flexShrink: 0, 
          textAlign: 'left'
        }} title={currentFileName || "MDP"}>
          MDP {currentFileName ? ` - ${currentFileName}` : ""}
        </div>
        
        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0 }}>
          <Tooltip title="Start Slideshow (F5)">
            <span>
              <Button 
                variant="text" 
                size="small" 
                onClick={toggleSlideshow}
                disabled={!currentFileName || currentFileType !== 'markdown'}
                sx={{ 
                  color: '#eee', 
                  minWidth: '40px',
                  '&.Mui-disabled': { color: 'rgba(255, 255, 255, 0.3)' }
                }}
              >
                <PlayArrowIcon />
              </Button>
            </span>
          </Tooltip>
          <Tooltip title="Print / Export PDF">
            <span>
              <Button 
                variant="text" 
                size="small" 
                onClick={handlePrint}
                disabled={!currentFileName || currentFileType !== 'markdown'}
                sx={{ 
                  color: '#eee', 
                  minWidth: '40px',
                  '&.Mui-disabled': { 
                    color: 'rgba(255, 255, 255, 0.3)' 
                  }
                }}
              >
                <PrintIcon />
              </Button>
            </span>
          </Tooltip>
        </Stack>
      </div>

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
                        <div key={index} style={{ opacity: slide.isHidden ? 0.5 : 1 }}>
                          <SlideThumbnail
                            htmlContent={slide.html}
                            slideSize={slideSize}
                            className={slide.className}
                            isActive={index === currentSlideIndex}
                            onClick={() => setCurrentSlideIndex(index)}
                            isCover={slide.isCover}
                            isHidden={slide.isHidden}
                            pageNumber={slide.pageNumber}
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
                    
                    <Tooltip title="Refresh List">
                      <Button variant="outlined" size="small" onClick={handleManualRefresh} sx={{ minWidth: '30px', px: 1, color: '#000', borderColor: '#555' }}>
                        <RefreshIcon fontSize="small" />
                      </Button>
                    </Tooltip>

                    <Tooltip title="New File">
                      <Button variant="outlined" size="small" onClick={() => handleCreate('file')} sx={{ minWidth: '30px', px: 1, color: '#000', borderColor: '#555' }}>
                        <NoteAddIcon fontSize="small" />
                      </Button>
                    </Tooltip>

                    <Tooltip title="New Folder">
                      <Button variant="outlined" size="small" onClick={() => handleCreate('directory')} sx={{ minWidth: '30px', px: 1, color: '#000', borderColor: '#555' }}>
                        <CreateNewFolderIcon fontSize="small" />
                      </Button>
                    </Tooltip>

                  </Stack>
                  <Box sx={{ p: 1, color: '#e0e0e0', fontSize: '0.9rem', overflowY: 'auto' }}>
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
                    {!currentFileName ? (
                      <EmptyState />
                    ) : currentFileType === 'markdown' ? (
                      <SlideScaler width={slideSize.width} height={slideSize.height}>
                        {slides.map((slide, index) => (
                        <SlideView
                            key={index}
                            html={slide.html}
                            pageNumber={slide.pageNumber}
                            className={slide.className}
                            isActive={index === currentSlideIndex}
                            slideSize={slideSize}
                            isEnabledPointerEvents={true}
                          />
                        ))}
                      </SlideScaler>
                    ) : currentFileType === 'image' ? (
                      <img src={`/files/${currentFileName}`} alt={currentFileName} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                    ) : (
                      <Typography variant="body1" sx={{ color: '#888' }}>
                        {currentFileType === 'text' ? "No preview for text files" : 
                         currentFileType === 'limit-exceeded' ? "File too large to preview" : "Preview not available"}
                      </Typography>
                    )}
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
                                basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true }}
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
    </div>
  );
}

export default App;