import { EditorView, Decoration, ViewPlugin, WidgetType } from '@codemirror/view';
import type { ViewUpdate } from '@uiw/react-codemirror';
import type { DecorationSet } from '@uiw/react-codemirror';
import { RangeSetBuilder } from '@codemirror/state';

export class DrawDataCollapseWidget extends WidgetType {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  eq(_other: DrawDataCollapseWidget) { return true; }
  ignoreEvent() { return false; }
  toDOM() {
    const span = document.createElement("span");
    span.textContent = "🖌️ Drawing Data";
    span.style.cssText = `
      background-color: var(--app-bg-elevated);
      color: var(--app-text-muted);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.85em;
      user-select: none;
      border: 1px dashed var(--app-border-strong);
      margin: 0 4px;
    `;
    return span;
  }
}

export const drawingCollapsePlugin = ViewPlugin.fromClass(class {
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
    const doc = view.state.doc;
    // `@drawing:` anchors are single-line, so decorate only the VISIBLE lines —
    // no whole-document scan on every keystroke (recomputed on viewportChanged).
    const re = new RegExp("<" + "!--\\s*@drawing:[^\\n]*?--" + ">", "g");
    for (const { from, to } of view.visibleRanges) {
      const startLine = doc.lineAt(from).number;
      const endLine = doc.lineAt(to).number;
      for (let i = startLine; i <= endLine; i++) {
        const line = doc.line(i);
        if (!line.text.includes('@drawing:')) continue;
        re.lastIndex = 0;
        let match;
        while ((match = re.exec(line.text)) !== null) {
          const start = line.from + match.index;
          const end = start + match[0].length;
          builder.add(start, end, Decoration.replace({ widget: new DrawDataCollapseWidget() }));
        }
      }
    }
    return builder.finish();
  }
}, {
  decorations: v => v.decorations
});