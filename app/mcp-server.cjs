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
// Shared with the web endpoint (app/mcp-tools.cjs); the bridge implements a method
// of the same name for each tool.
const { TOOLS } = require('./mcp-tools.cjs');

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
