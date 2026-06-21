import { StateField, type EditorState } from '@codemirror/state';
import { Decoration, type DecorationSet, WidgetType, EditorView } from '@codemirror/view';
import { findImageDefRanges } from '../images/imageRegistry';

class Base64Widget extends WidgetType {
  toDOM() {
    const span = document.createElement("span");
    span.textContent = " 🖼️ Image Data ";
    span.style.backgroundColor = "var(--app-bg-elevated)";
    span.style.color = "var(--app-text-secondary)";
    span.style.borderRadius = "4px";
    span.style.padding = "2px 6px";
    span.style.fontSize = "0.85em";
    span.style.cursor = "default";
    span.style.userSelect = "none";
    span.style.display = "inline-block";
    span.style.margin = "0 4px";
    return span;
  }
  eq() { return true; }
  ignoreEvent() { return true; }
}

const hideBase64Deco = Decoration.replace({
  widget: new Base64Widget(),
  inclusive: false
});

const base64Regex = /data:image\/[a-zA-Z0-9+.-]+;base64,[a-zA-Z0-9+/=]+/g;

function buildBase64Decorations(state: EditorState): DecorationSet {
  const docStr = state.doc.toString();
  // Fast path: no data URIs → nothing to fold, skip the whole-doc line scan.
  if (!docStr.includes('data:image/')) return Decoration.none;
  // `@image` def blocks are collapsed whole by ImageDefCollapsePlugin; skip any
  // data URI inside one so the two `Decoration.replace` ranges don't overlap.
  const imageRanges = findImageDefRanges(docStr);
  const insideImageDef = (from: number, to: number) =>
    imageRanges.some((r) => r.from <= from && to <= r.to);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const widgets: any[] = [];
  for (let i = 1; i <= state.doc.lines; i++) {
    const line = state.doc.line(i);
    // `![@drawio](data:...)` is collapsed whole by DrawioCollapsePlugin; don't
    // also fold the inner data URI (overlapping replaces → duplicate/garbled widget).
    if (line.text.includes('![@drawio]')) continue;
    if (line.text.includes('data:image/')) {
      let match;
      base64Regex.lastIndex = 0;
      while ((match = base64Regex.exec(line.text)) !== null) {
        const from = line.from + match.index;
        const to = from + match[0].length;
        if (insideImageDef(from, to)) continue;
        widgets.push(hideBase64Deco.range(from, to));
      }
    }
  }
  return Decoration.set(widgets);
}

export const base64Folding = StateField.define<DecorationSet>({
  create(state) {
    return buildBase64Decorations(state);
  },
  update(decorations, tr) {
    if (!tr.docChanged) return decorations;
    return buildBase64Decorations(tr.state);
  },
  provide: f => EditorView.decorations.from(f)
});