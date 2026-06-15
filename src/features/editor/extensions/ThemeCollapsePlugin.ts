import { EditorView, Decoration, ViewPlugin, WidgetType } from '@codemirror/view';
import type { ViewUpdate, DecorationSet } from '@uiw/react-codemirror';
import { RangeSetBuilder } from '@codemirror/state';

export class ThemeWidget extends WidgetType {
  readonly themeName: string;
  constructor(themeName: string) {
    super();
    this.themeName = themeName;
  }
  eq(other: ThemeWidget) { return other.themeName === this.themeName; }
  ignoreEvent() { return true; }

  toDOM() {
    const wrapper = document.createElement("span");
    wrapper.style.cssText = "display: inline-flex; align-items: center; margin: 0 4px;";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cm-theme-select-btn";
    btn.textContent = `🎨 Theme: ${this.themeName || 'default'}`;

    btn.style.cssText = `
      background-color: #3b4048;
      color: #dcdfe4;
      border: 1px solid #5c6370;
      border-radius: 4px;
      padding: 2px 8px;
      font-size: 0.85em;
      cursor: pointer;
      line-height: 1.4;
      font-family: inherit;
      transition: background-color 0.2s;
    `;
    btn.onmouseover = () => { btn.style.backgroundColor = '#4b5363'; };
    btn.onmouseout = () => { btn.style.backgroundColor = '#3b4048'; };

    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const event = new CustomEvent('open-theme-selector', {
        bubbles: true,
        detail: { currentTheme: this.themeName, target: btn }
      });
      btn.dispatchEvent(event);
    };

    wrapper.appendChild(btn);
    return wrapper;
  }
}

export const themeCollapsePlugin = ViewPlugin.fromClass(class {
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
        const themeRegex = new RegExp("<" + "!--\\s*@theme\\s+([^>]+?)\\s*--" + ">");
        const match = text.match(themeRegex);

        if (match && match.index !== undefined) {
           const themeName = match[1].trim();
           builder.add(
             line.from + match.index,
             line.from + match.index + match[0].length,
             Decoration.replace({ widget: new ThemeWidget(themeName) })
           );
        }
      }
    }
    return builder.finish();
  }
}, { decorations: v => v.decorations });