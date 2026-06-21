import { useEffect, useRef, useCallback, useMemo } from 'react';
import { ViewUpdate } from '@uiw/react-codemirror';
import { markdown as markdownLang } from '@codemirror/lang-markdown';
import { StateField, StateEffect, Prec, type Extension } from '@codemirror/state';
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
      // Map the caret to its slide via the already-parsed slide ranges
      // (slides[i].range = {startLine,endLine}). O(slides) — avoids re-scanning the
      // whole document for `---` on every keystroke AND every caret move (the old
      // line-1→caret scan was O(document)). Ranges come from the debounced parse so
      // they can lag a beat while typing; the active-slide sync then settles.
      const currentLine = viewUpdate.state.doc.lineAt(viewUpdate.state.selection.main.head).number;
      let newIndex = currentSlideIndex;
      if (slides.length > 0) {
        let found = -1;
        for (let i = 0; i < slides.length; i++) {
          const r = slides[i]?.range;
          if (!r) continue;
          // caret inside slide i, or in the gap/meta page before it → slide i
          if (currentLine <= r.endLine) { found = i; break; }
        }
        newIndex = found === -1 ? slides.length - 1 : found;
      }

      if (newIndex !== currentSlideIndex) {
        isSyncingFromEditor.current = true;
        setCurrentSlideIndex(newIndex);
      }
    }
  }, [currentSlideIndex, currentFileType, slides, setCurrentSlideIndex, isLoadingFile, setDrawioButtonPos, setDrawioEditTarget]);

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