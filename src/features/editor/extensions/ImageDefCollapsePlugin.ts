import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { RangeSetBuilder, StateField, type EditorState } from '@codemirror/state';
import { findImageDefRanges } from '../../images/imageRegistry';
import { changeCannotAffectMarkers } from './decoChangeMap';

// Collapses a multi-line `@image` definition block
//   <!-- @image logo -->
//   data:image/png;base64,....
//   <!-- @end -->
// into a one-line pill "🖼️ logo [edit]". Editing is done from the Images panel
// (the [edit] button dispatches `open-image-manager`), so the (potentially
// multi-megabyte) value is never rendered inline.

class ImageDefWidget extends WidgetType {
  readonly alias: string;
  constructor(alias: string) { super(); this.alias = alias; }
  eq(other: ImageDefWidget) { return other.alias === this.alias; }
  ignoreEvent() { return true; }

  toDOM() {
    const wrapper = document.createElement('span');
    wrapper.style.cssText = 'display:inline-flex;align-items:center;gap:6px;vertical-align:middle;margin:0 2px;';

    const label = document.createElement('span');
    label.textContent = `🖼️ ${this.alias}`;
    label.style.cssText = 'color:var(--app-text-secondary);background-color:var(--app-bg-elevated);padding:2px 8px;border-radius:12px 0 0 12px;font-size:0.85em;user-select:none;border:1px solid var(--app-border-strong);border-right:none;';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.textContent = 'edit';
    editBtn.style.cssText = 'background-color:var(--app-accent);color:var(--app-accent-contrast);border:none;border-radius:0 12px 12px 0;padding:2px 8px;font-size:0.8em;cursor:pointer;line-height:1.2;';
    editBtn.title = 'Manage this image in the Images panel';
    editBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      editBtn.dispatchEvent(new CustomEvent('open-image-manager', {
        bubbles: true,
        detail: { alias: this.alias },
      }));
    };

    wrapper.appendChild(label);
    wrapper.appendChild(editBtn);
    return wrapper;
  }
}

function buildDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const docStr = state.doc.toString();
  // Fast path: no `@image` defs → skip the whole-doc scan.
  if (!docStr.includes('@image')) return builder.finish();
  // findImageDefRanges returns blocks in document order (sorted by `from`).
  for (const r of findImageDefRanges(docStr)) {
    builder.add(r.from, r.to, Decoration.replace({ widget: new ImageDefWidget(r.alias), inclusive: false }));
  }
  return builder.finish();
}

// An `@image` def block is delimited by `<!-- @image … -->` … `<!-- @end -->`, so
// only a change touching one of these substrings can alter the collapsed ranges.
const IMAGE_DEF_MARKERS = /@image|@end|<!--|-->/;

export const imageDefCollapsePlugin = StateField.define<DecorationSet>({
  create(state) { return buildDecorations(state); },
  update(value, tr) {
    if (!tr.docChanged) return value;
    // Fast path: plain typing that can't touch an `@image` block → map existing
    // ranges through the change instead of rescanning the whole document.
    if (changeCannotAffectMarkers(tr, IMAGE_DEF_MARKERS)) return value.map(tr.changes);
    return buildDecorations(tr.state);
  },
  provide(field) { return EditorView.decorations.from(field); },
});
