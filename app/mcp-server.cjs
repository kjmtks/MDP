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
    description: 'The complete MDP slide-authoring specification: file format, directives, authoring rules, plus every theme, animation effect and module AVAILABLE FOR THE CURRENT DECK\'S FOLDER (modules describe themselves). Call this FIRST before writing or editing any .slide.md content.',
    inputSchema: S({}),
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
    description: 'Create or fully replace a deck. If the deck is open in the editor the change is applied there as an UNSAVED edit (the user reviews and saves); otherwise the file is written directly. Content must follow get_slide_spec (meta page, then `---`-separated slides).',
    inputSchema: S({ path: str('Workspace-relative deck path (must end in .slide.md)'), content: str('Full deck markdown') }, ['path', 'content']),
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
    description: 'Write the READ-ALOUD SCRIPT (the manuscript the presenter will speak, verbatim) for one slide, WITHOUT touching its visible content. Shown prominently in the presenter view; its length drives the slide\'s talk-time estimate at the user\'s reading speed. Ideal for generating a full talk manuscript: set_script per slide (mode="append" to build up). script="" clears. Markdown, multi-line OK (must not contain "-->").',
    inputSchema: S({ path: str('Deck path'), slide: num('Slide number (1-based)'), script: str('Read-aloud Markdown ("" clears)'), mode: { type: 'string', enum: ['replace', 'append'], description: 'replace (default) or append' } }, ['path', 'slide', 'script']),
  },
  {
    name: 'set_time',
    description: 'Set one slide\'s explicit speaking-time budget (`<!-- @time … -->`), overriding any estimate — use when distributing a target talk length across slides (e.g. a 10-minute talk). Accepts 90s / 2m / 1m30s / 1:30; time="" clears. Shown in the presenter countdown.',
    inputSchema: S({ path: str('Deck path'), slide: num('Slide number (1-based)'), time: str('Duration ("" clears), e.g. "90s", "1m30s", "1:30"') }, ['path', 'slide', 'time']),
  },
  {
    name: 'batch_set_slides',
    description: 'TOKEN-SAVER: set @note / @script / @time on MANY slides in ONE call (one write), instead of calling set_notes/set_script/set_time per slide. Ideal for generating a whole talk manuscript or distributing @time across a deck. `edits` = [{slide, note?, script?, time?, mode?}] (only the fields you pass are changed; "" clears one; mode="append" for note/script). Atomic: any invalid edit aborts the whole batch.',
    inputSchema: S({ path: str('Deck path'), edits: { type: 'array', description: 'Per-slide edits', items: { type: 'object', properties: { slide: num('1-based'), note: str('@note ("" clears)'), script: str('@script ("" clears)'), time: str('@time ("" clears)'), mode: { type: 'string', enum: ['replace', 'append'] } }, required: ['slide'] } } }, ['path', 'edits']),
  },
  {
    name: 'list_modules',
    description: 'List the modules available for a deck\'s folder (its cascading .mdp scope), with the path of each definition file. Modules already self-describe inside get_slide_spec; use read_module only when you need the exact template/CSS/script.',
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
    description: 'The deck currently open in the MDP editor: path, live (possibly unsaved) content, slide count and the slide shown in the preview.',
    inputSchema: S({}),
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
    description: 'LOW-TOKEN layout check of the ACTIVE deck. Per slide: overflowX/overflowY (px of content CLIPPED beyond the slide box — anything > 0 must be fixed by splitting/shortening), fillX/fillY (how far content extends across the width/height, 0..1; fillY < ~0.5 leaves the lower half unused), and coverage (painted-area fraction; much lower than the deck\'s typical = looks empty). TOKEN-SAVER: pass `slides:[n,…]` (1-based) to measure ONLY the slides you just changed. Run after writing, fix, re-run.',
    inputSchema: S({ slides: { type: 'array', items: { type: 'number' }, description: 'Measure only these 1-based slides. Omit for all.' } }),
  },
  {
    name: 'render_slide_image',
    description: 'Render one slide of the ACTIVE deck to an image (WebP), exactly as MDP displays it — use to visually judge layout/design when measure_slides is not enough. Higher token cost; prefer small widths.',
    inputSchema: S({ slide: num('Slide number, 1-based'), width: num('Image width in px (default 512, max 1280)') }, ['slide']),
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
    description: 'Token-efficient partial edit: replace an exact text fragment in a deck. old_str must match EXACTLY ONCE (or pass all=true to replace every occurrence). Prefer this over write_deck for small changes.',
    inputSchema: S({ path: str('Deck path'), old_str: str('Exact existing text'), new_str: str('Replacement text'), all: { type: 'boolean', description: 'Replace all occurrences (default false)' } }, ['path', 'old_str', 'new_str']),
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
    description: 'FAST deterministic lint of a deck (default: the active one) BEFORE visual checks: unknown module/directive names, disabled modules, unknown @theme / transition / build effect names, unknown or missing-required module parameters, and unbalanced <!-- @end --> per slide. Fix errors, then run measure_slides.',
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
    description: 'One contact-sheet image of ALL slides of the ACTIVE deck (grid of small thumbnails, numbered) — judge overall balance, consistency and pacing in a single image. Moderate token cost.',
    inputSchema: S({ thumbWidth: num('Thumbnail width in px (default 260, max 400)') }),
  },
  {
    name: 'get_asset_templates',
    description: 'Reference templates for AUTHORING new assets: a module (.mdpmod.xml), an animation effect (.mdpfx.xml) and a theme CSS. Read these before write_asset to learn each format.',
    inputSchema: S({}),
  },
  {
    name: 'write_asset',
    description: 'CREATE or update a workspace asset: kind "module" (.mdpmod.xml — reusable slide component with render template/CSS/script; self-describe it for AI via <aiSpec>), "effect" (.mdpfx.xml — transition/build animation) or "theme" (.css). Saved under the workspace .mdp and registered live. The user should review scripts you write. Study get_asset_templates and an existing asset (read_module / read_theme) first.',
    inputSchema: S({ kind: { type: 'string', enum: ['module', 'effect', 'theme'], description: 'Asset kind' }, name: str('Asset name (letters/digits/-/_)'), content: str('Full file content'), dir: str('Folder whose .mdp to write into (default: workspace root)') }, ['kind', 'name', 'content']),
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
