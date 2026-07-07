import { apiClient } from '../../api/apiClient';
import { IMAGES_DIR } from '../workspace/specialFolders';

// The shared image library keeps each `registry.json` SMALL: data images are
// written as individual binary files under the owning `.mdp/images/` and the
// registry stores only a `.mdp`-relative path (or a plain URL). Libraries CASCADE
// like every other `.mdp` asset: the merged view is assembled per active deck,
// while writes go to ONE owning `.mdp` (see updateRegistry).

const MIME_EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif',
  'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/bmp': 'bmp', 'image/x-icon': 'ico',
};

const extFromDataUri = (dataUri: string): string => {
  const m = /^data:([^;]+)[;,]/.exec(dataUri);
  return (m && MIME_EXT[m[1].toLowerCase()]) || 'png';
};

// A managed library file lives under SOME `.mdp/images/` — the workspace root's or
// a nested per-folder `.mdp`'s, so match the segment anywhere in the path.
const isManagedPath = (value: string) => /(^|\/)\.mdp\/images\//.test(value);

// Rebase a registry-local managed value (`/.mdp/images/<f>`) to the merged-view
// path under its owning config dir (e.g. `alice/.mdp/images/<f>`).
export const rebaseLibraryValue = (value: string, configDir: string): string =>
  value.replace(/^\/?\.mdp\/images\//, `${configDir}/images/`);

/**
 * Persist a library image value into a specific `.mdp`'s images store (default:
 * the workspace root's). A `data:` URI is written to `<configDir>/images/<alias>.<ext>`;
 * the returned registry value is `.mdp`-LOCAL (`/.mdp/images/<f>`) so a folder
 * stays portable. URLs and non-data paths pass through unchanged.
 */
export async function storeLibraryImage(alias: string, value: string, configDir: string = '.mdp'): Promise<string> {
  if (!value.startsWith('data:')) return value;
  const ext = extFromDataUri(value);
  const payload = value.split(',')[1] || '';
  const imagesDir = `${configDir}/images`;
  await apiClient.createFile(imagesDir, 'directory').catch(() => {});
  await apiClient.saveFile(`${imagesDir}/${alias}.${ext}`, payload, true);
  return `/${IMAGES_DIR}/${alias}.${ext}`;
}

/** Resolve a library value to an inline `data:` URI (for moving into a file def).
 *  Expects the MERGED-VIEW (rebased) value. */
export async function inlineLibraryImage(value: string): Promise<string> {
  if (!isManagedPath(value)) return value; // URL — inline as-is
  try {
    return await apiClient.getFileAsDataUrl(value.replace(/^\//, ''));
  } catch {
    return value;
  }
}

export interface LibraryRegistry {
  images: Record<string, string>;
  descriptions: Record<string, string>;
  tags: Record<string, string[]>;
}

/** Read one `.mdp`'s registry.json (empty registry when absent/invalid). */
export async function readRegistry(configDir: string): Promise<LibraryRegistry> {
  try {
    const p = JSON.parse(await apiClient.readFileText(`${configDir}/images/registry.json`));
    return { images: (p && p.images) || {}, descriptions: (p && p.descriptions) || {}, tags: (p && p.tags) || {} };
  } catch {
    return { images: {}, descriptions: {}, tags: {} };
  }
}

/** Read-modify-write ONE `.mdp`'s registry.json (the cascade's owning store for
 *  the alias being changed — never a merged map, which would cross-pollute). */
export async function updateRegistry(configDir: string, mutate: (reg: LibraryRegistry) => void): Promise<void> {
  const reg = await readRegistry(configDir);
  mutate(reg);
  await apiClient.createFile(`${configDir}/images`, 'directory').catch(() => {});
  await apiClient.saveFile(`${configDir}/images/registry.json`, JSON.stringify({ version: 1, ...reg }, null, 2));
}

/** Delete a library image's backing file if it is a managed `.mdp/images/` file.
 *  Expects the MERGED-VIEW (rebased) value. */
export async function deleteLibraryFile(value: string): Promise<void> {
  if (!isManagedPath(value)) return;
  try {
    await apiClient.deleteFiles([value.replace(/^\//, '')]);
  } catch {
    /* ignore */
  }
}
