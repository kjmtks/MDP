import { EditorView, Decoration, ViewPlugin, WidgetType } from '@codemirror/view';
import type { ViewUpdate } from '@uiw/react-codemirror';
import type { DecorationSet } from '@uiw/react-codemirror';
import { RangeSetBuilder } from '@codemirror/state';

export class CollapseWidget extends WidgetType {
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
    textSpan.textContent = "( 📊 Drawio Data ";
    textSpan.style.cssText = `
      color: var(--app-text-muted);
      background-color: var(--app-bg-elevated);
      padding: 2px 0 2px 6px;
      border-radius: 4px 0 0 4px;
      font-size: 0.85em;
      user-select: none;
    `;

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.textContent = "Edit";
    editBtn.className = "cm-drawio-edit-btn";
    editBtn.dataset.base64 = this.base64;

    editBtn.style.cssText = `
      background-color: var(--app-accent);
      color: var(--app-accent-contrast);
      border: none;
      border-radius: 3px;
      padding: 2px 6px;
      margin-right: 4px;
      font-size: 0.8em;
      cursor: pointer;
      line-height: 1.2;
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

    const closingSpan = document.createElement("span");
    closingSpan.textContent = ")";
    closingSpan.style.cssText = "color: var(--app-text-muted); background-color: var(--app-bg-elevated); padding: 2px 6px 2px 0; border-radius: 0 4px 4px 0; font-size: 0.85em;";
    textSpan.appendChild(editBtn);
    wrapper.appendChild(textSpan);
    wrapper.appendChild(closingSpan);
    return wrapper;
  }
}

export const drawioCollapsePlugin = ViewPlugin.fromClass(class {
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
        const searchStr = '![@drawio](';
        while ((pos = text.indexOf(searchStr, pos)) !== -1) {
          const urlStart = pos + searchStr.length;
          const urlEnd = text.indexOf(')', urlStart);
          if (urlEnd !== -1) {
            let base64 = text.substring(urlStart, urlEnd);
            base64 = base64.replace(/^data:image\/svg\+xml;base64,/, '');
            builder.add(line.from + urlStart - 1, line.from + urlEnd + 1, Decoration.replace({ widget: new CollapseWidget(base64) }));
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