// Server-specific options of OpenAI-compatible TTS servers — what a server takes
// beyond OpenAI's speech request: Chatterbox's language / cfg_weight (the accent of a
// reference voice) / exaggeration, Irodori's `irodori.*` tuning, Kokoro's lang_code…
// They are described as DATA, so MDP shows real choices without code per server, and
// sends each server only what it takes.
//
// Where a server's description comes from — the first one found; none is required,
// so any server works without cooperating:
//   1. the server itself: `options` (and `languages`) in its /health — a small MDP
//      convention a server MAY follow;
//   2. a profile: a JSON file describing a kind of server and how to recognize it —
//      bundled with the app (official-assets/tts-servers) or the workspace's own
//      (.mdp/tts-servers), see speechProfiles.ts;
//   3. the server's OpenAPI schema (/openapi.json — FastAPI servers have one);
//   4. none: options written in a deck are sent as written.
//
// Decks write a line's options as ONE argument, `mainextra: "cfg_weight=0.5, seed=7"`
// (parseExtra / formatExtra). An option with a ROLE carries something MDP already
// knows: role 'language' is filled from the line's language when the deck does not
// set it, role 'instructions' receives the speaker's prompt.
// Pure functions only — HTTP lives in ttsService.

export type SpeechOptionType = 'number' | 'integer' | 'boolean' | 'string' | 'select';

export interface SpeechOptionChoice {
  value: string | number;
  label?: string;
  /** BCP-47 tags this choice stands for (role 'language'): Kokoro's 'b' = ['en-GB']. */
  lang?: string[];
}

export interface SpeechOptionSpec {
  /** The request field; a dotted path for a nested one ("irodori.num_steps"). */
  key: string;
  type: SpeechOptionType;
  label?: string;
  description?: string;
  min?: number;
  max?: number;
  step?: number;
  /** The server's own default — shown, never sent. */
  default?: unknown;
  choices?: SpeechOptionChoice[];
  /** 'language': filled from the line's language; 'instructions': takes the prompt. */
  role?: 'language' | 'instructions';
}

/** How a profile recognizes its server — any one entry matching is enough. */
export interface SpeechProfileMatch {
  /** /health fields by dotted path: a string must equal (case-insensitive); true = present. */
  health?: Record<string, string | boolean>;
  /** A /v1/models id containing this (case-insensitive). */
  models?: string;
  /** A regular expression the server's URL must match. */
  url?: string;
}

/** A kind of server, described: official-assets/tts-servers/*.json, .mdp/tts-servers/*.json. */
export interface SpeechServerProfile {
  id: string;
  name?: string;
  description?: string;
  match?: SpeechProfileMatch[];
  /** What it speaks (BCP-47 primary tags). The server's own list wins when it gives one. */
  languages?: string[];
  options: SpeechOptionSpec[];
  /** true (default): send only the described options; false: undescribed ones too. */
  strict?: boolean;
  /** The voice when none is chosen (Irodori: 'none' = no reference voice). */
  defaultVoice?: string;
}

export interface SpeechServerDescription {
  source: 'server' | 'profile' | 'openapi' | 'none';
  profileId?: string;
  name?: string;
  options: SpeechOptionSpec[];
  /** What it speaks (primary tags); null = unknown. */
  languages: string[] | null;
  strict: boolean;
  defaultVoice?: string;
}

export const NO_DESCRIPTION: SpeechServerDescription = { source: 'none', options: [], languages: null, strict: false };

// OpenAI's own request fields and transport switches: never "options".
const STANDARD_FIELDS = new Set([
  'model', 'input', 'voice', 'response_format', 'speed', 'instructions', 'stream', 'stream_format',
  'return_download_link', 'download_format',
]);

// ---- paths -----------------------------------------------------------------------

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;
// A dotted path of plain field names — never one that reaches an object's prototype.
const isSafePath = (path: string): boolean =>
  path.split('.').every((s) => SAFE_SEGMENT.test(s) && s !== '__proto__' && s !== 'constructor' && s !== 'prototype');

/** `{a: {b: 1}, c: 2}` → `{'a.b': 1, c: 2}`. */
export function flattenOptions(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (isPlainObject(v)) Object.assign(out, flattenOptions(v, key));
    else out[key] = v;
  }
  return out;
}

/** Set `a.b.c` in `obj` (segments limited to safe names; `__proto__` and the like never). */
export function setOptionPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  if (!isSafePath(path)) return;
  const segs = path.split('.');
  let o = obj;
  for (const s of segs.slice(0, -1)) {
    if (!isPlainObject(o[s])) o[s] = {};
    o = o[s] as Record<string, unknown>;
  }
  o[segs[segs.length - 1]] = value;
}

export function getOptionPath(obj: Record<string, unknown>, path: string): unknown {
  let o: unknown = obj;
  for (const s of path.split('.')) {
    if (!isPlainObject(o)) return undefined;
    o = o[s];
  }
  return o;
}

/** Nested object from flat dotted keys. */
export function nestOptions(flat: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(flat)) setOptionPath(out, k, v);
  return out;
}

/** `b` merged into `a` (nested objects merged, everything else replaced). */
export function mergeOptions(a: Record<string, unknown> | undefined, b: Record<string, unknown> | undefined): Record<string, unknown> {
  return nestOptions({ ...flattenOptions(a || {}), ...flattenOptions(b || {}) });
}

// ---- the deck's text form ------------------------------------------------------------

// A bare value as written: a number, true/false, or text.
const literal = (raw: string): unknown => {
  const s = raw.trim();
  if (/^-?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(s)) return Number(s);
  if (s === 'true') return true;
  if (s === 'false') return false;
  return s;
};

/** `"cfg_weight=0.5, irodori.seed=7; style='calm, slow'"` → `{cfg_weight: 0.5, irodori: {seed: 7}, style: 'calm, slow'}`.
 *  Pairs are separated by `,` or `;`; a value in single quotes may contain them. */
export function parseExtra(text: string | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const s = String(text ?? '');
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /[\s,;]/.test(s[i])) i++;
    if (i >= s.length) break;
    let key = '';
    while (i < s.length && s[i] !== '=' && s[i] !== ',' && s[i] !== ';') key += s[i++];
    key = key.trim();
    if (s[i] !== '=') { continue; }   // a key without a value: skip it
    i++;
    while (i < s.length && s[i] === ' ') i++;
    let value: unknown;
    if (s[i] === "'") {
      let v = '';
      i++;
      while (i < s.length && s[i] !== "'") v += s[i++];
      i++;
      value = v;
    } else {
      let v = '';
      while (i < s.length && s[i] !== ',' && s[i] !== ';') v += s[i++];
      value = literal(v);
    }
    if (key) setOptionPath(out, key, value);
  }
  return out;
}

/** The inverse of parseExtra: `k=v, k2='a, b'` (nested keys dotted). */
export function formatExtra(obj: Record<string, unknown> | null | undefined): string {
  return Object.entries(flattenOptions(obj || {}))
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => {
      const s = String(v);
      return `${k}=${typeof v === 'string' && (/[,;'=]/.test(s) || s !== s.trim() || literal(s) !== s) ? `'${s.replace(/'/g, '')}'` : s}`;
    })
    .join(', ');
}

// ---- checking values against a description ----------------------------------------------

/** A value made to fit its option (type, range, choices); undefined = cannot. */
export function coerceOption(spec: SpeechOptionSpec, value: unknown): unknown {
  if (value === undefined || value === null || value === '') return undefined;
  const clamp = (n: number) => {
    let x = n;
    if (typeof spec.min === 'number') x = Math.max(spec.min, x);
    if (typeof spec.max === 'number') x = Math.min(spec.max, x);
    return x;
  };
  switch (spec.type) {
    case 'number': {
      const n = typeof value === 'number' ? value : Number(String(value).trim());
      return Number.isFinite(n) ? clamp(n) : undefined;
    }
    case 'integer': {
      const n = typeof value === 'number' ? value : Number(String(value).trim());
      return Number.isFinite(n) ? clamp(Math.round(n)) : undefined;
    }
    case 'boolean':
      if (typeof value === 'boolean') return value;
      if (/^(true|1|on|yes)$/i.test(String(value))) return true;
      if (/^(false|0|off|no)$/i.test(String(value))) return false;
      return undefined;
    case 'select': {
      const hit = (spec.choices || []).find((c) => String(c.value).toLowerCase() === String(value).trim().toLowerCase());
      return hit ? hit.value : undefined;
    }
    default:
      return String(value);
  }
}

/** The options to send: each described one fitted to its spec; an undescribed one
 *  only when the description is not strict (or there is none). */
export function sanitizeExtra(extra: Record<string, unknown> | undefined, desc: SpeechServerDescription): Record<string, unknown> {
  const specs = new Map(desc.options.map((o) => [o.key, o]));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(flattenOptions(extra || {}))) {
    if (STANDARD_FIELDS.has(k) || !isSafePath(k)) continue;   // the speech request's own fields are not options
    const spec = specs.get(k);
    if (spec) {
      const fit = coerceOption(spec, v);
      if (fit !== undefined) out[k] = fit;
    } else if (!desc.strict) {
      if (v !== undefined && v !== null && v !== '') out[k] = v;
    }
  }
  return nestOptions(out);
}

// ---- languages -------------------------------------------------------------------------

const primaryTag = (lang: string): string => lang.trim().toLowerCase().replace(/_/g, '-').split('-')[0];

/** The value a role-'language' option takes for a BCP-47 tag: a choice that names the
 *  tag (exact, then its primary subtag), else a choice whose value is the tag; with
 *  no choices, the primary subtag. undefined = the server has no such language. */
export function languageValue(lang: string, spec: SpeechOptionSpec): string | number | undefined {
  const tag = lang.trim().toLowerCase().replace(/_/g, '-');
  if (!tag) return undefined;
  const prim = primaryTag(tag);
  const choices = spec.choices || [];
  if (!choices.length) return prim;
  const tagsOf = (c: SpeechOptionChoice) => (c.lang || []).map((t) => t.toLowerCase().replace(/_/g, '-'));
  const exact = choices.find((c) => tagsOf(c).includes(tag));
  if (exact) return exact.value;
  const byPrimary = choices.find((c) => tagsOf(c).some((t) => primaryTag(t) === prim));
  if (byPrimary) return byPrimary.value;
  const byValue = choices.find((c) => String(c.value).toLowerCase() === tag)
    || choices.find((c) => String(c.value).toLowerCase() === prim);
  return byValue ? byValue.value : undefined;
}

/** Does the described server speak `lang`? undefined = it does not say. */
export function speaksLanguage(desc: SpeechServerDescription, lang: string): boolean | undefined {
  if (!lang.trim()) return true;
  const prim = primaryTag(lang);
  if (desc.languages && desc.languages.length) return desc.languages.some((l) => primaryTag(l) === prim);
  const opt = desc.options.find((o) => o.role === 'language');
  if (opt && opt.choices && opt.choices.length) return languageValue(lang, opt) !== undefined;
  return undefined;
}

// ---- the request ---------------------------------------------------------------------

/** The speech request body: OpenAI's fields, the prompt where the server takes it
 *  (its role-'instructions' option, else `fallbackPromptKey`), the options it takes,
 *  and the line's language in its role-'language' option unless the options set it. */
export function speechRequestBody(
  base: { model: string; input: string; voice: string; speed: number },
  call: { prompt?: string; extra?: Record<string, unknown>; lang?: string },
  desc: SpeechServerDescription,
  fallbackPromptKey = 'instructions',
): Record<string, unknown> {
  const body: Record<string, unknown> = { ...base };
  const extra = sanitizeExtra(call.extra, desc);
  for (const [k, v] of Object.entries(flattenOptions(extra))) setOptionPath(body, k, v);
  const prompt = (call.prompt || '').trim();
  if (prompt) {
    const key = desc.options.find((o) => o.role === 'instructions')?.key || fallbackPromptKey;
    if (getOptionPath(body, key) === undefined) setOptionPath(body, key, prompt);
  }
  const langOpt = desc.options.find((o) => o.role === 'language');
  if (langOpt && call.lang && getOptionPath(body, langOpt.key) === undefined) {
    const v = languageValue(call.lang, langOpt);
    if (v !== undefined) setOptionPath(body, langOpt.key, v);
  }
  return body;
}

// ---- reading descriptions (server, profile, OpenAPI) -----------------------------------------

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const text = (v: unknown, max = 400): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

/** A description entry made safe to use (from a server, a profile file or OpenAPI). */
export function normalizeOption(raw: unknown): SpeechOptionSpec | null {
  if (!isPlainObject(raw)) return null;
  const key = text(raw.key, 200);
  if (!key || !isSafePath(key) || STANDARD_FIELDS.has(key)) return null;
  const choices = Array.isArray(raw.choices)
    ? raw.choices.map((c): SpeechOptionChoice | null => {
      if (typeof c === 'string' || typeof c === 'number') return { value: c };
      if (!isPlainObject(c) || (typeof c.value !== 'string' && typeof c.value !== 'number')) return null;
      const lang = Array.isArray(c.lang) ? c.lang.filter((t): t is string => typeof t === 'string').slice(0, 20) : undefined;
      return { value: c.value, ...(text(c.label, 120) ? { label: text(c.label, 120) } : {}), ...(lang && lang.length ? { lang } : {}) };
    }).filter((c): c is SpeechOptionChoice => !!c).slice(0, 300)
    : undefined;
  const t = raw.type;
  const type: SpeechOptionType = choices && choices.length ? 'select'
    : t === 'number' || t === 'integer' || t === 'boolean' || t === 'select' ? t : 'string';
  const role = raw.role === 'language' || raw.role === 'instructions' ? raw.role : undefined;
  return {
    key, type,
    ...(text(raw.label, 120) ? { label: text(raw.label, 120) } : {}),
    ...(text(raw.description) ? { description: text(raw.description) } : {}),
    ...(num(raw.min) !== undefined ? { min: num(raw.min) } : {}),
    ...(num(raw.max) !== undefined ? { max: num(raw.max) } : {}),
    ...(num(raw.step) !== undefined ? { step: num(raw.step) } : {}),
    ...(raw.default !== undefined && (typeof raw.default !== 'object' || raw.default === null) ? { default: raw.default } : {}),
    ...(choices && choices.length ? { choices } : {}),
    ...(role ? { role } : {}),
  };
}

const optionList = (raw: unknown): SpeechOptionSpec[] => {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: SpeechOptionSpec[] = [];
  for (const r of raw.slice(0, 200)) {
    const o = normalizeOption(r);
    if (o && !seen.has(o.key)) { seen.add(o.key); out.push(o); }
  }
  return out;
};

const languageList = (raw: unknown): string[] | null =>
  (Array.isArray(raw) ? raw.filter((l): l is string => typeof l === 'string' && !!l.trim()).map((l) => l.trim()).slice(0, 300) : null);

/** A profile file made safe to use. */
export function normalizeProfile(raw: unknown): SpeechServerProfile | null {
  if (!isPlainObject(raw)) return null;
  const id = text(raw.id, 60);
  if (!id || !/^[A-Za-z0-9_.-]+$/.test(id)) return null;
  const match = Array.isArray(raw.match) ? raw.match.filter(isPlainObject).map((m): SpeechProfileMatch => ({
    ...(isPlainObject(m.health) ? { health: Object.fromEntries(Object.entries(m.health).filter(([, v]) => typeof v === 'string' || v === true)) as Record<string, string | boolean> } : {}),
    ...(text(m.models, 120) ? { models: text(m.models, 120) } : {}),
    ...(text(m.url, 300) ? { url: text(m.url, 300) } : {}),
  })) : undefined;
  return {
    id,
    ...(text(raw.name, 120) ? { name: text(raw.name, 120) } : {}),
    ...(text(raw.description) ? { description: text(raw.description) } : {}),
    ...(match && match.length ? { match } : {}),
    ...(languageList(raw.languages) ? { languages: languageList(raw.languages) as string[] } : {}),
    options: optionList(raw.options),
    ...(raw.strict === false ? { strict: false } : {}),
    ...(text(raw.defaultVoice, 120) !== undefined ? { defaultVoice: text(raw.defaultVoice, 120) } : {}),
  };
}

/** What a server says about itself and its models — the facts profiles are matched on. */
export interface SpeechServerFacts { url: string; health: unknown; models: unknown }

const modelIds = (models: unknown): string[] => {
  const list = isPlainObject(models) && Array.isArray(models.data) ? models.data : Array.isArray(models) ? models : [];
  return list.map((m) => (isPlainObject(m) ? String(m.id ?? '') : typeof m === 'string' ? m : '')).filter(Boolean);
};

/** The first profile any of whose `match` entries fits the server. */
export function matchProfile(profiles: SpeechServerProfile[], facts: SpeechServerFacts): SpeechServerProfile | null {
  const health = isPlainObject(facts.health) ? facts.health : null;
  const ids = modelIds(facts.models).map((s) => s.toLowerCase());
  const fits = (m: SpeechProfileMatch): boolean => {
    if (!m.health && !m.models && !m.url) return false;
    if (m.url) {
      try { if (!new RegExp(m.url, 'i').test(facts.url)) return false; } catch { return false; }
    }
    if (m.models && !ids.some((id) => id.includes(m.models!.toLowerCase()))) return false;
    if (m.health) {
      if (!health) return false;
      for (const [path, want] of Object.entries(m.health)) {
        const got = getOptionPath(health, path);
        if (typeof want === 'string' ? String(got ?? '').toLowerCase() !== want.toLowerCase() : got === undefined) return false;
      }
    }
    return true;
  };
  return profiles.find((p) => (p.match || []).some(fits)) || null;
}

/** The languages a server reports: /health `languages`, else its models' `languages`. */
export function reportedLanguages(facts: Pick<SpeechServerFacts, 'health' | 'models'>): string[] | null {
  if (isPlainObject(facts.health)) {
    const l = languageList(facts.health.languages);
    if (l && l.length) return l;
  }
  const list = isPlainObject(facts.models) && Array.isArray(facts.models.data) ? facts.models.data : [];
  const all = new Set<string>();
  for (const m of list) if (isPlainObject(m)) (languageList(m.languages) || []).forEach((l) => all.add(l));
  return all.size ? [...all] : null;
}

/** A description from the server's own /health `options`, if it gives one. */
export function describeFromHealth(health: unknown, models?: unknown): SpeechServerDescription | null {
  if (!isPlainObject(health) || !Array.isArray(health.options)) return null;
  return {
    source: 'server',
    options: optionList(health.options),
    languages: reportedLanguages({ health, models }),
    strict: health.strictOptions !== false,
    ...(text(health.defaultVoice, 120) !== undefined ? { defaultVoice: text(health.defaultVoice, 120) } : {}),
  };
}

/** A description from a matched profile, with the server's own language list. */
export function describeFromProfile(p: SpeechServerProfile, facts: SpeechServerFacts): SpeechServerDescription {
  const reported = reportedLanguages(facts);
  const options = p.options.map((o) => {
    // Offer only the languages this server says it has.
    if (o.role !== 'language' || !reported || !o.choices) return o;
    const have = new Set(reported.map(primaryTag));
    const choices = o.choices.filter((c) => have.has(primaryTag(String(c.value))) || (c.lang || []).some((t) => have.has(primaryTag(t))));
    return choices.length ? { ...o, choices } : o;
  });
  return {
    source: 'profile', profileId: p.id, ...(p.name ? { name: p.name } : {}),
    options, languages: reported || p.languages || null, strict: p.strict !== false,
    ...(p.defaultVoice !== undefined ? { defaultVoice: p.defaultVoice } : {}),
  };
}

// OpenAPI 3: resolve "#/components/schemas/X" references.
function deref(doc: Record<string, unknown>, s: unknown, depth = 0): Record<string, unknown> | null {
  if (!isPlainObject(s) || depth > 8) return null;
  if (typeof s.$ref === 'string' && s.$ref.startsWith('#/')) {
    const target = s.$ref.slice(2).split('/').reduce<unknown>((o, k) => (isPlainObject(o) ? o[k] : undefined), doc);
    return deref(doc, target, depth + 1);
  }
  // `anyOf: [{…}, {type: null}]` (an optional field) → the non-null branch.
  for (const k of ['anyOf', 'oneOf', 'allOf']) {
    const alts = s[k];
    if (Array.isArray(alts)) {
      const pick = alts.map((a) => deref(doc, a, depth + 1)).find((a) => a && a.type !== 'null');
      if (pick) return { ...pick, ...(typeof s.title === 'string' ? { title: s.title } : {}), ...(typeof s.description === 'string' ? { description: s.description } : {}), ...('default' in s ? { default: s.default } : {}) };
    }
  }
  return s;
}

/** Options from a server's OpenAPI schema: the speech request's fields beyond OpenAI's,
 *  nested objects flattened to dotted keys (two levels at most). */
export function optionsFromOpenApi(raw: unknown, limit = 40): SpeechOptionSpec[] {
  if (!isPlainObject(raw) || !isPlainObject(raw.paths)) return [];
  const doc = raw;
  const paths = raw.paths;
  const pathKey = Object.keys(paths).find((p) => /\/v1\/audio\/speech\/?$/.test(p));
  const post = pathKey && isPlainObject(paths[pathKey]) ? (paths[pathKey] as Record<string, unknown>).post : null;
  const content = isPlainObject(post) && isPlainObject(post.requestBody) ? (post.requestBody as Record<string, unknown>).content : null;
  const json = isPlainObject(content) ? content['application/json'] : null;
  const schema = isPlainObject(json) ? deref(doc, json.schema) : null;
  if (!schema) return [];
  const out: SpeechOptionSpec[] = [];
  const walk = (s: Record<string, unknown>, prefix: string, depth: number) => {
    const props = isPlainObject(s.properties) ? s.properties : {};
    for (const [name, rawProp] of Object.entries(props)) {
      if (out.length >= limit) return;
      const key = prefix ? `${prefix}.${name}` : name;
      if (!prefix && STANDARD_FIELDS.has(name)) continue;
      const p = deref(doc, rawProp);
      if (!p) continue;
      if ((p.type === 'object' || isPlainObject(p.properties)) && depth < 2) { walk(p, key, depth + 1); continue; }
      const enumVals = Array.isArray(p.enum) ? p.enum.filter((v): v is string | number => typeof v === 'string' || typeof v === 'number') : null;
      const type = enumVals && enumVals.length ? 'select'
        : p.type === 'integer' ? 'integer' : p.type === 'number' ? 'number' : p.type === 'boolean' ? 'boolean'
          : p.type === 'string' ? 'string' : null;
      if (!type) continue;   // arrays, objects too deep, unknowns: not offered
      const o = normalizeOption({
        key, type,
        label: typeof p.title === 'string' ? p.title : undefined,
        description: typeof p.description === 'string' ? p.description : undefined,
        min: num(p.minimum) ?? num(p.exclusiveMinimum), max: num(p.maximum) ?? num(p.exclusiveMaximum),
        default: p.default,
        ...(enumVals && enumVals.length ? { choices: enumVals } : {}),
      });
      if (o) out.push(o);
    }
  };
  walk(schema, '', 0);
  return out;
}

/** The label to show for an option. */
export const optionLabel = (o: SpeechOptionSpec): string => o.label || o.key;
