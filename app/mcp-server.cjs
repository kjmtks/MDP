#!/usr/bin/env node
// MDP MCP server (stdio) — a DEPENDENCY-FREE proxy that exposes the running MDP
// app to MCP hosts (e.g. Claude Desktop). It speaks MCP (JSON-RPC 2.0 over
// newline-delimited stdio) on one side and forwards every tool call to MDP's
// local control bridge (127.0.0.1, token-authenticated) on the other; the bridge
// executes tools against the live app (editor, preview, VFS) and returns results.
//
// Enable the bridge in MDP: Settings → MCP. That page also generates the
// Claude Desktop config snippet pointing at this file. The bridge writes its
// {port, token} handshake to ~/.mdp/mcp-bridge.json while it is running.
//
// No npm dependencies: safe to run with plain `node`, or with the packaged
// MDP.exe via ELECTRON_RUN_AS_NODE=1 (the file is shipped asar-unpacked).

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const SERVER_INFO = { name: 'mdp', version: '1.0.0' };
const DEFAULT_PROTOCOL = '2024-11-05';

// ---- bridge ----------------------------------------------------------------

function bridgeFile() {
  return process.env.MDP_MCP_BRIDGE || path.join(os.homedir(), '.mdp', 'mcp-bridge.json');
}

function readBridge() {
  try { return JSON.parse(fs.readFileSync(bridgeFile(), 'utf8')); } catch { return null; }
}

const NOT_RUNNING =
  'MDP is not running, or its MCP integration is off. Start MDP and enable Settings → MCP.';

function callBridge(name, args) {
  return new Promise((resolve, reject) => {
    const b = readBridge();
    if (!b || !b.port || !b.token) return reject(new Error(NOT_RUNNING));
    const body = JSON.stringify({ token: b.token, method: name, params: args || {} });
    const req = http.request(
      {
        host: '127.0.0.1', port: b.port, path: '/rpc', method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
        timeout: 180000,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try {
            const j = JSON.parse(data);
            if (j && j.ok) resolve(j.result);
            else reject(new Error((j && j.error) || 'MDP bridge error'));
          } catch (e) { reject(e); }
        });
      },
    );
    req.on('error', () => reject(new Error(NOT_RUNNING)));
    req.on('timeout', () => { req.destroy(); reject(new Error('MDP did not respond in time.')); });
    req.end(body);
  });
}

// ---- tool catalogue ----------------------------------------------------------
// The bridge implements a method of the same name for each tool.

const S = (properties, required) => ({ type: 'object', properties, ...(required ? { required } : {}) });
const str = (description) => ({ type: 'string', description });
const num = (description) => ({ type: 'number', description });

const TOOLS = [
  {
    name: 'get_slide_spec',
    description: 'The complete MDP slide-authoring specification: file format, directives, authoring rules, plus every theme AVAILABLE FOR THE CURRENT DECK\'S FOLDER, and COMPACT INDEXES of the available modules and animation effects (one line each, grouped). Call this FIRST before writing or editing any .slide.md content. To keep it small, modules and effects appear only as indexes — after picking the ones you\'ll use, call get_module_spec / get_effect_spec for their full parameters/examples (or suggest_modules / suggest_effects to pick by content/mood).',
    inputSchema: S({}),
  },
  {
    name: 'get_module_spec',
    description: 'Get the FULL self-descriptions (parameters, body/section format, and examples) for specific modules by name — the detail deliberately omitted from get_slide_spec\'s compact index. Call this after scanning the index in get_slide_spec: pass the handful of module names you intend to use, then write their directives. Cheaper than dumping every module up front.',
    inputSchema: S({ names: { type: 'array', items: { type: 'string' }, description: 'Module names to expand, e.g. ["barchart","callout"] (with or without a leading @).' } }, ['names']),
  },
  {
    name: 'get_effect_spec',
    description: 'Get the FULL spec (parameters, aiSpec, examples) for specific animation EFFECTS by name — the detail omitted from get_slide_spec\'s compact effect index. Call after scanning that index: pass the effect names you\'ll use as a @transition or @build. Effects drive slide transitions (<!-- @transition NAME … -->) and in-slide builds (<!-- @build effect: NAME … -->).',
    inputSchema: S({ names: { type: 'array', items: { type: 'string' }, description: 'Effect names to expand, e.g. ["fade","zoom"].' } }, ['names']),
  },
  {
    name: 'suggest_effects',
    description: 'Recommend animation effects for a MOOD/INTENT (free text like "subtle", "energetic", "draw attention", "reveal step by step", "3d flip"). Returns a compact shortlist with whether each fits a @transition or @build, and its style tags. Then call get_effect_spec for the full args of the ones you adopt. Useful for authoring an effect-rich slide style.',
    inputSchema: S({ text: str('The mood/intent to match, e.g. "energetic and playful"'), limit: num('Max suggestions (default 6)') }, ['text']),
  },
  {
    name: 'find_modules',
    description: 'Search the available modules by free text and/or taxonomy tags, returning a COMPACT list (name, kind, tags, one-line description) — the same shape as the get_slide_spec index, filtered. Use it to narrow down when the index is large: e.g. tags:["statistics"] or query:"timeline". Then call get_module_spec for the full spec of the ones you pick. Tags come from each module\'s taxonomy (shown as [..] in the index).',
    inputSchema: S({ query: str('Free text matched against module name, description and tags (case-insensitive)'), tags: { type: 'array', items: { type: 'string' }, description: 'Only modules carrying ALL of these taxonomy tags, e.g. ["charts","comparison"].' } }),
  },
  {
    name: 'suggest_modules',
    description: 'Recommend modules for a slide\'s CONTENT: paste the slide markdown (or a short description of what the slide will show) and get a ranked shortlist of modules that fit, each with the reason it was suggested. Uses content signals (bullet lists, numbered steps, math, tables, comparisons, dates, percentages, headline numbers, code, quotes, images, label:value data) plus the taxonomy. Call get_module_spec for the full spec of any you adopt. Returns a note when a plain heading/list/table is likely best.',
    inputSchema: S({ text: str('The slide markdown, or a description of the intended slide content'), limit: num('Max suggestions (default 6)') }, ['text']),
  },
  {
    name: 'get_style_samples',
    description: 'Get sample deck bodies (from the folder\'s .mdp scope) to LEARN THE AUTHOR\'S WRITING STYLE, plus the currently-cached style profile and its freshness. Distill a concise profile from the samples, then save it with save_style_profile so future authoring matches the author\'s voice WITHOUT re-reading decks. If currentProfile already covers these decks (basedOn), re-analysis may be skippable.',
    inputSchema: S({ deck: str('Deck whose .mdp scope to sample (default: the active deck, else root)'), limit: num('How many decks to sample (default 3, max 8)') }),
  },
  {
    name: 'save_style_profile',
    description: 'Cache a distilled WRITING-STYLE profile into the folder\'s .mdp (content.json). It is then auto-injected into get_slide_spec for every future session, so you never need to re-read decks to match the author\'s voice. Record analyzedDate + basedOn for freshness. Overwrites the existing profile for that .mdp.',
    inputSchema: S({ profile: str('The distilled style description (Markdown)'), deck: str('Deck whose .mdp scope to save into (default: active deck\'s nearest .mdp)'), dir: str('Explicit folder whose .mdp to write (overrides deck scope)'), analyzedDate: str('Today\'s date (ISO), for freshness'), basedOn: { type: 'array', items: { type: 'string' }, description: 'Deck paths the profile was distilled from' } }, ['profile']),
  },
  {
    name: 'list_decks',
    description: 'List every slide deck (*.slide.md) in the open MDP workspace, as workspace-relative paths. TIP: to imitate the user\'s writing style, read one or two of their existing decks with read_deck and mirror their tone, density, module choices and phrasing.',
    inputSchema: S({}),
  },
  {
    name: 'read_deck',
    description: 'Read a deck\'s markdown source (the live editor content when it is open, else the file). TOKEN-SAVER: pass `slides:[n,…]` (1-based; 0 = meta page) to read ONLY those slides instead of the whole deck — use get_deck_outline first to pick which. Embedded base64 images are SHORTENED to MDP_ELIDED_… placeholders (binaryElided); AUTO-RESTORED on write if kept verbatim, so images are never lost — patch_deck / replace_slide are still cheaper for edits.',
    inputSchema: S({ path: str('Workspace-relative deck path, e.g. "talks/intro.slide.md"'), slides: { type: 'array', items: { type: 'number' }, description: 'Read only these 1-based slides (0 = meta). Omit for the whole deck.' } }, ['path']),
  },
  {
    name: 'write_deck',
    description: 'Create or fully replace a deck. If the deck is open in the editor the change is applied there as an UNSAVED edit (the user reviews and saves); otherwise the file is written directly. Content must follow get_slide_spec (meta page, then `---`-separated slides). ROUND-TRIP SAVER: pass verify:true to get validate+lint+measure results in the SAME response (instead of 3 follow-up calls).',
    inputSchema: S({ path: str('Workspace-relative deck path (must end in .slide.md)'), content: str('Full deck markdown'), verify: { type: 'boolean', description: 'Also run check_deck (validate+lint+measure) and include `verification` in the response' } }, ['path', 'content']),
  },
  {
    name: 'append_slide',
    description: 'Append one slide to the end of a deck. Provide ONLY the slide body (no leading/trailing `---`).',
    inputSchema: S({ path: str('Deck path'), content: str('Markdown for the new slide (one slide, no --- separators)') }, ['path', 'content']),
  },
  {
    name: 'replace_slide',
    description: 'Replace one slide of a deck. slide=1 is the first slide after the meta page; slide=0 replaces the meta page itself.',
    inputSchema: S({ path: str('Deck path'), slide: num('Slide number (1-based; 0 = meta page)'), content: str('New markdown for that slide') }, ['path', 'slide', 'content']),
  },
  {
    name: 'set_notes',
    description: 'Write the SPEAKER NOTE (a supplementary reminder shown in the presenter view) for one slide, WITHOUT touching its visible content. Notes do NOT affect the talk-time estimate — for a read-aloud manuscript use set_script instead. mode="replace" (default) or "append"; notes="" clears. Markdown, multi-line OK (must not contain "-->").',
    inputSchema: S({ path: str('Deck path'), slide: num('Slide number (1-based)'), notes: str('Speaker-note Markdown ("" clears)'), mode: { type: 'string', enum: ['replace', 'append'], description: 'replace (default) or append' } }, ['path', 'slide', 'notes']),
  },
  {
    name: 'set_script',
    description: 'Write the READ-ALOUD SCRIPT (the manuscript the presenter will speak, verbatim) for one slide, WITHOUT touching its visible content. Shown prominently in the presenter view; its length drives the slide\'s talk-time estimate; the narrated auto-play speaks it with subtitles. IN-SCRIPT MARKERS: put one `[[step]]` where each in-slide @build should advance (exactly one per @build step, in order — lint flags mismatches); write maths as KaTeX `\\(…\\)` (rendered in the subtitle) followed by its spoken reading `[[say: よみ]]` (a formula without [[say]] is shown, not spoken) — do NOT spell maths out phonetically in plain text. script="" clears. Markdown, multi-line OK (must not contain "-->").',
    inputSchema: S({ path: str('Deck path'), slide: num('Slide number (1-based)'), script: str('Read-aloud Markdown ("" clears)'), mode: { type: 'string', enum: ['replace', 'append'], description: 'replace (default) or append' } }, ['path', 'slide', 'script']),
  },
  {
    name: 'set_time',
    description: 'Set one slide\'s explicit speaking-time budget (`<!-- @time … -->`), overriding any estimate — use when distributing a target talk length across slides (e.g. a 10-minute talk). Accepts 90s / 2m / 1m30s / 1:30; time="" clears. Shown in the presenter countdown.',
    inputSchema: S({ path: str('Deck path'), slide: num('Slide number (1-based)'), time: str('Duration ("" clears), e.g. "90s", "1m30s", "1:30"') }, ['path', 'slide', 'time']),
  },
  {
    name: 'batch_set_slides',
    description: 'TOKEN-SAVER: set @note / @script / @time on MANY slides in ONE call (one write), instead of calling set_notes/set_script/set_time per slide. Ideal for generating a whole talk manuscript or distributing @time across a deck. `edits` = [{slide, note?, script?, time?, mode?}] (only the fields you pass are changed; "" clears one; mode="append" for note/script). Scripts support the narration markers — `[[step]]` per @build step, KaTeX `\\(…\\)` + `[[say: よみ]]` for maths (see set_script). Atomic: any invalid edit aborts the whole batch.',
    inputSchema: S({ path: str('Deck path'), edits: { type: 'array', description: 'Per-slide edits', items: { type: 'object', properties: { slide: num('1-based'), note: str('@note ("" clears)'), script: str('@script ("" clears)'), time: str('@time ("" clears)'), mode: { type: 'string', enum: ['replace', 'append'] } }, required: ['slide'] } }, verify: { type: 'boolean', description: 'Also run check_deck (validate+lint+measure) and include `verification` in the response' } }, ['path', 'edits']),
  },
  {
    name: 'list_modules',
    description: 'List the modules available for a deck\'s folder (its cascading .mdp scope), with the path of each definition file. To learn HOW to use a module, use the index in get_slide_spec plus get_module_spec (its parameters/examples); use read_module only when you need the exact template/CSS/script.',
    inputSchema: S({ deck: str('Deck path whose scope to use (default: the active deck)') }),
  },
  {
    name: 'read_module',
    description: 'Read a module\'s raw .mdpmod.xml definition (render template, styles, script, params).',
    inputSchema: S({ path: str('Module path from list_modules (workspace-relative, or "builtin:...")') }, ['path']),
  },
  {
    name: 'list_themes',
    description: 'List the slide themes available for a deck\'s folder (valid values for `<!-- @theme NAME -->`).',
    inputSchema: S({ deck: str('Deck path whose scope to use (default: the active deck)') }),
  },
  {
    name: 'get_active_deck',
    description: 'Which deck is open in the MDP editor: path, slide count, current preview slide. LOW-TOKEN by default (no content). Pass includeContent:true only if you need the live (possibly unsaved) text — embedded base64 comes back elided; for reading source prefer read_deck (per-slide selection).',
    inputSchema: S({ includeContent: { type: 'boolean', description: 'Include the live deck text (base64 elided). Default false.' } }),
  },
  {
    name: 'open_deck',
    description: 'Open a deck in the MDP editor (required before measure_slides / render_slide_image / goto_slide on it).',
    inputSchema: S({ path: str('Deck path') }, ['path']),
  },
  {
    name: 'goto_slide',
    description: 'Show a slide in the MDP preview (1-based).',
    inputSchema: S({ slide: num('Slide number, 1-based') }, ['slide']),
  },
  {
    name: 'insert_at_cursor',
    description: 'Insert markdown at the editor cursor of the active deck (for small additions while the user watches).',
    inputSchema: S({ text: str('Markdown to insert') }, ['text']),
  },
  {
    name: 'measure_slides',
    description: 'LOW-TOKEN layout check. Returns ONLY problem slides by default (`issues`: overflow/empty rows + each slide\'s metrics; healthy rows are omitted — pass all:true for every row) with the deck path echoed. Metrics: overflowX/overflowY (px CLIPPED beyond the slide box — anything > 0 must be fixed), fillX/fillY (0..1), coverage (painted-area fraction), stepCount (in-slide build steps, when > 0). PASS `path` to target a specific deck (it is opened+waited for); omitting it measures whatever deck is active, which goes wrong when the user switches tabs. `slides:[n,…]` measures a subset.',
    inputSchema: S({ path: str('Deck path to measure (recommended; default: the active deck)'), slides: { type: 'array', items: { type: 'number' }, description: 'Measure only these 1-based slides. Omit for all.' }, all: { type: 'boolean', description: 'Return every measured row, not just issues (default false)' } }),
  },
  {
    name: 'render_slide_image',
    description: 'Render ONE slide to an image (WebP), exactly as MDP displays it. PASS `path` to target a deck explicitly (opened+waited for; response echoes `deck`). For checking SEVERAL slides use render_slides (one composite image, one call) instead of repeating this. Higher token cost; prefer small widths.',
    inputSchema: S({ path: str('Deck path (recommended; default: the active deck)'), slide: num('Slide number, 1-based'), width: num('Image width in px (default 512, max 1280)') }, ['slide']),
  },
  {
    name: 'render_slides',
    description: 'Render SEVERAL chosen slides in ONE call as a single numbered composite image (WebP) — the middle ground between per-slide render_slide_image (1 round trip each) and the too-small render_deck_overview thumbnails. Up to 12 slides; `width` is the per-slide width. PASS `path` to target a deck explicitly (response echoes `deck`).',
    inputSchema: S({ slides: { type: 'array', items: { type: 'number' }, description: '1-based slide numbers to render (max 12)' }, width: num('Per-slide width in px (default 480, max 1200)'), path: str('Deck path (recommended; default: the active deck)') }, ['slides']),
  },
  {
    name: 'get_deck_outline',
    description: 'LOW-TOKEN structure map of a deck (default: the active one): per slide its heading, bullet count, modules used, note volume and estimated `seconds` (from its `<!-- @time … -->` if set, else notes/complexity), plus deck title/tags and total estimatedMinutes. Prefer this over read_deck for orientation and style sampling of long decks. To make talk-time accurate, set `<!-- @time 90s -->` on slides.',
    inputSchema: S({ path: str('Deck path (default: the active deck)') }),
  },
  {
    name: 'search_decks',
    description: 'Search all decks in the workspace by text query and/or tags (matches title, subtitle, tags and body). Use to find reference material or past decks to reuse/imitate.',
    inputSchema: S({ query: str('Search text (case-insensitive)'), tags: { type: 'array', items: { type: 'string' }, description: 'Tags that must all be present' } }),
  },
  {
    name: 'patch_deck',
    description: 'Token-efficient partial edit: replace exact text fragments in a deck. ROUND-TRIP SAVER: pass `edits` = [{old_str, new_str, all?}, …] to apply MANY independent fixes in ONE call (atomic — any non-matching old_str aborts the whole batch before anything is written). Each old_str must match exactly once (or all:true). The single old_str/new_str form still works. verify:true adds validate+lint+measure to the response. Prefer this over write_deck for small changes.',
    inputSchema: S({ path: str('Deck path'), edits: { type: 'array', description: 'Batch of fixes applied atomically in order', items: { type: 'object', properties: { old_str: { type: 'string', description: 'Exact existing text' }, new_str: { type: 'string', description: 'Replacement text' }, all: { type: 'boolean', description: 'Replace all occurrences of this old_str' } }, required: ['old_str', 'new_str'] } }, old_str: str('Exact existing text (single-edit form)'), new_str: str('Replacement text (single-edit form)'), all: { type: 'boolean', description: 'Replace all occurrences (single-edit form)' }, verify: { type: 'boolean', description: 'Also run check_deck (validate+lint+measure) and include `verification` in the response' } }, ['path']),
  },
  {
    name: 'edit_slides',
    description: 'Slide-level structure edits: op="insert" adds a slide after position `after` (0 = right after the meta page); op="delete" removes slide `slide`; op="move" moves slide `slide` to position `to`. Slide numbers are 1-based.',
    inputSchema: S({ path: str('Deck path'), op: { type: 'string', enum: ['insert', 'delete', 'move'], description: 'Operation' }, content: str('Slide markdown (insert only, no --- separators)'), after: num('insert: insert after this slide (0..N)'), slide: num('delete/move: target slide (1..N)'), to: num('move: new position (1..N)') }, ['path', 'op']),
  },
  {
    name: 'list_images',
    description: 'The image-alias library available to a deck (cascading .mdp scope): alias, description, tags, kind and (for stored files) path. Reference an image in slides as ![alt](@alias). Use read_image to actually SEE one. With no `deck` and none open, lists the workspace-root library.',
    inputSchema: S({ deck: str('Deck path whose .mdp scope to use (default: the active deck, else the workspace root)') }),
  },
  {
    name: 'read_image',
    description: 'View an image (returned as an image block): a library image by `alias` (resolved in the given deck\'s .mdp scope), or any workspace image file by `path`. Use to write accurate captions/alt text or judge whether a figure fits a slide.',
    inputSchema: S({ alias: str('Image-library alias'), deck: str('Deck whose .mdp scope resolves the alias (default: the active deck, else root)'), path: str('Workspace-relative image path (alternative to alias)'), maxWidth: num('Downscale to this width (default 800)') }),
  },
  {
    name: 'validate_deck',
    description: 'FAST deterministic lint BEFORE visual checks: unknown module/directive names, disabled modules, unknown @theme / transition / build effect names, unknown or missing-required module parameters, and unbalanced <!-- @end --> per slide. Pass `text` to validate candidate content WITHOUT writing it (dry run). For the full one-shot inspection (this + lint + measure) use check_deck.',
    inputSchema: S({ path: str('Deck path (default: the active deck)'), text: str('Candidate deck markdown to validate WITHOUT writing (dry run)') }),
  },
  {
    name: 'lint_deck',
    description: 'DESIGN & CONSISTENCY advisories for a deck (default: the active one) — complements validate_deck (syntax) and measure_slides (overflow). Flags: slides with no heading, too many bullets, text-heavy slides with no visual, sparse slides, images missing alt text, duplicate headings, mixed heading levels, and missing @title/@theme. Returns findings with severity (warn/info) and slide number (0 = deck-level). Use after drafting to tighten a deck; apply your judgment — not every finding needs a change.',
    inputSchema: S({ path: str('Deck path (default: the active deck)') }),
  },
  {
    name: 'list_templates',
    description: 'List deck templates (workspace .mdp/templates + built-ins). Starting from the user\'s template keeps new decks consistent with their conventions.',
    inputSchema: S({}),
  },
  {
    name: 'read_template',
    description: 'Read a deck template\'s markdown (use as the skeleton for a new deck).',
    inputSchema: S({ path: str('Template path from list_templates (workspace-relative or "builtin:...")') }, ['path']),
  },
  {
    name: 'read_theme',
    description: 'Read a slide theme\'s CSS (by name from list_themes). Use to keep any custom styling (@addstyle) consistent with the theme\'s variables, or as a reference before writing a new theme.',
    inputSchema: S({ name: str('Theme name'), deck: str('Deck path whose scope to use (default: the active deck)') }, ['name']),
  },
  {
    name: 'render_deck_overview',
    description: 'One contact-sheet image of ALL slides (grid of small thumbnails, numbered) — judge overall balance, consistency and pacing in a single image. Thumbnails are too small to read text — for readable checks of specific slides use render_slides. PASS `path` to target a deck explicitly (response echoes `deck`). Moderate token cost.',
    inputSchema: S({ path: str('Deck path (recommended; default: the active deck)'), thumbWidth: num('Thumbnail width in px (default 260, max 400)') }),
  },
  {
    name: 'check_deck',
    description: 'ONE-SHOT full inspection — validate (syntax/unknown modules/params/unbalanced @end) + lint (design advisories incl. script-step-mismatch and math-in-plain-field) + measure (overflow, issues only) in a single response, replacing 3 separate calls. DRY RUN: pass `text` instead of `path` to check candidate content BEFORE writing it (validate+lint only; nothing touches the editor or disk).',
    inputSchema: S({ path: str('Deck path to inspect (default: the active deck)'), text: str('Candidate deck markdown to check WITHOUT writing (dry run; validate+lint only)') }),
  },
  {
    name: 'bootstrap',
    description: 'START HERE: one call returning everything an authoring session needs — the full slide spec (format + module/effect indexes + themes + cached style profile) plus the workspace\'s deck list, templates and image aliases. Replaces the get_slide_spec + list_decks + list_templates + list_images opening sequence. Then: get_module_spec for the modules you pick; write with verify:true; check visually with render_slides.',
    inputSchema: S({ deck: str('Deck path whose .mdp scope to use for templates/images (default: the active deck)') }),
  },
  {
    name: 'get_asset_templates',
    description: 'How to AUTHOR a workspace asset. Call with a `kind` (module | effect | theme | snippet) to get: its reference TEMPLATE, a detailed authoring GUIDE (schema, the render/CSS/script contract and pitfalls, the design tokens / file format), and the list of ones that ALREADY EXIST in the workspace (so you imitate conventions and avoid duplicates). Omit `kind` for a guide overview of all four. Read this before write_asset.',
    inputSchema: S({ kind: { type: 'string', enum: ['module', 'effect', 'theme', 'snippet'], description: 'Asset kind to get the template + guide + existing list for. Omit for an overview of all kinds.' } }),
  },
  {
    name: 'list_snippets',
    description: 'List the insertable text snippets available for a deck (built-ins + the deck\'s .mdp chain), grouped by category with each item\'s label. Use it to see what exists before adding more with write_asset (kind: "snippet").',
    inputSchema: S({ deck: str('Deck path whose .mdp scope to use (default: the active deck)') }),
  },
  {
    name: 'write_asset',
    description: 'CREATE or update a workspace asset: kind "module" (.mdpmod.xml — reusable slide component; self-describe it for AIs via <aiSpec>), "effect" (.mdpfx.xml — transition/build animation), "theme" (.css — slide design-token overrides) or "snippet" (.json — insertable text snippets grouped by category). Saved under the workspace .mdp and registered live. The user should review scripts you write. Study get_asset_templates (with this kind) and an existing asset first (get_slide_spec / get_module_spec / read_module / read_theme / list_snippets).',
    inputSchema: S({ kind: { type: 'string', enum: ['module', 'effect', 'theme', 'snippet'], description: 'Asset kind' }, name: str('Asset name (letters/digits/-/_)'), content: str('Full file content (XML for module/effect, CSS for theme, a JSON array of {category,items} for snippet)'), dir: str('Folder whose .mdp to write into (default: workspace root)') }, ['kind', 'name', 'content']),
  },
];

// ---- MCP over stdio ----------------------------------------------------------

function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    return reply(id, {
      protocolVersion: (params && params.protocolVersion) || DEFAULT_PROTOCOL,
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
    });
  }
  if (typeof method === 'string' && method.startsWith('notifications/')) return; // no response
  if (method === 'ping') return reply(id, {});
  if (method === 'tools/list') return reply(id, { tools: TOOLS });
  if (method === 'resources/list') return reply(id, { resources: [] });
  if (method === 'resources/templates/list') return reply(id, { resourceTemplates: [] });
  if (method === 'prompts/list') return reply(id, { prompts: [] });
  if (method === 'tools/call') {
    try {
      const result = await callBridge(params.name, params.arguments);
      const content = result && result.__image
        ? [{ type: 'image', data: result.__image, mimeType: result.mimeType || 'image/png' }]
        : [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }];
      reply(id, { content });
    } catch (e) {
      reply(id, { content: [{ type: 'text', text: String((e && e.message) || e) }], isError: true });
    }
    return;
  }
  if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    try { handle(JSON.parse(line)); } catch { /* ignore malformed line */ }
  }
});
process.stdin.on('end', () => process.exit(0));
