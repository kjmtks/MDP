export interface ModuleParam {
  name: string;
  default?: string;
  required?: boolean;
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

  // Manipulation capability (block modules only). Axis tokens: 'x'|'y'|'xy';
  // 'true'/'both' => 'xy'; '' / 'false' / 'none' => disabled.
  let manipulate: ManipulateConfig | undefined;
  const manipEl = root.querySelector("manipulate");
  if (manipEl && type === 'block') {
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

  const parameters: ModuleParam[] = [];
  root.querySelectorAll("parameters > param").forEach(p => {
    parameters.push({
      name: p.getAttribute("name") || "",
      default: p.hasAttribute("default") ? p.getAttribute("default")! : undefined,
      required: p.getAttribute("required") === "true"
    });
  });

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