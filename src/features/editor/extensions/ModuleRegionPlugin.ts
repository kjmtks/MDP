import { StateField, StateEffect, RangeSetBuilder, type EditorState, type Extension, type Transaction, type ChangeSet } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, gutter, GutterMarker } from '@codemirror/view';
import { foldService } from '@codemirror/language';
import { loadedModules } from '../../modules/moduleManager';

// Dispatched to force a re-scan when the set of registered modules changes (they
// load asynchronously after the editor mounts — without this the initial scan
// sees no modules, so nothing is coloured/foldable until the doc next changes).
export const moduleRefreshEffect = StateEffect.define<null>();

/** Re-scan module regions in the given view (call when modules (re)load). */
export function refreshModuleRegions(view: EditorView | null | undefined): void {
  view?.dispatch({ effects: moduleRefreshEffect.of(null) });
}

// Highlights module directives in the editor and makes block-module regions
// foldable:
//  - A block module's opening `<!-- @name … -->` and its matching `<!-- @end -->`
//    get the SAME subtle colour, chosen by NESTING DEPTH — so it's obvious which
//    @end closes which start, and nested blocks read at a glance.
//  - Inline modules get one common subtle colour.
//  - The region between a block start and its @end is foldable (the fold gutter is
//    already enabled), nesting-aware.
// Only registered modules are decorated; `@theme`, `@header`, `@aspect`, … are not.

interface FoldRange { openLineFrom: number; foldFrom: number; foldTo: number; }
interface ModuleScan {
  decorations: DecorationSet;
  folds: FoldRange[];
  // line number → depths of the block regions covering it (outermost first). Drawn
  // as a vertical scope rail in the gutter so a block's start and @end are visibly
  // connected by a continuous coloured line (one bar per nesting depth).
  lineDepths: Map<number, number[]>;
}

const DEPTHS = 6; // distinct nesting colours before they cycle

// Non-module directives that ALSO open a `<!-- … --> … <!-- @end -->` region and
// benefit from colouring/folding (@build wraps content; @header/@footer are blocks).
const SPECIAL_BLOCKS = new Set(['build', 'header', 'footer']);

function scan(state: EditorState): ModuleScan {
  const doc = state.doc;
  const text = doc.toString();

  // Fast path: no HTML-comment directive at all → nothing to colour/fold, skip the
  // two whole-doc regex passes and the build.
  if (!text.includes('<!--')) {
    return { decorations: Decoration.none, folds: [], lineDepths: new Map() };
  }

  // Directives inside code spans are literal text, not modules — skip them.
  const codeSpans: Array<[number, number]> = [];
  const codeRe = /```[\s\S]*?```|`[^`]+`/g;
  let cm: RegExpExecArray | null;
  while ((cm = codeRe.exec(text)) !== null) codeSpans.push([cm.index, cm.index + cm[0].length]);
  const inCode = (i: number) => codeSpans.some(([a, b]) => i >= a && i < b);

  const blockNames = new Set(
    Object.values(loadedModules).filter((m) => m.config.type === 'block').map((m) => m.config.name),
  );
  const isInline = (name: string) => loadedModules[name]?.config.type === 'inline';

  const re = /<!--\s*@(end)?([a-zA-Z0-9_-]*)\s*(.*?)\s*-->/g;
  interface Open { from: number; to: number; depth: number }
  const stack: Open[] = [];
  const marks: Array<{ from: number; to: number; cls: string }> = [];
  const folds: FoldRange[] = [];
  const lineDepths = new Map<number, number[]>();
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    const from = m.index;
    const to = from + m[0].length;
    if (inCode(from)) continue;
    const isEnd = !!m[1];
    const name = m[2] || '';
    if (!isEnd && name === '') continue; // section separator `<!-- @ -->`

    if (!isEnd) {
      if (blockNames.has(name) || SPECIAL_BLOCKS.has(name)) {
        stack.push({ from, to, depth: stack.length });
      } else if (isInline(name)) {
        marks.push({ from, to, cls: 'cm-mod-inline' });
      }
      // other (non-module) directives are left untouched
    } else if (stack.length > 0) {
      // `@end` closes the nearest open block MODULE (a stray @end — e.g. a
      // @header block's — leaves the stack empty and is ignored here).
      const open = stack.pop()!;
      const cls = `cm-mod-block cm-mod-d${open.depth % DEPTHS}`;
      marks.push({ from: open.from, to: open.to, cls });
      marks.push({ from, to, cls });
      const openLine = doc.lineAt(open.from);
      const endLine = doc.lineAt(to);
      if (endLine.number > openLine.number) {
        folds.push({ openLineFrom: openLine.from, foldFrom: openLine.to, foldTo: endLine.to });
      }
      // Record this block's depth on every line it spans (start..@end) so the
      // gutter can draw a continuous rail connecting the two.
      for (let ln = openLine.number; ln <= endLine.number; ln++) {
        const arr = lineDepths.get(ln);
        if (arr) arr.push(open.depth); else lineDepths.set(ln, [open.depth]);
      }
    }
  }

  // @end pops innermost-first, so each line's depths arrive deepest-first — sort
  // ascending so the outermost rail is drawn leftmost.
  for (const arr of lineDepths.values()) arr.sort((a, b) => a - b);
  marks.sort((a, b) => a.from - b.from || a.to - b.to);
  const builder = new RangeSetBuilder<Decoration>();
  for (const mk of marks) builder.add(mk.from, mk.to, Decoration.mark({ class: mk.cls }));
  return { decorations: builder.finish(), folds, lineDepths };
}

// Shift a cached scan through a doc change WITHOUT re-scanning. Only valid when the
// change can't have altered the module structure (see changeKeepsModules): line
// numbers are unchanged, so lineDepths is reused as-is and only char offsets move.
const mapScan = (prev: ModuleScan, changes: ChangeSet): ModuleScan => ({
  decorations: prev.decorations.map(changes),
  folds: prev.folds.map((f) => ({
    openLineFrom: changes.mapPos(f.openLineFrom),
    foldFrom: changes.mapPos(f.foldFrom),
    foldTo: changes.mapPos(f.foldTo),
  })),
  lineDepths: prev.lineDepths,
});

// True when an edit CANNOT have created / removed / renamed a directive: the line
// count is unchanged AND neither the inserted text nor the edited old lines contain
// directive syntax (`<!--`, `-->`, `@`, `--`). Plain typing on a content line — the
// common case — qualifies, letting us skip the O(document) re-scan and just map the
// cached scan through the change.
const changeKeepsModules = (tr: Transaction): boolean => {
  if (tr.startState.doc.lines !== tr.state.doc.lines) return false;
  let keeps = true;
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    if (!keeps) return;
    if (/[<>@]|--/.test(inserted.toString())) { keeps = false; return; }
    const fromLine = tr.startState.doc.lineAt(fromA).number;
    const toLine = tr.startState.doc.lineAt(toA).number;
    for (let i = fromLine; i <= toLine; i++) {
      if (/<!--|-->|@/.test(tr.startState.doc.line(i).text)) { keeps = false; return; }
    }
  });
  return keeps;
};

const moduleRegionField = StateField.define<ModuleScan>({
  create: (state) => scan(state),
  update: (val, tr) => {
    if (tr.effects.some((e) => e.is(moduleRefreshEffect))) return scan(tr.state);
    if (!tr.docChanged) return val;
    if (changeKeepsModules(tr)) return mapScan(val, tr.changes);
    return scan(tr.state);
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.decorations),
});

// One vertical bar per nesting depth, rendered in the scope gutter. Consecutive
// lines' bars align, forming a continuous rail from a block's start to its @end.
class ScopeMarker extends GutterMarker {
  constructor(readonly depths: number[]) { super(); }
  eq(o: ScopeMarker): boolean {
    return o.depths.length === this.depths.length && o.depths.every((d, i) => d === this.depths[i]);
  }
  toDOM(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'cm-mod-scope';
    for (const d of this.depths) {
      const bar = document.createElement('span');
      bar.className = `cm-mod-scope-bar cm-mod-sd${d % DEPTHS}`;
      el.appendChild(bar);
    }
    return el;
  }
}

const moduleScopeGutter = gutter({
  class: 'cm-mod-scope-gutter',
  lineMarker(view, line) {
    const s = view.state.field(moduleRegionField, false);
    if (!s) return null;
    const depths = s.lineDepths.get(view.state.doc.lineAt(line.from).number);
    return depths && depths.length ? new ScopeMarker(depths) : null;
  },
  lineMarkerChange: (update) =>
    update.docChanged || update.transactions.some((t) => t.effects.some((e) => e.is(moduleRefreshEffect))),
});

// A block-module start line is foldable down to its matching @end.
const moduleFold = foldService.of((state, lineStart, lineEnd) => {
  const s = state.field(moduleRegionField, false);
  if (!s) return null;
  for (const f of s.folds) {
    if (f.openLineFrom >= lineStart && f.openLineFrom <= lineEnd) return { from: f.foldFrom, to: f.foldTo };
  }
  return null;
});

const moduleTheme = EditorView.baseTheme({
  '.cm-mod-inline': { backgroundColor: 'rgba(148, 163, 184, 0.18)', borderRadius: '3px' },
  '.cm-mod-block.cm-mod-d0': { backgroundColor: 'rgba(59, 130, 246, 0.18)', borderRadius: '3px' },
  '.cm-mod-block.cm-mod-d1': { backgroundColor: 'rgba(168, 85, 247, 0.18)', borderRadius: '3px' },
  '.cm-mod-block.cm-mod-d2': { backgroundColor: 'rgba(20, 184, 166, 0.18)', borderRadius: '3px' },
  '.cm-mod-block.cm-mod-d3': { backgroundColor: 'rgba(245, 158, 11, 0.18)', borderRadius: '3px' },
  '.cm-mod-block.cm-mod-d4': { backgroundColor: 'rgba(236, 72, 153, 0.18)', borderRadius: '3px' },
  '.cm-mod-block.cm-mod-d5': { backgroundColor: 'rgba(34, 197, 94, 0.18)', borderRadius: '3px' },
  // Scope rail: thin full-height bars in the gutter, coloured by nesting depth to
  // match the start/@end tag colours above.
  '.cm-mod-scope-gutter': { paddingLeft: '3px' },
  // No vertical padding on the per-line cell, else the bars break between lines.
  '.cm-mod-scope-gutter .cm-gutterElement': { padding: '0' },
  '.cm-mod-scope': { display: 'flex', gap: '2px', height: '100%', alignItems: 'stretch' },
  '.cm-mod-scope-bar': { width: '2px', borderRadius: '1px' },
  '.cm-mod-scope-bar.cm-mod-sd0': { backgroundColor: 'rgba(59, 130, 246, 0.85)' },
  '.cm-mod-scope-bar.cm-mod-sd1': { backgroundColor: 'rgba(168, 85, 247, 0.85)' },
  '.cm-mod-scope-bar.cm-mod-sd2': { backgroundColor: 'rgba(20, 184, 166, 0.85)' },
  '.cm-mod-scope-bar.cm-mod-sd3': { backgroundColor: 'rgba(245, 158, 11, 0.85)' },
  '.cm-mod-scope-bar.cm-mod-sd4': { backgroundColor: 'rgba(236, 72, 153, 0.85)' },
  '.cm-mod-scope-bar.cm-mod-sd5': { backgroundColor: 'rgba(34, 197, 94, 0.85)' },
});

export const moduleRegionPlugin: Extension = [moduleRegionField, moduleScopeGutter, moduleFold, moduleTheme];
