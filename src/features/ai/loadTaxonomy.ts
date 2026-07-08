import { apiClient } from '../../api/apiClient';
import type { Taxonomy } from './slideSpecPrompt';

// The module taxonomy is a DOWNLOADED ASSET, not bundled: official-assets/taxonomy.json
// is listed in catalog.json, so the official-assets sync writes it into a workspace's
// `.mdp/taxonomy/taxonomy.json`. A folder may also hand-place `.mdp/taxonomy.json` to
// override it. This loader resolves the effective taxonomy for a deck's `.mdp` scope.
//
// `scopeDirs` are the `.mdp` directories for the deck, ordered ROOT → NEAREST
// (e.g. ['.mdp', 'alice/.mdp']). Precedence: the NEAREST scope wins, and within a
// scope a hand-authored `taxonomy.json` beats the synced `taxonomy/taxonomy.json`.
// Returns undefined when none is found (the prompt then renders a flat index).

function isValidTaxonomy(v: unknown): v is Taxonomy {
  return !!v && Array.isArray((v as Taxonomy).groups) && (v as Taxonomy).groups.length > 0;
}

export async function loadTaxonomy(scopeDirs: string[]): Promise<Taxonomy | undefined> {
  // Nearest scope first.
  const dirs = [...(scopeDirs || [])].reverse();
  for (const dir of dirs) {
    const base = dir.replace(/\/+$/, '');
    for (const rel of [`${base}/taxonomy.json`, `${base}/taxonomy/taxonomy.json`]) {
      try {
        const text = await apiClient.readFileText(rel.replace(/^\/+/, ''));
        const parsed = JSON.parse(text);
        if (isValidTaxonomy(parsed)) return parsed;
      } catch { /* absent / invalid here — try the next candidate */ }
    }
  }
  return undefined;
}
