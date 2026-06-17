import { EditorView, Decoration, ViewPlugin, WidgetType } from '@codemirror/view';
import type { ViewUpdate, DecorationSet } from '@uiw/react-codemirror';
import { RangeSetBuilder } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { loadedModules } from '../../modules/moduleManager';

// A directive written inside a fenced/inline code block is shown as literal text
// (moduleProcessor masks code before expanding modules), so it is NOT a module
// instance and must not get a settings button. We detect this via the markdown
// syntax tree (FencedCode / CodeBlock / CodeText / InlineCode nodes).
const isInCode = (view: EditorView, pos: number): boolean => {
  let node = syntaxTree(view.state).resolveInner(pos, 1) as { name: string; parent: unknown } | null;
  for (let n = node; n; n = (n as { parent: unknown }).parent as typeof node) {
    if (/Code/.test(n.name)) return true;
  }
  return false;
};

// A small gear button appended after a module directive (`<!-- @name ... -->`).
// Clicking it dispatches `open-module-settings` so EditorPage can open the
// argument-editing dialog. The directive text stays visible/editable — this is
// an additive widget, not a replace decoration.
class ModuleSettingsWidget extends WidgetType {
  constructor(
    readonly name: string,
    readonly args: string,
    readonly from: number,
    readonly to: number,
    readonly original: string,
  ) { super(); }

  eq(o: ModuleSettingsWidget) {
    return o.name === this.name && o.args === this.args && o.from === this.from && o.to === this.to;
  }
  ignoreEvent() { return true; }

  toDOM() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cm-module-settings-btn';
    btn.title = `Edit “${this.name}” settings`;
    btn.textContent = '⚙';
    btn.style.cssText =
      'margin:0 4px;padding:0 6px;font-size:0.9em;line-height:1.4;cursor:pointer;' +
      'border-radius:4px;border:1px solid var(--app-border-strong);' +
      'background-color:var(--app-bg-elevated);color:var(--app-text-secondary);';
    btn.onmouseover = () => { btn.style.backgroundColor = 'var(--app-bg-hover)'; };
    btn.onmouseout = () => { btn.style.backgroundColor = 'var(--app-bg-elevated)'; };
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      btn.dispatchEvent(new CustomEvent('open-module-settings', {
        bubbles: true,
        detail: { name: this.name, args: this.args, from: this.from, to: this.to, original: this.original, target: btn },
      }));
    };
    return btn;
  }
}

export const moduleSettingsPlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = this.build(view); }
  update(u: ViewUpdate) {
    if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view);
  }
  build(view: EditorView) {
    const builder = new RangeSetBuilder<Decoration>();
    const doc = view.state.doc;
    for (const { from, to } of view.visibleRanges) {
      const startLine = doc.lineAt(from).number;
      const endLine = doc.lineAt(to).number;
      for (let i = startLine; i <= endLine; i++) {
        const line = doc.line(i);
        // Match every `<!-- @name args -->` on the line; keep only those whose
        // name is a registered module (so @end / @cover / @theme are skipped).
        const re = /<!--\s*@([a-zA-Z0-9_-]+)\s*(.*?)\s*-->/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(line.text)) !== null) {
          const name = m[1];
          if (name === 'end' || !loadedModules[name]) continue;
          // Skip modules with no declared parameters — nothing to edit.
          if (!loadedModules[name].config.parameters?.length) continue;
          const dirFrom = line.from + m.index;
          // A directive inside a code block isn't a module — no button.
          if (isInCode(view, dirFrom)) continue;
          const dirTo = dirFrom + m[0].length;
          builder.add(
            dirTo, dirTo,
            Decoration.widget({ widget: new ModuleSettingsWidget(name, m[2], dirFrom, dirTo, m[0]), side: 1 }),
          );
        }
      }
    }
    return builder.finish();
  }
}, { decorations: v => v.decorations });
