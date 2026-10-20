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
type ResetCb = (phase: 'down' | 'up') => void;

interface BusMsg { type: 'MODULE_STATE' | 'MODULE_ACTION'; syncId: string; state?: any; actionType?: string; payload?: any; }

let sender: ((msg: BusMsg) => void) | null = null;
const states: Record<string, any> = {};
const stateListeners: Record<string, Set<StateCb>> = {};
const actionListeners: Record<string, Set<ActionCb>> = {};
const resetListeners = new Set<ResetCb>();
// The syncId of the MODULE_STATE that drops EVERY state (a show starts). An older
// page just keeps a state nobody reads under it.
const ALL = '*';

const notifyState = (syncId: string) => {
  stateListeners[syncId]?.forEach((l) => { try { l(states[syncId]); } catch (e) { console.error('[MDP] module onState error', e); } });
};

// Every module starts again from its initial state: the surfaces stop their module
// scripts first (a teardown may still write a state), the states go, then the
// scripts run again — an owner finds no state and sets its initial one (a timer its
// full time), a mirror shows its default until the owner's arrives.
const dropAll = (broadcast: boolean) => {
  const phase = (p: 'down' | 'up') => resetListeners.forEach((l) => { try { l(p); } catch (e) { console.error('[MDP] module reset error', e); } });
  phase('down');
  Object.keys(states).forEach((id) => { delete states[id]; });
  // Before the owners' new states, which arrive after it in order.
  if (broadcast) sender?.({ type: 'MODULE_STATE', syncId: ALL, state: null });
  phase('up');
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

  /** A show starts — the slideshow, the narrated auto-play (Start / Restart / Play
   *  again), the presenter view or the output window opened, the presenter's
   *  stopwatch starting a new run: every module back to its initial state, in this
   *  window and every other one. (A rehearsal in the preview left a timer at 0:00,
   *  and `[[emit-wait: cmd:x start]]` then went on at once.) Within a show the
   *  states are kept. */
  resetAll() { dropAll(true); },

  /** A surface running module scripts: `down` = stop them, `up` = run them again. */
  onReset(cb: ResetCb): () => void {
    resetListeners.add(cb);
    return () => { resetListeners.delete(cb); };
  },

  // --- inbound from the sync channel (called by the page) ---
  receiveState(syncId: string, state: any) {
    if (syncId === ALL) { dropAll(false); return; }
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
