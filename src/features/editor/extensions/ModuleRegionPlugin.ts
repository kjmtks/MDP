import { StateField, StateEffect, RangeSetBuilder, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';
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
interface ModuleScan { decorations: DecorationSet; folds: FoldRange[]; }

const DEPTHS = 6; // distinct nesting colours before they cycle

// Non-module directives that ALSO open a `<!-- … --> … <!-- @end -->` region and
// benefit from colouring/folding (@build wraps content; @header/@footer are blocks).
const SPECIAL_BLOCKS = new Set(['build', 'header', 'footer']);

function scan(state: EditorState): ModuleScan {
  const doc = state.doc;
  const text = doc.toString();

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
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    const from = m.index;
    const to = from + m[0].length;
    if (inCode(from)) continue;
    const isEnd = !!m[1];
    const name = m[2] || '';
    if (!isEnd && name === '') continue; // section separator `<!-- @ -->`

    if (!isEnd) {
      if (blockNames.has(name)) {
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
    }
  }

  marks.sort((a, b) => a.from - b.from || a.to - b.to);
  const builder = new RangeSetBuilder<Decoration>();
  for (const mk of marks) builder.add(mk.from, mk.to, Decoration.mark({ class: mk.cls }));
  return { decorations: builder.finish(), folds };
}

const moduleRegionField = StateField.define<ModuleScan>({
  create: (state) => scan(state),
  update: (val, tr) =>
    (tr.docChanged || tr.effects.some((e) => e.is(moduleRefreshEffect))) ? scan(tr.state) : val,
  provide: (f) => EditorView.decorations.from(f, (v) => v.decorations),
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
});

export const moduleRegionPlugin: Extension = [moduleRegionField, moduleFold, moduleTheme];
