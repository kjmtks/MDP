import { WEB_BASE } from '../../../api/base';
import { useEffect, useRef, useCallback, useState } from 'react';
import { isElectron } from '../../../api/apiClient';
import type { SlideLinkRect } from '../capture/captureTypes';
import type { RehearsalRun } from '../../rehearsal/rehearsalStore';
import type { RecordingState } from '../../recording/slideRecorder';
import type { RemoteDeck, RemotePos } from '../liveRemote';
import type { LayoutReport, LayoutResult } from '../layoutCheck';

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
  // Clickable hyperlink hotspots for the CURRENT slide image (fractions of size).
  links?: SlideLinkRect[];
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
  // App-wide event bus (mdpBus) crossing surfaces — one hop, never re-forwarded.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | { type: 'BUS_EVENT'; topic: string; payload?: any; channelId?: string }
  | { type: 'SYNC_STATE_IMAGE'; payload: ImageSyncPayload; channelId?: string }
  // `whole`: to the next / previous slide itself, skipping its builds, emphases and
  // events (↑ / ↓) — else through the script's steps first (→ / ←).
  | { type: 'NAV'; direction: number; whole?: boolean; channelId: string }
  // A chip clicked in the presenter's script (mirror → host): → goes on right after
  // it. `chip`: its place among the pane's chips (presentMarkers).
  | { type: 'CUE_AT'; slide: number; chip: number; channelId?: string }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | { type: 'DRAW_STROKE'; pageIndex: number; stroke: any; channelId?: string }
  | { type: 'CLEAR_DRAWING'; pageIndex: number; channelId?: string }
  | { type: 'REQUEST_SYNC'; channelId: string }
  | { type: 'UNDO'; pageIndex: number; channelId?: string }
  | { type: 'REDO'; pageIndex: number; channelId?: string }
  | { type: 'ADD_BLANK_SLIDE'; pageIndex: number; channelId?: string }
  | { type: 'UPDATE_STROKES'; pageIndex: number; indices: number[]; dx: number; dy: number; channelId?: string }
  | { type: 'UPDATE_NOTE'; pageIndex: number; note: string; channelId?: string }
  // Presenter-side edit of the read-aloud `@script` blocks of a slide. One entry
  // per source `<!-- @script: … -->` block, in document order (raw text, markers kept).
  | { type: 'UPDATE_SCRIPT'; pageIndex: number; scripts: string[]; channelId?: string }
  // A rehearsal run measured by the presenter tool's stopwatch (mirror→host): the
  // host owns the deck path and writes it to the deck's rehearsal sidecar. Sent
  // every time the timer pauses (same run id → upsert) and on reset/close.
  | { type: 'REHEARSAL_RUN'; run: RehearsalRun; channelId?: string }
  | { type: 'TOGGLE_OVERVIEW'; channelId?: string }
  | { type: 'SELECT_SLIDE'; index: number; channelId?: string }
  // Hyperlink navigation (mirror→host): jump to a link target / move through history.
  | { type: 'LINK_NAV'; target: string; channelId?: string }
  | { type: 'HISTORY_NAV'; dir: 1 | -1; channelId?: string }
  | { type: 'OVERVIEW_GRID'; payload: OverviewGridPayload; channelId?: string }
  // The live remote (liveRemote.ts): the deck once per change, the position per
  // page turn (host → remote devices).
  | { type: 'REMOTE_DECK'; payload: RemoteDeck; channelId?: string }
  | { type: 'REMOTE_POS'; payload: RemotePos; channelId?: string }
  // Does the device break the lines where the host does? (layoutCheck.ts)
  | { type: 'LAYOUT_REPORT'; payload: LayoutReport; channelId?: string }
  | { type: 'LAYOUT_RESULT'; payload: LayoutResult; channelId?: string }
  // Interactive-module state sync (shared state + actions across surfaces).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | { type: 'MODULE_STATE'; syncId: string; state: any; channelId?: string }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | { type: 'MODULE_ACTION'; syncId: string; actionType: string; payload?: any; channelId?: string }
  // Recording the live presentation: the presenter view asks (mirror→host; the host
  // owns the deck path and records), the host reports its recorder's state back.
  | { type: 'REC_COMMAND'; action: 'start' | 'stop'; micId?: string; channelId?: string }
  | { type: 'REC_STATE'; state: RecordingState; channelId?: string };

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
  return `${wsProtocol}//${wsHost}${WEB_BASE}/`;
}

// A window on this machine gets every message TWICE when it has both ways open —
// the BroadcastChannel and the WebSocket relay (the web build always; the desktop
// app while its remote server runs): the relay passes a message to every other
// socket of the channel, the windows that already had it by the BroadcastChannel
// among them. So every message carries an id (`_mid`) and a receiver acts on an id
// once — a "next" is one step, an [[emit]] chip one command, a stroke one stroke.
// (A message without an id — from an older page — is acted on as before.)
const newMessageId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
function messageIds() {
  const set = new Set<string>();
  const order: string[] = [];
  const add = (id: string) => {
    set.add(id);
    order.push(id);
    if (order.length > 1000) set.delete(order.shift()!);   // both copies come within moments
  };
  return {
    /** True the first time this message is seen (or when it has no id). */
    first(msg: unknown): boolean {
      const id = msg && typeof (msg as { _mid?: unknown })._mid === 'string' ? (msg as { _mid: string })._mid : '';
      if (!id) return true;
      if (set.has(id)) return false;
      add(id);
      return true;
    },
    /** Our own message: never acted on if it comes back. */
    mark: add,
  };
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
  const [seen] = useState(messageIds);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    if (!channelId) return;

    const bc = new BroadcastChannel(`mdp-sync-${channelId}`);
    bcRef.current = bc;
    bc.onmessage = (event) => {
      if (!seen.first(event.data)) return;
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
          if (data.channelId === channelId && seen.first(data)) onMessageRef.current(data);
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
  }, [channelId, token, electronWsPort, seen]);

  const send = useCallback((msg: SyncMessage, target: SendTarget = 'all') => {
    const _mid = newMessageId();
    seen.mark(_mid);
    const messageToSend = { ...msg, channelId: channelId || undefined, _mid };
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
  }, [channelId, seen]);

  return { send, status: channelId ? 'connected' : 'disconnected' as ConnectionStatus };
};