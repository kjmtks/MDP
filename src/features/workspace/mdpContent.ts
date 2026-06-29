// Per-`.mdp` CONTENT config — `<configDir>/content.json`. It carries the content
// profile that cascades (rule B): currently which modules are enabled/disabled for
// the subtree. `modules` is name→boolean (true = enabled, false = disabled; a name
// ABSENT = inherit). Effective state cascades root→nearest, NEAREST explicit wins —
// so a child `.mdp` can disable a module its parent enables, or re-enable one the
// parent disabled.

export interface MdpContent {
  version?: number;
  modules?: Record<string, boolean>;
}

export const CONTENT_FILE = 'content.json';
export const contentPath = (configDir: string) => `${configDir}/${CONTENT_FILE}`;

export function parseContent(text: string): MdpContent {
  try { const c = JSON.parse(text); return (c && typeof c === 'object') ? c as MdpContent : {}; }
  catch { return {}; }
}

// Effective DISABLED module names from a chain of content configs (root→nearest).
export function effectiveDisabledModules(chain: MdpContent[]): string[] {
  const state = new Map<string, boolean>();
  for (const c of chain) for (const [name, enabled] of Object.entries(c.modules || {})) state.set(name, !!enabled);
  return [...state].filter(([, en]) => !en).map(([n]) => n);
}

// Effective enabled state of `name` for a chain ending at a target `.mdp`.
export function moduleEnabledIn(chain: MdpContent[], name: string): boolean {
  let enabled = true;
  for (const c of chain) if (c.modules && name in c.modules) enabled = !!c.modules[name];
  return enabled;
}
