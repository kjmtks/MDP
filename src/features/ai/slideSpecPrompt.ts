import type { ModuleConfig, ModuleParam, ModuleData } from '../../utils/moduleParser';
import type { EffectConfig, EffectData } from '../../utils/effectParser';
import type { ThemeOption } from '../../types';

// Builds ONE English prompt that teaches a generative AI how to author MDP
// `.slide.md` files: a hardcoded description of the tool's slide format, followed
// by a self-description of every module installed in the workspace.
//
// Two layers:
//   1. SLIDE_FORMAT_SPEC — the tool's built-in syntax (stable, edited by hand here).
//   2. describeModuleForAI(config) — each module describes ITSELF, either from a
//      hand-written <aiSpec> in its .mdpmod.xml, or synthesized from its
//      description + parameters + snippets when no <aiSpec> is given.
//
// buildSlideSpecPrompt() / buildSlideSpecPromptFromLoaded() join the two so a UI
// (button / export / copy-to-clipboard) can hand the result to an LLM verbatim.

export const PROMPT_INTRO = `# Authoring MDP presentation slides

You are helping author a presentation for **MDP**, a Markdown-based slide tool.
A presentation is a single \`.slide.md\` file written in Markdown plus a small set
of HTML-comment directives (\`<!-- @name ... -->\`). Produce ONLY the file content.
Follow the format below exactly. Keep slides concise and visual; prefer the
installed modules over raw HTML.`;

export const SLIDE_FORMAT_SPEC = `## File structure

- The file is split into blocks by a line containing exactly \`---\` (three
  dashes). A \`---\` inside a fenced code block does NOT split.
- The FIRST block is the **meta / preamble page** — it is NOT a slide. It holds
  global settings (title, theme, aspect, header/footer, …) that apply to every
  slide.
- Every block AFTER the first \`---\` is one slide, in order.

## Meta-page (global) commands — put these in the first block

Each is an HTML comment on its own line:

- \`<!-- @title TEXT -->\`, \`<!-- @subtitle TEXT -->\`, \`<!-- @date TEXT -->\`,
  \`<!-- @presenter TEXT -->\`, \`<!-- @affiliation TEXT -->\`, \`<!-- @contact TEXT -->\`
  — presentation metadata, shown on the cover slide.
- \`<!-- @aspect W:H -->\` — slide aspect ratio, e.g. \`<!-- @aspect 16:9 -->\`.
- \`<!-- @theme NAME -->\` — apply a slide theme (NAME is one of the installed themes
  listed under "Themes" below). \`<!-- @css PATH -->\` — load extra CSS.
- \`<!-- @transition NAME key: value, … -->\` — default slide transition; NAME is an
  effect (see "Animation effects" below). Common args: \`duration\`, \`easing\`.
- \`<!-- @build key: value, … -->\` — default settings for in-slide build animations.

## Header / footer — block regions (meta page = all slides; a slide = that slide only)

\`\`\`
<!-- @header -->
markdown (or modules) shown at the top of every slide
<!-- @end -->

<!-- @footer -->
markdown shown at the bottom of every slide
<!-- @end -->
\`\`\`

Put them on the meta page to apply to all slides. Repeating a \`@header\`/\`@footer\`
block on a single slide OVERRIDES the global one for that slide; an EMPTY block
(\`<!-- @header --><!-- @end -->\`) suppresses it on that slide.

## Per-slide commands

- \`<!-- @cover -->\` — render this slide as the title/cover page (uses the meta fields).
- \`<!-- @pageclass NAME -->\` — add a CSS class to the slide (theme-specific styling).
- \`<!-- @caption TEXT -->\` — placed immediately BEFORE an image or table to caption it.
- \`<!-- @transition NAME key: value -->\` — override the transition for this slide.
- \`<!-- @note: TEXT -->\` — speaker note (hidden on the slide; shown in presenter view).

## In-slide builds (step-by-step reveals)

\`\`\`
<!-- @build step: 2, effect: fade, duration: 300ms -->
content that appears on step 2
<!-- @end -->
\`\`\`

Common args: \`step\`/\`enter\` (step it appears), \`effect\` (an effect NAME — see
"Animation effects" below), \`duration\`, \`easing\`, \`emphasis\`/\`exit\` (+
\`emphasisEffect\`/\`exitEffect\`), \`stagger\`, \`auto\` (auto-advance ms).

## Module directives

Modules are reusable components invoked with an HTML comment. Two forms:

- **Inline** (self-contained, no closing tag): \`<!-- @name key: value, key2: value2 -->\`
- **Block** (wraps a body): \`<!-- @name key: value -->\` … \`<!-- @end -->\`. Inside a
  block, \`<!-- @ -->\` (bare) separates the body into multiple SECTIONS.

Argument syntax (the \`key: value\` list):
- Pairs separated by commas: \`a: 1, b: hello\`.
- Quote values with spaces: \`label: "Hello world"\`.
- List values use brackets: \`ratio: [1, 2, 1]\`. Escape a literal comma/bracket
  inside a value with a backslash: \`\\,\` \`\\[\` \`\\]\`.
- Positioned modules accept \`x\`, \`y\` (center %, 0–100), \`w\`, \`h\` (size %), \`rot\`
  (degrees) — but normally you let the user place them on the canvas; don't add
  these unless a specific position is requested.

## Markdown features

- Standard Markdown: headings, lists, task lists (\`- [ ]\`/\`- [x]\`), tables, blockquotes,
  ordered lists with a custom start (\`5. …\`).
- Math (KaTeX): inline \`\\( … \\)\`, display \`\\[ … \\]\`.
- Code fences with extras: \`\`\`lang:filename.ext start:10{2,4-6}\`\`\` — optional filename,
  starting line number, and \`{ }\` highlighted line ranges.
- Diagram fences: \`\`\`@mermaid\`\`\`, \`\`\`@plantuml\`\`\`, \`\`\`@chartjs\`\`\` (Chart.js JSON config).
- Images \`![alt](path)\`; embedded drawio diagrams use \`![@drawio](…)\` (tool-generated).`;

const paramTypeName = (p: ModuleParam): string =>
  p.isArray ? `list of ${p.type || 'text'}` : (p.type || 'text');

const describeParam = (p: ModuleParam): string => {
  const meta: string[] = [paramTypeName(p)];
  if (p.required) meta.push('required');
  if (p.type === 'number') {
    const r: string[] = [];
    if (p.min != null) r.push(`min ${p.min}`);
    if (p.max != null) r.push(`max ${p.max}`);
    if (p.integer) r.push('integer');
    if (r.length) meta.push(r.join(', '));
  }
  let line = `- \`${p.name}\` (${meta.join('; ')})`;
  const label = p.label && p.label !== p.name ? p.label : '';
  const human = [label, p.description].filter(Boolean).join(' — ');
  if (human) line += ` — ${human}`;
  if (p.options && p.options.length) {
    line += `. Options: ${p.options.map((o) => (o.value === o.label ? o.value : `${o.value} (${o.label})`)).join(', ')}`;
  }
  if (p.default !== undefined && p.default !== '') line += `. Default: ${p.default}`;
  return line;
};

/** One module's self-description for the AI prompt — its own \`<aiSpec>\` if it
 *  provides one, otherwise synthesized from description + parameters + snippets. */
export function describeModuleForAI(c: ModuleConfig): string {
  const kind = c.type === 'inline' ? 'inline' : c.inlineRender ? 'block (renders inline)' : 'block';
  const out: string[] = [`### \`@${c.name}\` — ${kind} module`];
  if (c.description) out.push(c.description);

  if (c.aiSpec) {
    out.push(c.aiSpec);
  } else if (c.parameters.length) {
    out.push('Parameters:');
    out.push(c.parameters.map(describeParam).join('\n'));
  } else {
    out.push('No parameters.');
  }

  out.push(
    c.type === 'inline' || c.inlineRender
      ? `Syntax: \`<!-- @${c.name} key: value, … -->\` (self-contained).`
      : `Syntax: \`<!-- @${c.name} key: value, … -->\` … \`<!-- @end -->\` (body is the content; \`<!-- @ -->\` separates sections).`,
  );

  if (c.manipulate) {
    const m = c.manipulate;
    const axes = [m.move && `move ${m.move}`, m.resize && `resize ${m.resize}`, m.rotate && 'rotate'].filter(Boolean).join(', ');
    if (axes) out.push(`Placeable on the canvas (${axes}); position/size persist as x/y/w/h/rot percent args.`);
  }
  if (c.interactive) out.push('Interactive: clicking it does not advance the slideshow.');

  const examples = (c.snippets || []).filter((s) => s && s.text).slice(0, 2);
  if (examples.length) {
    out.push('Examples:');
    out.push(examples.map((s) => `  ${s.text}${s.description ? `   # ${s.description}` : ''}`).join('\n'));
  }
  return out.join('\n');
}

/** Animation-effect catalogue for the prompt. The SAME effect names drive slide
 *  transitions (\`@transition NAME\`) and in-slide builds (\`@build effect: NAME\`). */
export function describeEffectsForAI(effects: EffectConfig[]): string {
  return [...effects]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => {
      let l = `- \`${e.name}\``;
      if (e.description) l += ` — ${e.description}`;
      const ps = (e.parameters || []).map((p) => p.name);
      if (ps.length) l += ` (args: ${ps.join(', ')})`;
      // A hand-written self-description is appended (indented) under the effect.
      if (e.aiSpec) l += `\n  ${e.aiSpec.replace(/\n/g, '\n  ')}`;
      return l;
    })
    .join('\n');
}

/** Theme list for the prompt — what \`<!-- @theme NAME -->\` accepts. */
function describeThemesForAI(themes: ThemeOption[]): string {
  return [...themes]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => (t.name === t.fileName ? `- \`${t.name}\`` : `- \`${t.name}\` (or \`${t.fileName}\`)`))
    .join('\n');
}

export interface SlideSpecExtras {
  effects?: EffectConfig[];
  themes?: ThemeOption[];
}

/** Assemble the full slide-authoring prompt: built-in format spec, then the
 *  workspace's installed themes, animation effects, and modules. */
export function buildSlideSpecPrompt(modules: ModuleConfig[], extras: SlideSpecExtras = {}): string {
  const parts: string[] = [PROMPT_INTRO, SLIDE_FORMAT_SPEC];

  if (extras.themes && extras.themes.length) {
    parts.push(`## Themes\n\nApply with \`<!-- @theme NAME -->\` on the meta page. Installed themes:\n\n${describeThemesForAI(extras.themes)}`);
  }
  if (extras.effects && extras.effects.length) {
    parts.push(`## Animation effects\n\nValid for BOTH slide transitions (\`<!-- @transition NAME … -->\`) and in-slide builds (\`<!-- @build effect: NAME … -->\`):\n\n${describeEffectsForAI(extras.effects)}`);
  }

  const sorted = [...modules].sort((a, b) => a.name.localeCompare(b.name));
  parts.push(`## Installed modules\n\nThese modules are available in this workspace — invoke each with its \`<!-- @name … -->\` directive.`);
  parts.push(sorted.length ? sorted.map(describeModuleForAI).join('\n\n') : '_(No modules are installed in this workspace.)_');
  return parts.join('\n\n');
}

/** Convenience overload for the live registries (\`loadedModules\` / \`loadedEffects\`). */
export function buildSlideSpecPromptFromLoaded(
  loadedModules: Record<string, ModuleData>,
  loadedEffects?: Record<string, EffectData>,
  themes?: ThemeOption[],
): string {
  return buildSlideSpecPrompt(Object.values(loadedModules).map((m) => m.config), {
    effects: loadedEffects ? Object.values(loadedEffects).map((e) => e.config) : undefined,
    themes,
  });
}
