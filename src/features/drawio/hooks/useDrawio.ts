import { useState, useCallback, useEffect } from 'react';
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror';

export const useDrawio = (
  editorRef: React.RefObject<ReactCodeMirrorRef | null>,
  setMarkdown: (md: string) => void,
  markdownRef: React.RefObject<string>
) => {
  const [isDrawioModalOpen, setIsDrawioModalOpen] = useState(false);
  const [drawioEditTarget, setDrawioEditTarget] = useState<{ base64: string, lineNo: number } | null>(null);
  const [drawioButtonPos, setDrawioButtonPos] = useState<{ top: number, left: number } | null>(null);

  const handleCreateDrawio = useCallback(() => {
    setDrawioEditTarget(null);
    setIsDrawioModalOpen(true);
  }, []);

  const handleDrawioSave = useCallback((dataUri: string) => {

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
      if (editorRef.current?.view && typeof base64 === 'string' && target) {
        try {
          const pos = editorRef.current.view.posAtDOM(target);
          const line = editorRef.current.view.state.doc.lineAt(pos);
          setDrawioEditTarget({ base64, lineNo: line.number });
          setIsDrawioModalOpen(true);
        } catch (err) { console.error("Failed to locate widget position:", err); }
      }
    };
    window.addEventListener('open-drawio-editor', handleOpenDrawio);
    return () => window.removeEventListener('open-drawio-editor', handleOpenDrawio);
  }, [editorRef]);

  return {
    isDrawioModalOpen, setIsDrawioModalOpen,
    drawioEditTarget, setDrawioEditTarget,
    drawioButtonPos, setDrawioButtonPos,
    handleCreateDrawio, handleDrawioSave
  };
};