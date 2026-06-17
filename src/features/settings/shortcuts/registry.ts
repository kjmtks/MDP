// Central registry of every customizable keyboard action. Each scattered handler
// resolves the keys it listens for from here (honoring per-workspace overrides in
// AppSettings.shortcuts), so shortcuts are remappable from the Settings screen.
//
// Combo format mirrors CodeMirror's: `Mod-Shift-Key` where `Mod` = Ctrl on
// win/linux and Cmd on mac. Named keys use their `KeyboardEvent.key` value
// (`ArrowRight`, `PageDown`, `Enter`, `Escape`, `Delete`, …); a literal space is
// `Space`; single characters are lowercased.

export type ShortcutScope = 'global' | 'editor' | 'slideshow' | 'presenter' | 'manipulation';

export interface ActionDef {
  id: string;
  label: string;
  scope: ShortcutScope;
  defaultKeys: string[];
  /** Listed in the UI but not rebindable (e.g. modifier-combinatorial nudging). */
  immutable?: boolean;
}

export const SCOPE_LABELS: Record<ShortcutScope, string> = {
  global: 'Editor — Global',
  editor: 'Editor — Text',
  slideshow: 'Slideshow',
  presenter: 'Presenter View',
  manipulation: 'Edit-Layout (move/resize)',
};

export const ACTIONS: ActionDef[] = [
  // ---- global (DOM handlers on the editor page) ----------------------------
  { id: 'global.slideshowToggle', label: 'Start / stop slideshow', scope: 'global', defaultKeys: ['F5'] },
  { id: 'global.overviewExit', label: 'Close slide overview', scope: 'global', defaultKeys: ['Escape'] },
  { id: 'global.previewPenToggle', label: 'Toggle pen (preview)', scope: 'global', defaultKeys: ['p'] },
  { id: 'global.editorFontIncrease', label: 'Increase editor font', scope: 'global', defaultKeys: ['Mod-=', 'Mod-;'] },
  { id: 'global.editorFontDecrease', label: 'Decrease editor font', scope: 'global', defaultKeys: ['Mod--'] },

  // ---- editor (CodeMirror keymap) ------------------------------------------
  { id: 'editor.save', label: 'Save file', scope: 'editor', defaultKeys: ['Mod-s'] },
  { id: 'editor.slidePrev', label: 'Jump to previous slide', scope: 'editor', defaultKeys: ['PageUp'] },
  { id: 'editor.slideNext', label: 'Jump to next slide', scope: 'editor', defaultKeys: ['PageDown'] },

  // ---- slideshow -----------------------------------------------------------
  { id: 'slideshow.toggleControls', label: 'Toggle controls', scope: 'slideshow', defaultKeys: ['p'] },
  { id: 'slideshow.undo', label: 'Undo drawing', scope: 'slideshow', defaultKeys: ['Mod-z'] },
  { id: 'slideshow.redo', label: 'Redo drawing', scope: 'slideshow', defaultKeys: ['Mod-y'] },
  { id: 'slideshow.clear', label: 'Clear drawing', scope: 'slideshow', defaultKeys: ['c'] },
  { id: 'slideshow.addSlide', label: 'Add blank slide', scope: 'slideshow', defaultKeys: ['n'] },
  { id: 'slideshow.next', label: 'Next slide', scope: 'slideshow', defaultKeys: ['ArrowRight', 'ArrowDown', 'Space', 'Enter', 'PageDown'] },
  { id: 'slideshow.prev', label: 'Previous slide', scope: 'slideshow', defaultKeys: ['ArrowLeft', 'ArrowUp', 'PageUp'] },

  // ---- presenter -----------------------------------------------------------
  { id: 'presenter.penToggle', label: 'Toggle pen', scope: 'presenter', defaultKeys: ['p'] },
  { id: 'presenter.undo', label: 'Undo drawing', scope: 'presenter', defaultKeys: ['Mod-z'] },
  { id: 'presenter.redo', label: 'Redo drawing', scope: 'presenter', defaultKeys: ['Mod-y'] },
  { id: 'presenter.clear', label: 'Clear drawing', scope: 'presenter', defaultKeys: ['c'] },
  { id: 'presenter.addSlide', label: 'Add blank slide', scope: 'presenter', defaultKeys: ['n'] },
  { id: 'presenter.next', label: 'Next slide', scope: 'presenter', defaultKeys: ['ArrowRight', 'ArrowDown', 'Space', 'Enter', 'PageDown'] },
  { id: 'presenter.prev', label: 'Previous slide', scope: 'presenter', defaultKeys: ['ArrowLeft', 'ArrowUp', 'PageUp'] },

  // ---- manipulation (edit-layout overlay) ----------------------------------
  { id: 'manip.deselect', label: 'Deselect', scope: 'manipulation', defaultKeys: ['Escape'] },
  { id: 'manip.delete', label: 'Delete selected', scope: 'manipulation', defaultKeys: ['Delete', 'Backspace'] },
  { id: 'manip.nudge', label: 'Move / resize selected (arrow keys — Shift = coarse, Alt = fine, Ctrl = resize)', scope: 'manipulation', defaultKeys: ['Arrows'], immutable: true },
  { id: 'manip.rotate', label: 'Rotate selected ([ and ] — Shift = 15°)', scope: 'manipulation', defaultKeys: ['[', ']'], immutable: true },
];

export const ACTIONS_BY_SCOPE: Record<ShortcutScope, ActionDef[]> = ACTIONS.reduce((acc, a) => {
  (acc[a.scope] ||= []).push(a);
  return acc;
}, {} as Record<ShortcutScope, ActionDef[]>);

export function actionById(id: string): ActionDef | undefined {
  return ACTIONS.find((a) => a.id === id);
}
