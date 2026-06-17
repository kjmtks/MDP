import { apiClient } from '../../api/apiClient';
import { IMAGES_DIR } from '../workspace/specialFolders';

// The shared image library keeps `.mdp/images/registry.json` SMALL: data images
// are written as individual binary files under `.mdp/images/` and the registry
// stores only a root-relative path (or a plain URL). This avoids a single giant
// JSON that is slow to read/parse/rewrite on every edit.

const MIME_EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif',
  'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/bmp': 'bmp', 'image/x-icon': 'ico',
};

const extFromDataUri = (dataUri: string): string => {
  const m = /^data:([^;]+)[;,]/.exec(dataUri);
  return (m && MIME_EXT[m[1].toLowerCase()]) || 'png';
};

const isManagedPath = (value: string) => value.startsWith(`/${IMAGES_DIR}/`) || value.startsWith(`${IMAGES_DIR}/`);

/**
 * Persist a library image value. A `data:` URI is written to
 * `.mdp/images/<alias>.<ext>` and a root-relative path is returned; URLs and paths
 * pass through unchanged.
 */
export async function storeLibraryImage(alias: string, value: string): Promise<string> {
  if (!value.startsWith('data:')) return value;
  const ext = extFromDataUri(value);
  const payload = value.split(',')[1] || '';
  const path = `${IMAGES_DIR}/${alias}.${ext}`;
  await apiClient.createFile(IMAGES_DIR, 'directory').catch(() => {});
  await apiClient.saveFile(path, payload, true);
  return `/${path}`;
}

/** Resolve a library value to an inline `data:` URI (for moving into a file def). */
export async function inlineLibraryImage(value: string): Promise<string> {
  if (!isManagedPath(value)) return value; // URL — inline as-is
  try {
    return await apiClient.getFileAsDataUrl(value.replace(/^\//, ''));
  } catch {
    return value;
  }
}

/** Write the (small) registry file: alias→path/URL plus descriptions and tags. */
export async function saveRegistry(
  map: Record<string, string>,
  descriptions: Record<string, string> = {},
  tags: Record<string, string[]> = {},
): Promise<void> {
  await apiClient.createFile(IMAGES_DIR, 'directory').catch(() => {});
  const payload = { version: 1, images: map, descriptions, tags };
  await apiClient.saveFile(`${IMAGES_DIR}/registry.json`, JSON.stringify(payload, null, 2));
}

/** Delete a library image's backing file if it is a managed `.mdp/images/` file. */
export async function deleteLibraryFile(value: string): Promise<void> {
  if (!isManagedPath(value)) return;
  try {
    await apiClient.deleteFiles([value.replace(/^\//, '')]);
  } catch {
    /* ignore */
  }
}
