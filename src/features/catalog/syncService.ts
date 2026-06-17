import { apiClient } from '../../api/apiClient';

export interface CatalogItem { path: string; }
export type CatalogData = Record<string, CatalogItem[]>;

// Official assets now live in the MDP app repo under official-assets/.
// catalog.json sits at the root of that folder and its item paths are
// relative to it (e.g. "effects/blur.mdpfx.xml"), so the base URL points
// straight at official-assets/. On sync each category is re-homed under the
// workspace's `.mdp/` directory (see catalogLocalDir).
export const CATALOG_BASE_URL = 'https://raw.githubusercontent.com/kjmtks/MDP/refs/heads/main/official-assets';

/** Fetch the official catalog manifest (cache-busted so updates are picked up). */
export async function fetchCatalog(): Promise<CatalogData> {
  const res = await fetch(`${CATALOG_BASE_URL}/catalog.json?t=${Date.now()}`);
  if (!res.ok) throw new Error(`Failed to fetch catalog: ${res.status}`);
  return res.json();
}

/** Local destination DIRECTORY for a catalog category. The remote catalog uses
 *  root-relative categories (`.modules`, `.themes`, …); locally they live under
 *  `.mdp/` (`.mdp/modules`, …) — strip the leading dot and re-home under `.mdp`.
 *  Tolerates categories already in `.mdp/...` form. */
export function catalogLocalDir(category: string): string {
  if (category.startsWith('.mdp/')) return category;
  return `.mdp/${category.replace(/^\./, '')}`;
}

/** Local destination path for a catalog item: `${localDir}/${fileName}`. */
export function catalogLocalPath(category: string, item: CatalogItem): string {
  const fileName = item.path.split('/').pop() || '';
  return `${catalogLocalDir(category)}/${fileName}`;
}

export async function syncOfficialCatalog(): Promise<void> {
  console.log('[MDP Sync] Starting official catalog sync...');

  window.dispatchEvent(new CustomEvent('mdp-sync-start'));

  try {
    const catalog = await fetchCatalog();

    for (const [category, items] of Object.entries(catalog)) {
      if (!items || items.length === 0) continue;

      try { await apiClient.createFile(catalogLocalDir(category), 'directory'); } catch {
        // directory already exists
      }

      for (const item of items) {
        // Cache-bust each file too, otherwise the GitHub raw CDN may serve a
        // stale copy and the overwrite has no effect.
        const fileUrl = `${CATALOG_BASE_URL}/${item.path}?t=${Date.now()}`;

        const fileRes = await fetch(fileUrl);
        if (!fileRes.ok) {
          console.warn(`[MDP Sync] Skipped ${item.path}: HTTP ${fileRes.status}`);
          continue;
        }

        const content = await fileRes.text();
        // saveFile overwrites unconditionally, so syncing always refreshes.
        await apiClient.saveFile(catalogLocalPath(category, item), content);
      }
    }
    console.log('[MDP Sync] All official assets synced successfully.');

  } catch (error) {
    console.error('[MDP Sync] Sync error:', error);
    throw error;
  } finally {
    window.dispatchEvent(new CustomEvent('mdp-sync-end'));
  }
}
