// The MDP MCP tool catalogue — ONE definition, shared by every front end that
// speaks MCP for MDP:
//   * app/mcp-server.cjs — the stdio proxy an MCP host (Claude Desktop, Claude
//     Code…) launches against the DESKTOP app.
//   * app/mcp-web.cjs    — the shared web server's per-user HTTP endpoint.
// Each tool's name is also the bridge method that implements it (app/mcp-bridge.cjs).
//
// Keep the two front ends honest about what they can actually serve: DESKTOP_ONLY
// lists the tools that drive the human's OWN editor window (open a tab, move the
// cursor, save the buffer). On a shared server there is no such window — the web
// endpoint hides them rather than failing halfway through a call.

const S = (properties, required) => ({ type: 'object', properties, ...(required ? { required } : {}) });
const str = (description) => ({ type: 'string', description });
const num = (description) => ({ type: 'number', description });

const TOOLS = [
  {
    name: 'get_slide_spec',
    description: 'The complete MDP slide-authoring specification: file format, directives, authoring rules, plus every theme AVAILABLE FOR THE CURRENT DECK\'S FOLDER, COMPACT INDEXES of the available modules and animation effects (one line each, grouped), and the folder\'s SLIDE SKILLS — the author\'s own guides for making slides there (always-applied ones in full) — and its GLOSSARIES\' terms (how the narrator reads them; a script needs no ruby for them). Call this FIRST before writing or editing any .slide.md content. To keep it small, modules, effects and most skills appear only as indexes — read the skills that fit the task with get_skill, and call get_module_spec / get_effect_spec for the full parameters/examples of what you pick (or suggest_modules / suggest_effects to pick by content/mood).',
    inputSchema: S({}),
  },
  {
    name: 'get_skill',
    description: 'Read one of the folder\'s SLIDE SKILLS — the author\'s guide for making slides in that folder (.mdp/skills/<name>/SKILL.md): how to phrase titles, how dense a slide may be, how to show math and figures, which modules to use for what, plus a checklist. The spec (get_slide_spec / bootstrap) lists the skills with a one-line description; read EVERY skill whose description fits the task BEFORE planning or writing slides, and follow it — where it disagrees with the generic spec, the skill wins. No `name` → the list for the deck\'s folder. `file` → one of the skill\'s reference files (e.g. an exemplary deck). When the user corrects your slides, offer to record the rule in the skill (patch_skill with `append`).',
    inputSchema: S({ name: str('Skill name from the spec\'s "Slide skills" list (omit to list them)'), file: str('A reference file inside the skill folder, as listed in its `files`'), deck: str('Deck whose folder\'s skills to use (default: the active deck, else the workspace root)') }),
  },
  {
    name: 'write_skill',
    description: 'CREATE a slide skill, or REPLACE one wholesale (.mdp/skills/<name>/SKILL.md) — or, with `file`, write one of its reference files (a text file such as an exemplary .slide.md or a glossary). Give `description` (one line: what it covers and WHEN to read it — the index shows only this) and `content` = the Markdown guide (or a whole SKILL.md with frontmatter). `always: true` puts the full text into every slide spec (for the folder\'s main guide; keep it short). End the guide with a "## Checklist" of yes/no items. Where: `dir` = the folder whose .mdp gets it ("" = workspace root); default = where that skill already lives in the deck\'s chain, else the deck\'s nearest .mdp. For small changes use patch_skill instead. The user may be asked to confirm; a replaced file is backed up to .mdp/mcp-backups. Read get_asset_templates (kind "skill") for the template and how to write a guide AIs follow.',
    inputSchema: S({ name: str('Skill folder name (letters/digits/-/_)'), description: str('One line: what the skill covers and when to read it'), content: str('The Markdown guide (body), or a whole SKILL.md incl. frontmatter; with `file`, that file\'s text'), always: { type: 'boolean', description: 'Include the whole guide in every slide spec (default false)' }, file: str('Write this reference file inside the skill folder instead of SKILL.md'), dir: str('Folder whose .mdp to write into ("" = workspace root)'), deck: str('Deck whose folder chain decides the default location (default: the active deck)') }, ['name', 'content']),
  },
  {
    name: 'patch_skill',
    description: 'UPDATE a slide skill without rewriting it: `append` = [{section, text}] adds lines at the end of the section with that heading (created before the Checklist if missing) — the way to RECORD A NEW RULE the user just gave; `edits` = [{old_str, new_str, all?}] exact-text replacements (atomic, like patch_deck; old_str must match exactly once); `description` / `always` change the frontmatter. `file` targets a reference file instead of SKILL.md. The skill is found in the deck\'s chain (a parent folder\'s skill is edited in place; pass `dir` to address one .mdp exactly). The user may be asked to confirm; the previous version is backed up to .mdp/mcp-backups.',
    inputSchema: S({ name: str('Skill name'), append: { type: 'array', description: 'Lines to add under headings', items: { type: 'object', properties: { section: str('Heading text, e.g. "文字" or "Checklist"'), text: str('Markdown to add, e.g. "- 見出しは半角コロン＋スペースで区切る"') }, required: ['section', 'text'] } }, edits: { type: 'array', description: 'Exact-text replacements, applied atomically in order', items: { type: 'object', properties: { old_str: str('Exact existing text'), new_str: str('Replacement text'), all: { type: 'boolean', description: 'Replace every occurrence' } }, required: ['old_str', 'new_str'] } }, description: str('New one-line description (frontmatter)'), always: { type: 'boolean', description: 'Include the whole guide in every slide spec' }, file: str('A reference file of the skill instead of SKILL.md'), dir: str('Folder whose .mdp holds the skill (default: found in the deck\'s chain)'), deck: str('Deck whose folder chain to search (default: the active deck)') }, ['name']),
  },
  {
    name: 'delete_skill',
    description: 'DELETE a slide skill (its whole folder) or, with `file`, one of its reference files. Found in the deck\'s chain like patch_skill (`dir` addresses one .mdp exactly); if a parent folder has a skill of the same name, that one applies again afterwards. The desktop app always asks the user to confirm; everything removed is backed up to .mdp/mcp-backups first. Delete only when the user asks.',
    inputSchema: S({ name: str('Skill name'), file: str('Delete only this reference file'), dir: str('Folder whose .mdp holds the skill (default: found in the deck\'s chain)'), deck: str('Deck whose folder chain to search (default: the active deck)') }, ['name']),
  },
  {
    name: 'get_glossary',
    description: 'The folder\'s GLOSSARIES — how the narrator reads the field\'s terms (.mdp/glossary/<name>.md, a table of 用語 | 読み; one per field, reused by every deck of it). Every deck beneath the folder reads each term with its reading in the narrated auto-play, the narrated videos and the rehearsal, as if its script had a ruby [[term|reading]] there — so a script needs NO ruby for a glossary term (a ruby it has still wins). No arguments → the glossaries the deck\'s folder reads (name, description, lang, term count, problems), every term as the narrator reads it (merged: a nearer glossary wins; first 300) and conflicting readings. `name` → that glossary\'s terms with their notes. `terms` → how each given term is read here (reading null = no glossary has it — the TTS reads it on its own). Terms match as written: case-sensitive, a Latin term as a whole word, a space between Latin and Japanese optional.',
    inputSchema: S({ name: str('A glossary name (omit to list them)'), terms: { type: 'array', items: { type: 'string' }, description: 'Look these terms up instead, e.g. ["SHAP", "Shapley値"]' }, deck: str('Deck whose folder\'s glossaries to use (default: the active deck, else the workspace root)') }),
  },
  {
    name: 'write_glossary',
    description: 'CREATE a glossary for a field — the narrator\'s readings of its terms (.mdp/glossary/<name>.md) — or REPLACE one wholesale. Give `terms` = [{term, reading, note?}] (written as a Markdown table) or `content` = the whole Markdown file (a "| 用語 | 読み | メモ |" table; optional frontmatter description / lang). `description`: one line, the field it covers. `lang`: the narration language of its readings (ja, en …; default: ja when the readings are Japanese) — a ja glossary never reads an English line. Put in it terms a TTS misreads that RECUR in the field (acronyms, names, field readings); a reading only one sentence needs stays a ruby. One glossary per FIELD: write it into the .mdp of the folder whose decks share the field (`dir`; "" = the workspace root; default: where that glossary already lives in the deck\'s chain, else the deck\'s nearest .mdp). To add or change a few terms use patch_glossary. The user may be asked to confirm; a replaced file is backed up to .mdp/mcp-backups. get_asset_templates (kind "glossary") has the format.',
    inputSchema: S({
      name: str('Glossary name = its file name without .md (letters of any script, digits, - _ .), e.g. "machine-learning"'),
      terms: { type: 'array', description: 'The terms (or give content)', items: { type: 'object', properties: { term: str('As written in scripts, e.g. "SHAP", "Shapley値"'), reading: str('What the narrator says, e.g. "シャップ"'), note: str('For people (optional)') }, required: ['term', 'reading'] } },
      content: str('The whole Markdown file (or give terms)'),
      description: str('One line: the field it covers'),
      lang: str('Narration language of its readings: ja, en …'),
      title: str('A heading for the file (with terms)'),
      dir: str('Folder whose .mdp to write into ("" = workspace root)'),
      deck: str('Deck whose folder chain decides the default location (default: the active deck)'),
    }, ['name']),
  },
  {
    name: 'patch_glossary',
    description: 'UPDATE a glossary without rewriting it — the way to ADD A TERM the narrator misreads: `set` = [{term, reading, note?}] adds new terms at the end of its table and changes the reading (and the note, when given) of terms already there, in place; `remove` = [term, …] deletes rows; `description` / `lang` change the frontmatter ("" removes); `edits` = [{old_str, new_str, all?}] exact-text replacements for anything else. Everything else in the file is kept. The glossary is found in the deck\'s chain (a parent folder\'s is edited in place; `dir` addresses one .mdp exactly). Reports `overridden` — terms a NEARER glossary reads otherwise (that reading is what the deck hears). The user may be asked to confirm; the previous version is backed up to .mdp/mcp-backups.',
    inputSchema: S({
      name: str('Glossary name'),
      set: { type: 'array', description: 'Terms to add or change', items: { type: 'object', properties: { term: str('As written in scripts'), reading: str('What the narrator says'), note: str('For people ("" clears; omit to keep)') }, required: ['term', 'reading'] } },
      remove: { type: 'array', items: { type: 'string' }, description: 'Terms to delete' },
      description: str('New one-line description ("" removes)'),
      lang: str('New narration language ("" removes — then inferred from the readings)'),
      edits: { type: 'array', description: 'Exact-text replacements, applied atomically in order', items: { type: 'object', properties: { old_str: str('Exact existing text'), new_str: str('Replacement text'), all: { type: 'boolean', description: 'Replace every occurrence' } }, required: ['old_str', 'new_str'] } },
      dir: str('Folder whose .mdp holds the glossary (default: found in the deck\'s chain)'),
      deck: str('Deck whose folder chain to search (default: the active deck)'),
    }, ['name']),
  },
  {
    name: 'delete_glossary',
    description: 'DELETE a glossary file. Found in the deck\'s chain like patch_glossary (`dir` addresses one .mdp exactly); if a parent folder has a glossary of the same name, that one applies again afterwards. The desktop app always asks the user to confirm; the file is backed up to .mdp/mcp-backups first. Delete only when the user asks.',
    inputSchema: S({ name: str('Glossary name'), dir: str('Folder whose .mdp holds the glossary (default: found in the deck\'s chain)'), deck: str('Deck whose folder chain to search (default: the active deck)') }, ['name']),
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
    description: 'Write the READ-ALOUD SCRIPT (the manuscript the presenter will speak, verbatim) for one slide, WITHOUT touching its visible content. Shown prominently in the presenter view; its length drives the slide\'s talk-time estimate; the narrated auto-play speaks it with subtitles. IN-SCRIPT MARKERS: put one `[[step]]` where each in-slide @build should advance (exactly one per @build step, in order — lint flags mismatches). READINGS for the narrator are rubies `[[base|reading]]` — the base is exactly what is written before the `|`, e.g. `ルビの[[仕様|しよう]]を[[改良|かいりょう]]したい。`, `[[SVD|エスブイディー]]`; the TTS says the reading, while the presenter view, the subtitles and the talk-time estimate use only the base — give hard or ambiguous words one. Terms in the folder\'s GLOSSARY (get_glossary) are read with their reading already — no ruby for them; add a term that recurs in the field with patch_glossary. Write maths as KaTeX with its spoken reading as a ruby, `[[\\(x^2\\)|エックスの二乗]]` (the subtitle renders the maths; a formula without a reading is shown, not spoken; the older `\\(…\\)[[say: よみ]]` means the same) — do NOT spell maths out phonetically in plain text. Cues for modules during the narration: `[[emit: cmd:TAG ACTION | label]]` fires the command to the module whose directive has `tag: TAG`, `[[emit-wait: cmd:TAG ACTION timeout=30s | label]]` also pauses the narration until the module finishes, `[[pause: 2s]]` holds (see get_slide_spec). FOCUS CUES `[[look: #name]]` / `[[mark: #name]]` show the viewer where to look as a line starts (get_focus_targets); `[[then]]` only splits the → presses of a talk given by hand. get_narration shows what the narrator will say and show, line by line. script="" clears. Markdown, multi-line OK (must not contain "-->").',
    inputSchema: S({ path: str('Deck path'), slide: num('Slide number (1-based)'), script: str('Read-aloud Markdown ("" clears)'), mode: { type: 'string', enum: ['replace', 'append'], description: 'replace (default) or append' } }, ['path', 'slide', 'script']),
  },
  {
    name: 'set_time',
    description: 'Set one slide\'s explicit speaking-time budget (`<!-- @time … -->`), overriding any estimate — use when distributing a target talk length across slides (e.g. a 10-minute talk). Accepts 90s / 2m / 1m30s / 1:30; time="" clears. Shown in the presenter countdown.',
    inputSchema: S({ path: str('Deck path'), slide: num('Slide number (1-based)'), time: str('Duration ("" clears), e.g. "90s", "1m30s", "1:30"') }, ['path', 'slide', 'time']),
  },
  {
    name: 'batch_set_slides',
    description: 'TOKEN-SAVER: set @note / @script / @time on MANY slides in ONE call (one write), instead of calling set_notes/set_script/set_time per slide. Ideal for generating a whole talk manuscript or distributing @time across a deck. `edits` = [{slide, note?, script?, time?, mode?}] (only the fields you pass are changed; "" clears one; mode="append" for note/script). Scripts support the narration markers — `[[step]]` per @build step, rubies `[[語|よみ]]` for readings (none for the folder\'s glossary terms) and `[[\\(…\\)|よみ]]` for maths, `[[emit…]]` cues for modules, focus cues (see set_script). Atomic: any invalid edit aborts the whole batch.',
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
    name: 'save_deck',
    description: 'SAVE the deck to disk. Edits made to an OPEN deck (write_deck / patch_deck / replace_slide / set_notes …) land in the editor as UNSAVED changes for the user to review — call this to commit them to the file, the same as the user pressing Ctrl+S. The deck is activated first. Returns saved:false when there was nothing to save. If the file was ALSO changed on disk outside MDP, the user is asked to confirm the overwrite, so this call may wait for them. Ask the user before saving on their behalf unless they told you to.',
    inputSchema: S({ path: str('Deck path to save (default: the active deck)') }),
  },
  {
    name: 'reload_deck',
    description: 'RELOAD the deck from disk into the editor, discarding whatever the editor holds — use after the file was changed outside MDP (another tool, an external editor, a git checkout) so the editor and preview show the real file. Refuses when the deck has unsaved editor changes unless discardUnsaved:true (save them first with save_deck if they matter). Returns the reloaded slide count.',
    inputSchema: S({ path: str('Deck path to reload (default: the active deck)'), discardUnsaved: { type: 'boolean', description: 'Reload even though the editor has unsaved changes, throwing them away (default false)' } }),
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
    description: 'Render ONE slide to an image (WebP), exactly as MDP displays it. PASS `path` to target a deck explicitly (opened+waited for; response echoes `deck`). For checking SEVERAL slides use render_slides (one composite image, one call) instead of repeating this. Higher token cost; prefer small widths. `focus` draws the slide\'s FOCUS CUES ([[look]] / [[mark]] in its @script) over it — "outline": every cue\'s target outlined and numbered in script order (targets not found are listed on the picture); "line:N": the slide exactly as the narrated auto-play shows it while narration line N plays (that build step, the looks and marks in force then); or cue markers to try before writing them, e.g. "[[look: item:2 spotlight]]". With `focus`, the response also says where each target landed (box in % of the slide) or why it was not found.',
    inputSchema: S({ path: str('Deck path (recommended; default: the active deck)'), slide: num('Slide number, 1-based'), width: num('Image width in px (default 512, max 1280)'), focus: str('Draw the focus cues: "outline" | "line:N" | cue markers such as "[[look: \\"phrase\\" ring]]"') }, ['slide']),
  },
  {
    name: 'get_focus_targets',
    description: 'FOCUS CUES of ONE slide — what it can point at, and whether its cues land. Focus cues in a slide\'s @script show the viewer where to look while the narration plays (narrated auto-play, both video modes, and the presenter\'s chips): [[look: TARGET]] moves the one point of attention there (pointer — default —, ring, arrow, box, spotlight, blur); [[mark: TARGET]] leaves an annotation that stays until [[clear]] or the next slide (marker — default —, underline, circle). A cue acts when its narration LINE starts (a line = one subtitle unit, about a sentence; never cut a sentence for a cue). POINT BY NAME (it survives edits of the slide): mark the place in the slide — \\focus{name}{…} around words, an image or a formula part (inside LaTeX too), <!-- @focus name -->…<!-- @end --> around blocks, tag: name on a module, data-focus="name" in an inline SVG — and write #name (item:#name / cell:#name / row:#name / col:#name = the bullet / cell / row / column holding it). Returns `targets`: every pointable thing on the rendered slide with the exact target string to write — the NAMED places first (#name), then what is found by its words or position (a phrase as shown "…", item:N, cell:R,C, row:…, col:…, math:N, fig:"label" — they break when the slide changes: name the place instead), images → area:x,y,w,h (% of the slide) — each with its box in % of the slide; `advice` when the slide\'s cues point by words or position; `cues`: the slide\'s cues in order, each with the narration line it acts on (or the wait / last build it rides on), the build step shown then and where every target landed; `problems`: error = not found (nothing is drawn), warn = several matches (the first is used — name the place) or not visible at that moment (an unrevealed build), note = several emphases in one line (all shown at once — not recommended) or a cue written far into its line (it shows as the line starts). Use it BEFORE writing cues (take target strings from `targets`) and AFTER (fix `problems`); see the result with render_slide_image focus:"outline" or "line:N". check_deck checks every slide\'s cues the same way.',
    inputSchema: S({ path: str('Deck path (recommended; default: the active deck)'), slide: num('Slide number, 1-based') }, ['slide']),
  },
  {
    name: 'get_narration',
    description: 'What the NARRATION of slides will SAY and SHOW — check a script\'s readings, cuts and pacing without listening. Per slide, each narration line (one subtitle unit, about a sentence; its number N is render_slide_image focus "line:N") with its `caption` (as subtitled; KaTeX rendered) and `speech` (exactly what the TTS is sent: rubies, the folder\'s GLOSSARY and formulas\' readings applied — omitted when it is the caption as is), the build step shown and the focus cues acting as it starts; the events / waits / holds between; `glossary` = the terms a glossary read on the slide; `redundantRubies` = rubies that only repeat the glossary; `rubiesOverGlossary` = rubies that read a glossary term otherwise; `presses` = what each → does in a talk given BY HAND (builds, focus cues and [[emit]] events grouped as pressed — check where [[then]] splits). `slide` or `slides` (up to 30); neither = every slide with a script (first 30).',
    inputSchema: S({ path: str('Deck path (recommended; default: the active deck)'), slide: num('One slide (1-based)'), slides: { type: 'array', items: { type: 'number' }, description: 'Several slides (1-based, max 30)' } }),
  },
  {
    name: 'render_slides',
    description: 'Render SEVERAL chosen slides in ONE call as a single numbered composite image (WebP) — the middle ground between per-slide render_slide_image (1 round trip each) and the too-small render_deck_overview thumbnails. Up to 12 slides; `width` is the per-slide width. PASS `path` to target a deck explicitly (response echoes `deck`).',
    inputSchema: S({ slides: { type: 'array', items: { type: 'number' }, description: '1-based slide numbers to render (max 12)' }, width: num('Per-slide width in px (default 480, max 1200)'), path: str('Deck path (recommended; default: the active deck)') }, ['slides']),
  },
  {
    name: 'get_deck_outline',
    description: 'LOW-TOKEN structure map of a deck (default: the active one): per slide its heading, bullet count, modules used, note volume and estimated `seconds` (from its `<!-- @time … -->` if set; else, with an @script, its narration as MDP measured it (`measuredSec`) or the read time of its script; else complexity), plus deck title and total estimatedMinutes. When the deck has recorded rehearsals, each slide also carries `rehearsalSec` (seconds actually spent in the LAST run) and the deck a `lastRehearsal` summary — call get_rehearsals for the full history. Prefer this over read_deck for orientation and style sampling of long decks. To make talk-time accurate, set `<!-- @time 90s -->` on slides.',
    inputSchema: S({ path: str('Deck path (default: the active deck)') }),
  },
  {
    name: 'get_rehearsals',
    description: 'Rehearsal history of a deck as MEASURED by MDP — presenter-tool stopwatch runs (source "presenter": seconds per slide while the timer ran, summed over revisits), TTS dry runs of the @script text (source "tts"), and narrations measured for the time estimates (source "autoplay" / "video": the narrated auto-play or a narrated video with "Update the time estimates" — their times are the current estimates of those scripts). Each run keeps the PLANNED budget of every slide at that time, so per slide you get planned vs actual vs `diffSec`, plus totals and whether the run reached the last slide. The CURRENT plan (from @time / @script) is returned alongside so you can rebalance: move `<!-- @time … -->` budgets toward what the speaker actually needs (set_time / batch_set_slides), and shorten or lengthen the `@script` of slides that consistently over/under-run. Newest runs first; nothing recorded → empty `runs`.',
    inputSchema: S({ path: str('Deck path (default: the active deck)'), last: num('How many recent runs to return (default 3, max 20)') }),
  },
  {
    name: 'search_decks',
    description: 'Search all decks in the workspace for SLIDES: each slide\'s heading and visible text, plus the deck title/subtitle — never speaker notes or scripts. Terms are AND-ed (a term may be met by the deck title). Returns decks best first, each with its matching slides (1-based `slide`, `heading`, `snippet`; at most 8 — `slideCount` is the total). Use to find past slides or decks to reuse/imitate.',
    inputSchema: S({ query: str('Search terms, whitespace-separated, all required (case-insensitive)') }, ['query']),
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
    description: 'The image aliases available to a deck: the image library (cascading .mdp scope) and, as deckImages, the deck\'s own <!-- @image alias --> definitions — in that deck an own definition wins over a library image of the same alias (overriddenByDeck), and of two own definitions the first is used. Each: alias, description, tags, kind and (for files) path. Reference an image in slides as ![alt](@alias). Use read_image to actually SEE one. With no `deck` and none open, lists the workspace-root library.',
    inputSchema: S({ deck: str('Deck path whose .mdp scope to use (default: the active deck, else the workspace root)') }),
  },
  {
    name: 'read_image',
    description: 'View an image (returned as an image block): by `alias`, resolved as the given deck\'s slides resolve it (its own @image definition first, then its .mdp image library), or any workspace image file by `path`. Use to write accurate captions/alt text or judge whether a figure fits a slide.',
    inputSchema: S({ alias: str('Image alias'), deck: str('Deck whose definitions and .mdp scope resolve the alias (default: the active deck, else root)'), path: str('Workspace-relative image path (alternative to alias)'), maxWidth: num('Downscale to this width (default 800)') }),
  },
  {
    name: 'validate_deck',
    description: 'FAST deterministic lint BEFORE visual checks: unknown module/directive names, disabled modules, unknown @theme / transition / build effect names, unknown or missing-required module parameters, unbalanced <!-- @end --> per slide, and image aliases (![](@alias) defined nowhere; an alias defined twice in the deck). Pass `text` to validate candidate content WITHOUT writing it (dry run). For the full one-shot inspection (this + lint + measure) use check_deck.',
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
    description: 'ONE-SHOT full inspection — validate (syntax/unknown modules/params/unbalanced @end, and the focus cues\' text-level notes) + lint (design advisories incl. script-step-mismatch and math-in-plain-field) + measure (overflow, issues only) in a single response, replacing 3 separate calls; `focus` (only when the deck has focus cues) checks every [[look]] / [[mark]] target on its slide as rendered when the cue acts — found, in one place, visible; `glossary` (only when the folder has glossaries and something to report) lists rubies that only repeat a glossary reading, glossary rows that are not read and terms read two ways; `skills` hands back the checklists of the folder\'s slide skills to review the deck against. DRY RUN: pass `text` instead of `path` to check candidate content BEFORE writing it (validate+lint only; nothing touches the editor or disk).',
    inputSchema: S({ path: str('Deck path to inspect (default: the active deck)'), text: str('Candidate deck markdown to check WITHOUT writing (dry run; validate+lint only)') }),
  },
  {
    name: 'bootstrap',
    description: 'START HERE: one call returning everything an authoring session needs — the full slide spec (format + module/effect indexes + themes + cached style profile + the folder\'s SLIDE SKILLS, the author\'s guides, and its GLOSSARIES\' terms, the narrator\'s readings) plus the workspace\'s deck list, templates and image aliases. Replaces the get_slide_spec + list_decks + list_templates + list_images opening sequence. Then: get_skill for the skills that fit the task; get_module_spec for the modules you pick; write with verify:true; check visually with render_slides.',
    inputSchema: S({ deck: str('Deck path whose .mdp scope to use for templates/images (default: the active deck)') }),
  },
  {
    name: 'get_asset_templates',
    description: 'How to AUTHOR a workspace asset. Call with a `kind` (module | effect | theme | snippet | skill | glossary) to get: its reference TEMPLATE, a detailed authoring GUIDE (schema, the render/CSS/script contract and pitfalls, the design tokens / file format — for a skill: how to write a slide guide an AI follows reliably; for a glossary: its table, how terms match, what belongs in one), and the list of ones that ALREADY EXIST in the workspace (so you imitate conventions and avoid duplicates). Omit `kind` for a guide overview of all kinds. Read this before write_asset.',
    inputSchema: S({ kind: { type: 'string', enum: ['module', 'effect', 'theme', 'snippet', 'skill', 'glossary'], description: 'Asset kind to get the template + guide + existing list for. Omit for an overview of all kinds.' } }),
  },
  {
    name: 'list_snippets',
    description: 'List the insertable text snippets available for a deck (built-ins + the deck\'s .mdp chain), grouped by category with each item\'s label. Use it to see what exists before adding more with write_asset (kind: "snippet").',
    inputSchema: S({ deck: str('Deck path whose .mdp scope to use (default: the active deck)') }),
  },
  {
    name: 'write_asset',
    description: 'CREATE or update a workspace asset: kind "module" (.mdpmod.xml — reusable slide component; self-describe it for AIs via <aiSpec>), "effect" (.mdpfx.xml — transition/build animation), "theme" (.css — slide design-token overrides) or "snippet" (.json — insertable text snippets grouped by category). Saved under the workspace .mdp and registered live. The user should review scripts you write. Study get_asset_templates (with this kind) and an existing asset first (get_slide_spec / get_module_spec / read_module / read_theme / list_snippets). Slide skills and glossaries have their own tools (write_skill / patch_skill / delete_skill, write_glossary / patch_glossary / delete_glossary).',
    inputSchema: S({ kind: { type: 'string', enum: ['module', 'effect', 'theme', 'snippet'], description: 'Asset kind' }, name: str('Asset name (letters/digits/-/_)'), content: str('Full file content (XML for module/effect, CSS for theme, a JSON array of {category,items} for snippet)'), dir: str('Folder whose .mdp to write into (default: workspace root)') }, ['kind', 'name', 'content']),
  },
  {
    name: 'export_video',
    description: 'Queue a NARRATED VIDEO of a deck — the narrated auto-play: each slide\'s @script read aloud by the user\'s TTS voice, the slides following along, subtitles burned in — saved beside the deck as <deck>.mp4 (REPLACING an earlier one), optionally with <deck>.vtt. mode "exact" (default) records the REAL auto-play in a hidden window: module scripts, slide transitions, build effects and `[[emit…]]` cues exactly as they run; it takes as long as the show plus the narration synthesis. mode "fast" renders still pictures joined by cross-fades, much quicker than real time, but module scripts and transitions do not play. Needs the desktop app and a narrator that produces audio (VOICEVOX or a TTS server, set in MDP — not Web Speech); hidden slides are left out unless includeHidden. A deck in a folder reached through an SSH link cannot be exported this way (nothing can be written there) — the user exports it from MDP (Export → Narrated video) and picks where to save it. Returns a jobId at once; the job runs in the background, one at a time — poll get_video_jobs for its progress and output path. Tell the user a video is being made (it appears in MDP\'s video queue panel).',
    inputSchema: S({
      path: str('Deck path (default: the active deck)'),
      mode: { type: 'string', enum: ['exact', 'fast'], description: 'exact (default): record the real auto-play; fast: still pictures + cross-fades' },
      height: { type: 'number', enum: [720, 1080, 2160], description: 'Frame height in pixels (default 1080); the width follows the deck\'s aspect' },
      subtitles: { type: 'boolean', description: 'Burn the subtitles into the picture (default true)' },
      vtt: { type: 'boolean', description: 'Also save the subtitles as <deck>.vtt (default false)' },
      includeHidden: { type: 'boolean', description: 'Include hidden slides (default false)' },
      fade: { type: 'boolean', description: 'fast mode only: cross-fade picture changes (default true)' },
      updateTimes: { type: 'boolean', description: 'Measure how long each slide\'s narration takes and make it that slide\'s time estimate (kept per script in the deck\'s rehearsal history; get_deck_outline shows it as measuredSec). Default false. Fast mode leaves out slides that wait for a module ([[emit-wait]] / [[wait]]).' },
    }),
  },
  {
    name: 'export_pdf',
    description: 'Export a deck to PDF — the Export menu\'s PDF: one page per slide, as printed (@pdfhide content left out, @pdfonly content printed) — saved BESIDE the deck as <deck>.pdf (or `name`), replacing an earlier one (backed up to .mdp/mcp-backups first). `answers`: "hide" makes the HANDOUT of a quiz / exercise deck — every @answer block left as a blank of its own size (default name <deck>-handout.pdf); "show" the instructor\'s copy; omitted = as the deck says (`<!-- @answers … -->`). The editor\'s own show/hide choice is put back afterwards. Desktop app only; the deck is opened in the editor while it prints.',
    inputSchema: S({ path: str('Deck path (default: the active deck)'), answers: { type: 'string', enum: ['show', 'hide'], description: 'Show or hide the @answer blocks (hide = a handout)' }, name: str('File name to save beside the deck (ends in .pdf)') }),
  },
  {
    name: 'export_pptx',
    description: 'Export a deck to PowerPoint (.pptx) — the Export menu\'s — saved BESIDE the deck as <deck>.pptx (or `name`), replacing an earlier one (backed up to .mdp/mcp-backups first). Each slide is one full-bleed picture, exactly as MDP shows it (math, charts, modules, the theme), and its @script goes into the slide\'s NOTES for the presenter: the markers dropped, each ruby as its word, formulas written out in Unicode with their readings in brackets (the @note is not included). Desktop app only; the deck is opened in the editor while it renders (one slide at a time — a long deck takes a while).',
    inputSchema: S({ path: str('Deck path (default: the active deck)'), name: str('File name to save beside the deck (ends in .pptx)') }),
  },
  {
    name: 'get_video_jobs',
    description: 'The narrated-video export queue (cheap — poll it after export_video): per job its id, deck, mode, status (queued / running / done / failed / cancelled), stage (prepare = synthesizing the narration, record = recording the exact auto-play, render = fast rendering, finish = closing the file), progress (done/total narration lines or stretches), video seconds so far, and when done the output path(s) — or the error.',
    inputSchema: S({}),
  },
  {
    name: 'cancel_video',
    description: 'Cancel a queued or running narrated-video export (jobId from export_video / get_video_jobs), or every queued and running one with all:true. A cancelled job leaves no half-written file; an earlier finished video of the same deck stays.',
    inputSchema: S({ jobId: str('The job to cancel'), all: { type: 'boolean', description: 'Cancel every queued and running job' } }),
  },
];

// Tools that only make sense in the desktop app: they act on the editor window the
// user is looking at (its active tab, cursor, unsaved buffer). The web endpoint
// serves everything else — file tools run against the requester's own spaces and
// the visual tools go through a headless renderer (app/mcp-render.cjs).
const DESKTOP_ONLY = new Set([
  'get_active_deck', 'open_deck', 'save_deck', 'reload_deck', 'goto_slide', 'insert_at_cursor',
  // The narrated-video export runs in the desktop app (hidden window, streamed file);
  // the PDF is printed from the editor window, the PowerPoint rendered there.
  'export_video', 'get_video_jobs', 'cancel_video', 'export_pdf', 'export_pptx',
]);

// Tools whose answer can only come from MDP's renderer: the live module / effect
// registries (and the authoring spec built from them), layout measurement, and
// every picture. The web endpoint serves these through a headless browser
// (app/mcp-render.cjs) and hides them when that is not available, rather than
// advertising tools that would fail on use.
const NEEDS_RENDERER = new Set([
  'get_slide_spec', 'get_module_spec', 'get_effect_spec', 'find_modules',
  'suggest_modules', 'suggest_effects', 'validate_deck', 'measure_slides',
  'render_slides', 'render_slide_image', 'render_deck_overview', 'read_image',
  'bootstrap', 'get_focus_targets', 'get_narration',
]);

module.exports = { TOOLS, DESKTOP_ONLY, NEEDS_RENDERER };
