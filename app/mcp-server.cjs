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
// Shown to the AI by hosts that support server instructions.
const INSTRUCTIONS = [
  'MDP — Markdown presentation decks (*.slide.md) in the running MDP app.',
  'Start with bootstrap (or get_slide_spec). The folder\'s SLIDE SKILLS listed there are the',
  'author\'s own guides for making slides: read every skill that fits the task with get_skill',
  'BEFORE planning or writing, follow it, and review the result against its checklist',
  '(check_deck / verify:true). When the user corrects your slides, offer to record the rule',
  'in the skill (patch_skill with `append`) so later decks get it right. The folder\'s GLOSSARIES',
  '(listed in the spec) give the narrator\'s readings of the field\'s terms: write no ruby for those',
  'terms, and add a term the TTS misreads that recurs in the field with patch_glossary.',
  'A reference the user pastes from MDP (the preview\'s "Copy reference") reads',
  '`deck p.N (slide M, @id X) 「heading」 › TARGET 「its words」 › 「words selected」`: M is the',
  '`slide` the tools take (N is the page printed on it), TARGET is a place as get_focus_targets names it.',
  'A deck can have a REVIEW beside it — findings anchored to its slides (get_review; add_review for a',
  'reviewer, resolve_review for the author; the person\'s own comments come first) —, snapshots to compare',
  'a revision with (snapshot_deck, get_changes), and a lecture FLOW file, its understanding design',
  '(get_flow / write_flow — write it before the slides; a step whose student\'s question you cannot write is a flat one).',
  'The folder\'s AUDIENCE (get_audience: personas of who its decks are for) is what to write for — and what a reviewer reads a deck as.',
  'Asked to REVIEW a deck with AI: call review_readiness first — it says what is in place and what is left; in Claude Code the /mdp-review-loop skill runs the reviewer and reviser subagents.',
  'EVERYTHING AROUND A DECK GOES THROUGH THESE TOOLS — never read or write the workspace\'s files yourself (the decks\' folders may be on a NAS behind a .mdplink; touching them directly makes the user approve each access):',
  'read_file / write_file / patch_file (a lesson plan, notes, a CSV, an .svg) and patch_files (several at once — skills, a flow and a plan, all or nothing);',
  'put_file for a figure / PDF / zip your script made (`from` = its path in the temp folder; re-using a figure\'s name is fine, MDP draws the new one); list_files (sizes, times, md5); delete_file (moved to .mdp/mcp-backups);',
  'inspect_pdf after export_pdf (pages, paper sizes, a picture). For MDP\'s own records use their tools: get_rehearsals, get_review, get_flow.',
  'No MDP tool waits for the person: writes happen at once (overwritten and deleted files are kept in .mdp/mcp-backups — the answer says where); when only you can judge (the file changed on disk, a file the person is editing), the answer gives the reason and the ways out.',
  'ANSWERS: get_active_deck says whether the @answer blocks are shown (`answers`); set_answers changes the editor\'s toggle (show / hide / default = as the deck says); the render and check tools take `answers` for one call; check_deck checks the deck as the class sees it.',
].join(' ');

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
// Shared with the web endpoint (app/mcp-tools.cjs); the bridge implements a method
// of the same name for each tool.
const { TOOLS, toContent } = require('./mcp-tools.cjs');

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
      instructions: INSTRUCTIONS,
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
      reply(id, { content: toContent(result) });
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
