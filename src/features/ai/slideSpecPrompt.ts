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

You are an expert author of presentations for **MDP**, a Markdown-based slide tool.
A presentation is a single \`.slide.md\` file: Markdown plus a small set of
HTML-comment directives (\`<!-- @name ... -->\`). Read the format, the rules, and the
installed themes/effects/modules below, then write slides. Prefer the installed
modules over raw HTML; keep slides concise and visual.

## How to work

- **Plan before generating.** Work from a per-slide plan — ideally a table giving,
  for each slide: number, title, the key points IN ORDER, the module or diagram to
  use, and any speaker note. If the user provides such a plan, follow it EXACTLY —
  do not merge, split, reorder, or pad slides. If the user did NOT provide one,
  first reply with a brief one-line-per-slide outline and get approval BEFORE
  writing the full file.
- **Be faithful to the source.** Treat any wording, numbers, equations,
  definitions, and citations the user gives as authoritative: reproduce them
  verbatim. Do not paraphrase, round, restate, or "improve" them unless explicitly
  permitted. Honour any terminology rules and any "do not include / confidential"
  boundaries the user sets. When something is ambiguous or missing, ASK rather than
  guess.
- **Output format.** When you write the file, output ONLY the raw \`.slide.md\`
  content — no surrounding code fence, no commentary before or after it.`;

export const SLIDE_FORMAT_SPEC = `## File structure

- The file is split into blocks by a line containing exactly \`---\` (three
  dashes). A \`---\` inside a fenced code block does NOT split.
- The FIRST block (everything before the first \`---\`) is the **meta page**. It is
  CONFIGURATION ONLY and is NEVER displayed as a slide. Put the deck-wide settings
  here (title, theme, aspect, transition, header/footer, …). Anything you write
  before the first \`---\` — even plain text — is treated as meta and never shown.
- Each block AFTER the first \`---\` is one slide, shown in order. So always lay the
  file out as: meta page → \`---\` → slide 1 → \`---\` → slide 2 → …
- Meta-page settings apply to the WHOLE deck. A \`@transition\` set on the meta page
  is the DEFAULT transition for EVERY slide; a \`@transition\` (or \`@header\`/\`@footer\`)
  repeated on an individual slide overrides it for that one slide only.

## Meta-page (global) commands — put these in the first block

Each is an HTML comment on its own line:

- \`<!-- @title TEXT -->\`, \`<!-- @subtitle TEXT -->\`, \`<!-- @date TEXT -->\`,
  \`<!-- @presenter TEXT -->\`, \`<!-- @affiliation TEXT -->\`, \`<!-- @contact TEXT -->\`
  — presentation metadata, shown on the cover slide.
- \`<!-- @tags TAG1, TAG2, … -->\` — comma-separated deck tags for search and
  organization (quote a tag that contains a comma, e.g. \`"a, b"\`). Not shown on slides.
- \`<!-- @aspect W:H -->\` — slide aspect ratio, e.g. \`<!-- @aspect 16:9 -->\`.
- \`<!-- @theme NAME -->\` — apply a slide theme (NAME is one of the installed themes
  listed under "Themes" below). \`<!-- @css PATH -->\` — load extra CSS.
- \`<!-- @transition NAME key: value, … -->\` — sets the default transition applied
  to EVERY slide. NAME is an effect (see "Animation effects" below). Common args:
  \`duration\`, \`easing\`.
- \`<!-- @build key: value, … -->\` — deck-wide default settings for in-slide build
  animations (each \`@build\` block may still override them).

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
- Images \`![alt](path)\`. For diagrams and charts, see the next section.

## Diagrams & charts

To ADD a diagram, prefer a TEXT-BASED diagram — those are easy to generate, edit,
and theme. Put each in a fenced code block with a special language tag.

### Mermaid — \`\`\`@mermaid  (recommended for generated diagrams)
Flowcharts, sequence, class, state, ER, gantt, pie, mindmap, … Write Mermaid
syntax as the fence body:

\`\`\`@mermaid
flowchart LR
  A[Start] --> B{Decision}
  B -->|yes| C[Do it]
  B -->|no| D[Skip]
\`\`\`

\`\`\`@mermaid
sequenceDiagram
  Client->>Server: Request
  Server-->>Client: Response
\`\`\`

### PlantUML — \`\`\`@plantuml
UML diagrams (sequence, class, activity, component, use-case). Body is PlantUML:

\`\`\`@plantuml
@startuml
Alice -> Bob: Request
Bob --> Alice: Response
@enduml
\`\`\`

### Chart.js — \`\`\`@chartjs  (data charts)
Bar / line / pie / radar / … The fence body is a Chart.js config in JSON:

\`\`\`@chartjs
{ "type": "bar",
  "data": { "labels": ["Q1", "Q2", "Q3"],
            "datasets": [{ "label": "Sales", "data": [12, 19, 7] }] } }
\`\`\`

### drawio / inline SVG — \`![@drawio](SRC)\`
Diagrams drawn in the app's built-in drawio editor are saved as an SVG and
embedded as a data-URI image, e.g. \`![@drawio](data:image/svg+xml;base64,…)\`.
SRC may be ANY SVG — a \`data:image/svg+xml\` data-URI OR a workspace \`.svg\` path —
and is inlined into the slide so theme CSS can restyle its text.

You cannot reproduce the editor's SVG by hand, so to GENERATE a vector diagram,
embed your own SVG as a **base64** data-URI (base64 is safest — it contains no
spaces or \`)\` that would break the \`![…](…)\` image parser):

  \`![@drawio](data:image/svg+xml;base64,PHN2Zy4uLg==)\`   (base64 of your \`<svg>…</svg>\`)

SVG tips: include a \`viewBox\`; do NOT hard-code text \`fill\` (leave it so the theme
colours the labels). For most generated diagrams, **prefer \`@mermaid\`** — it is far
less error-prone than emitting base64 SVG.

## Putting it together — a complete file

\`\`\`
<!-- @title Quarterly Review -->
<!-- @subtitle Q2 results -->
<!-- @tags finance, quarterly, review -->
<!-- @presenter Alice Smith -->
<!-- @aspect 16:9 -->
<!-- @theme dark -->
<!-- @transition slide duration: 400ms -->
<!-- @footer -->
Acme Inc. — Confidential
<!-- @end -->

---
<!-- @cover -->

---
## Agenda

- Results
- Roadmap
- Q&A

<!-- @build step: 2 -->
…and one more thing
<!-- @end -->

<!-- @note: Pause here for questions. -->

---
## Side by side

<!-- @multicolumn ratio: [1, 1] -->
Left column
<!-- @ -->
Right column
<!-- @end -->
\`\`\`

Everything above the first \`---\` is the (hidden) meta page; the slides that follow
inherit its theme, 16:9 aspect, \`slide\` transition, and footer.`;

// Authoring rules that prevent the most common MDP mistakes and keep output
// consistent. These matter as much as the syntax spec for accuracy.
export const AUTHORING_RULES = `## Authoring rules & common pitfalls

Structure
- Slides are separated by \`---\`; the block BEFORE the first \`---\` is the meta page
  (config only, never shown). Count slide numbers from AFTER the first \`---\`. To
  show a literal \`---\` line in body content, put it inside a fenced code block.

Module sections (the #1 cause of broken layouts)
- A block module that expects N sections needs EXACTLY N−1 \`<!-- @ -->\` separators
  in its body. Each module's entry under "Installed modules" states how many it
  expects — e.g. \`@card\`, \`@compare\`, \`@definition\`, \`@faq\`, \`@infobox\` take
  exactly 2 sections; \`@bignumber\` up to 3; \`@columns\` / \`@multicolumn\` / \`@gallery\`
  / \`@grid\` / \`@process\` / \`@timeline\` take ONE section per item. A missing
  separator collapses the body into a single section and breaks the layout.

Arguments vs. body
- Arguments are a \`key: value\` list separated by commas. If a value would contain
  \`,\` \`:\` \`[\` \`]\` or \`"\`, do NOT put it in an argument — put that text in the
  module BODY instead (or escape a comma as \`\\,\`). This is exactly why \`@qr\`'s URL
  and \`@references\`' BibTeX belong in the body, not in an argument.
- Do NOT add position args (\`x\`/\`y\`/\`w\`/\`h\`/\`rot\`) unless a specific placement was
  requested — let modules flow in document order. Stray coordinates misplace things.

Math & references
- Math is KaTeX with \`\\( … \\)\` (inline) and \`\\[ … \\]\` (display) — NOT \`$ … $\`.
  Paste LaTeX sources unchanged; if the source uses \`$…$\`, only convert the
  delimiters, never the math itself.
- Render citations with \`@references\` and BibTeX entries in its body — don't retype
  references by hand (it mis-attributes sources).

Diagrams & images
- Build diagrams as TEXT: \`@mermaid\` (flow/sequence/…), \`@chartjs\` (charts),
  \`@plantuml\` (UML). Avoid hand-authored base64 SVG — it is error-prone. For a
  chart, use the EXACT series/labels/values given; never invent numbers.
- You cannot fetch external images. Use a workspace image path the user provides;
  otherwise leave a clear placeholder. For SVG, include a \`viewBox\` and don't
  hard-code text \`fill\` (let the theme colour it). For non-Latin (e.g. Japanese)
  labels in a drawio/SVG, set the font with \`@addstyle\`, e.g. a CSS section of
  \`.mdp-drawio-svg { --mdp-drawio-font: "Noto Sans JP"; }\`.

Consistency
- Set the theme and aspect ONCE on the meta page (don't repeat per slide); choose
  the deck transition there too.
- Use the SAME module for the same kind of content throughout (e.g. always
  \`@callout\` for takeaways, \`@metrics\` for KPIs).
- Prefer theme colour variables (e.g. \`var(--accent-color)\`) over hard-coded colours
  so the palette stays consistent.
- Keep each slide light (aim for ≤ ~5 bullets); split dense content across slides
  only if the plan allows it.
- If the user provides a sample slide they like, mirror its structure, density,
  and style across the deck.
- Header/footer go on the meta page for all slides; repeat on a slide to override,
  or use an empty \`<!-- @header --><!-- @end -->\` to suppress it on that slide.`;

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
  const parts: string[] = [PROMPT_INTRO, SLIDE_FORMAT_SPEC, AUTHORING_RULES];

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
