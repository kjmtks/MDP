import { useEffect, useRef, useCallback } from 'react';
import { isElectron } from '../../../api/apiClient';

declare const __API_PORT__: string;

export interface ImageSyncPayload {
  index: number;
  nextIndex: number;
  slideCount: number;
  slideSize: { width: number; height: number };
  curImage: string | null;
  nextImage: string | null;
  allDrawings?: Record<number, unknown[]>;
  isOverview?: boolean;
  channelId?: string;
}

export interface OverviewGridPayload {
  images: (string | null)[];
  slideSize: { width: number; height: number };
  index: number;
}

export type SyncMessage =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | { type: 'SYNC_STATE'; payload: any; channelId?: string }
  | { type: 'SYNC_STATE_IMAGE'; payload: ImageSyncPayload; channelId?: string }
  | { type: 'NAV'; direction: number; channelId: string }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | { type: 'DRAW_STROKE'; pageIndex: number; stroke: any; channelId?: string }
  | { type: 'CLEAR_DRAWING'; pageIndex: number; channelId?: string }
  | { type: 'REQUEST_SYNC'; channelId: string }
  | { type: 'UNDO'; pageIndex: number; channelId?: string }
  | { type: 'REDO'; pageIndex: number; channelId?: string }
  | { type: 'ADD_BLANK_SLIDE'; pageIndex: number; channelId?: string }
  | { type: 'UPDATE_STROKES'; pageIndex: number; indices: number[]; dx: number; dy: number; channelId?: string }
  | { type: 'UPDATE_NOTE'; pageIndex: number; note: string; channelId?: string }
  | { type: 'TOGGLE_OVERVIEW'; channelId?: string }
  | { type: 'SELECT_SLIDE'; index: number; channelId?: string }
  | { type: 'OVERVIEW_GRID'; payload: OverviewGridPayload; channelId?: string }
  // Interactive-module state sync (shared state + actions across surfaces).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | { type: 'MODULE_STATE'; syncId: string; state: any; channelId?: string }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | { type: 'MODULE_ACTION'; syncId: string; actionType: string; payload?: any; channelId?: string };

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export type SendTarget = 'all' | 'local' | 'remote';

function computeWsUrl(electronWsPort?: number | null): string | null {
  if (isElectron()) {
    return electronWsPort ? `ws://127.0.0.1:${electronWsPort}` : null;
  }
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsHost = (window.location.port === '5173' || window.location.port === '4173')
    ? `localhost:${typeof __API_PORT__ !== 'undefined' ? __API_PORT__ : '3000'}`
    : window.location.host;
  return `${wsProtocol}//${wsHost}`;
}

export const useSync = (
  channelId: string | null,
  token: string | null,
  onMessage: (msg: SyncMessage) => void,
  electronWsPort?: number | null,
) => {
  const bcRef = useRef<BroadcastChannel | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const onMessageRef = useRef(onMessage);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    if (!channelId) return;

    const bc = new BroadcastChannel(`mdp-sync-${channelId}`);
    bcRef.current = bc;
    bc.onmessage = (event) => {
      // eslint-disable-next-line no-empty
      try { onMessageRef.current(event.data); } catch {}
    };
    bc.postMessage({ type: 'REQUEST_SYNC', channelId });

    const wsUrl = computeWsUrl(electronWsPort);
    let closedByUs = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (!wsUrl) return;
      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        scheduleReconnect();
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        attempt = 0;
        try {
          ws.send(JSON.stringify({ type: 'JOIN', channelId, token: token || undefined }));
          ws.send(JSON.stringify({ type: 'BROADCAST', payload: { type: 'REQUEST_SYNC', channelId } }));
        // eslint-disable-next-line no-empty
        } catch {}
      };
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.channelId === channelId) onMessageRef.current(data);
        // eslint-disable-next-line no-empty
        } catch {}
      };
      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        if (!closedByUs) scheduleReconnect();
      };
      ws.onerror = () => {
        // eslint-disable-next-line no-empty
        try { ws.close(); } catch {}
      };
    };

    const scheduleReconnect = () => {
      if (closedByUs) return;
      const delay = Math.min(1000 * 2 ** attempt, 10000);
      attempt++;
      retryTimer = setTimeout(connect, delay);
    };

    connect();

    return () => {
      closedByUs = true;
      if (retryTimer) clearTimeout(retryTimer);
      bc.close();
      bcRef.current = null;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [channelId, token, electronWsPort]);

  const send = useCallback((msg: SyncMessage, target: SendTarget = 'all') => {
    const messageToSend = { ...msg, channelId: channelId || undefined };
    if (target !== 'remote' && bcRef.current) {
      // eslint-disable-next-line no-empty
      try { bcRef.current.postMessage(messageToSend); } catch {}
    }
    if (target !== 'local' && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify({ type: 'BROADCAST', payload: messageToSend }));
      // eslint-disable-next-line no-empty
      } catch {}
    }
  }, [channelId]);

  return { send, status: channelId ? 'connected' : 'disconnected' as ConnectionStatus };
};