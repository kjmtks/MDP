import { parseMdmodXml, type ModuleData } from '../../utils/moduleParser';
import { moduleSyncBus } from './moduleSyncBus';

export const loadedModules: Record<string, ModuleData> = {};

export const clearAllModules = () => {
  Object.keys(loadedModules).forEach(name => {
    const styleId = `mdp-module-style-${name}`;
    const styleTag = document.getElementById(styleId);
    if (styleTag) {
      styleTag.remove();
    }
    delete loadedModules[name];
  });
};

export const registerModule = (fileContent: string) => {
  if (!fileContent) return null;
  const moduleData = parseMdmodXml(fileContent);
  if (!moduleData || !moduleData.config.name) return null;

  const { name } = moduleData.config;
  loadedModules[name] = moduleData;

  if (moduleData.style) {
    const styleId = `mdp-module-style-${name}`;
    let styleTag = document.getElementById(styleId);
    if (!styleTag) {
      styleTag = document.createElement('style');
      styleTag.id = styleId;
      document.head.appendChild(styleTag);
    }
    styleTag.textContent = moduleData.style;
  }

  return moduleData;
};

// Register a module from an already-parsed ModuleData (used by mirror surfaces
// such as the presenter/remote windows, which receive definitions over sync
// rather than reading the workspace files themselves).
export const registerParsedModule = (moduleData: ModuleData) => {
  if (!moduleData || !moduleData.config?.name) return null;
  const { name } = moduleData.config;
  loadedModules[name] = moduleData;
  if (moduleData.style) {
    const styleId = `mdp-module-style-${name}`;
    let styleTag = document.getElementById(styleId);
    if (!styleTag) {
      styleTag = document.createElement('style');
      styleTag.id = styleId;
      document.head.appendChild(styleTag);
    }
    styleTag.textContent = moduleData.style;
  }
  return moduleData;
};

export const getAllModuleSnippets = () => {
  return Object.values(loadedModules).flatMap(mod => mod.config.snippets || []);
};

/* eslint-disable @typescript-eslint/no-explicit-any */
// Per-instance context handed to a module's `init(el, ctx)`.
export interface ModuleScriptContext {
  id: string;                       // unique runtime id for this instance
  root: HTMLElement;                // the instance's root element
  presenting: boolean;             // true in the fullscreen slideshow (vs editor preview)
  onCleanup: (fn: () => void) => void;  // register teardown (e.g. clearInterval)
  setInteractive: (on: boolean) => void; // toggle nav-suppression for this instance
  // --- cross-surface state sync ---
  syncId: string;                   // deterministic id shared by every surface
  role: 'owner' | 'mirror';         // owner runs logic; mirrors only display
  shared: any;                      // snapshot of shared state at init time
  getShared: () => any;             // live shared state
  setShared: (patch: any) => void;  // owner: merge + broadcast shared state
  onShared: (cb: (state: any) => void) => void;    // display updates from shared state
  sendAction: (type: string, payload?: any) => void;  // dispatch a user action
  onAction: (cb: (type: string, payload: any) => void) => void; // owner: handle actions
}

let instanceCounter = 0;

/**
 * Run module `<script>`s against a freshly-rendered slide container and return
 * a teardown function (call it when the slide unmounts/changes).
 *
 * Two contracts (the module's `<script>` exports a default):
 *  - Legacy: `export default function(elements) { ... }` — called once with the
 *    NodeList of instances; may return a cleanup function.
 *  - Per-instance (interactive): `export default { init(el, ctx), destroy?(el, ctx) }`
 *    — `init` runs once per instance with a context (unique id, onCleanup,
 *    setInteractive, presenting). The module's JS lives once in its definition
 *    and is shared by every embedded instance (it is not duplicated per use).
 */
export const executeModuleScripts = (
  container: HTMLElement,
  opts: { presenting?: boolean; slideIndex?: number; role?: 'owner' | 'mirror' } = {},
): (() => void) => {
  if (!container) return () => {};
  const cleanups: Array<() => void> = [];
  const slideIndex = opts.slideIndex ?? 0;
  const role: 'owner' | 'mirror' = opts.role || 'owner';

  Object.values(loadedModules).forEach(mod => {
    const { name, interactive } = mod.config;
    const elements = Array.from(container.querySelectorAll<HTMLElement>(`.mdp-mod-${name}`));
    if (elements.length === 0) return;

    elements.forEach(el => {
      // Interactive modules suppress slide navigation within their region.
      if (interactive) el.classList.add('mdp-interactive');
      // Give each instance a stable-per-render unique id.
      if (!el.dataset.mdpId) el.dataset.mdpId = `${name}-${++instanceCounter}`;
    });

    if (!mod.script || !mod.script.trim()) return;

    let exported: any;
    try {
      const scriptCode = mod.script
        .replace(/export\s+default\s+function\s*[a-zA-Z0-9_]*\s*\(/, 'return function(')
        .replace(/export\s+default\s+/, 'return ');
      exported = new Function(scriptCode)();
    } catch (e) {
      console.error(`[MDP] Module Script Error (${name}):`, e);
      return;
    }

    const makeCtx = (el: HTMLElement, occ: number): ModuleScriptContext => {
      // Deterministic across surfaces: same slide html → same module order.
      const syncId = `${slideIndex}:${name}:${occ}`;
      return {
        id: el.dataset.mdpId || name,
        root: el,
        presenting: !!opts.presenting,
        onCleanup: (fn) => { if (typeof fn === 'function') cleanups.push(fn); },
        setInteractive: (on) => el.classList.toggle('mdp-interactive', on !== false),
        syncId,
        role,
        shared: moduleSyncBus.getState(syncId),
        getShared: () => moduleSyncBus.getState(syncId),
        setShared: (patch) => moduleSyncBus.setState(syncId, patch),
        onShared: (cb) => { cleanups.push(moduleSyncBus.onState(syncId, cb)); },
        sendAction: (type, payload) => moduleSyncBus.dispatchAction(syncId, type, payload),
        onAction: (cb) => { cleanups.push(moduleSyncBus.onAction(syncId, cb)); },
      };
    };

    try {
      if (exported && typeof exported === 'object' && typeof exported.init === 'function') {
        elements.forEach((el, i) => {
          const ctx = makeCtx(el, i);
          const ret = exported.init(el, ctx);
          el.classList.add('mdp-mod-inited');
          if (typeof ret === 'function') cleanups.push(ret);
          if (typeof exported.destroy === 'function') cleanups.push(() => exported.destroy(el, ctx));
        });
      } else if (typeof exported === 'function') {
        const ret = exported(elements);
        if (typeof ret === 'function') cleanups.push(ret);
      }
    } catch (e) {
      console.error(`[MDP] Module Script Error (${name}):`, e);
    }
  });

  return () => {
    cleanups.forEach(fn => { try { fn(); } catch (e) { console.error('[MDP] Module cleanup error:', e); } });
  };
};