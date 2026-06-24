import { useCallback, useRef, useEffect } from 'react';
import { splitMarkdownToBlocks } from '../../../features/slide/parser/slideParser';
import type { Stroke } from '../../../features/drawing/components/DrawingOverlay';
import { apiClient } from '../../../api/apiClient';
import { stripDrawingData } from '../../../utils/drawingBaseline';

interface UseAppActionsProps {
  currentFileName: string | null;
  markdown: string;
  setMarkdown: (md: string) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  markdownRef: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editorRef: any;
  drawings: Record<number, Stroke[]>;
  insertPage: (page: number) => void;
  syncDrawings: (drawings: Record<number, Stroke[]>) => void;
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

export const useAppActions = ({
  currentFileName, markdown, setMarkdown, markdownRef, editorRef, drawings, insertPage, syncDrawings
}: UseAppActionsProps) => {

  const prevTagsRef = useRef<Record<number, string | null>>({});

  const latestDrawingsRef = useRef(drawings);
  useEffect(() => { latestDrawingsRef.current = drawings; }, [drawings]);

  useEffect(() => {
    const handler = setTimeout(() => {
      const blocks = splitMarkdownToBlocks(markdown);
      const currentTags: Record<number, string | null> = {};
      let needsSync = false;
      const newDrawings = { ...latestDrawingsRef.current };

      blocks.slice(1).forEach((block, index) => {
        const anchorRegex = new RegExp('<' + '!--\\s*@drawing:\\s*([a-zA-Z0-9]+)\\s*--' + '>');
        const match = block.rawContent.match(anchorRegex);
        currentTags[index] = match ? match[1] : null;

        const prevTag = prevTagsRef.current[index];
        const currentTag = currentTags[index];

        if (prevTag !== currentTag) {
          if (!currentTag && prevTag) {
            delete newDrawings[index];
            needsSync = true;

          } else if (currentTag) {
            const map = getDrawingMap();
            const base64 = map.get(currentTag);
            if (base64) {
              try {
                const binString = atob(base64);
                const bytes = new Uint8Array(binString.length);
                for (let i = 0; i < binString.length; i++) {
                    bytes[i] = binString.charCodeAt(i);
                }
                const json = new TextDecoder().decode(bytes);

                newDrawings[index] = JSON.parse(json);
                needsSync = true;
              } catch (e) {
                console.error("Failed to restore drawing data", e);
              }
            }
          }
        }
      });
      if (needsSync) {
        syncDrawings(newDrawings);
      }

      prevTagsRef.current = currentTags;
    }, 500);

    return () => clearTimeout(handler);
  }, [markdown, syncDrawings]);

  const handleAddBlankSlide = useCallback(async (insertAfterIndex: number) => {
    if (!currentFileName || !markdown) return;
    insertPage(insertAfterIndex + 1);
    const contents = splitMarkdownToBlocks(markdown).map(b => b.rawContent);
    contents.splice(insertAfterIndex + 2, 0, "\n\n");
    const newMarkdown = contents.join('\n---\n');
    setMarkdown(newMarkdown);
    if (markdownRef.current !== undefined) markdownRef.current = newMarkdown;
    if (editorRef.current?.view) {
        editorRef.current.view.dispatch({ changes: { from: 0, to: editorRef.current.view.state.doc.length, insert: newMarkdown } });
    }
  }, [currentFileName, markdown, insertPage, setMarkdown, markdownRef, editorRef]);

  const handleSaveDrawingsToMarkdown = useCallback(async () => {
    if (!currentFileName || !markdown) return;

    // Guard against clobbering external edits. This is an AUTOMATIC write-back of
    // the in-memory markdown, so only proceed when the on-disk TEXT (ignoring
    // drawing data) still equals the editor's text. If they differ — the file was
    // changed externally, or the editor has unsaved text edits — skip, so we never
    // overwrite an external change with stale in-memory data.
    try {
      const diskNow = await apiClient.readFileText(currentFileName);
      if (stripDrawingData(diskNow) !== stripDrawingData(markdown)) {
        console.warn('[MDP] Drawing auto-save skipped: file changed on disk (external edit or unsaved text) — not overwriting.');
        return;
      }
    } catch {
      return; // can't read disk → don't risk an overwrite
    }

    let isTextModified = false;
    const map = getDrawingMap();
    const seenIds = new Set<string>();

    const contents = splitMarkdownToBlocks(markdown).map((block, index) => {
      const slideIndex = index - 1;
      if (slideIndex < 0) return block.rawContent;

      const strokes = drawings[slideIndex];
      let text = block.rawContent;

      const anchorRegex = new RegExp('<' + '!--\\s*@drawing:\\s*([a-zA-Z0-9]+)\\s*--' + '>');
      let match = text.match(anchorRegex);

      if (match && seenIds.has(match[1])) {
          text = text.replace(new RegExp('\\n*<' + '!--\\s*@drawing:\\s*' + match[1] + '\\s*--' + '>', 'g'), '');
          match = null;
      }
      if (match) seenIds.add(match[1]);

      if (strokes && strokes.length > 0) {
        const jsonStr = JSON.stringify(strokes);
        const bytes = new TextEncoder().encode(jsonStr);
        const binString = Array.from(bytes, (byte) => String.fromCodePoint(byte)).join("");
        const base64 = btoa(binString);

        if (match) {
          map.set(match[1], base64);
        } else {
          const id = Math.random().toString(36).substring(2, 10);
          map.set(id, base64);
          text = `${text.trimEnd()}\n\n` + '<' + `!-- @drawing: ${id} --` + `>\n`;
          isTextModified = true;
        }
      } else {
        if (match) {
          text = text.replace(new RegExp('\\n*<' + '!--\\s*@drawing:\\s*' + match[1] + '\\s*--' + '>', 'g'), '');
          isTextModified = true;
        }
      }
      return text;
    });

    const newMarkdown = contents.join('\n---\n');

    if (isTextModified) {
      if (editorRef.current?.view) {
        const view = editorRef.current.view;
        view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: newMarkdown },
            selection: { anchor: Math.min(view.state.selection.main.anchor, newMarkdown.length) }
        });
      }
      setMarkdown(newMarkdown);
      if (markdownRef.current !== undefined) markdownRef.current = newMarkdown;
    }

    try {
        let textToSave = newMarkdown;
        const anchorRegexGlobal = new RegExp('<' + '!--\\s*@drawing:\\s*([a-zA-Z0-9]+)\\s*--' + '>', 'g');

        textToSave = textToSave.replace(anchorRegexGlobal, (m, id) => {
            const base64 = map.get(id);
            return base64 ? '<' + '!-- @draw: ' + base64 + ' --' + '>' : m;
        });

        await apiClient.saveFile(currentFileName, textToSave);
    } catch (e) {
        console.error("Auto-save failed", e);
    }

  }, [currentFileName, markdown, drawings, setMarkdown, markdownRef, editorRef]);

  return { handleAddBlankSlide, handleSaveDrawingsToMarkdown };
};