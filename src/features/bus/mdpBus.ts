// App-wide topic-based event bus ("mdpBus"): loose-coupling messages between
// modules, the narrated auto-play, and app surfaces. It COMPLEMENTS
// moduleSyncBus (which mirrors a module instance's shared STATE across
// owner/mirror surfaces): mdpBus carries free-form, addressable EVENTS —
// "play example ex1", "narration: pause", "timer finished".
//
// Topics are plain strings. Conventions (documented, not enforced):
//   cmd:<tag>        command a module instance (its `tag:` directive argument)
//   narration:*      control the narrated auto-play (pause / resume / skip)
//   module:<name>:*  events announced by modules
// A subscription pattern ending in '*' is a prefix match.
//
// Events cross surfaces (editor/slideshow/presenter/remote) via the
// presentation sync channel as BUS_EVENT messages, exactly ONE hop: events
// received from the channel are delivered locally but never re-forwarded.
//
// request() is the generic "do it, then tell me" primitive: it stamps a
// `replyTo` token into the payload, and resolves when anyone emits that token
// (the script marker [[emit-wait: …]] and ctx.onCommand's `done` use this).
// It RESOLVES with `{ timeout: true }` on timeout — callers keep flowing.

export interface BusMeta { topic: string; remote: boolean }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BusPayload = any;
export type BusCallback = (payload: BusPayload, meta: BusMeta) => void;
export interface BusEventMsg { type: 'BUS_EVENT'; topic: string; payload?: BusPayload }

let sender: ((msg: BusEventMsg) => void) | null = null;
const subs = new Set<{ pattern: string; cb: BusCallback }>();

function matches(pattern: string, topic: string): boolean {
  return pattern.endsWith('*') ? topic.startsWith(pattern.slice(0, -1)) : topic === pattern;
}

function deliver(topic: string, payload: BusPayload, remote: boolean): void {
  const meta: BusMeta = { topic, remote };
  [...subs].forEach((s) => {
    if (!matches(s.pattern, topic)) return;
    try { s.cb(payload, meta); } catch (e) { console.error('[MDP] mdpBus handler error', e); }
  });
}

export const mdpBus = {
  /** Wire the cross-surface transport (the presentation sync channel). */
  setSender(fn: ((msg: BusEventMsg) => void) | null): void { sender = fn; },

  /** Publish an event. scope 'local' keeps it in this window only. */
  emit(topic: string, payload?: BusPayload, opts?: { scope?: 'all' | 'local' }): void {
    if (!topic) return;
    deliver(topic, payload, false);
    if ((opts?.scope ?? 'all') !== 'local') {
      try { sender?.({ type: 'BUS_EVENT', topic, payload }); } catch { /* ignore */ }
    }
  },

  /** Subscribe. Returns the unsubscribe function — ALWAYS keep and call it. */
  on(topic: string, cb: BusCallback): () => void {
    const sub = { pattern: topic, cb };
    subs.add(sub);
    return () => { subs.delete(sub); };
  },

  /** Emit with a replyTo token; resolve on the reply (or `{timeout:true}`). */
  request(topic: string, payload?: Record<string, unknown>, opts?: { timeoutMs?: number }): Promise<BusPayload> {
    const timeoutMs = Math.max(500, opts?.timeoutMs ?? 30000);
    const replyTo = `reply:${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (v: BusPayload) => { if (settled) return; settled = true; off(); window.clearTimeout(id); resolve(v); };
      const off = mdpBus.on(replyTo, (p) => finish(p ?? {}));
      const id = window.setTimeout(() => finish({ timeout: true }), timeoutMs);
      mdpBus.emit(topic, { ...(payload || {}), replyTo });
    });
  },

  /** Deliver an event received from the sync channel (no re-forwarding). */
  receiveRemote(topic: string, payload: BusPayload): void {
    deliver(topic, payload, true);
  },
};

/** Expose as `window.mdpBus` for module <script>s (called once from main.tsx). */
export function installMdpBus(): void {
  (window as unknown as { mdpBus?: typeof mdpBus }).mdpBus = mdpBus;
}
