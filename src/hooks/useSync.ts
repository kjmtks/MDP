import { useEffect, useRef, useCallback, useState } from 'react';

export type SyncMessage = 
  | { type: 'NAV'; direction: number; channelId: string }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | { type: 'SYNC_STATE'; payload: any; channelId: string }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | { type: 'DRAW_STROKE'; stroke: any; pageIndex: number; channelId: string }
  | { type: 'CLEAR_DRAWING'; pageIndex: number; channelId: string }
  | { type: 'REQUEST_SYNC'; channelId: string }
  | { type: 'UNDO'; pageIndex: number; channelId: string }
  | { type: 'REDO'; pageIndex: number; channelId: string }
  | { type: 'ADD_BLANK_SLIDE'; pageIndex: number; channelId: string };

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export const useSync = (
  channelId: string | null, 
  onMessage: (msg: SyncMessage) => void
) => {
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  
  const onMessageRef = useRef(onMessage);
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  const [prevChannelId, setPrevChannelId] = useState<string | null>(channelId);

  if (channelId !== prevChannelId) {
    setPrevChannelId(channelId);
    setStatus(channelId ? 'connecting' : 'disconnected');
  }

  useEffect(() => {
    if (!channelId) return; 

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let wsUrl = '';
    if (window.location.port === '5173') {
      wsUrl = `${protocol}//${window.location.host}/ws`;
    } else {
      wsUrl = `${protocol}//${window.location.host}`;
    }
    
    if (wsRef.current) {
      wsRef.current.close();
    }

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log(`WS Connected (Channel: ${channelId})`);
      setStatus('connected');
      
      if (ws.readyState === WebSocket.OPEN) {
        const req: SyncMessage = { type: 'REQUEST_SYNC', channelId };
        ws.send(JSON.stringify({ type: 'BROADCAST', payload: req }));
      }
    };

    ws.onclose = (event) => {
      console.log('WS Closed', event.code);
      setStatus('disconnected');
    };

    ws.onerror = (error) => {
      console.error('WS Error', error);
      setStatus('error');
    };

    ws.onmessage = (event) => {
      if (event.data === 'file-change') return;
      try {
        const msg = JSON.parse(event.data) as SyncMessage;
        if (msg.channelId === channelId) {
          onMessageRef.current(msg);
        }
      } catch {
        // ignore
      }
    };

    return () => {
      if (wsRef.current === ws) {
          ws.onclose = null;
          ws.onerror = null;
          ws.onmessage = null;
          ws.onopen = null;
          ws.close();
          wsRef.current = null;
      }
    };
  }, [channelId]); 

  const send = useCallback((msg: SyncMessage) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        const payload = JSON.stringify({
          type: 'BROADCAST',
          payload: msg
        });
        wsRef.current.send(payload);
      } catch (e) {
        console.error("WS Send Error:", e);
      }
    } else {
      console.warn("WS not ready, message dropped:", msg.type);
    }
  }, []);

  return { send, status };
};