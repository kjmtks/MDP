import { isMac } from '../../../utils/osUtils';
import { type ActionDef, ACTIONS, type ShortcutScope } from './registry';
import type { AppSettings } from '../types';

// Normalize a KeyboardEvent into a combo string (see registry.ts for the format).
// Returns '' for a bare modifier keypress.
export function eventToCombo(e: KeyboardEvent): string {
  if (e.key === 'Control' || e.key === 'Meta' || e.key === 'Alt' || e.key === 'Shift') return '';
  const parts: string[] = [];
  const mod = isMac() ? e.metaKey : e.ctrlKey;
  if (mod) parts.push('Mod');
  // The non-platform Ctrl on mac (rare) — fold into Ctrl so it's still expressible.
  if (isMac() && e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  let key = e.key;
  if (key === ' ') key = 'Space';
  else if (key.length === 1) key = key.toLowerCase();
  parts.push(key);
  return parts.join('-');
}

const KEY_LABELS: Record<string, string> = {
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
  Space: 'Space', Enter: 'Enter', Escape: 'Esc', Backspace: 'Backspace', Delete: 'Del',
  PageUp: 'PageUp', PageDown: 'PageDown',
};

/** Human-readable form of a combo, e.g. `Mod-s` → `Ctrl+S` (or `⌘+S` on mac). */
export function prettyCombo(combo: string): string {
  return combo.split('-').map((part) => {
    if (part === 'Mod') return isMac() ? '⌘' : 'Ctrl';
    if (part === 'Ctrl') return '⌃';
    if (part === 'Alt') return isMac() ? '⌥' : 'Alt';
    if (part === 'Shift') return '⇧';
    if (KEY_LABELS[part]) return KEY_LABELS[part];
    return part.length === 1 ? part.toUpperCase() : part;
  }).join('+');
}

/** Resolve the active key combos for an action (override or registry default). */
export function resolveKeys(action: ActionDef, settings: AppSettings): string[] {
  const override = settings.shortcuts[action.id];
  return override && override.length ? override : action.defaultKeys;
}

/** First action in `actions` whose resolved combos contain the event's combo. */
export function matchAction(
  e: KeyboardEvent,
  actions: ActionDef[],
  settings: AppSettings,
): ActionDef | null {
  const combo = eventToCombo(e);
  if (!combo) return null;
  for (const a of actions) {
    if (a.immutable) continue;
    if (resolveKeys(a, settings).includes(combo)) return a;
  }
  return null;
}

/** Per-scope conflicts: the same combo bound to more than one action in a scope. */
export function findConflicts(settings: AppSettings): Map<string, string[]> {
  // key = `${scope}::${combo}` → actionIds
  const byScopeCombo = new Map<string, string[]>();
  for (const a of ACTIONS) {
    if (a.immutable) continue;
    for (const combo of resolveKeys(a, settings)) {
      const k = `${a.scope}::${combo}`;
      (byScopeCombo.get(k) ?? byScopeCombo.set(k, []).get(k)!).push(a.id);
    }
  }
  const conflicts = new Map<string, string[]>();
  for (const [k, ids] of byScopeCombo) if (ids.length > 1) conflicts.set(k, ids);
  return conflicts;
}

/** Conflict check for a single proposed combo within a scope (excluding self). */
export function comboConflictsInScope(
  combo: string,
  scope: ShortcutScope,
  selfActionId: string,
  settings: AppSettings,
): string[] {
  return ACTIONS.filter(
    (a) => a.scope === scope && a.id !== selfActionId && !a.immutable && resolveKeys(a, settings).includes(combo),
  ).map((a) => a.id);
}
