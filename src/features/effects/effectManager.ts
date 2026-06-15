import { parseMdpfxXml, type EffectData } from '../../utils/effectParser';

// Registry of effects loaded from the `.effect` folder, keyed by effect name.
export const loadedEffects: Record<string, EffectData> = {};

// Lazily-compiled JS hooks (`export default { enter, emphasis, leave }`) per effect.
export interface EffectHooks {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  enter?: (el: HTMLElement, ctx: EffectContext) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  emphasis?: (el: HTMLElement, ctx: EffectContext) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  leave?: (el: HTMLElement, ctx: EffectContext) => any;
}

export interface EffectContext {
  duration: number;
  easing: string;
  direction: 'forward' | 'back';
  args: Record<string, string>;
}

const compiledHooks: Record<string, EffectHooks | null> = {};

export const clearAllEffects = () => {
  Object.keys(loadedEffects).forEach((name) => {
    document.getElementById(`mdp-effect-style-${name}`)?.remove();
    delete loadedEffects[name];
    delete compiledHooks[name];
  });
};

export const registerEffect = (fileContent: string): EffectData | null => {
  if (!fileContent) return null;
  const effectData = parseMdpfxXml(fileContent);
  if (!effectData || !effectData.config.name) return null;

  const { name } = effectData.config;
  loadedEffects[name] = effectData;
  delete compiledHooks[name];

  if (effectData.style) {
    const styleId = `mdp-effect-style-${name}`;
    let styleTag = document.getElementById(styleId);
    if (!styleTag) {
      styleTag = document.createElement('style');
      styleTag.id = styleId;
      document.head.appendChild(styleTag);
    }
    styleTag.textContent = effectData.style;
  }

  return effectData;
};

// Register an effect from an already-parsed EffectData (used by mirror surfaces
// such as the presenter, which receive effect definitions over sync rather than
// reading the `.effect` folder themselves). Mirrors registerEffect minus parsing.
export const registerParsedEffect = (effectData: EffectData): EffectData | null => {
  if (!effectData || !effectData.config?.name) return null;
  const { name } = effectData.config;
  loadedEffects[name] = effectData;
  delete compiledHooks[name];
  if (effectData.style) {
    const styleId = `mdp-effect-style-${name}`;
    let styleTag = document.getElementById(styleId);
    if (!styleTag) {
      styleTag = document.createElement('style');
      styleTag.id = styleId;
      document.head.appendChild(styleTag);
    }
    styleTag.textContent = effectData.style;
  }
  return effectData;
};

export const getEffect = (name: string): EffectData | undefined => loadedEffects[name];

export const getAllEffectSnippets = () =>
  Object.values(loadedEffects).flatMap((fx) => fx.config.snippets || []);

// Resolve a numeric parameter default (duration) / string default (easing).
export const effectParamDefault = (name: string, param: string): string | undefined =>
  loadedEffects[name]?.config.parameters.find((p) => p.name === param)?.default;

// Compile and cache an effect's optional JS hooks. Returns null if the effect
// has no usable `<script>` (callers then fall back to the CSS phase classes).
export const getEffectHooks = (name: string): EffectHooks | null => {
  if (name in compiledHooks) return compiledHooks[name];
  const fx = loadedEffects[name];
  if (!fx || !fx.script || !fx.script.trim()) {
    compiledHooks[name] = null;
    return null;
  }
  try {
    const code = fx.script
      .replace(/export\s+default\s+/, 'return ');
    const hooks = new Function(code)() as EffectHooks;
    compiledHooks[name] = hooks && typeof hooks === 'object' ? hooks : null;
  } catch (e) {
    console.error(`[MDP] Effect Script Error (${name}):`, e);
    compiledHooks[name] = null;
  }
  return compiledHooks[name];
};
