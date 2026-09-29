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
//
// Directories are looked up by PATH, never by display name: a `.mdplink` is SHOWN
// without its extension (`KJNAS`) while its path keeps it (`KJNAS.mdplink/…`), so
// a name match never entered a link — no `.mdp` behind a `.mdplink` ever joined a
// deck's chain (its image library, themes and modules were all missing). A remote
// (SSH) subtree is also only listed on demand; `lazyScopeDirs` names the deferred
// directories this walk still needs, for the caller to load.
// ---------------------------------------------------------------------------

// The directory node at a workspace-relative path, or null if it isn't present in
// the tree (or sits below a directory whose children aren't loaded yet).
function dirNodeAt(tree: FileNode[], dirPath: string): FileNode | null {
  let nodes: FileNode[] = tree;
  let found: FileNode | null = null;
  let cur = '';
  for (const seg of dirPath.split('/').filter(Boolean)) {
    cur = cur ? `${cur}/${seg}` : seg;
    if (found) {
      if (!found.children) return null;
      nodes = found.children;
    }
    found = nodes.find((n) => n.type === 'directory' && n.path === cur) || null;
    if (!found) return null;
  }
  return found;
}

// The child nodes at a workspace-relative directory ('' = root), or null if that
// directory isn't present/loaded in the tree.
export function childrenAtDir(tree: FileNode[], dirPath: string): FileNode[] | null {
  if (!dirPath) return tree;
  const found = dirNodeAt(tree, dirPath);
  return found && found.children ? found.children : null;
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

// The DEFERRED (not yet listed) directories that resolving `deckPath`'s scope still
// needs — a deck behind an SSH `.mdplink` sits in a subtree that is only listed as
// it is expanded. In order: the first unlisted ancestor of the deck (a tab restored
// at startup opens it without expanding anything; each load reveals the next
// level), each applicable `.mdp`, and the `.mdp` folders whose FILES are taken
// from the tree (modules / effects — the rest are read from disk by path).
export function lazyScopeDirs(tree: FileNode[], deckPath: string | null): string[] {
  if (!deckPath) return [];
  const out: string[] = [];
  for (const d of ancestorDirs(deckPath)) {
    if (!d) continue;
    const node = dirNodeAt(tree, d);
    if (!node) break;                              // not in the tree (yet)
    if (node.lazy) { out.push(node.path); break; } // deeper levels follow its load
  }
  for (const cdir of resolveMdpConfigDirs(tree, deckPath)) {
    const mdp = dirNodeAt(tree, cdir);
    if (!mdp) continue;
    if (mdp.lazy) { out.push(mdp.path); continue; }
    for (const sub of ['modules', 'effects']) {
      const node = dirNodeAt(tree, `${cdir}/${sub}`);
      if (node && node.lazy) out.push(node.path);
    }
  }
  return out;
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
