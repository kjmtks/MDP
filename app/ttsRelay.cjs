// Main-process relay for the renderer's calls to an OpenAI-compatible TTS server
// (Irodori-TTS-Server, Kokoro-FastAPI, OpenAI… — run locally by the user, shared
// on a LAN, or a cloud API).
//
// Why it exists: such servers usually send no CORS headers (Irodori only when
// started with IRODORI_CORS_ORIGINS), so a renderer `fetch` from the app's
// file:// page is blocked. Node has no CORS, so the renderer hands the request
// here over IPC.
//
// Deliberately NARROW — this is not a general proxy: http(s) only, only the
// speech API's paths (under any base path), a fixed method per path, bounded
// request and response.
//   GET  /health, /v1/models, /v1/audio/voices, /openapi.json (the server's own
//        description of its speech request — the options it takes)
//   POST /v1/audio/speech            (JSON)
//   POST /v1/audio/voices            (Irodori: multipart upload of a reference voice)
//   PUT  /v1/audio/voices/<id>       (Irodori: multipart replace of a reference voice)
//   DELETE /v1/audio/voices/<id>     (Irodori: remove a reference voice)
// A server with an API key (Irodori: IRODORI_API_KEY) wants `Authorization:
// Bearer <key>`; the renderer passes the key as `apiKey` and it is added to every
// request.
// The answer comes back as { status, contentType, body } plus ONE header,
// Irodori's `X-Irodori-Messages` (as `messages`): what the model did with the
// request — e.g. that it ignored a reference voice it cannot use.
// A request carrying an `id` can be cut off with abortTtsHttp(id): the renderer
// does that when the user stops or cancels. Closing the connection is what tells
// the server to stop — a streamed (SSE) synthesis then ends after the chunk in
// progress instead of rendering the whole text for nobody.
// A request carrying `ssh` ({host, port, user, auth, keyPath}) goes THROUGH that
// bastion (sshTunnel.cjs): the bastion opens the connection to the server, so a
// server that only admits campus addresses works from home. An SSH problem the
// user can act on (an unknown host key, a rejected password…) resolves as
// `{ status: 0, sshError }` rather than an error — structure survives IPC.
// Node's http module rather than fetch: fetch's built-in 300 s header timeout is
// shorter than a first request that has to wait for a multi-GB model to load.
const http = require('http');
const https = require('https');
const tls = require('tls');
const net = require('net');
const crypto = require('crypto');
const sshTunnel = require('./sshTunnel.cjs');

const GET_PATH = /\/(health|openapi\.json|v1\/models|v1\/audio\/voices)$/;
const SPEECH_PATH = /\/v1\/audio\/speech$/;
const VOICES_PATH = /\/v1\/audio\/voices$/;
const VOICE_PATH = /\/v1\/audio\/voices\/[A-Za-z0-9_-]+$/;
const VOICE_ID = /^[A-Za-z0-9_-]+$/;       // the server's own rule for voice ids
const API_KEY = /^[\x21-\x7E]+$/;          // printable ASCII: nothing that could end a header
const REQ_ID = /^[A-Za-z0-9_-]{1,64}$/;

// Requests in flight, by the renderer-chosen id, so they can be aborted. One that
// goes through a bastion is registered before its tunnel opens, so a stop during
// the SSH sign-in cancels it too.
const inflight = new Map();

function abortTtsHttp(id) {
  const h = inflight.get(String(id));
  if (h) h.abort();
  return !!h;
}
const MAX_REQUEST = 1 << 20;               // 1 MB of JSON — the text to speak
const MAX_UPLOAD = 32 << 20;               // 32 MB reference clip
const MAX_RESPONSE = 256 << 20;            // 256 MB of audio (~45 min of 48 kHz WAV)
// Idle limit on the socket. A request can legitimately sit silent for a long time —
// waiting for a model load (IRODORI_MODEL_LOAD_TIMEOUT) or, on a shared server, in
// the synthesis queue (IRODORI_SYNTHESIS_WAIT_TIMEOUT) — so this stays well above
// both and the SERVER decides when a wait has failed (it answers 503).
const TIMEOUT_MS = 30 * 60 * 1000;

// multipart/form-data with an optional `voice_id` field and one `file` part —
// what the server's voice endpoints read.
function multipart(upload) {
  const boundary = `----mdp${crypto.randomBytes(12).toString('hex')}`;
  const filename = String(upload.filename || 'voice.wav').replace(/[^A-Za-z0-9._-]/g, '_');
  const parts = [];
  if (upload.voiceId) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="voice_id"\r\n\r\n${upload.voiceId}\r\n`));
  }
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: audio/wav\r\n\r\n`));
  parts.push(Buffer.from(upload.data));
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

// The bastion's channel, shaped like the socket http(s).request expects — the way
// ssh2's own HTTP agents do it. For https the TLS session runs end to end over the
// channel (the certificate is checked against the server's name as usual), so the
// bastion sees neither the text nor the API key.
function tunnelSocket(stream, u, host) {
  if (u.protocol === 'https:') {
    const sock = tls.connect({ socket: stream, ...(net.isIP(host) ? { host } : { servername: host }), ALPNProtocols: ['http/1.1'] });
    // nodejs/node#35904: without this the TLS socket may never emit 'close'.
    const resume = () => { if (stream.isPaused()) stream.resume(); };
    sock.once('end', resume).once('close', resume);
    return sock;
  }
  const self = () => stream;
  return Object.assign(stream, {
    setKeepAlive: self, setNoDelay: self, setTimeout: self, ref: self, unref: self,
    destroySoon: () => stream.destroy(),
  });
}

function relayTtsHttp(req) {
  return new Promise((resolve, reject) => {
    const fail = (msg) => reject(new Error(`ttsHttp: ${msg}`));
    let u;
    try { u = new URL(String((req && req.url) || '')); } catch { fail('invalid URL'); return; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') { fail('only http(s) URLs'); return; }
    const p = u.pathname.replace(/\/+$/, '');
    const method = ['POST', 'PUT', 'DELETE'].includes(req.method) ? req.method : 'GET';
    const apiKey = req.apiKey ? String(req.apiKey) : '';
    if (apiKey && !API_KEY.test(apiKey)) { fail('API key may only contain printable ASCII characters'); return; }
    const id = req.id ? String(req.id) : '';
    if (id && !REQ_ID.test(id)) { fail('invalid request id'); return; }

    let body = null;
    let contentType = '';
    if (method === 'GET') {
      if (!GET_PATH.test(p)) { fail(`not a speech API path: ${u.pathname}`); return; }
    } else if (method === 'DELETE') {
      if (!VOICE_PATH.test(p) || req.upload || req.body) { fail(`DELETE is not allowed for ${u.pathname}`); return; }
    } else if (method === 'POST' && SPEECH_PATH.test(p) && !req.upload) {
      body = Buffer.from(String(req.body ?? ''), 'utf8');
      if (body.length > MAX_REQUEST) { fail('request too large'); return; }
      contentType = 'application/json';
    } else if (req.upload && ((method === 'POST' && VOICES_PATH.test(p)) || (method === 'PUT' && VOICE_PATH.test(p)))) {
      const data = req.upload.data;
      if (!data || !data.length || data.length > MAX_UPLOAD) { fail('upload missing or too large'); return; }
      if (req.upload.voiceId && !VOICE_ID.test(String(req.upload.voiceId))) { fail('voice id must be letters, digits, - or _'); return; }
      ({ body, contentType } = multipart(req.upload));
    } else {
      fail(`${method} is not allowed for ${u.pathname}`); return;
    }

    const headers = body ? { 'Content-Type': contentType, 'Content-Length': body.length } : {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const lib = u.protocol === 'https:' ? https : http;

    const handle = {
      aborted: false, req: null,
      abort() { this.aborted = true; if (this.req) this.req.destroy(new Error('ttsHttp: aborted')); },
    };
    if (id) inflight.set(id, handle);
    const forget = () => { if (id && inflight.get(id) === handle) inflight.delete(id); };

    // `channel`: the bastion's stream under `socket` — closed with the request so
    // the bastion drops its connection to the server at once (a stop stops it).
    const send = (socket, channel) => {
      const r = lib.request(u, socket ? { method, headers, createConnection: () => socket } : { method, headers }, (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (c) => {
          size += c.length;
          if (size > MAX_RESPONSE) { r.destroy(new Error('ttsHttp: response too large')); return; }
          chunks.push(c);
        });
        res.on('end', () => resolve({
          status: res.statusCode || 0,
          contentType: String(res.headers['content-type'] || ''),
          body: Buffer.concat(chunks),
          ...(res.headers['x-irodori-messages'] ? { messages: String(res.headers['x-irodori-messages']) } : {}),
        }));
        res.on('error', reject);
      });
      handle.req = r;
      r.setTimeout(TIMEOUT_MS, () => r.destroy(new Error('ttsHttp: timed out')));
      r.on('error', reject);
      r.on('close', () => {
        forget();
        if (channel) { try { channel.destroy(); } catch { /* ignore */ } }
      });
      if (body) r.write(body);
      r.end();
    };

    if (!req.ssh) { send(null, null); return; }
    const host = u.hostname.replace(/^\[|\]$/g, '');
    const port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
    sshTunnel.openStream(req.ssh, host, port).then((channel) => {
      if (handle.aborted) {       // stopped while the bastion was being signed into
        forget();
        try { channel.destroy(); } catch { /* ignore */ }
        reject(new Error('ttsHttp: aborted'));
        return;
      }
      send(tunnelSocket(channel, u, host), channel);
    }, (e) => {
      forget();
      if (e && e.sshProblem) resolve({ status: 0, contentType: '', body: Buffer.alloc(0), sshError: e.sshProblem });
      else reject(e);
    });
  });
}

module.exports = { relayTtsHttp, abortTtsHttp };
