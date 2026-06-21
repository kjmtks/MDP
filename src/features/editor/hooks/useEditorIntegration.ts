import { useEffect, useRef, useCallback, useMemo } from 'react';
import { ViewUpdate } from '@uiw/react-codemirror';
import { markdown as markdownLang } from '@codemirror/lang-markdown';
import { StateField, StateEffect, Prec, type Extension, type Text } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, keymap } from '@codemirror/view';
import { loadLanguage } from '@uiw/codemirror-extensions-langs';

import { drawingCollapsePlugin } from '../extensions/DrawCollapsePlugin';
import { drawioCollapsePlugin } from '../extensions/DrawioCollapsePlugin';
import { imageDropPasteHandler } from '../extensions/imageDropPasteHandler';
import { base64Folding } from '../base64Folding';
import { noteCollapsePlugin } from '../extensions/NoteCollapsePlugin';
import { themeCollapsePlugin } from '../extensions/ThemeCollapsePlugin';
import { imageDefCollapsePlugin } from '../extensions/ImageDefCollapsePlugin';
import { moduleSettingsPlugin } from '../extensions/ModuleSettingsPlugin';
import { tagSettingsPlugin } from '../extensions/TagSettingsPlugin';
import { moduleRegionPlugin } from '../extensions/ModuleRegionPlugin';
import { useAppSettings } from '../../settings/AppSettingsContext';
import { resolveKeys } from '../../settings/shortcuts/matcher';
import { actionById } from '../../settings/shortcuts/registry';

interface UseEditorIntegrationProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editorRef: any;
  currentFileType: string;
  currentSlideIndex: number;
  setCurrentSlideIndex: (idx: number) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  slides: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  isLoadingFile: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prevSlideIndexRef: any;
  setDrawioButtonPos: (pos: {top: number, left: number} | null) => void;
  setDrawioEditTarget: (target: {base64: string, lineNo: number} | null) => void;
  handleSave: () => void;
  setMarkdown: (md: string) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  markdownRef: any;
  currentFileName: string | null;
}

function moveSlideInEditor(view: EditorView, dir: number): boolean {
  const doc = view.state.doc;
  const currentLineNumber = doc.lineAt(view.state.selection.main.head).number;
  const hrLines: number[] = [];
  for (let i = 1; i <= doc.lines; i++) {
    if (doc.line(i).text.trim() === '---') hrLines.push(i);
  }
  let target = 1;
  if (dir < 0) {
    const prev = hrLines.filter(l => l < currentLineNumber);
    target = prev.length >= 2 ? prev[prev.length - 2] + 1 : 1;
  } else {
    const next = hrLines.filter(l => l > currentLineNumber);
    target = next.length > 0 ? Math.min(next[0] + 1, doc.lines) : doc.lines;
  }
  const targetPos = doc.line(target).from;
  view.dispatch({
    selection: { anchor: targetPos, head: targetPos },
    effects: EditorView.scrollIntoView(targetPos, { y: 'start' }),
  });
  view.focus();
  return true;
}

// Line numbers (1-based) of `---` slide separators, fence-aware (mirrors
// splitMarkdownToBlocks). Drives the live active-slide sync below.
function computeSeparatorLines(doc: Text): number[] {
  const seps: number[] = [];
  let inCode = false;
  for (let i = 1; i <= doc.lines; i++) {
    const t = doc.line(i).text.trim();
    if (t.startsWith('```')) inCode = !inCode;
    else if (!inCode && t === '---') seps.push(i);
  }
  return seps;
}

// True when an edit may have added/removed/altered a `---` separator or a ```
// fence line (→ the cached separator list must be recomputed). Plain text edits
// that keep the line count and don't touch a `---`/``` line return false, so the
// cache is reused and active-slide sync stays O(log n).
function separatorsMayHaveChanged(vu: ViewUpdate): boolean {
  if (vu.startState.doc.lines !== vu.state.doc.lines) return true;
  const hasMarker = (doc: Text, from: number, to: number): boolean => {
    const s = doc.lineAt(from).number, e = doc.lineAt(to).number;
    for (let i = s; i <= e; i++) {
      const t = doc.line(i).text.trim();
      if (t === '---' || t.startsWith('```')) return true;
    }
    return false;
  };
  let maybe = false;
  vu.changes.iterChanges((fromA, toA, fromB, toB) => {
    if (!maybe && (hasMarker(vu.startState.doc, fromA, toA) || hasMarker(vu.state.doc, fromB, toB))) maybe = true;
  });
  return maybe;
}

export const activeSlideEffect = StateEffect.define<{from: number, to: number}>();

export const activeSlideTheme = StateField.define<DecorationSet>({
  create() { return Decoration.none; },
  update(decos, tr) {
    decos = decos.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(activeSlideEffect)) {
        const { from, to } = e.value;
        const lineDeco = Decoration.line({ class: "cm-activeSlide" });
        const builder = [];
        const doc = tr.state.doc;
        let pos = from;
        while (pos <= to && pos <= doc.length) {
          const line = doc.lineAt(pos);
          builder.push(lineDeco.range(line.from));
          if (line.to >= doc.length) break;
          pos = line.to + 1;
        }
        decos = Decoration.set(builder, true);
      }
    }
    return decos;
  },
  provide: f => EditorView.decorations.from(f)
});

export const useEditorIntegration = ({
  editorRef, currentFileType, currentSlideIndex, setCurrentSlideIndex, slides,
  isLoadingFile, prevSlideIndexRef, setDrawioButtonPos, setDrawioEditTarget,
  handleSave, setMarkdown, markdownRef, currentFileName
}: UseEditorIntegrationProps) => {
  const { settings } = useAppSettings();
  const isSyncingFromEditor = useRef(false);
  const prevActiveFileRef = useRef(currentFileName);
  // Cached `---` separator line numbers for the live active-slide sync, with the
  // doc line count they were computed for (recomputed only on separator-changing edits).
  const sepCacheRef = useRef<{ lines: number; seps: number[] } | null>(null);

  const onEditorUpdate = useCallback((viewUpdate: ViewUpdate) => {
    if (currentFileType !== 'markdown' || isLoadingFile.current || !viewUpdate.view.hasFocus) return;

    if (viewUpdate.selectionSet || viewUpdate.docChanged || viewUpdate.viewportChanged) {
        const line = viewUpdate.state.doc.lineAt(viewUpdate.state.selection.main.head);
        const match = line.text.match(/^\s*!\[@drawio\]\(([^)]*)\)\s*$/);
        if (match) {
          const coords = viewUpdate.view.coordsAtPos(line.to);
          if (coords) {
              const rawBase64 = match[1].trim().replace(/^data:image\/svg\+xml;base64,/, '');
              setDrawioButtonPos({ top: coords.top, left: coords.right + 20 });
              setDrawioEditTarget({ base64: rawBase64, lineNo: line.number });
          }
        } else {
          setDrawioButtonPos(null); setDrawioEditTarget(null);
        }
    }

    if (viewUpdate.selectionSet || viewUpdate.docChanged) {
      // LIVE active-slide sync: count `---` separators before the caret from the
      // CURRENT doc, so the preview/thumbnail follow the caret immediately (no
      // debounce lag). The separator-line list is cached and only recomputed when
      // an edit could have changed it (line-count change, or a `---`/``` line
      // touched) — so plain typing and caret moves stay O(log n), not O(document).
      const doc = viewUpdate.state.doc;
      const cache = sepCacheRef.current;
      const seps = (cache && cache.lines === doc.lines && !(viewUpdate.docChanged && separatorsMayHaveChanged(viewUpdate)))
        ? cache.seps
        : computeSeparatorLines(doc);
      sepCacheRef.current = { lines: doc.lines, seps };

      const currentLine = doc.lineAt(viewUpdate.state.selection.main.head).number;
      // upper bound: number of separators on a line <= currentLine
      let lo = 0, hi = seps.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (seps[mid] <= currentLine) lo = mid + 1; else hi = mid; }
      const newIndex = Math.min(Math.max(0, lo - 1), Math.max(0, slides.length - 1));

      if (newIndex !== currentSlideIndex) {
        isSyncingFromEditor.current = true;
        setCurrentSlideIndex(newIndex);
      }
    }
  }, [currentSlideIndex, currentFileType, slides.length, setCurrentSlideIndex, isLoadingFile, setDrawioButtonPos, setDrawioEditTarget]);

  // Editor keymaps are built from the central shortcut registry (combos use the
  // CodeMirror `Mod-` syntax), so remapping `editor.save` / slide-nav in Settings
  // reconfigures CodeMirror live.
  const saveKeymap = useMemo(
    () => keymap.of(
      resolveKeys(actionById('editor.save')!, settings).map((key) => ({
        key, run: () => { handleSave(); return true; }, preventDefault: true,
      })),
    ),
    [handleSave, settings],
  );

  const slideNavKeymap = useMemo(() => {
    const isSlide = !!currentFileName?.endsWith('.slide.md');
    const prevKeys = resolveKeys(actionById('editor.slidePrev')!, settings);
    const nextKeys = resolveKeys(actionById('editor.slideNext')!, settings);
    return Prec.high(keymap.of([
      ...prevKeys.map((key) => ({ key, run: (v: EditorView) => (isSlide ? moveSlideInEditor(v, -1) : false), preventDefault: isSlide })),
      ...nextKeys.map((key) => ({ key, run: (v: EditorView) => (isSlide ? moveSlideInEditor(v, 1) : false), preventDefault: isSlide })),
    ]));
  }, [currentFileName, settings]);

  const extensions = useMemo(() => {
    const baseExts: Extension[] = [
      EditorView.lineWrapping,
      saveKeymap,
      slideNavKeymap,
      drawioCollapsePlugin,
      drawingCollapsePlugin,
      imageDropPasteHandler,
      base64Folding,
      imageDefCollapsePlugin,
      activeSlideTheme,
      noteCollapsePlugin,
      themeCollapsePlugin,
      moduleSettingsPlugin,
      tagSettingsPlugin,
      moduleRegionPlugin,
    ];

    const ext = currentFileName?.split('.').pop()?.toLowerCase();
    if (currentFileName?.endsWith('.mdpmod.xml')) {
      const xmlLang = loadLanguage('xml');
      if (xmlLang) baseExts.unshift(xmlLang);
    } else if (!ext || ext === 'md') {
      baseExts.unshift(markdownLang());
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const langExt = loadLanguage(ext as any);
      if (langExt) {
        baseExts.unshift(langExt);
      }
    }

    return baseExts;
  }, [saveKeymap, slideNavKeymap, currentFileName]);

  useEffect(() => {
    const view = editorRef.current?.view;
    if (currentFileType !== 'markdown' || !view || !slides || slides.length === 0) return;

    const doc = view.state.doc;
    let startLine = 1;
    let endLine = doc.lines;
    let currentBlock = 0;
    let inCodeBlock = false;

    const targetBlock = currentSlideIndex + 1;

    for (let i = 1; i <= doc.lines; i++) {
        const text = doc.line(i).text.trim();
        if (text.startsWith('```')) inCodeBlock = !inCodeBlock;

        if (!inCodeBlock && /^---$/.test(text)) {
            if (currentBlock === targetBlock) {
                endLine = i - 1;
                break;
            }
            currentBlock++;
            if (currentBlock === targetBlock) {
                startLine = i + 1;
            }
        }
    }

    const startPos = doc.line(startLine).from;
    const endPos = Math.max(startPos, doc.line(endLine).to);

    const effects = [activeSlideEffect.of({ from: startPos, to: endPos })];

    // When the active file changed (tab switch), keep each editor's own cursor/scroll
    // and only refresh the slide highlight — do not jump the caret to the slide start.
    const fileChanged = prevActiveFileRef.current !== currentFileName;
    prevActiveFileRef.current = currentFileName;

    if (isSyncingFromEditor.current || view.hasFocus || fileChanged) {
      view.dispatch({ effects });
      isSyncingFromEditor.current = false;
    } else {
      view.dispatch({
        selection: { anchor: startPos },
        effects: [
          ...effects,
          EditorView.scrollIntoView(startPos, { y: "start", yMargin: 0 })
        ]
      });
    }

    prevSlideIndexRef.current = currentSlideIndex;
    if (isLoadingFile.current) setTimeout(() => { isLoadingFile.current = false; }, 150);

  }, [currentSlideIndex, currentFileName, editorRef, slides, currentFileType, isLoadingFile, prevSlideIndexRef]);

  const handleInsertText = useCallback((text: string) => {
    const view = editorRef.current?.view;
    if (!view) return;
    const transaction = view.state.replaceSelection(text);
    view.dispatch(transaction);
    view.focus();
  }, [editorRef]);

  const onChangeEditor = useCallback((val: string) => {
    setMarkdown(val);
    if (markdownRef.current !== undefined) markdownRef.current = val;
  }, [setMarkdown, markdownRef]);

  return { onEditorUpdate, extensions, handleInsertText, onChangeEditor };
};