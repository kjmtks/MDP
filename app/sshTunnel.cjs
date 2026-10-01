// SSH jump host (bastion) for the TTS-server relay (app/ttsRelay.cjs). A request
// can reach the TTS server THROUGH a bastion: the bastion opens the TCP connection
// to the server's host:port (like `ssh -L` / ProxyJump), so a laptop off campus can
// use a server that only admits campus addresses. The server address is resolved
// on the bastion — `http://127.0.0.1:8088` there means the bastion itself.
//
// A bastion is usually signed into with a university account, so:
//   * Its host key is PINNED (trust on first use). An unknown key is refused BEFORE
//     any credential is sent — the renderer shows the fingerprint and the user
//     confirms it (trust()); a changed key is refused outright.
//   * Secrets (a password, a key's passphrase) are encrypted with the OS keystore
//     (Electron safeStorage — DPAPI on Windows) in a machine-local file, never in
//     the app settings, and each is BOUND to what it unlocks: a password only to
//     `user@host:port`, a passphrase only to its key file. The renderer can store
//     or clear a secret but never read one back, so no caller can send the
//     password to another host.
//   * One pooled connection per bastion; one left unused closes itself.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('ssh2');

const IDLE_MS = 5 * 60 * 1000;    // close a bastion connection nobody used for this long
const STALE_MS = 60 * 1000;       // idle longer than this → reconnect (the laptop may have slept)
const SEEN_MS = 10 * 60 * 1000;   // a fingerprint shown to the user stays trustable this long
const MAX_SECRET = 4096;

let storeFile = '';
let safe = null;                  // Electron safeStorage (a stand-in in tests)
let store = { version: 1, hostKeys: {}, secrets: {} };
const pool = new Map();           // poolKey → { client, ready, channels, lastUsed, idle, dead, kill }
const seen = new Map();           // hostId → the key the bastion last presented

const expandHome = (p) => (p && /^~(?=$|[\\/])/.test(p) ? path.join(os.homedir(), p.slice(1)) : p);

// Set by a failure the renderer can explain (and act on: trust a key, re-enter a
// password). `code` is stable; `message` is shown as is.
function problem(code, message, extra) {
  const e = new Error(message);
  e.sshProblem = { code, message, ...(extra || {}) };
  return e;
}

// ---- machine-local store ------------------------------------------------------

function init({ file, safeStorage } = {}) {
  storeFile = file || '';
  safe = safeStorage || null;
  let s = null;
  try { s = storeFile ? JSON.parse(fs.readFileSync(storeFile, 'utf8')) : null; } catch { s = null; }
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  store = { version: 1, hostKeys: obj(s && s.hostKeys), secrets: obj(s && s.secrets) };
}

function save() {
  if (!storeFile) return;
  const tmp = `${storeFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, storeFile);
}

function encryptionAvailable() {
  try { return !!(safe && safe.isEncryptionAvailable()); } catch { return false; }
}

function readSecret(id) {
  const enc = store.secrets[id];
  if (!enc || !encryptionAvailable()) return '';
  try { return safe.decryptString(Buffer.from(enc, 'base64')); } catch { return ''; }
}

function writeSecret(id, value) {
  if (!value) {
    delete store.secrets[id];
  } else {
    if (!encryptionAvailable()) {
      throw problem('unavailable', 'This computer has no protected storage for secrets (the OS keystore is unavailable), so it cannot be saved.');
    }
    store.secrets[id] = safe.encryptString(value).toString('base64');
  }
  save();
}

// ---- identities -----------------------------------------------------------------

const HOST_RE = /^[A-Za-z0-9._:-]{1,253}$/;        // a DNS name, IPv4 or IPv6 (brackets stripped)
const USER_RE = /^[A-Za-z0-9._@+-]{1,64}$/;

function hostOf(cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  const host = String(c.host || '').trim().replace(/^\[|\]$/g, '');
  const port = Number(c.port) || 22;
  if (!host || !HOST_RE.test(host)) throw problem('config', 'Set the bastion’s host name.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw problem('config', 'The bastion’s port must be a number from 1 to 65535.');
  return { host, port };
}

function normalize(cfg) {
  const { host, port } = hostOf(cfg);
  const user = String(cfg.user || '').trim();
  const auth = cfg.auth === 'password' ? 'password' : 'key';
  const keyPath = String(cfg.keyPath || '').trim();
  if (!USER_RE.test(user)) throw problem('config', 'Set your user name on the bastion.');
  if (auth === 'key' && !keyPath) throw problem('config', 'Choose your private key file.');
  return { host, port, user, auth, keyPath };
}

const hostId = (c) => `${c.host.toLowerCase()}:${c.port}`;
const passwordId = (c) => `password:${c.user}@${hostId(c)}`;
function passphraseId(keyPath) {
  const p = path.resolve(expandHome(String(keyPath)));
  return `passphrase:${process.platform === 'win32' ? p.toLowerCase() : p}`;
}

// OpenSSH's fingerprint form (what `ssh` and `ssh-keygen -lf` print), so the user
// can compare it with what the bastion's administrator publishes.
function fingerprintOf(key) {
  return `SHA256:${crypto.createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
}
function keyTypeOf(key) {
  try { return key.subarray(4, 4 + key.readUInt32BE(0)).toString('ascii'); } catch { return ''; }
}

// ---- what the settings panel may do ------------------------------------------------

/** What is stored for this bastion (never the secrets themselves). */
function info(cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  let hid = '';
  try { hid = hostId(hostOf(c)); } catch { /* host not filled in yet */ }
  const user = String(c.user || '').trim();
  const keyPath = String(c.keyPath || '').trim();
  return {
    encryption: encryptionAvailable(),
    hasPassword: !!(hid && user && store.secrets[`password:${user}@${hid}`]),
    hasPassphrase: !!(keyPath && store.secrets[passphraseId(keyPath)]),
    hostKey: hid && store.hostKeys[hid] ? { ...store.hostKeys[hid] } : null,
  };
}

/** Store (or, with an empty value, clear) the password of `user@host:port` or the
 *  passphrase of a key file. */
function setSecret(req) {
  const r = req && typeof req === 'object' ? req : {};
  const value = typeof r.value === 'string' ? r.value : '';
  if (value.length > MAX_SECRET) throw problem('config', 'That is too long to be a password.');
  if (r.kind === 'passphrase') {
    if (!String(r.keyPath || '').trim()) throw problem('config', 'Choose the key file first.');
    writeSecret(passphraseId(r.keyPath), value);
  } else {
    writeSecret(passwordId(normalize({ ...r, auth: 'password' })), value);
  }
  closeAll();                     // the next request signs in with what is stored now
  return info(r);
}

/** Pin the host key the bastion presented a moment ago (after the user compared
 *  the fingerprint). Only a key actually seen can be pinned. */
function trust(req) {
  const hid = hostId(hostOf(req));
  const s = seen.get(hid);
  if (!s || s.fingerprint !== String((req && req.fingerprint) || '') || Date.now() - s.at > SEEN_MS) {
    throw problem('hostkey-stale', 'Connect again to see the bastion’s current host key.');
  }
  store.hostKeys[hid] = { fingerprint: s.fingerprint, keyType: s.keyType, at: Date.now() };
  save();
  return info(req);
}

/** Forget the pinned host key (the administrator replaced it): the next connection
 *  asks again. */
function forget(req) {
  const hid = hostId(hostOf(req));
  delete store.hostKeys[hid];
  save();
  closeAll();
  return info(req);
}

// ---- connections -------------------------------------------------------------------

const REASONS = { 1: 'the bastion does not allow port forwarding', 2: 'connection failed', 3: 'unknown channel type', 4: 'resource shortage' };

function classify(err, c) {
  const hid = hostId(c);
  const code = String((err && err.code) || '');
  const msg = String((err && err.message) || err);
  if (err && err.level === 'client-authentication') {
    return problem('auth', c.auth === 'password'
      ? `${hid} did not accept the password for ${c.user}.`
      : `${hid} did not accept the key for ${c.user} — is its public key registered there?`);
  }
  if (err && err.level === 'client-timeout') return problem('connect', `No answer from the bastion ${hid} (timed out).`);
  if (/ENOTFOUND|EAI_AGAIN/.test(code)) return problem('connect', `The bastion’s host name ${c.host} could not be found.`);
  if (/ECONNREFUSED/.test(code)) return problem('connect', `${hid} refused the connection — is SSH running on port ${c.port}?`);
  if (/ETIMEDOUT|EHOSTUNREACH|ENETUNREACH/.test(code)) return problem('connect', `Cannot reach the bastion ${hid} (${code}).`);
  return problem('connect', `SSH to ${hid} failed: ${msg}`);
}

function armIdle(entry) {
  clearTimeout(entry.idle);
  entry.idle = null;
  if (entry.dead || entry.channels > 0) return;
  entry.idle = setTimeout(() => entry.kill(), IDLE_MS);
  if (entry.idle.unref) entry.idle.unref();
}

const poolKey = (c) => JSON.stringify([hostId(c), c.user, c.auth, c.auth === 'key' ? passphraseId(c.keyPath) : '']);

function getClient(c) {
  const key = poolKey(c);
  const cur = pool.get(key);
  if (cur && !cur.dead) {
    if (cur.channels > 0 || Date.now() - cur.lastUsed < STALE_MS) return cur.ready;
    cur.kill();                   // idle a while: the TCP connection may be dead without knowing
  }
  const hid = hostId(c);
  const client = new Client();
  const entry = { client, channels: 0, lastUsed: Date.now(), idle: null, dead: false };
  entry.kill = () => {
    if (entry.dead) return;
    entry.dead = true;
    clearTimeout(entry.idle);
    if (pool.get(key) === entry) pool.delete(key);
    try { client.end(); } catch { /* ignore */ }
  };
  pool.set(key, entry);
  entry.ready = new Promise((resolve, reject) => {
    let refused = null;           // the host key check's own verdict (clearer than "Host denied")
    let missing = null;           // a secret we lack — reported once the host key checks out,
                                  // so a first connection still shows the key to confirm
    let settled = false;
    const fail = (e) => { entry.kill(); if (!settled) { settled = true; reject(e); } };
    const pinned = store.hostKeys[hid];
    const opts = {
      host: c.host, port: c.port, username: c.user,
      readyTimeout: 20000, keepaliveInterval: 15000, keepaliveCountMax: 3,
      hostVerifier: (hostKey) => {
        const fingerprint = fingerprintOf(hostKey);
        const keyType = keyTypeOf(hostKey);
        seen.set(hid, { fingerprint, keyType, at: Date.now() });
        if (!pinned) {
          refused = problem('hostkey-unknown', `First connection to ${hid}: check its host key before signing in.`,
            { host: c.host, port: c.port, fingerprint, keyType });
          return false;
        }
        if (pinned.fingerprint !== fingerprint) {
          refused = problem('hostkey-mismatch', `The host key of ${hid} has CHANGED. Someone may be intercepting the connection, so it was refused.`,
            { host: c.host, port: c.port, fingerprint, keyType, expected: pinned.fingerprint });
          return false;
        }
        if (missing) { refused = missing; return false; }   // close before signing in
        return true;
      },
    };
    if (c.auth === 'password') {
      const password = readSecret(passwordId(c));
      if (!password) {
        missing = problem('no-secret', `Enter the password for ${c.user}@${hid}.`);
      } else {
        opts.password = password;
        // Many servers take the password only as keyboard-interactive (PAM).
        opts.tryKeyboard = true;
        client.on('keyboard-interactive', (_name, _instr, _lang, prompts, finish) => finish(prompts.map(() => password)));
      }
    } else {
      try { opts.privateKey = fs.readFileSync(expandHome(c.keyPath)); } catch (e) {
        fail(problem('key', `Cannot read the key file ${c.keyPath} (${e.code || e.message}).`));
        return;
      }
      const passphrase = readSecret(passphraseId(c.keyPath));
      if (passphrase) opts.passphrase = passphrase;
    }
    client
      .on('ready', () => { if (!settled) { settled = true; resolve(client); } armIdle(entry); })
      .on('error', (err) => fail(refused || classify(err, c)))
      .on('close', () => fail(refused || problem('connect', `The bastion ${hid} closed the connection.`)));
    try {
      client.connect(opts);
    } catch (err) {
      // The key is parsed here: an encrypted one without (the right) passphrase.
      const msg = String((err && err.message) || err);
      fail(problem('key', /passphrase|encrypted|decrypt/i.test(msg)
        ? `The key file ${c.keyPath} is protected — enter its passphrase.`
        : `Cannot use the key file ${c.keyPath}: ${msg}`));
    }
  });
  return entry.ready;
}

/** A TCP stream to dstHost:dstPort opened BY the bastion (a direct-tcpip channel).
 *  Rejects with an Error carrying `sshProblem` when the renderer can explain it. */
async function openStream(cfg, dstHost, dstPort) {
  const c = normalize(cfg);
  const client = await getClient(c);
  const entry = pool.get(poolKey(c));
  return new Promise((resolve, reject) => {
    const onOpen = (err, stream) => {
      if (err) {
        const why = REASONS[err.reason] || String(err.message || err).replace(/^\(SSH\) Channel open failure: /, '');
        reject(problem('forward', `The bastion could not connect to ${dstHost}:${dstPort} (${why}).`));
        return;
      }
      if (entry && entry.client === client) {
        entry.channels += 1;
        entry.lastUsed = Date.now();
        clearTimeout(entry.idle);
        stream.once('close', () => { entry.channels -= 1; entry.lastUsed = Date.now(); armIdle(entry); });
      }
      resolve(stream);
    };
    try {
      client.forwardOut('127.0.0.1', 0, dstHost, dstPort, onOpen);
    } catch (e) {                 // the connection dropped since it was handed out
      if (entry) entry.kill();
      reject(problem('connect', `The connection to the bastion ${hostId(c)} was lost (${e.message}). Try again.`));
    }
  });
}

function closeAll() {
  for (const entry of [...pool.values()]) entry.kill();
  pool.clear();
}

module.exports = { init, info, setSecret, trust, forget, openStream, closeAll, fingerprintOf };
