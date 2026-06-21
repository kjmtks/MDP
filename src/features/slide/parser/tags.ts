// Shared helpers for the per-deck `@tags` meta directive.
//
// Tags are authored on the meta page as `<!-- @tags a, b; c -->` and used for deck
// search/organization — they are NOT rendered on slides. Tags may be separated by
// commas OR semicolons. splitTags/serializeTags are a round-trip pair: a separator
// (or backslash) inside a tag is escaped with `\` (e.g. `\,` `\;`), or the tag can be
// quoted (`"a, b"`), mirroring moduleProcessor.parseArguments' escaping convention.

/** Match a single-line `<!-- @tags ... -->` directive; the inner value is group 1. */
export const TAGS_DIRECTIVE_RE = /<!--\s*@tags\s+([\s\S]*?)\s*-->/i;

/** Parse a `@tags` value into a clean, de-duplicated list.
 *  - commas or semicolons separate tags; `\,` / `\;` escape a literal separator;
 *    `"…"` quotes a value so separators inside it don't split
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
    if ((ch === ',' || ch === ';') && !inQuote) { raw.push(cur); cur = ''; continue; }
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

/** Serialize tags to a `@tags` value (`, ` separated, with `\`, `,` and `;` escaped)
 *  so the result round-trips through splitTags. */
export const serializeTags = (tags: string[]): string =>
  tags
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => t.replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;'))
    .join(', ');
