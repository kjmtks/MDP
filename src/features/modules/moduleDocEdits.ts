import type { EditorView } from '@codemirror/view';
import { loadedModules } from './moduleManager';
import { parseArguments } from './moduleProcessor';

// Targeted in-file edits to manipulable module directives via single CodeMirror
// transactions (preserves native undo + cursor, unlike a whole-doc replace).
// Used by the on-preview ManipulationLayer to persist move/resize/rotate as
// percent transform args, and to delete a module.

export interface ManipDirective {
  name: string;
  ord: number;                 // document-order index among manipulable directives
  id: string | null;           // explicit `id:` arg, or null if not yet assigned
  args: Record<string, string>;
  openFrom: number; openTo: number;   // the opening `<!-- @name ... -->`
  fullFrom: number; fullTo: number;   // opening start .. matching `<!-- @end -->`
}

export interface TransformEdit { x?: number; y?: number; w?: number; h?: number; rot?: number }
export interface DirectiveSelector { id?: string | null; ord?: number }

const RE_OPEN = '<' + '!--';

/**
 * Parse the document for manipulable block-module directives, returning each
 * one's id/ord, parsed args, and source ranges. Mirrors moduleProcessor's
 * ordering exactly: code spans are skipped and `ord` is assigned in document
 * order at each manipulable block's opening — so an element's `data-mdp-ord`
 * matches the directive found here.
 */
export function parseModuleDirectives(doc: string): ManipDirective[] {
  // Spans to ignore (don't expand directives inside code).
  const codeSpans: Array<[number, number]> = [];
  const codeRe = /```[\s\S]*?```|`[^`]+`/g;
  let cm: RegExpExecArray | null;
  while ((cm = codeRe.exec(doc)) !== null) codeSpans.push([cm.index, cm.index + cm[0].length]);
  const inCode = (i: number) => codeSpans.some(([a, b]) => i >= a && i < b);

  const blockNames = new Set(
    Object.values(loadedModules).filter((m) => m.config.type === 'block').map((m) => m.config.name),
  );
  const isManip = (name: string) => !!loadedModules[name]?.config.manipulate;
  const isInlineManip = (name: string) =>
    loadedModules[name]?.config.type === 'inline' && !!loadedModules[name]?.config.manipulate;

  const tokRe = new RegExp(RE_OPEN + '\\s*@(end)?([a-zA-Z0-9_-]*)\\s*(.*?)\\s*-->', 'g');
  interface Open { name: string; argsStr: string; from: number; to: number; ord: number | null }
  const stack: Open[] = [];
  const out: ManipDirective[] = [];
  let manipOrd = 0;
  let m: RegExpExecArray | null;

  const pushEntry = (open: Open, fullTo: number) => {
    const args = parseArguments(open.argsStr);
    out.push({
      name: open.name, ord: open.ord!, id: (args.id || '').trim() || null, args,
      openFrom: open.from, openTo: open.to, fullFrom: open.from, fullTo,
    });
  };

  while ((m = tokRe.exec(doc)) !== null) {
    if (inCode(m.index)) continue;
    const isEnd = !!m[1];
    const name = m[2] || '';
    const argsStr = m[3] || '';
    const from = m.index;
    const to = m.index + m[0].length;

    if (!isEnd && name === '') continue; // section separator `<!-- @ -->`

    if (!isEnd) {
      if (blockNames.has(name)) {
        stack.push({ name, argsStr, from, to, ord: isManip(name) ? manipOrd++ : null });
      } else if (isInlineManip(name)) {
        // A manipulable INLINE module is a self-contained directive (no @end).
        // It takes an `ord` from the SAME document-order counter as blocks, so it
        // matches the renderer's assignment in moduleProcessor.
        const args = parseArguments(argsStr);
        out.push({
          name, ord: manipOrd++, id: (args.id || '').trim() || null, args,
          openFrom: from, openTo: to, fullFrom: from, fullTo: to,
        });
      }
    } else {
      // `<!-- @end -->` / `<!-- @endName -->`: close nearest matching open.
      let idx = -1;
      for (let i = stack.length - 1; i >= 0; i--) {
        if (!name || stack[i].name === name) { idx = i; break; }
      }
      if (idx >= 0) {
        const open = stack[idx];
        stack.length = idx; // drop this open (and any unclosed above it)
        if (open.ord !== null) pushEntry(open, to);
      }
    }
  }
  // Unclosed manipulable opens still count (fall back to the opening range).
  for (const open of stack) if (open.ord !== null) pushEntry(open, open.to);

  out.sort((a, b) => a.ord - b.ord);
  return out;
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);

function buildOpen(name: string, args: Record<string, string>): string {
  const body = Object.keys(args)
    .filter((k) => args[k] !== undefined && args[k] !== '')
    .map((k) => `${k}: ${args[k]}`)
    .join(', ');
  return `${RE_OPEN} @${name}${body ? ' ' + body : ''} -->`;
}

const find = (dirs: ManipDirective[], sel: DirectiveSelector) =>
  (sel.id ? dirs.find((d) => d.id === sel.id) : undefined) ??
  (sel.ord !== undefined ? dirs.find((d) => d.ord === sel.ord) : undefined);

/** Apply transform updates to one or more directives in a single transaction.
 *  Identity is document-order (ord); no id is written. Any legacy `id` arg is
 *  dropped on rewrite so the directive stays clean. */
export function updateModuleTransforms(
  view: EditorView,
  edits: Array<{ sel: DirectiveSelector; t: TransformEdit }>,
): void {
  const doc = view.state.doc.toString();
  const dirs = parseModuleDirectives(doc);
  const changes: Array<{ from: number; to: number; insert: string }> = [];

  for (const e of edits) {
    const dir = find(dirs, e.sel);
    if (!dir) continue;
    const args = { ...dir.args };
    delete args.id;
    if (e.t.x !== undefined) args.x = fmt(e.t.x);
    if (e.t.y !== undefined) args.y = fmt(e.t.y);
    if (e.t.w !== undefined) args.w = fmt(e.t.w);
    if (e.t.h !== undefined) args.h = fmt(e.t.h);
    if (e.t.rot !== undefined) args.rot = fmt(e.t.rot);
    changes.push({ from: dir.openFrom, to: dir.openTo, insert: buildOpen(dir.name, args) });
  }
  if (changes.length) view.dispatch({ changes });
}

/** Convenience for a single directive. */
export function updateModuleTransform(view: EditorView, sel: DirectiveSelector, t: TransformEdit): void {
  updateModuleTransforms(view, [{ sel, t }]);
}

/**
 * Normalize a document by removing the transform args (x/y/w/h/rot/id) from every
 * manipulable directive. Two documents that strip-equal differ ONLY in module
 * transforms — used to detect "transform-only" edits so the preview can skip a
 * full slide re-render (the live DOM is already updated by the overlay).
 */
export function stripManipTransforms(doc: string): string {
  const dirs = parseModuleDirectives(doc);
  if (!dirs.length) return doc;
  let out = doc;
  for (const d of [...dirs].sort((a, b) => b.openFrom - a.openFrom)) {
    const args = { ...d.args };
    delete args.x; delete args.y; delete args.w; delete args.h; delete args.rot; delete args.id;
    out = out.slice(0, d.openFrom) + buildOpen(d.name, args) + out.slice(d.openTo);
  }
  return out;
}

/** Delete whole module directives (opening .. matching @end), swallowing up to
 *  two trailing newlines so no blank gap remains. Single transaction. */
export function removeModuleDirectives(view: EditorView, sels: DirectiveSelector[]) {
  const doc = view.state.doc.toString();
  const dirs = parseModuleDirectives(doc);
  const targets = sels.map((s) => find(dirs, s)).filter((d): d is ManipDirective => !!d);
  if (!targets.length) return;
  // De-dup and sort so ranges don't overlap.
  const seen = new Set<number>();
  const changes = targets
    .filter((d) => (seen.has(d.fullFrom) ? false : (seen.add(d.fullFrom), true)))
    .map((d) => {
      let to = d.fullTo;
      for (let k = 0; k < 2 && (doc[to] === '\r' || doc[to] === '\n'); k++) {
        if (doc[to] === '\r') to++;
        if (doc[to] === '\n') to++;
      }
      return { from: d.fullFrom, to, insert: '' };
    });
  view.dispatch({ changes });
}
