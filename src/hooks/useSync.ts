import { useEffect, useRef, useCallback } from 'react';

export type SyncMessage = 
  | { type: 'NAV'; direction: number; channelId: string }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | { type: 'SYNC_STATE'; payload: any; channelId: string }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | { type: 'DRAW_STROKE'; stroke: any; pageIndex: number; channelId: string }
  | { type: 'CLEAR_DRAWING'; pageIndex: number; channelId: string }
  | { type: 'REQUEST_SYNC'; channelId: string };

export const useSync = (
  channelId: string | null, 
  onMessage: (msg: SyncMessage) => void
) => {
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!channelId) return;
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsHost = window.location.port === '5173' 
      ? `${window.location.hostname}:3000` 
      : window.location.host;
    const ws = new WebSocket(`${wsProtocol}//${wsHost}`);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log(`WS Connected (Channel: ${channelId})`);
      if (ws.readyState === WebSocket.OPEN) {
        const req: SyncMessage = { type: 'REQUEST_SYNC', channelId };
        ws.send(JSON.stringify({ type: 'BROADCAST', payload: req }));
      }
    };

    ws.onmessage = (event) => {
      if (event.data === 'file-change') return;
      try {
        const msg = JSON.parse(event.data) as SyncMessage;
        if (msg.channelId === channelId) {
          onMessage(msg);
        }
      } catch {
        // ignore
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [channelId, onMessage]);

  const send = useCallback((msg: SyncMessage) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const payload = JSON.stringify({
        type: 'BROADCAST',
        payload: msg
      });
      wsRef.current.send(payload);
    }
  }, []);

  return { send };
};