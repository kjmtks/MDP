import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { RangeSetBuilder, StateField, type EditorState } from '@codemirror/state';

class NoteWidget extends WidgetType {
  readonly pos: number;

  constructor(pos: number) {
    super();
    this.pos = pos;
  }

  eq(other: NoteWidget) {
    return this.pos === other.pos;
  }

  toDOM(view: EditorView) {
    const span = document.createElement('span');
    span.className = 'cm-note-collapse';
    span.innerHTML = '💭 ...';

    span.style.cursor = 'pointer';
    span.style.display = 'inline-flex';
    span.style.alignItems = 'center';
    span.style.padding = '2px 8px';
    span.style.margin = '0 4px';
    span.style.borderRadius = '12px';
    span.style.backgroundColor = 'var(--app-accent-soft)';
    span.style.color = 'var(--app-accent)';
    span.style.fontSize = '0.85em';
    span.style.fontWeight = 'bold';
    span.style.userSelect = 'none';
    span.style.border = '1px solid color-mix(in srgb, var(--app-accent) 30%, transparent)';
    span.title = 'Click to expand note';

    span.addEventListener('mousedown', (e) => {
      e.preventDefault();
      view.dispatch({
        selection: { anchor: this.pos + 4, head: this.pos + 4 }
      });
      view.focus();
    });

    return span;
  }
}

function buildDecorations(state: EditorState) {
  const builder = new RangeSetBuilder<Decoration>();
  const docStr = state.doc.toString();

  const regex = new RegExp('<' + '!--\\s*@note:([\\s\\S]{0,10000}?)--' + '>', 'g');
  let match;

  const selection = state.selection.main;

  while ((match = regex.exec(docStr)) !== null) {
    const from = match.index;
    const to = from + match[0].length;

    if (selection.head >= from && selection.head <= to) {
      continue;
    }

    builder.add(from, to, Decoration.replace({
      widget: new NoteWidget(from),
      inclusive: false
    }));
  }

  return builder.finish();
}

export const noteCollapsePlugin = StateField.define<DecorationSet>({
  create(state) {
    return buildDecorations(state);
  },
  update(value, tr) {
    if (tr.docChanged || tr.selection) {
      return buildDecorations(tr.state);
    }
    return value;
  },
  provide(field) {
    return EditorView.decorations.from(field);
  }
});