import type { FileNode } from '../../types';
import { MDP_DIR } from './specialFolders';

// ---------------------------------------------------------------------------
// `.mdp` scope resolution (cascade rule B)
//
// A `.mdp/` folder can sit in ANY directory; everything beneath it follows that
// `.mdp` (content profile: modules / effects / themes / images / AI prompt). The
// applicable `.mdp`s for a deck are its ancestor directories that contain a `.mdp`,
// from the OPENED WORKSPACE ROOT down to the deck's own directory — nearest wins,
// inheriting from ancestors. There is NO `root: true` marker: the walk is bounded
// by the workspace root (we never look above what the file tree shows).
//
// Resolution is purely tree-based (the loaded FileNode[] already includes `.mdp`
// dirs — buildTree keeps `.mdp` while hiding other dotfolders), so it needs no
// backend round-trips and stays fast even over a (NAS-mounted) network tree.
// ---------------------------------------------------------------------------

// The child nodes at a workspace-relative directory ('' = root), or null if that
// directory isn't present/loaded in the tree.
export function childrenAtDir(tree: FileNode[], dirPath: string): FileNode[] | null {
  if (!dirPath) return tree;
  let nodes: FileNode[] = tree;
  for (const seg of dirPath.split('/')) {
    const found = nodes.find((n) => n.type === 'directory' && n.name === seg);
    if (!found || !found.children) return null;
    nodes = found.children;
  }
  return nodes;
}

// Does `dirPath` directly contain a `.mdp/` folder?
function dirHasMdp(tree: FileNode[], dirPath: string): boolean {
  const nodes = childrenAtDir(tree, dirPath);
  return !!nodes && nodes.some((n) => n.name === MDP_DIR && n.type === 'directory');
}

// Ancestor directories of a path, from the workspace root down to the path's own
// directory: ['', 'a', 'a/b'] for 'a/b/deck.slide.md'.
function ancestorDirs(relPath: string): string[] {
  const segs = (relPath || '').split('/').filter(Boolean);
  segs.pop(); // drop the file (or leaf) name → its containing directory
  const dirs = [''];
  let cur = '';
  for (const s of segs) { cur = cur ? `${cur}/${s}` : s; dirs.push(cur); }
  return dirs;
}

// The directories that own an applicable `.mdp`, ordered ROOT → NEAREST. Overlay in
// this order (nearest applied last → nearest wins).
export function resolveMdpChain(tree: FileNode[], deckPath: string | null): string[] {
  if (!deckPath) return [];
  return ancestorDirs(deckPath).filter((d) => dirHasMdp(tree, d));
}

// The `.mdp` config directory paths for a deck, root→nearest (e.g. ['.mdp',
// 'alice/.mdp']). These are what an asset loader reads + merges.
export function resolveMdpConfigDirs(tree: FileNode[], deckPath: string | null): string[] {
  return resolveMdpChain(tree, deckPath).map((d) => (d ? `${d}/${MDP_DIR}` : MDP_DIR));
}

// The directory owning the NEAREST `.mdp` to a deck (where edits to that deck's
// scope are written), or null if none applies.
export function nearestMdpDir(tree: FileNode[], deckPath: string | null): string | null {
  const chain = resolveMdpChain(tree, deckPath);
  return chain.length ? chain[chain.length - 1] : null;
}

// Whether a node is itself a `.mdp` folder (for "Configure…" context-menu gating).
export function isMdpFolder(node: FileNode): boolean {
  return node.type === 'directory' && node.name === MDP_DIR;
}

// The config dirs (root→nearest) for a deck, falling back to the root `.mdp` when no
// deck/scope applies (e.g. nothing open yet) so assets still load like before.
export function scopeConfigDirs(tree: FileNode[], deckPath: string | null): string[] {
  const dirs = resolveMdpConfigDirs(tree, deckPath);
  if (dirs.length) return dirs;
  const rootKids = childrenAtDir(tree, '');
  return rootKids && rootKids.some((n) => n.name === MDP_DIR && n.type === 'directory') ? [MDP_DIR] : [];
}

// Collect asset file paths of one kind (subdir e.g. 'modules', ext '.mdpmod.xml')
// from each `.mdp` config dir in the chain, merged so the NEAREST `.mdp` wins on
// basename. `configDirs` is root→nearest. Returns the chosen file paths (unsorted).
export function collectScopedAssetPaths(tree: FileNode[], configDirs: string[], subdir: string, ext: string): string[] {
  const byName = new Map<string, string>();
  for (const cdir of configDirs) {
    const nodes = childrenAtDir(tree, `${cdir}/${subdir}`);
    if (!nodes) continue;
    for (const f of nodes) if (f.type === 'file' && f.name.endsWith(ext)) byName.set(f.name, f.path);
  }
  return [...byName.values()];
}
