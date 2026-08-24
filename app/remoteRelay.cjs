'use strict';

const OPEN = 1;

// opts.userOf(req): shared-deployment hook. When present, every socket is
// tagged with its authenticated user and BROADCAST frames are relayed only
// between sockets of the SAME user (one person's PC + tablet). Without the
// hook (Electron / single-user web) behavior is unchanged.
function attachRelay(wss, opts = {}) {
  const userOf = typeof opts.userOf === 'function' ? opts.userOf : null;
  const channelTokens = new Map();

  // A channel with a registered token only relays to sockets presenting that token.
  // Channels that never present a token stay open (legacy / web behavior).
  const authed = (ws, channelId) => {
    const required = channelId ? channelTokens.get(channelId) : undefined;
    return !required || ws._mdpToken === required;
  };

  wss.on('connection', (ws, req) => {
    ws._mdpChannel = null;
    ws._mdpToken = null;
    ws._mdpUser = userOf ? userOf(req) : null;

    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }

      if (msg.type === 'JOIN') {
        ws._mdpChannel = msg.channelId || null;
        ws._mdpToken = msg.token || null;
        if (msg.channelId && msg.token && !channelTokens.has(msg.channelId)) {
          channelTokens.set(msg.channelId, msg.token);
        }
        return;
      }

      if (msg.type === 'BROADCAST') {
        const payload = msg.payload || {};
        const channelId = payload.channelId;
        if (channelId && !ws._mdpChannel) ws._mdpChannel = channelId;
        if (!authed(ws, channelId)) return;

        wss.clients.forEach((client) => {
          if (client === ws || client.readyState !== OPEN) return;
          // Shared mode: by default relay only between one person's own
          // devices (anti-snoop). A channel that carries a token is an
          // EXPLICIT collaboration session -- the presenter shared the QR
          // (channel + token), so anyone presenting that token may join and
          // co-operate, across users. authed() below enforces the token match.
          if (userOf && client._mdpUser !== ws._mdpUser
              && !(channelId && channelTokens.has(channelId))) return;
          if (client._mdpChannel && channelId && client._mdpChannel !== channelId) return;
          if (!authed(client, channelId)) return;
          client.send(JSON.stringify(payload));
        });
      }
    });
  });
}

module.exports = { attachRelay };
