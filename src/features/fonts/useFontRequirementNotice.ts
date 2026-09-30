import { useEffect } from 'react';
import { apiClient, isMcpRenderer } from '../../api/apiClient';
import { choiceDialog, notify, reportError } from '../../components/error/errorReporter';
import type { FontRequirementStatus } from './fontTypes';
import { sourceLabel, toEntry } from './fontRequirements';

// Tell the user when the open deck's folder DECLARES fonts (requirements.json)
// that this computer has neither in a `.mdp` nor installed — each such font once
// per session (or never again, if they say so) — and offer to download the ones
// that have a source. Nothing is downloaded without that click (offline-first).

// `<.mdp>/<family>` of every declared font already announced this session.
const shown = new Set<string>();
const MUTED_KEY = 'mdp-font-notice-muted';
const idOf = (r: FontRequirementStatus) => `${r.configDir}/${r.family.toLowerCase()}`;

function muted(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(MUTED_KEY) || '[]')); } catch { return new Set(); }
}
function mute(ids: string[]) {
  try {
    const list = [...new Set([...muted(), ...ids])].slice(-200);
    localStorage.setItem(MUTED_KEY, JSON.stringify(list));
  } catch { /* storage unavailable — the session memory still applies */ }
}

/** Download the declared fonts that have a source into the `.mdp` declaring
 *  each; reports progress and failures. Returns how many were installed. */
export async function installRequiredFonts(list: FontRequirementStatus[]): Promise<number> {
  let ok = 0;
  const failed: string[] = [];
  for (const r of list) {
    if (!r.source) continue;
    notify(`Downloading ${r.family} (${sourceLabel(r.source)})…`, { severity: 'info' });
    try {
      const res = await apiClient.installFont(r.configDir, toEntry(r));
      if (res.error) failed.push(`${r.family}: ${res.error}`);
      else ok++;
    } catch (e) {
      failed.push(`${r.family}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (ok) notify(`Installed ${ok} font${ok > 1 ? 's' : ''}.`);
  if (failed.length) reportError(`Could not install ${failed.length} font${failed.length > 1 ? 's' : ''}.`, { detail: failed.join('\n') });
  window.dispatchEvent(new CustomEvent('mdp-fonts-changed'));
  return ok;
}

export function useFontRequirementNotice(requirements: FontRequirementStatus[], requirementsScope: string, scopeDirs: string[]) {
  useEffect(() => {
    if (isMcpRenderer()) return;
    const scope = scopeDirs.join('\n');
    if (requirementsScope !== scope) return;             // declarations of another folder still in flight
    const off = muted();
    const missing = requirements.filter((r) => r.state === 'missing' && !off.has(idOf(r)));
    // Only when something NEW is missing — not again for the fonts the user has
    // already been told about (e.g. the ones left after downloading the others).
    if (!missing.some((r) => !shown.has(idOf(r)))) return;
    // Wait for the font list and the declarations to settle (they load separately).
    const timer = window.setTimeout(async () => {
      if (!missing.some((r) => !shown.has(idOf(r)))) return;
      missing.forEach((r) => shown.add(idOf(r)));
      const auto = missing.filter((r) => r.source);
      const manual = missing.filter((r) => !r.source);
      const lines: string[] = ['Decks in this folder declare fonts that this computer does not have. Until they are here, text uses fallback fonts, so the slides can look (and fit) differently from the author’s.'];
      if (auto.length) {
        lines.push('', 'Can be downloaded into the folder’s .mdp:');
        for (const r of auto) lines.push(`  • ${r.family} — ${sourceLabel(r.source)}${r.license ? `, ${r.license}` : ''}`);
      }
      if (manual.length) {
        lines.push('', 'Must be installed by you (not distributed with the decks):');
        for (const r of manual) {
          lines.push(`  • ${r.family}${r.note ? ` — ${r.note}` : ''}${r.homepage ? `\n     ${r.homepage}` : ''}${r.fallback?.length ? `\n     meanwhile: ${r.fallback.join(', ')}` : ''}`);
        }
      }
      lines.push('', 'Details: right-click the .mdp folder → Configure (.mdp)… → Required fonts.');
      const choice = await choiceDialog(lines.join('\n'), {
        title: 'Fonts required by this folder',
        severity: 'warning',
        options: [
          ...(auto.length ? [{ value: 'install', label: `Download ${auto.length} font${auto.length > 1 ? 's' : ''}`, variant: 'contained' as const, color: 'primary' as const }] : []),
          { value: 'later', label: 'Not now' },
          { value: 'mute', label: 'Don’t remind me' },
        ],
      });
      if (choice === 'install') await installRequiredFonts(auto);
      else if (choice === 'mute') mute(missing.map(idOf));
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [requirements, requirementsScope, scopeDirs]);
}
