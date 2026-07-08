import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { RangeSetBuilder, StateField, type EditorState } from '@codemirror/state';
import { changeCannotAffectMarkers } from './decoChangeMap';

// Collapses a `<!-- @script: … -->` read-aloud manuscript into a small pill in the
// editor (like the @note pill, with a mic icon), so a long script doesn't clutter
// the slide source. Click to expand (caret enters the comment); it also expands
// automatically while the caret is inside it.
class ScriptWidget extends WidgetType {
  readonly pos: number;

  constructor(pos: number) {
    super();
    this.pos = pos;
  }

  eq(other: ScriptWidget) {
    return this.pos === other.pos;
  }

  toDOM(view: EditorView) {
    const span = document.createElement('span');
    span.className = 'cm-script-collapse';
    span.innerHTML = '🎙️ ...';

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
    span.title = 'Click to expand read-aloud script';

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

// The decoration set plus whether the doc contains ANY `@script:` directive, so the
// caret-move handler can skip the whole-doc rescan when there are no scripts.
interface ScriptState { deco: DecorationSet; hasScripts: boolean; }

function buildScriptState(state: EditorState): ScriptState {
  const builder = new RangeSetBuilder<Decoration>();
  const docStr = state.doc.toString();
  if (!docStr.includes('@script:')) return { deco: builder.finish(), hasScripts: false };

  const regex = new RegExp('<' + '!--\\s*@script:([\\s\\S]{0,10000}?)--' + '>', 'g');
  let match;

  const selection = state.selection.main;

  while ((match = regex.exec(docStr)) !== null) {
    const from = match.index;
    const to = from + match[0].length;

    if (selection.head >= from && selection.head <= to) {
      continue;
    }

    builder.add(from, to, Decoration.replace({
      widget: new ScriptWidget(from),
      inclusive: false
    }));
  }

  return { deco: builder.finish(), hasScripts: true };
}

// Only an edit touching one of these can add/remove/alter a script directive.
const SCRIPT_MARKERS = /@script:|<!--|-->/;

export const scriptCollapsePlugin = StateField.define<ScriptState>({
  create(state) {
    return buildScriptState(state);
  },
  update(value, tr) {
    if (tr.docChanged) {
      if (!changeCannotAffectMarkers(tr, SCRIPT_MARKERS)) return buildScriptState(tr.state);
      value = { deco: value.deco.map(tr.changes), hasScripts: value.hasScripts };
    }
    if (tr.selection && value.hasScripts) return buildScriptState(tr.state);
    return value;
  },
  provide(field) {
    return EditorView.decorations.from(field, v => v.deco);
  }
});
