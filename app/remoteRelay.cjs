'use strict';

const OPEN = 1;

function attachRelay(wss) {
  const channelTokens = new Map();

  // A channel with a registered token only relays to sockets presenting that token.
  // Channels that never present a token stay open (legacy / web behavior).
  const authed = (ws, channelId) => {
    const required = channelId ? channelTokens.get(channelId) : undefined;
    return !required || ws._mdpToken === required;
  };

  wss.on('connection', (ws) => {
    ws._mdpChannel = null;
    ws._mdpToken = null;

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
          if (client._mdpChannel && channelId && client._mdpChannel !== channelId) return;
          if (!authed(client, channelId)) return;
          client.send(JSON.stringify(payload));
        });
      }
    });
  });
}

module.exports = { attachRelay };
