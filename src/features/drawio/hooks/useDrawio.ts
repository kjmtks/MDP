import { useState, useCallback, useEffect } from 'react';
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { apiClient } from '../../../api/apiClient';
import { reportError } from '../../../components/error/errorReporter';
import { invalidateSvg } from '../../slide/inlineSvg';

// What the drawio dialog is editing. `base64` is the SVG (with its embedded
// diagram) as base64 text. For an EMBEDDED diagram (`![@drawio](data:…)`) the
// save rewrites that markdown line; for a FILE reference (`![@drawio](figs/x.drawio.svg)`)
// `filePath`/`cacheKey` are set and the save writes the SVG back to that file
// instead, leaving the markdown untouched.
export interface DrawioEditTarget {
  base64: string;
  lineNo: number;
  filePath?: string;   // workspace path (normalised) to write back to
  cacheKey?: string;   // inline-SVG cache key as SlideView builds it (un-normalised)
}

const isDataUri = (s: string) => /^data:image\/svg\+xml/i.test(s);
// A `![@drawio](…)` value that is a workspace path rather than base64 payload.
const looksLikeFilePath = (s: string) => /\.svg(\?.*)?$/i.test(s.trim()) && !/^data:/i.test(s);

const encodeBase64Utf8 = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
};

const decodeDataUriSvg = (dataUri: string) => {
  if (!dataUri.startsWith('data:image/svg+xml;base64,')) return dataUri;
  const b64 = dataUri.split(',')[1] || '';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
};

// Mirror SlideView's `toWorkspacePath` EXACTLY (no `./`/`..` normalisation) so the
// result matches the inline-SVG cache key of the placeholder, then also produce a
// normalised path for file I/O.
const resolveSvgRef = (src: string, deckPath: string | null | undefined) => {
  let s = src.trim().split('?')[0];
  const dir = deckPath ? deckPath.split('/').slice(0, -1).join('/') : '';
  if (s.startsWith('mdp-file://')) s = s.replace(/^mdp-file:\/\/+/, '');
  else if (s.startsWith('/')) s = s.slice(1);
  else s = dir ? `${dir}/${s}` : s;
  try { s = decodeURIComponent(s); } catch { /* ignore */ }
  const cacheKey = s;
  const parts: string[] = [];
  for (const seg of s.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return { cacheKey, filePath: parts.join('/') };
};

export const useDrawio = (
  editorRef: React.RefObject<ReactCodeMirrorRef | null>,
  setMarkdown: (md: string) => void,
  markdownRef: React.RefObject<string>,
  // The deck being edited — relative `![@drawio](path)` references resolve against
  // its folder.
  currentFileName?: string | null,
) => {
  const [isDrawioModalOpen, setIsDrawioModalOpen] = useState(false);
  const [drawioEditTarget, setDrawioEditTarget] = useState<DrawioEditTarget | null>(null);
  const [drawioButtonPos, setDrawioButtonPos] = useState<{ top: number, left: number } | null>(null);

  const handleCreateDrawio = useCallback(() => {
    setDrawioEditTarget(null);
    setIsDrawioModalOpen(true);
  }, []);

  const handleDrawioSave = useCallback((dataUri: string) => {
    // File reference: write the SVG back to the file, drop it from the inline
    // cache (mounted slides re-inject it) and leave the markdown as it is.
    if (drawioEditTarget?.filePath) {
      const { filePath, cacheKey } = drawioEditTarget;
      (async () => {
        try {
          await apiClient.saveFile(filePath, decodeDataUriSvg(dataUri));
          invalidateSvg(...new Set([cacheKey || filePath, filePath]));
        } catch (e) {
          reportError('Failed to save the diagram file.', { detail: e });
        }
      })();
      setDrawioButtonPos(null);
      return;
    }

    const insertText = `![@drawio](${dataUri})`;

    if (!drawioEditTarget || !editorRef.current?.view) {
        editorRef.current?.view?.dispatch(editorRef.current?.view.state.replaceSelection(`\n${insertText}\n`));
        return;
    }

    const view = editorRef.current.view;
    const line = view.state.doc.line(drawioEditTarget.lineNo);
    view.dispatch({ changes: { from: line.from, to: line.to, insert: insertText } });

    const newDoc = view.state.doc.toString();
    setMarkdown(newDoc);

    if (markdownRef.current !== undefined) {
      markdownRef.current = newDoc;
    }
    setDrawioButtonPos(null);
  }, [drawioEditTarget, editorRef, setMarkdown, markdownRef]);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleOpenDrawio = (e: any) => {
      const { base64, target } = e.detail;
      if (!editorRef.current?.view || typeof base64 !== 'string' || !target) return;
      let lineNo: number;
      try {
        const pos = editorRef.current.view.posAtDOM(target);
        lineNo = editorRef.current.view.state.doc.lineAt(pos).number;
      } catch (err) { console.error("Failed to locate widget position:", err); return; }

      const value = base64.trim();
      if (!isDataUri(value) && looksLikeFilePath(value)) {
        // `![@drawio](figs/x.drawio.svg)`: load the referenced file so the dialog
        // opens on its embedded diagram; the save goes back to the file.
        const { cacheKey, filePath } = resolveSvgRef(value, currentFileName);
        apiClient.readFileText(filePath)
          .then((text: string) => {
            setDrawioEditTarget({ base64: encodeBase64Utf8(text), lineNo, filePath, cacheKey });
            setIsDrawioModalOpen(true);
          })
          .catch((err: unknown) => reportError(`Could not read the diagram file "${filePath}".`, { detail: err }));
        return;
      }
      setDrawioEditTarget({ base64, lineNo });
      setIsDrawioModalOpen(true);
    };
    window.addEventListener('open-drawio-editor', handleOpenDrawio);
    return () => window.removeEventListener('open-drawio-editor', handleOpenDrawio);
  }, [editorRef, currentFileName]);

  return {
    isDrawioModalOpen, setIsDrawioModalOpen,
    drawioEditTarget, setDrawioEditTarget,
    drawioButtonPos, setDrawioButtonPos,
    handleCreateDrawio, handleDrawioSave
  };
};
