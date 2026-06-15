// Per-window hub that lets interactive module instances share state and route
// actions across surfaces (main slideshow / presenter / remote) via the sync
// channel. The page wires a sender (sync.send) and forwards inbound
// MODULE_STATE / MODULE_ACTION messages here.
//
// Model: exactly one instance per syncId is the "owner" (runs the logic and
// calls setState). Every instance (owner + mirrors) subscribes to onState to
// render, and any instance can dispatch an action — owners process it.

/* eslint-disable @typescript-eslint/no-explicit-any */
type StateCb = (state: any) => void;
type ActionCb = (type: string, payload: any) => void;

interface BusMsg { type: 'MODULE_STATE' | 'MODULE_ACTION'; syncId: string; state?: any; actionType?: string; payload?: any; }

let sender: ((msg: BusMsg) => void) | null = null;
const states: Record<string, any> = {};
const stateListeners: Record<string, Set<StateCb>> = {};
const actionListeners: Record<string, Set<ActionCb>> = {};

const notifyState = (syncId: string) => {
  stateListeners[syncId]?.forEach((l) => { try { l(states[syncId]); } catch (e) { console.error('[MDP] module onState error', e); } });
};

export const moduleSyncBus = {
  /** Wire the channel sender (msg → sync.send(msg, 'all')). */
  setSender(fn: ((msg: BusMsg) => void) | null) { sender = fn; },

  getState(syncId: string) { return states[syncId]; },

  /** Owner: merge a patch into shared state, notify local views, broadcast. */
  setState(syncId: string, patch: any) {
    states[syncId] = { ...(states[syncId] || {}), ...patch };
    notifyState(syncId);
    sender?.({ type: 'MODULE_STATE', syncId, state: states[syncId] });
  },

  onState(syncId: string, cb: StateCb): () => void {
    (stateListeners[syncId] ||= new Set()).add(cb);
    return () => { stateListeners[syncId]?.delete(cb); };
  },

  /** Any surface: dispatch an action. Broadcast for remote owners + run locally. */
  dispatchAction(syncId: string, type: string, payload?: any) {
    sender?.({ type: 'MODULE_ACTION', syncId, actionType: type, payload });
    actionListeners[syncId]?.forEach((l) => { try { l(type, payload); } catch (e) { console.error('[MDP] module onAction error', e); } });
  },

  onAction(syncId: string, cb: ActionCb): () => void {
    (actionListeners[syncId] ||= new Set()).add(cb);
    return () => { actionListeners[syncId]?.delete(cb); };
  },

  // --- inbound from the sync channel (called by the page) ---
  receiveState(syncId: string, state: any) {
    states[syncId] = state;
    notifyState(syncId);
  },
  receiveAction(syncId: string, type: string, payload?: any) {
    actionListeners[syncId]?.forEach((l) => { try { l(type, payload); } catch (e) { console.error('[MDP] module onAction error', e); } });
  },

  /** Re-broadcast all known states (e.g. when a new mirror requests sync). */
  rebroadcastAll() {
    Object.keys(states).forEach((syncId) => sender?.({ type: 'MODULE_STATE', syncId, state: states[syncId] }));
  },
};
