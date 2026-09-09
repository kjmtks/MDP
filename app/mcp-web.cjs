// MCP for the shared web server: one endpoint, one workspace per signed-in person.
//
// The desktop app exposes MDP to an AI through a local bridge and a stdio proxy
// (app/mcp-bridge.cjs + app/mcp-server.cjs). A shared deployment cannot work that
// way — there is no single "open folder" and no editor window — so this mounts the
// SAME tool implementations at `POST /mcp` and gives each call a workspace built
// from the requester's identity:
//
//   * file tools resolve every path through the deployment's spaces engine
//     (app/webspaces.cjs), so an AI sees exactly what its user sees — their own
//     decks, the homes they may read, the groups they belong to — and writes only
//     where they may write;
//   * visual tools (previews, measurement, the module/effect registries) go to a
//     headless browser opened AS that user (app/mcp-render.cjs);
//   * tools that drive a person's own editor window are simply not offered here.
//
// Identity comes from the same header the rest of the server trusts (set by the
// authenticating proxy, or by a trusted service calling the container directly) —
// there is no second authentication scheme to keep in step.

const path = require('path');
const bridge = require('./mcp-bridge.cjs');
const render = require('./mcp-render.cjs');
const { TOOLS, DESKTOP_ONLY, NEEDS_RENDERER } = require('./mcp-tools.cjs');

const SERVER_INFO = { name: 'mdp-web', version: '1.0.0' };
const DEFAULT_PROTOCOL = '2024-11-05';

const INSTRUCTIONS = [
  'MDP — Markdown presentation decks (*.slide.md), shared server.',
  'Paths are workspace-relative, exactly as they appear in MDP: your own folder at the',
  'root, other people\'s and your groups\' under the "@" folders. Start with bootstrap',
  '(spec + decks + templates + images), then get_module_spec for the modules you pick.',
  'There is no editor window here: always pass an explicit `path` / `deck`.',
].join(' ');

function mount(app, deps) {
  const { spaces, webspaces, walk, lockHolder, pokeClients, assetDir } = deps;

  // ---- the workspace a call runs against ------------------------------------
  const workspaceFor = (req, user) => ({
    key: user,
    // Read or write ONE path, through the deployment's own permission model. A path
    // outside what this user may reach reports "not found" — the same answer the
    // file tree gives them, revealing nothing about what exists elsewhere.
    resolve(rel, mode) {
      const loc = webspaces.locate(spaces, req, rel);
      if (!loc || !webspaces.canRead(spaces, req, loc) || !loc.abs) {
        throw new Error(`"${rel}" is not in your workspace (see list_decks).`);
      }
      if (mode === 'w') {
        if (!webspaces.canWrite(spaces, req, loc)) throw new Error(`"${rel}" is read-only for you.`);
        // Someone editing that file in MDP right now would lose their work to a
        // background write — the same advisory lock the editor itself respects.
        const holder = lockHolder(loc.abs);
        if (holder && holder !== user) throw new Error(`"${rel}" is open for editing by ${holder} right now. Try again once they are done.`);
      }
      return { kind: 'local', abs: loc.abs };
    },
    tree: () => webspaces.tree(spaces, req, walk),
    relay: (method, params, timeoutMs) => relay(user, method, params, timeoutMs),
    assetPath: (rel) => path.join(assetDir, rel),
    readingCpm: () => 320,
  });

  // ---- what "live" means without a live editor -------------------------------
  // The bridge asks the editor window for these. Here: the ones about a person's
  // own editor state are answered locally (there is no such state on a server, and
  // the tool falls back to the file), the rest go to the headless renderer.
  const LOCAL = {
    // No unsaved buffer to consult -> the file on disk IS the deck.
    getDeckText: () => ({ open: false }),
    setOpenDeckText: () => ({ applied: false }),
    // A write from an AI should show up in the browsers that have this workspace open.
    refreshTree: () => { pokeClients(); return { ok: true }; },
    contentChanged: () => { pokeClients(); return { ok: true }; },
    // The desktop asks the user to review an AI-authored asset before saving it.
    // There is nobody at this screen; the write is already limited to the folders
    // this user may write, and write_asset says so in its result.
    confirmAssetWrite: (params) => ({
      approved: true,
      note: params && params.hasScript
        ? 'No one reviewed this file before it was saved (there is no dialog on a shared server) — tell the user what its <script> does.'
        : 'No one reviewed this file before it was saved (there is no dialog on a shared server).',
    }),
    activeDeck: () => { throw new Error('There is no editor window on this server — pass "path" (or "deck") explicitly; list_decks shows what is there.'); },
    openDeck: () => { throw new Error('There is no editor window on this server — tools take a "path" instead of opening a deck.'); },
    saveDeck: () => { throw new Error('Writes go straight to the file here; there is no unsaved editor buffer to save.'); },
    reloadDeck: () => { throw new Error('Writes go straight to the file here; there is nothing to reload.'); },
    gotoSlide: () => { throw new Error('There is no editor window on this server.'); },
    insertAtCursor: () => { throw new Error('There is no cursor on this server — edit with patch_deck / replace_slide / append_slide.'); },
  };
  const relay = async (user, method, params, timeoutMs) => {
    if (LOCAL[method]) return LOCAL[method](params);
    return render.call(user, method, params, timeoutMs);
  };

  // ---- MCP (JSON-RPC 2.0 over HTTP POST) -------------------------------------
  const toolsFor = () => TOOLS.filter((t) => !DESKTOP_ONLY.has(t.name) && (render.enabled() || !NEEDS_RENDERER.has(t.name)));

  app.post('/mcp', async (req, res) => {
    const user = webspaces.userOf(spaces, req);
    if (!user) return res.status(401).json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'unidentified user' } });
    const msg = req.body || {};
    const { id, method, params } = msg;
    const ok = (result) => res.json({ jsonrpc: '2.0', id, result });

    // Notifications carry no id and take no response.
    if (typeof method === 'string' && method.startsWith('notifications/')) return res.status(202).end();
    if (method === 'initialize') {
      return ok({
        protocolVersion: (params && params.protocolVersion) || DEFAULT_PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    if (method === 'ping') return ok({});
    if (method === 'tools/list') return ok({ tools: toolsFor() });
    if (method === 'resources/list') return ok({ resources: [] });
    if (method === 'resources/templates/list') return ok({ resourceTemplates: [] });
    if (method === 'prompts/list') return ok({ prompts: [] });
    if (method === 'tools/call') {
      const name = params && params.name;
      if (!toolsFor().some((t) => t.name === name)) {
        return ok({ content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true });
      }
      try {
        const result = await bridge.callToolFor(workspaceFor(req, user), name, (params && params.arguments) || {});
        const content = result && result.__image
          ? [{ type: 'image', data: result.__image, mimeType: result.mimeType || 'image/png' }]
          : [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }];
        return ok({ content });
      } catch (e) {
        // A failed tool is an ANSWER, not a transport error: the AI should read it
        // and try something else.
        return ok({ content: [{ type: 'text', text: String((e && e.message) || e) }], isError: true });
      }
    }
    if (id === undefined) return res.status(202).end();
    return res.json({ jsonrpc: '2.0', id: id ?? null, error: { code: -32601, message: `Method not found: ${method}` } });
  });

  // MCP hosts may probe for a server-sent-events channel; this endpoint is
  // stateless request/response, so say so plainly instead of hanging.
  app.get('/mcp', (req, res) => res.status(405).json({ error: 'POST JSON-RPC to this endpoint (no SSE channel).' }));
}

module.exports = { mount };
