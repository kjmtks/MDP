export interface ModuleParam {
  name: string;
  default?: string;
  required?: boolean;
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
    config: { name, type, description, parameters, snippets, interactive },
    render: root.querySelector("render")?.textContent?.trim() || "return '';",
    style: root.querySelector("style")?.textContent?.trim() || "",
    script: root.querySelector("script")?.textContent?.trim() || ""
  };
};