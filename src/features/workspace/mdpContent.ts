// Per-`.mdp` CONTENT config — `<configDir>/content.json`. It carries the content
// profile that cascades (rule B): which modules are enabled/disabled for the
// subtree, and the author profile used to fill new decks created there. `modules`
// is name→boolean (true = enabled, false = disabled; a name ABSENT = inherit).
// Effective state cascades root→nearest, NEAREST explicit wins — so a child `.mdp`
// can disable a module its parent enables, or re-enable one the parent disabled.

export interface MdpAuthor {
  name?: string;
  affiliation?: string;
  email?: string;
}

export interface MdpContent {
  version?: number;
  modules?: Record<string, boolean>;
  author?: MdpAuthor;
  // Free-text house style / instructions for AIs authoring decks under this folder
  // (appended to the slide spec). Accumulates: parent notes then child notes both apply.
  aiNotes?: string;
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

// Effective AI notes for a chain (root→nearest): every non-empty note accumulates,
// so lab-wide guidance and a folder-specific addendum both reach the AI.
export function effectiveAiNotes(chain: MdpContent[]): string {
  return chain.map((c) => (c.aiNotes || '').trim()).filter(Boolean).join('\n\n');
}

// Effective enabled state of `name` for a chain ending at a target `.mdp`.
export function moduleEnabledIn(chain: MdpContent[], name: string): boolean {
  let enabled = true;
  for (const c of chain) if (c.modules && name in c.modules) enabled = !!c.modules[name];
  return enabled;
}

// Effective author profile: per-field cascade root→nearest (a nearer `.mdp` may
// override just one field), falling back to the machine-local app profile.
export function effectiveAuthor(chain: MdpContent[], fallback: MdpAuthor): MdpAuthor {
  const out: MdpAuthor = { ...fallback };
  for (const c of chain) {
    if (!c.author) continue;
    if (c.author.name) out.name = c.author.name;
    if (c.author.affiliation) out.affiliation = c.author.affiliation;
    if (c.author.email) out.email = c.author.email;
  }
  return out;
}
