import { apiClient } from '../../api/apiClient';

// `hash` is the official file's content fingerprint (scripts/make_catalog.py).
// Absent on an older catalog — then only MISSING files can be detected, which is
// exactly the gap that let an out-of-date module sit in a workspace forever.
// `size` (bytes) is given for binary assets (fonts), which are checked by size
// instead of being read back and hashed.
export interface CatalogItem { path: string; hash?: string; size?: number }
export type CatalogData = Record<string, CatalogItem[]>;

/** Binary official assets (workspace fonts): downloaded as bytes, never as text. */
export const isBinaryAsset = (path: string) => /\.(woff2?|ttf|otf)$/i.test(path);

const categoryName = (category: string) => category.replace(/^\.mdp\//, '').replace(/^\./, '');

function bytesToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/** The same fingerprint make_catalog.py computes: FNV-1a/32 over the UTF-8 bytes,
 *  CRLF normalised to LF and any BOM stripped, so a local copy hashes identically
 *  no matter which writer produced it. Not cryptographic — it only has to differ
 *  when the file differs. */
export function assetHash(text: string): string {
  const bytes = new TextEncoder().encode(String(text).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'));
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h = Math.imul(h ^ bytes[i], 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

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
 *  a `.mdp/` directory (`.mdp/modules`, …) — strip the leading dot and re-home.
 *  `prefix` re-homes into a NESTED `.mdp` (e.g. 'alice/' → 'alice/.mdp/modules'),
 *  so per-folder content profiles can hold their own copy of the official assets.
 *  Tolerates categories already in `.mdp/...` form. */
export function catalogLocalDir(category: string, prefix = ''): string {
  if (category.startsWith('.mdp/')) return `${prefix}${category}`;
  return `${prefix}.mdp/${category.replace(/^\./, '')}`;
}

/** Local destination path for a catalog item: `${localDir}/${fileName}` — except
 *  fonts, which keep their per-family folder (`fonts/<id>/<file>`). */
export function catalogLocalPath(category: string, item: CatalogItem, prefix = ''): string {
  if (categoryName(category) === 'fonts') {
    const rel = item.path.replace(/^fonts\//, '').split('/').filter((s) => s && s !== '..' && s !== '.').join('/');
    return `${catalogLocalDir(category, prefix)}/${rel}`;
  }
  const fileName = item.path.split('/').pop() || '';
  return `${catalogLocalDir(category, prefix)}/${fileName}`;
}

/** `prefix` = folder whose `.mdp` receives the assets ('' = workspace root;
 *  'alice/' = alice's `.mdp`). `only` limits the download to some categories
 *  (e.g. ['fonts'] for "Get official fonts"). Resolves with how many files were
 *  written and how many could not be fetched. */
export async function syncOfficialCatalog(prefix = '', only?: string[]): Promise<{ downloaded: number; failed: number }> {
  console.log('[MDP Sync] Starting official catalog sync...');

  window.dispatchEvent(new CustomEvent('mdp-sync-start'));
  let downloaded = 0;
  let failed = 0;

  try {
    const catalog = await fetchCatalog();

    for (const [category, items] of Object.entries(catalog)) {
      if (!items || items.length === 0) continue;
      if (only && !only.includes(categoryName(category))) continue;

      try { await apiClient.createFile(catalogLocalDir(category, prefix), 'directory'); } catch {
        // directory already exists
      }

      for (const item of items) {
        // Cache-bust each file too, otherwise the GitHub raw CDN may serve a
        // stale copy and the overwrite has no effect.
        const fileUrl = `${CATALOG_BASE_URL}/${item.path}?t=${Date.now()}`;

        const fileRes = await fetch(fileUrl);
        if (!fileRes.ok) {
          console.warn(`[MDP Sync] Skipped ${item.path}: HTTP ${fileRes.status}`);
          failed++;
          continue;
        }

        // saveFile overwrites unconditionally, so syncing always refreshes. A font
        // is bytes — reading it as text would corrupt it. (saveFile creates the
        // per-family folder as needed.)
        const dest = catalogLocalPath(category, item, prefix);
        if (isBinaryAsset(item.path)) {
          await apiClient.saveFile(dest, bytesToBase64(await fileRes.arrayBuffer()), true);
        } else {
          await apiClient.saveFile(dest, await fileRes.text());
        }
        downloaded++;
      }
    }
    console.log(`[MDP Sync] Official assets synced: ${downloaded} written, ${failed} skipped.`);
    return { downloaded, failed };

  } catch (error) {
    console.error('[MDP Sync] Sync error:', error);
    throw error;
  } finally {
    window.dispatchEvent(new CustomEvent('mdp-sync-end'));
  }
}
