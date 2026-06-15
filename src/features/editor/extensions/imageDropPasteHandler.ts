import { EditorView } from '@codemirror/view';
import { compressImageToBase64 } from '../../../utils/imageUtils';

export const handleImageInsert = async (file: File, view: EditorView) => {
  try {
    const base64 = await compressImageToBase64(file);
    const imageTag = `![@image](${base64})`;
    const pos = view.state.selection.main.head;
    view.dispatch({
      changes: { from: pos, insert: imageTag },
      selection: { anchor: pos + imageTag.length }
    });
    view.focus();
  } catch (err) {
    console.error("Image processing failed", err);
  }
};

export const imageDropPasteHandler = EditorView.domEventHandlers({
  paste(event, view) {
    const items = event.clipboardData?.items;
    if (!items) return false;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        event.preventDefault();
        const file = item.getAsFile();
        if (file) handleImageInsert(file, view);
        return true;
      }
    }
    return false;
  },
  drop(event, view) {
    const files = event.dataTransfer?.files;
    if (!files || files.length === 0) return false;
    const file = files[0];
    if (file.type.startsWith('image/')) {
      event.preventDefault();
      handleImageInsert(file, view);
      return true;
    }
    return false;
  }
});