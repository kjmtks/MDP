import { EditorView, Decoration, ViewPlugin, WidgetType } from '@codemirror/view';
import type { ViewUpdate } from '@uiw/react-codemirror';
import type { DecorationSet } from '@uiw/react-codemirror';
import { RangeSetBuilder } from '@codemirror/state';

export class ImageCollapseWidget extends WidgetType {
  ignoreEvent() { return true; }
  eq() { return true; }
  toDOM() {
    const span = document.createElement("span");
    span.textContent = "( 🖼️ Image Data )";
    span.style.cssText = "color: #aaa; background: #333; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; margin: 0 2px; user-select: none;";
    return span;
  }
}

export const imageCollapsePlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = this.build(view); }
  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = this.build(update.view);
    }
  }
  build(view: EditorView) {
    const builder = new RangeSetBuilder<Decoration>();
    const doc = view.state.doc;

    for (const { from, to } of view.visibleRanges) {
      const startLine = doc.lineAt(from).number;
      const endLine = doc.lineAt(to).number;

      for (let i = startLine; i <= endLine; i++) {
        const line = doc.line(i);
        const text = line.text;

        let pos = 0;
        const searchStr = '(data:image/';
        while ((pos = text.indexOf(searchStr, pos)) !== -1) {
          const urlEnd = text.indexOf(')', pos);

          if (urlEnd !== -1) {
             builder.add(line.from + pos, line.from + urlEnd + 1, Decoration.replace({ widget: new ImageCollapseWidget() }));
             pos = urlEnd + 1;
          } else {
             pos += searchStr.length;
          }
        }
      }
    }
    return builder.finish();
  }
}, { decorations: v => v.decorations });