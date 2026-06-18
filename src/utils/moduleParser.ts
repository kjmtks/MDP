// Input kind for the per-argument settings UI (the gear button on a module
// directive). 'text' = free text (default), 'number' = numeric (integer when
// `integer`), 'boolean' = on/off, 'select' = one of `options`, 'color' = free
// pick or a theme variable, 'image' = URL/path or an `@alias` from the library.
export type ParamType = 'text' | 'number' | 'boolean' | 'select' | 'color' | 'image';

export interface ParamOption { value: string; label: string; }

export interface ModuleParam {
  name: string;
  default?: string;
  required?: boolean;
  // Settings-UI metadata (all optional; absent → free-text input).
  type?: ParamType;
  // When the declared type is wrapped in brackets — `[number]`, `[text]`,
  // `[color]`, … — the value is a LIST whose items each have `type`. The value
  // serialises in the directive as `[a, b, c]` (commas inside an item escaped
  // as `\,`); the render fn receives a real JS array (numbers for `[number]`).
  isArray?: boolean;
  label?: string;        // human label (defaults to `name`)
  description?: string;  // help text shown under the control
  options?: ParamOption[]; // for type="select"
  min?: number;          // for type="number"
  max?: number;
  step?: number;
  integer?: boolean;     // number: integer-only
}

// Which axes a manipulable module allows. '' = disabled, 'x' = horizontal only,
// 'y' = vertical only, 'xy' = both.
export type ManipAxis = '' | 'x' | 'y' | 'xy';

// Declared by a block module via `<manipulate position=".." size=".." rotation=".."
// minW=".." .. />`. Lets the module be moved/resized/rotated directly on the
// preview, with the transform persisted as percent args on its directive.
export interface ManipulateConfig {
  move: ManipAxis;
  resize: ManipAxis;
  rotate: boolean;
  minW?: number; maxW?: number;
  minH?: number; maxH?: number;
}

export interface ModuleConfig {
  name: string;
  type: 'block' | 'inline';
  description: string;
  parameters: ModuleParam[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  snippets: any[];
  // When true, this module's regions capture pointer/keys so interacting with
  // them (e.g. clicking a timer button) does not advance the slide.
  interactive: boolean;
  // Present when the module opted into on-preview manipulation (block modules).
  manipulate?: ManipulateConfig;
}

export interface ModuleData {
  config: ModuleConfig;
  render: string;
  style: string;
  script: string;
}

const PARAM_TYPES = ['text', 'number', 'boolean', 'select', 'color', 'image'];

// Parse `<parameters><param .../></parameters>` (settings-UI metadata) from any
// container element. Shared by module and effect (.mdpfx) parsing.
export const parseParamElements = (root: ParentNode): ModuleParam[] => {
  const out: ModuleParam[] = [];
  root.querySelectorAll("parameters > param").forEach(p => {
    const rawType = (p.getAttribute("type") || "").trim().toLowerCase();
    // `[number]` / `[text]` / … → an array whose items are of the inner type.
    const arrMatch = rawType.match(/^\[\s*(.*?)\s*\]$/);
    const isArray = arrMatch != null;
    const baseType = isArray ? arrMatch![1] : rawType;
    const type = (PARAM_TYPES.includes(baseType) ? baseType : undefined) as ParamType | undefined;

    // Options for type="select": child <option value=".." label=".."/> elements,
    // or an `options="a,b:Label,c"` attribute (token = value or value:label).
    let options: ParamOption[] | undefined;
    const optEls = p.querySelectorAll("option");
    if (optEls.length) {
      options = Array.from(optEls).map(o => {
        const value = o.getAttribute("value") ?? (o.textContent || '').trim();
        return { value, label: o.getAttribute("label") ?? ((o.textContent || '').trim() || value) };
      });
    } else if (p.hasAttribute("options")) {
      options = p.getAttribute("options")!.split(',').map(s => s.trim()).filter(Boolean).map(tok => {
        const ci = tok.indexOf(':');
        return ci === -1 ? { value: tok, label: tok } : { value: tok.slice(0, ci).trim(), label: tok.slice(ci + 1).trim() };
      });
    }

    const numAttr = (a: string): number | undefined => {
      const v = p.getAttribute(a);
      const n = v == null ? NaN : parseFloat(v);
      return Number.isFinite(n) ? n : undefined;
    };

    out.push({
      name: p.getAttribute("name") || "",
      default: p.hasAttribute("default") ? p.getAttribute("default")! : undefined,
      required: p.getAttribute("required") === "true",
      type,
      isArray,
      label: p.getAttribute("label") || undefined,
      description: p.getAttribute("desc") || p.getAttribute("description") || undefined,
      options,
      min: numAttr("min"), max: numAttr("max"), step: numAttr("step"),
      integer: p.getAttribute("integer") === "true",
    });
  });
  return out;
};

export const parseMdmodXml = (content: string): ModuleData | null => {
  if (!content) return null;
  const cleanContent = content.replace(/^\uFEFF/, '').trim();

  const parser = new DOMParser();
  const doc = parser.parseFromString(cleanContent, "application/xml");

  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    console.error("[MDP] XML Parse Error:", parseError.textContent);
    return null;
  }

  const root = doc.querySelector("module");
  if (!root) return null;

  const name = root.querySelector("name")?.textContent?.trim() || "";
  const type = (root.querySelector("type")?.textContent?.trim() || "block") as 'block' | 'inline';
  const description = root.querySelector("description")?.textContent?.trim() || "";
  const interactive = root.querySelector("interactive")?.textContent?.trim() === "true";

  // Manipulation capability (block or inline modules). Axis tokens: 'x'|'y'|'xy';
  // 'true'/'both' => 'xy'; '' / 'false' / 'none' => disabled.
  let manipulate: ManipulateConfig | undefined;
  const manipEl = root.querySelector("manipulate");
  if (manipEl) {
    const axis = (v: string | null): ManipAxis => {
      const s = (v || '').trim().toLowerCase();
      if (!s || s === 'false' || s === 'none') return '';
      if (s === 'true' || s === 'both') return 'xy';
      const hasX = s.includes('x'), hasY = s.includes('y');
      return hasX && hasY ? 'xy' : hasX ? 'x' : hasY ? 'y' : '';
    };
    // XML attributes are case-sensitive; accept both `minW` and `minw`.
    const attr = (a: string) => manipEl.getAttribute(a) ?? manipEl.getAttribute(a.toLowerCase());
    const num = (a: string): number | undefined => {
      const raw = attr(a);
      const n = raw == null ? NaN : parseFloat(raw);
      return Number.isFinite(n) ? n : undefined;
    };
    const move = axis(attr('position'));
    const resize = axis(attr('size'));
    const rotate = (attr('rotation') || '').trim().toLowerCase() === 'true';
    if (move || resize || rotate) {
      manipulate = { move, resize, rotate, minW: num('minW'), maxW: num('maxW'), minH: num('minH'), maxH: num('maxH') };
    }
  }

  const parameters = parseParamElements(root);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snippets: any[] = [];
  root.querySelectorAll("snippets > snippet").forEach(s => {
    snippets.push({
      category: s.querySelector("category")?.textContent?.trim() || "Custom Modules",
      label: s.querySelector("label")?.textContent?.trim() || name,
      text: s.querySelector("text")?.textContent?.trim() || "",
      description: s.querySelector("description")?.textContent?.trim() || "",
      isModule: true
    });
  });

  return {
    config: { name, type, description, parameters, snippets, interactive, manipulate },
    render: root.querySelector("render")?.textContent?.trim() || "return '';",
    style: root.querySelector("style")?.textContent?.trim() || "",
    script: root.querySelector("script")?.textContent?.trim() || ""
  };
};