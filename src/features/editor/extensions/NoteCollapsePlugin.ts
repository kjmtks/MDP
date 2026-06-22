import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { RangeSetBuilder, StateField, type EditorState } from '@codemirror/state';
import { changeCannotAffectMarkers } from './decoChangeMap';

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

// The decoration set plus whether the doc contains ANY `@note:` directive. The
// flag lets the caret-move (selection) handler skip the whole-doc rescan entirely
// when there are no notes — the common case for a large prose document.
interface NoteState { deco: DecorationSet; hasNotes: boolean; }

function buildNoteState(state: EditorState): NoteState {
  const builder = new RangeSetBuilder<Decoration>();
  const docStr = state.doc.toString();
  // Fast path: no speaker-note directives → skip the whole-doc regex.
  if (!docStr.includes('@note:')) return { deco: builder.finish(), hasNotes: false };

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

  return { deco: builder.finish(), hasNotes: true };
}

// Only an edit touching one of these can add/remove/alter a note directive.
const NOTE_MARKERS = /@note:|<!--|-->/;

export const noteCollapsePlugin = StateField.define<NoteState>({
  create(state) {
    return buildNoteState(state);
  },
  update(value, tr) {
    if (tr.docChanged) {
      // A change that touches note syntax must rescan; otherwise just shift the
      // existing widgets through the change (no whole-doc toString/regex).
      if (!changeCannotAffectMarkers(tr, NOTE_MARKERS)) return buildNoteState(tr.state);
      value = { deco: value.deco.map(tr.changes), hasNotes: value.hasNotes };
    }
    // The note under the caret is shown expanded, so a caret move must re-evaluate
    // which note is collapsed — but only when the doc actually has notes.
    if (tr.selection && value.hasNotes) return buildNoteState(tr.state);
    return value;
  },
  provide(field) {
    return EditorView.decorations.from(field, v => v.deco);
  }
});