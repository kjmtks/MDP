// The TTS server profiles MDP knows (see speechOptions.ts): the ones bundled with the
// app — official-assets/tts-servers/*.json, built in so they work in any workspace —
// overlaid by the workspace's own .mdp/tts-servers/*.json (the official ones synced
// there, newer than the app's copy, or written by the user for another server). A
// workspace profile with the same `id` replaces the bundled one.
import { normalizeProfile, type SpeechServerProfile } from './speechOptions';

const bundledFiles = import.meta.glob('../../../official-assets/tts-servers/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const bundled: SpeechServerProfile[] = Object.keys(bundledFiles).sort()
  .map((k) => normalizeProfile(bundledFiles[k]))
  .filter((p): p is SpeechServerProfile => !!p);

let workspace: SpeechServerProfile[] = [];
const listeners = new Set<() => void>();

/** Every profile in effect: the workspace's, then the bundled ones it does not replace. */
export function speechProfiles(): SpeechServerProfile[] {
  const ids = new Set(workspace.map((p) => p.id));
  return [...workspace, ...bundled.filter((p) => !ids.has(p.id))];
}

/** The workspace's profiles (the raw texts of .mdp/tts-servers/*.json); an unreadable
 *  file is skipped. */
export function setWorkspaceSpeechProfiles(texts: string[]): void {
  const list: SpeechServerProfile[] = [];
  for (const t of texts) {
    try {
      const p = normalizeProfile(JSON.parse(t));
      if (p) list.push(p);
    } catch { /* not JSON: skip */ }
  }
  const before = JSON.stringify(workspace);
  workspace = list;
  if (JSON.stringify(workspace) !== before) listeners.forEach((f) => f());
}

/** Called when the profiles change (descriptions found earlier may no longer hold). */
export function onSpeechProfilesChanged(f: () => void): () => void {
  listeners.add(f);
  return () => { listeners.delete(f); };
}
