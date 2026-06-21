import { EditorView, Decoration, ViewPlugin, WidgetType } from '@codemirror/view';
import type { ViewUpdate, DecorationSet } from '@uiw/react-codemirror';
import { RangeSetBuilder } from '@codemirror/state';

// A small 🏷 button appended after the meta-page `<!-- @tags … -->` directive.
// Clicking it dispatches `open-tag-settings` so EditorPage can open the tag-editing
// dialog. Mirrors ModuleSettingsPlugin (the ⚙ button). The directive text stays
// visible/editable — this is an additive widget, not a replace decoration.
class TagSettingsWidget extends WidgetType {
  constructor(readonly value: string, readonly from: number, readonly to: number) { super(); }

  eq(o: TagSettingsWidget) { return o.value === this.value && o.from === this.from && o.to === this.to; }
  ignoreEvent() { return true; }

  toDOM() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cm-tag-settings-btn';
    btn.title = 'Edit tags';
    btn.textContent = '🏷';
    btn.style.cssText =
      'margin:0 4px;padding:0 6px;font-size:0.9em;line-height:1.4;cursor:pointer;' +
      'border-radius:4px;border:1px solid var(--app-border-strong);' +
      'background-color:var(--app-bg-elevated);color:var(--app-text-secondary);';
    btn.onmouseover = () => { btn.style.backgroundColor = 'var(--app-bg-hover)'; };
    btn.onmouseout = () => { btn.style.backgroundColor = 'var(--app-bg-elevated)'; };
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      btn.dispatchEvent(new CustomEvent('open-tag-settings', {
        bubbles: true,
        detail: { value: this.value, from: this.from, to: this.to },
      }));
    };
    return btn;
  }
}

export const tagSettingsPlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = this.build(view); }
  update(u: ViewUpdate) {
    if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view);
  }
  build(view: EditorView) {
    const builder = new RangeSetBuilder<Decoration>();
    const doc = view.state.doc;

    // `@tags` only applies on the meta page (before the first `---` separator);
    // find that boundary line so the button never appears on a slide body.
    let metaEnd = Infinity;
    let inFence = false;
    for (let i = 1; i <= doc.lines; i++) {
      const t = doc.line(i).text.trim();
      if (t.startsWith('```')) inFence = !inFence;
      else if (!inFence && t === '---') { metaEnd = i; break; }
    }

    for (const { from, to } of view.visibleRanges) {
      const startLine = doc.lineAt(from).number;
      const endLine = doc.lineAt(to).number;
      for (let i = startLine; i <= endLine; i++) {
        if (i >= metaEnd) break; // past the meta page — no tags here
        const line = doc.line(i);
        // `\s*` (not `\s+`) so an empty `<!-- @tags -->` still gets the button,
        // letting the user populate it from the dialog.
        const re = /<!--\s*@tags\s*(.*?)\s*-->/gi;
        let m: RegExpExecArray | null;
        while ((m = re.exec(line.text)) !== null) {
          const dirFrom = line.from + m.index;
          const dirTo = dirFrom + m[0].length;
          builder.add(dirTo, dirTo, Decoration.widget({
            widget: new TagSettingsWidget(m[1] || '', dirFrom, dirTo), side: 1,
          }));
        }
      }
    }
    return builder.finish();
  }
}, { decorations: v => v.decorations });
