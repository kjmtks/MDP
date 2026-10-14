import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { StateEffect, StateField, type EditorState, type Range } from '@codemirror/state';
import { changeCannotAffectMarkers } from './decoChangeMap';
import { parseFocusCue, parseScriptAction, type FocusCue } from '../../autoplay/autoplay';
import { splitMarkdownToBlocks } from '../../slide/parser/slideParser';
import { cueInForce, type FocusState } from '../../focus/focusState';

// Chips in the editor's read-aloud script (`<!-- @script: … -->`), as in the presenter
// view's script pane — a presentation can be tried by hand while writing it:
// - a focus cue ([[look: …]] / [[mark: …]] / [[clear]]) is shown on its slide — the
//   preview, the slideshow, the presenter, the output window (focusBus) —, and a click
//   on a lit chip takes it away again;
// - an event marker ([[emit: …]] / [[emit-wait: …]]) fires its event on the app bus,
//   so a module on the slide answers it (@timer, @video, @speakcard…).
// [[wait: …]], [[pause: …]] and [[step]] pace the narrated auto-play: marked, not
// clickable. The chips sit inside the script, so they show while it is expanded (the
// caret inside — ScriptCollapsePlugin folds it otherwise); a click keeps the caret
// where it is and is handed to EditorPage as EDITOR_CHIP_EVENT.

export const EDITOR_CHIP_EVENT = 'mdp-editor-chip';

export type EditorChipDetail =
  | { kind: 'focus'; slide: number; cue: FocusCue }
  | { kind: 'emit'; slide: number; topic: string; args: string[] };

/** The focus EditorPage shows on one slide (null: none) — its chips are lit. */
export interface ChipFocus { slide: number; focus: FocusState | null }
export const setChipFocus = StateEffect.define<ChipFocus | null>();

const SCRIPT_SRC = '<' + '!--\\s*@script:[\\s\\S]{0,20000}?--' + '>';
const MARKER_SRC = '\\[\\[\\s*(look|mark|clear|emit-wait|emit|wait|pause|step)\\s*(?::\\s*([^\\]]*?))?\\s*\\]\\]';

/** The slide (0-based, the meta page is -1) holding the given line. */
function slideAtLine(blocks: ReturnType<typeof splitMarkdownToBlocks>, line: number): number {
  const i = blocks.findIndex((b) => line >= b.startLine && line <= b.endLine);
  return i - 1;
}

type ChipData = { kind: 'focus'; cue: FocusCue } | { kind: 'emit'; topic: string; args: string[] };

class ChipWidget extends WidgetType {
  readonly detail: ChipData;
  readonly on: boolean;
  constructor(detail: ChipData, on: boolean) { super(); this.detail = detail; this.on = on; }

  eq(o: ChipWidget) { return o.on === this.on && JSON.stringify(o.detail) === JSON.stringify(this.detail); }

  toDOM(view: EditorView) {
    const d = this.detail;
    const b = document.createElement('button');
    b.type = 'button';
    if (d.kind === 'focus') {
      b.className = `cm-mdp-chip cm-mdp-chip-focus${this.on ? ' cm-mdp-chip-on' : ''}`;
      b.textContent = d.cue.kind === 'look' ? '👁' : d.cue.kind === 'mark' ? '🖍' : '✕';
      b.title = d.cue.kind === 'clear' ? 'Clear the focus on this slide' : (this.on ? 'Shown — click to take it away' : 'Show this on the slide (preview, slideshow, presenter)');
    } else {
      b.className = 'cm-mdp-chip cm-mdp-chip-event';
      b.textContent = '▶';
      b.title = `Send the event ${d.topic}${d.args.length ? ` ${d.args.join(' ')}` : ''}`;
    }
    // The caret stays where it is: the script must not fold away under the click.
    b.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      let pos: number;
      try { pos = view.posAtDOM(b); } catch { return; }
      const doc = view.state.doc;
      const slide = slideAtLine(splitMarkdownToBlocks(doc.toString()), doc.lineAt(pos).number);
      if (slide < 0) return;
      const detail: EditorChipDetail = d.kind === 'focus'
        ? { kind: 'focus', slide, cue: d.cue }
        : { kind: 'emit', slide, topic: d.topic, args: d.args };
      b.dispatchEvent(new CustomEvent(EDITOR_CHIP_EVENT, { bubbles: true, detail }));
      b.classList.remove('cm-mdp-chip-fired');
      void b.offsetWidth; // restart the flash
      b.classList.add('cm-mdp-chip-fired');
    });
    return b;
  }

  ignoreEvent() { return true; }
}

function buildChips(state: EditorState, lit: ChipFocus | null): DecorationSet {
  const doc = state.doc.toString();
  if (!doc.includes('@script:')) return Decoration.none;
  // Which slide a cue belongs to matters only for lighting chips.
  const blocks = lit && lit.focus ? splitMarkdownToBlocks(doc) : null;
  const decos: Range<Decoration>[] = [];
  const scripts = new RegExp(SCRIPT_SRC, 'g');
  for (let s = scripts.exec(doc); s; s = scripts.exec(doc)) {
    const markers = new RegExp(MARKER_SRC, 'gi');
    for (let m = markers.exec(s[0]); m; m = markers.exec(s[0])) {
      const from = s.index + m.index;
      const to = from + m[0].length;
      const kind = m[1].toLowerCase();
      if (kind === 'look' || kind === 'mark' || kind === 'clear') {
        const cue = parseFocusCue(kind, m[2] || '');
        const on = !!(blocks && lit && lit.focus && kind !== 'clear'
          && slideAtLine(blocks, state.doc.lineAt(from).number) === lit.slide && cueInForce(lit.focus, cue));
        decos.push(Decoration.widget({ widget: new ChipWidget({ kind: 'focus', cue }, on), side: -1 }).range(from));
        decos.push(Decoration.mark({ class: 'cm-mdp-script-marker cm-mdp-script-marker-focus' }).range(from, to));
      } else if (kind === 'emit' || kind === 'emit-wait') {
        const a = parseScriptAction(kind, m[2] || '');
        if (a.topic) decos.push(Decoration.widget({ widget: new ChipWidget({ kind: 'emit', topic: a.topic, args: a.args || [] }, false), side: -1 }).range(from));
        decos.push(Decoration.mark({ class: 'cm-mdp-script-marker cm-mdp-script-marker-event' }).range(from, to));
      } else {
        decos.push(Decoration.mark({ class: 'cm-mdp-script-marker cm-mdp-script-marker-passive' }).range(from, to));
      }
    }
  }
  return Decoration.set(decos, true);
}

// Only an edit touching one of these can add, remove or change a chip.
const CHIP_MARKERS = /\[\[|\]\]|@script:|<!--|-->/;

interface ChipState { deco: DecorationSet; lit: ChipFocus | null }

const chipField = StateField.define<ChipState>({
  create(state) { return { deco: buildChips(state, null), lit: null }; },
  update(value, tr) {
    let lit = value.lit;
    let rebuild = false;
    for (const e of tr.effects) if (e.is(setChipFocus)) { lit = e.value; rebuild = true; }
    if (tr.docChanged && !changeCannotAffectMarkers(tr, CHIP_MARKERS)) rebuild = true;
    if (rebuild) return { deco: buildChips(tr.state, lit), lit };
    if (tr.docChanged) return { deco: value.deco.map(tr.changes), lit };
    return value;
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

const chipTheme = EditorView.baseTheme({
  '.cm-mdp-chip': {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    minWidth: '1.7em', height: '1.4em', padding: '0 4px', margin: '0 2px 0 1px',
    border: '1px solid', borderRadius: '999px', font: 'inherit', fontSize: '0.8em', lineHeight: '1',
    verticalAlign: 'baseline', cursor: 'pointer', userSelect: 'none',
  },
  '.cm-mdp-chip-focus': { borderColor: '#d97706', backgroundColor: 'rgba(245, 158, 11, 0.14)', color: '#d97706' },
  '.cm-mdp-chip-focus:hover': { backgroundColor: 'rgba(245, 158, 11, 0.32)' },
  '.cm-mdp-chip-focus.cm-mdp-chip-on': { backgroundColor: '#d97706', color: '#ffffff' },
  '.cm-mdp-chip-event': { borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.14)', color: '#3b82f6' },
  '.cm-mdp-chip-event:hover': { backgroundColor: 'rgba(59, 130, 246, 0.32)' },
  '.cm-mdp-chip-fired': { animation: 'cm-mdp-chip-flash 0.6s ease-out' },
  '@keyframes cm-mdp-chip-flash': { from: { boxShadow: '0 0 0 4px rgba(59, 130, 246, 0.45)' }, to: { boxShadow: '0 0 0 0 rgba(59, 130, 246, 0)' } },
  '.cm-mdp-script-marker': { borderRadius: '4px' },
  '.cm-mdp-script-marker-focus': { backgroundColor: 'rgba(245, 158, 11, 0.10)' },
  '.cm-mdp-script-marker-event': { backgroundColor: 'rgba(59, 130, 246, 0.10)' },
  '.cm-mdp-script-marker-passive': { backgroundColor: 'rgba(128, 128, 128, 0.12)' },
});

export const scriptChipsPlugin = [chipField, chipTheme];
