// Image-alias registry + resolution.
//
// Authors define an image under an alias and reference it in slide markdown:
//   <!-- @image logo -->
//   data:image/png;base64,....        (or an http(s) URL, or a workspace path)
//   <!-- @end -->
//   ...later in the body...  ![alt](@logo)
//
// Definitions may live in the slide file (per-deck) and/or a workspace-shared
// library (.mdp/images/registry.json). On alias conflict the in-file def wins.

// --- workspace-shared library registry (module-scoped, like loadedModules) ---
let libraryImages: Record<string, string> = {};
export const getLibraryImages = (): Record<string, string> => libraryImages;
export const setLibraryImages = (map: Record<string, string>) => { libraryImages = map || {}; };
export const clearLibraryImages = () => { libraryImages = {}; };

// `<!--` is assembled to avoid embedding a literal HTML comment opener in source.
const OPEN = '<' + '!--';
// One def block: captures alias (1), optional directive args (2: `desc: …; tags:
// a, b`), and the value body (3). `@end` is required (non-greedy body) so an
// unterminated block never swallows the doc.
const defBlockRegex = () => new RegExp(
  OPEN + '\\s*@image\\s+([\\w-]+)[ \\t]*([^\\r\\n]*?)[ \\t]*--' + '>\\r?\\n([\\s\\S]*?)\\r?\\n?\\s*' + OPEN + '\\s*@end\\s*--' + '>',
  'g',
);

export interface ImageDefRange { alias: string; from: number; to: number; value: string; description?: string; tags?: string[]; }

/** A single alias entry surfaced to the Images panel. */
export interface ImageEntry { alias: string; value: string; scope: 'file' | 'library'; description?: string; tags?: string[]; }

// Parse the optional `@image` directive args: `desc: …; tags: a, b` (`;` separates
// keys so commas can be used inside the tag list).
const parseDefArgs = (argsStr: string): { description?: string; tags?: string[] } => {
  const out: { description?: string; tags?: string[] } = {};
  if (!argsStr) return out;
  for (const seg of argsStr.split(';')) {
    const i = seg.indexOf(':');
    if (i === -1) continue;
    const key = seg.slice(0, i).trim().toLowerCase();
    const val = seg.slice(i + 1).trim();
    if (key === 'desc' || key === 'description') { if (val) out.description = val; }
    else if (key === 'tags' || key === 'tag') {
      const tags = val.split(',').map((t) => t.trim()).filter(Boolean);
      if (tags.length) out.tags = tags;
    }
  }
  return out;
};

/** Locate every `@image … @end` block in `doc` (character offsets). */
export const findImageDefRanges = (doc: string): ImageDefRange[] => {
  const out: ImageDefRange[] = [];
  const re = defBlockRegex();
  let m: RegExpExecArray | null;
  while ((m = re.exec(doc || '')) !== null) {
    const { description, tags } = parseDefArgs(m[2] || '');
    out.push({ alias: m[1], from: m.index, to: m.index + m[0].length, value: m[3].trim(), description, tags });
  }
  return out;
};

/** In-file alias map + block ranges parsed from the markdown. */
export const parseInFileImageDefs = (
  markdown: string,
): { defs: Record<string, string>; ranges: ImageDefRange[] } => {
  const ranges = findImageDefRanges(markdown || '');
  const defs: Record<string, string> = {};
  for (const r of ranges) defs[r.alias] = r.value;
  return { defs, ranges };
};

// Reference syntax: ![alt](@alias). The leading `@` distinguishes an alias from
// a normal image URL, so ordinary images are never touched.
const refRegex = () => /!\[([^\]]*)\]\(@([\w-]+)\)/g;

/**
 * Expand `![alt](@alias)` references and strip `@image` def blocks. Merges the
 * in-file defs over the shared library (in-file wins). Fenced/inline code is
 * masked so literal examples are left untouched. An unknown alias is left in
 * place as an inline English warning (and a console.warn).
 */
// Library data images are stored under SOME `.mdp/images/` — the workspace root's
// (`/.mdp/images/<f>`) or a nested per-folder `.mdp`'s (merged view rebases to
// e.g. `alice/.mdp/images/<f>`). Either form resolves relative to the WORKSPACE
// ROOT (not the slide's folder), so the caller passes a resolver that prefixes
// them with the platform base (`/files/` or `mdp-file://`). Match the `.mdp/images/`
// segment ANYWHERE, or nested-registry aliases fall through to deck-relative
// resolution and break.
const MANAGED_PATH = /(^|\/)\.mdp\/images\//;

export const resolveImages = (
  markdown: string,
  library: Record<string, string> = libraryImages,
  resolveManagedPath?: (path: string) => string,
): { markdown: string; unresolved: string[] } => {
  if (!markdown) return { markdown: '', unresolved: [] };

  // Mask fenced / inline code so refs and defs inside code samples are ignored.
  const codeBlocks: string[] = [];
  let md = markdown.replace(/```[\s\S]*?```|`[^`]+`/g, (m) => {
    codeBlocks.push(m);
    return `__MDP_IMG_CB_${codeBlocks.length - 1}__`;
  });

  const { defs } = parseInFileImageDefs(md);
  const map: Record<string, string> = { ...library, ...defs };

  // Remove def blocks from the output (they are definitions, not content).
  md = md.replace(defBlockRegex(), '');

  const unresolved: string[] = [];
  md = md.replace(refRegex(), (_whole, alt: string, alias: string) => {
    let value = map[alias];
    if (value == null || value === '') {
      if (!unresolved.includes(alias)) unresolved.push(alias);
      console.warn(`[MDP] Unknown image alias: @${alias}`);
      return `**⚠️ Unknown image alias: @${alias}**`;
    }
    if (resolveManagedPath && MANAGED_PATH.test(value)) value = resolveManagedPath(value);
    return `![${alt}](${value})`;
  });

  // Also resolve aliases used as MODULE arguments inside HTML-comment directives,
  // e.g. `<!-- @balloon image: @avatar-kojima -->`. We only touch `key: @alias`
  // (a value position) so the directive name (`@balloon`) is never matched, and
  // only KNOWN aliases are substituted (so `@balloon` etc. are left as-is even if
  // a comment uses them as a value). The resolved value is wrapped in quotes so a
  // data-URI's commas survive the module arg parser (which splits on `,` but
  // respects quotes).
  md = md.replace(/<!--[\s\S]*?-->/g, (comment) =>
    comment.replace(/([:=]\s*)@([\w-]+)/g, (whole, pre: string, alias: string) => {
      let value = map[alias];
      if (value == null || value === '') return whole;
      if (resolveManagedPath && MANAGED_PATH.test(value)) value = resolveManagedPath(value);
      return `${pre}"${value}"`;
    }),
  );

  codeBlocks.forEach((b, i) => { md = md.replace(`__MDP_IMG_CB_${i}__`, () => b); });
  return { markdown: md, unresolved };
};
