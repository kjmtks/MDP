// Shared helpers for the per-deck `@tags` meta directive.
//
// Tags are authored on the meta page as `<!-- @tags a, b, "c, d" -->` and used for
// deck search/organization — they are NOT rendered on slides. splitTags/serializeTags
// are a round-trip pair: a literal comma inside a tag is escaped as `\,`, mirroring
// the escaping convention used by moduleProcessor.parseArguments.

/** Match a single-line `<!-- @tags ... -->` directive; the inner value is group 1. */
export const TAGS_DIRECTIVE_RE = /<!--\s*@tags\s+([\s\S]*?)\s*-->/i;

/** Parse a `@tags` value into a clean, de-duplicated list.
 *  - commas separate tags; `\,` escapes a literal comma; `"…"` quotes a value so
 *    commas inside it don't split
 *  - each tag is trimmed; empties are dropped
 *  - de-duped case-insensitively, preserving the first-seen casing */
export const splitTags = (value: string): string[] => {
  if (!value || !value.trim()) return [];
  const raw: string[] = [];
  let cur = '';
  let inQuote = false;
  let esc = false;
  for (const ch of value) {
    if (esc) { cur += ch; esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inQuote = !inQuote; continue; }
    if (ch === ',' && !inQuote) { raw.push(cur); cur = ''; continue; }
    cur += ch;
  }
  raw.push(cur);

  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of raw) {
    const tag = part.trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
};

/** Serialize tags to a `@tags` value (`, ` separated, `\` and `,` escaped) so the
 *  result round-trips through splitTags. */
export const serializeTags = (tags: string[]): string =>
  tags
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => t.replace(/\\/g, '\\\\').replace(/,/g, '\\,'))
    .join(', ');
