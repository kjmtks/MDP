import type { Transaction } from '@codemirror/state';

// Shared fast-path guard for marker-based decoration StateFields (base64 folding,
// @image-def collapse, @note collapse, …).
//
// Those fields previously rebuilt their whole decoration set from a full-document
// rescan — `state.doc.toString()` + a regex/line walk — on EVERY `docChanged`
// transaction, i.e. every keystroke. On large documents that O(document) work per
// keystroke is a measurable typing-latency cost.
//
// This returns true when a doc change CANNOT have created, removed, split or
// altered any of the given marker substrings, so the caller can just MAP the
// existing decoration set through the change (`decos.map(tr.changes)`) instead of
// rescanning. Only the inserted text and the OLD text of the touched lines are
// examined, so it is O(change), not O(document). (Same idea as ModuleRegionPlugin's
// `changeKeepsModules`.)
//
// `markerRe` MUST be non-global (no `g` flag) so `.test()` is stateless.
export function changeCannotAffectMarkers(tr: Transaction, markerRe: RegExp): boolean {
  let keeps = true;
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    if (!keeps) return;
    // Inserted text introducing a marker → must rescan.
    if (markerRe.test(inserted.toString())) { keeps = false; return; }
    // Old text being edited/removed that contained a marker → must rescan.
    const startLine = tr.startState.doc.lineAt(fromA).number;
    const endLine = tr.startState.doc.lineAt(toA).number;
    for (let i = startLine; i <= endLine; i++) {
      if (markerRe.test(tr.startState.doc.line(i).text)) { keeps = false; return; }
    }
  });
  return keeps;
}
