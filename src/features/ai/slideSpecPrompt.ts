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
- \`<!-- @tags TAG1, TAG2; TAG3 -->\` — deck tags for search/organization, separated
  by commas or semicolons (quote a tag that itself contains one, e.g. \`"a, b"\`). Not shown on slides.
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
- \`<!-- @id NAME -->\` — give this slide a stable anchor a hyperlink can target
  (\`[text](#NAME)\`). NAME is unique within the deck (letters/digits/-/_).
- \`<!-- @caption TEXT -->\` — placed immediately BEFORE an image or table to caption it.
- \`<!-- @transition NAME key: value -->\` — override the transition for this slide.
- \`<!-- @note: TEXT -->\` — speaker note: a SUPPLEMENTARY reminder (hidden on the
  slide; shown in the presenter view). Does NOT affect the talk-time estimate.
- \`<!-- @script: TEXT -->\` — a READ-ALOUD manuscript for this slide (what the
  presenter plans to say, verbatim). Shown prominently in the presenter view; its
  length drives the talk-time estimate at the user's reading speed. Use this (not
  @note) when the intent is to read the slide out.
  - **Build sync:** if the slide has in-slide builds (\`@build\` steps), put a
    \`[[step]]\` marker in the @script where each build should advance. The narrated
    auto-play reads a segment, advances one build step at the marker, then reads on —
    keeping the words in sync with the reveals. One \`[[step]]\` per build step, in
    order. Markers are invisible on the slide and in the presenter view; they only
    pace the auto-play. Example: \`<!-- @script: First the problem. [[step]] Now the
    fix. -->\` on a slide whose second point is a \`@build\`.
  - **Math in the script:** write formulas in KaTeX — \`\\(…\\)\` inline, \`\\[…\\]\`
    display — and they are RENDERED in the on-screen subtitle (the caption and the
    spoken audio are separate, so the caption can show real math). To have a formula
    SPOKEN, add its reading right after it as \`[[say: よみ]]\`; a formula with no
    \`[[say:…]]\` is shown but not read aloud. Example:
    \`基本角周波数を \\(\\omega_0 = 2\\pi/T\\) [[say: オメガゼロ イコール 2パイ割るティー]] とおくと，…\`
    — the caption shows \\(\\omega_0=2\\pi/T\\); the narrator says "オメガゼロ イコール 2パイ割るティー".
    Prefer KaTeX + \`[[say:…]]\` over spelling maths out phonetically in plain text.
- \`<!-- @time 90s -->\` — this slide's speaking-time budget (overrides the estimate).
  Accepts \`90s\`, \`2m\`, \`1m30s\`, \`1:30\` (mm:ss). Shown live in the presenter view
  (per-slide + whole-deck countdown).

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

⚠️ **CRITICAL — a block body must OPEN with its directive.** Every \`<!-- @ -->\`
separator and every \`<!-- @end -->\` must be inside a block that a \`<!-- @name … -->\`
opened just above. NEVER write a bare \`<!-- @ -->\` or a \`<!-- @end -->\` on its own —
that produces a broken slide (the comments render as nothing and the text spills out
raw). If you want a plain list of items (e.g. topics, an agenda), either open a REAL
module first — call get_module_spec for its exact body format, e.g.
\`<!-- @steps -->\` A \`<!-- @ -->\` B \`<!-- @end -->\` — or just use a Markdown list
(\`- A\` / \`- B\`). Do not invent module syntax: if you didn't open a \`<!-- @name -->\`,
do not emit \`<!-- @ -->\` or \`<!-- @end -->\`. Also REPLACE any template placeholder
text (e.g. "New Section", "Message") with the slide's real content.

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
- Slide hyperlinks (jump to a page; the viewer can then go Back/Forward through the
  jump history): \`[text](#5)\` → page 5 of THIS deck; \`[text](#NAME)\` → the slide with
  \`<!-- @id NAME -->\`; \`[text](other.slide.md)\` / \`other.slide.md#5\` / \`other.slide.md#NAME\`
  → another deck (path relative to this deck's folder). Other URLs open externally.

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

- [Results](#details)
- Roadmap
- Q&A

<!-- @build step: 2 -->
…and one more thing
<!-- @end -->

<!-- @note: Pause here for questions. -->

---
<!-- @id details -->
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
- **Nesting sectioned modules:** a block module CAN sit inside another block
  module's section (e.g. \`@derivation\` inside a \`@grid\` cell). Separators and
  \`<!-- @end -->\` always belong to the INNERMOST open block — close the inner
  module before writing the outer's next \`<!-- @ -->\`. In the index, \`(block,
  sectioned)\` = body uses separators; \`(block, no @end)\` = params-only.

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
- Mind Mermaid SIZE: diagrams render at their natural size and easily overflow the
  slide (or shrink to unreadable). Keep each diagram modest (roughly ≤ 8–12 nodes),
  keep node labels short, prefer \`flowchart LR\` on a wide slide (TD grows tall
  fast), and SPLIT a large diagram across slides instead of cramming it. Give a
  diagram its own slide (title + diagram) rather than squeezing it under long text.
- You cannot fetch external images. Use a workspace image path the user provides;
  otherwise leave a clear placeholder. For SVG, include a \`viewBox\` and don't
  hard-code text \`fill\` (let the theme colour it). For non-Latin (e.g. Japanese)
  labels in a drawio/SVG, set the font with \`@addstyle\`, e.g. a CSS section of
  \`.mdp-drawio-svg { --mdp-drawio-font: "Noto Sans JP"; }\`.

Style & density (defaults — always apply)
- IMITATE the author's existing style: when existing decks or sample slides are
  available (or provided), study one or two FIRST and mirror their tone, wording,
  heading style, slide density and module choices — the new deck should read as if
  the same author wrote it. Only deviate when explicitly asked.
- NO sparse slides: every slide should use most of the canvas. A slide with just a
  heading and a line or two looks unfinished — merge it into a neighbour, or enrich
  it (a diagram, an example, a module like \`@callout\`/\`@metrics\`). The inverse also
  holds: don't overflow — split a slide that exceeds the canvas.
- Keep each slide light in TEXT (aim for ≤ ~5 bullets) — fullness should come from
  structure and visuals, not walls of text.

Timing
- If the user gives a target talk length (e.g. "10-minute talk"), set a
  \`<!-- @time … -->\` budget on each slide so the totals add up to the target — this
  is far more reliable than leaving it to be estimated, and it drives the presenter
  view's countdown. Spend more time on complex/important slides, less on covers.
- If the user wants a spoken SCRIPT, put it in \`<!-- @script: … -->\` (not @note) —
  that both provides the read-aloud text in the presenter view AND makes the
  talk-time estimate reflect it. Reserve @note for brief reminders. Write any maths in
  the script as KaTeX (\`\\(…\\)\`) so the subtitle renders it, and give each formula a
  spoken reading with \`[[say: よみ]]\` (see @script above).

Consistency
- Set the theme and aspect ONCE on the meta page (don't repeat per slide); choose
  the deck transition there too.
- Use the SAME module for the same kind of content throughout (e.g. always
  \`@callout\` for takeaways, \`@metrics\` for KPIs).
- Prefer theme colour variables (e.g. \`var(--accent-color)\`) over hard-coded colours
  so the palette stays consistent.
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
  const kind = c.type === 'inline' ? 'inline' : c.inlineRender ? 'block (renders inline)' : c.selfClosing ? 'block (self-closing, NO body)' : c.sectioned ? 'block (sectioned body: `<!-- @ -->` separators)' : 'block (single body)';
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
      : c.selfClosing
        ? `Syntax: \`<!-- @${c.name} key: value, … -->\` — self-contained, takes NO body and NO \`<!-- @end -->\` (all data is in the parameters).`
        : c.sectioned
          ? `Syntax: \`<!-- @${c.name} key: value, … -->\` … \`<!-- @end -->\` — the body is split into SECTIONS by \`<!-- @ -->\`. Nesting: a nested block module's separators belong to the INNERMOST open block, so this module can sit inside another sectioned module's section.`
          : `Syntax: \`<!-- @${c.name} key: value, … -->\` … \`<!-- @end -->\` (the whole body is one content region).`,
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

/** The module taxonomy: TWO levels — groups (top) each own a set of leaf tags.
 *  A module's first `<tags>` entry decides its group; the rest are secondary.
 *  The taxonomy is a DOWNLOADED ASSET (official-assets/taxonomy.json → synced to
 *  a workspace's `.mdp/`), NOT bundled into the app. Callers load it and pass it
 *  in; a workspace can also override it per folder via `.mdp/taxonomy.json`. When
 *  no taxonomy is available (e.g. before the first asset sync) the index falls
 *  back to a flat, ungrouped list. */
export interface TaxonomyGroup { id: string; label: string; desc?: string; tags: string[] }
export interface Taxonomy { groups: TaxonomyGroup[] }

// Legacy fallback: map an old free-form snippet category to a group id, for
// modules that predate `<tags>`. All shipped modules now declare `<tags>`, so
// this only catches user modules that haven't been tagged yet.
const LEGACY_SNIPPET_TO_GROUP: Record<string, string> = {
  math: 'math', data: 'charts', media: 'content', diagram: 'diagrams',
  diagrams: 'diagrams', shapes: 'diagrams', layout: 'layout', structure: 'layout',
  'presentation ui': 'content', content: 'content', 'ui parts': 'ui', interactive: 'ui',
};

/** The effective taxonomy, or null when none is loaded (→ flat index). */
function resolveTaxonomy(tax?: Taxonomy): Taxonomy | null {
  if (tax && Array.isArray(tax.groups) && tax.groups.length) return tax;
  return null;
}

/** tag → group id, from the taxonomy. */
function buildTagGroupMap(tax: Taxonomy): Record<string, string> {
  const m: Record<string, string> = {};
  for (const g of tax.groups) for (const t of g.tags || []) m[t.toLowerCase()] = g.id;
  return m;
}

/** The group id a module belongs to: its first tag's group, else a legacy
 *  snippet-category fallback, else 'other'. */
function moduleGroupId(c: ModuleConfig, tagGroup: Record<string, string>): string {
  const primary = (c.tags && c.tags[0]) ? c.tags[0].toLowerCase() : '';
  if (primary && tagGroup[primary]) return tagGroup[primary];
  const rawSnip = (c.snippets && c.snippets[0] && c.snippets[0].category ? String(c.snippets[0].category) : '').trim().toLowerCase();
  return LEGACY_SNIPPET_TO_GROUP[rawSnip] || 'other';
}

/** The FIRST sentence of a description — enough to screen on, without the full
 *  when-to-use prose. Keeps the index roughly one line per module. */
function shortDescription(desc: string): string {
  const d = (desc || '').replace(/\s+/g, ' ').trim();
  if (!d) return '';
  const m = d.match(/^(.*?[.．。])(\s|$)/);
  const first = (m ? m[1] : d).trim();
  return first.length > 150 ? first.slice(0, 147).trimEnd() + '…' : first;
}

/** One compact line describing a module for the index. */
function moduleIndexLine(c: ModuleConfig): string {
  const kind = c.type === 'inline' ? 'inline' : c.inlineRender ? 'block→inline' : c.selfClosing ? 'block, no @end' : c.sectioned ? 'block, sectioned' : 'block';
  const secondary = (c.tags || []).slice(1);
  const tagStr = secondary.length ? ` [${secondary.join(', ')}]` : '';
  const desc = shortDescription(c.description);
  return `- \`@${c.name}\` (${kind})${tagStr}${desc ? ` — ${desc}` : ''}`;
}

/** A one-line legend of the categories that actually contain modules — so the AI
 *  knows each group's ROLE and can screen at the group level first. Empty when no
 *  taxonomy is loaded (the index is then flat, so there is nothing to legend). */
export function describeCategoryLegend(modules: ModuleConfig[], override?: Taxonomy): string {
  const tax = resolveTaxonomy(override);
  if (!tax) return '';
  const tagGroup = buildTagGroupMap(tax);
  const used = new Set(modules.map((m) => moduleGroupId(m, tagGroup)));
  return tax.groups
    .filter((g) => used.has(g.id))
    .map((g) => `- **${g.label}** — ${g.desc || ''}`.trimEnd())
    .join('\n');
}

/** A COMPACT one-line-per-module index for the prompt. The AI screens on this
 *  (≈12× smaller than dumping every aiSpec), then pulls the full spec for the few
 *  modules it will use via get_module_spec. When a taxonomy is loaded, modules are
 *  grouped by it (in its order) and each line shows secondary tags; without one it
 *  falls back to a single flat, alphabetical list. */
export function describeModuleIndex(modules: ModuleConfig[], override?: Taxonomy): string {
  const tax = resolveTaxonomy(override);
  const byName = (a: ModuleConfig, b: ModuleConfig) => a.name.localeCompare(b.name);

  if (!tax) {
    return modules.slice().sort(byName).map(moduleIndexLine).join('\n');
  }

  const tagGroup = buildTagGroupMap(tax);
  const byGroup = new Map<string, ModuleConfig[]>();
  for (const c of modules) {
    const gid = moduleGroupId(c, tagGroup);
    if (!byGroup.has(gid)) byGroup.set(gid, []);
    byGroup.get(gid)!.push(c);
  }
  // Emit groups in taxonomy order; any group id not in the taxonomy trails at the end.
  const order = tax.groups.map((g) => g.id);
  const seen = new Set(order);
  const trailing = [...byGroup.keys()].filter((id) => !seen.has(id)).sort();
  const label = (id: string) => tax.groups.find((g) => g.id === id)?.label || id;

  const lines: string[] = [];
  for (const gid of [...order, ...trailing]) {
    const mods = byGroup.get(gid);
    if (!mods || !mods.length) continue;
    lines.push(`\n### ${label(gid)}`);
    for (const c of mods.sort(byName)) lines.push(moduleIndexLine(c));
  }
  return lines.join('\n').trim();
}

/** Compact search over modules by tag and/or free text (name/description/tags) —
 *  what the find_modules tool returns. Results are one-liners like the index;
 *  the AI then calls get_module_spec for the full spec of the ones it wants. */
export function findModules(
  modules: ModuleConfig[],
  opts: { query?: string; tags?: string[] } = {},
): string {
  const q = (opts.query || '').trim().toLowerCase();
  const wantTags = (opts.tags || []).map((t) => String(t).trim().toLowerCase()).filter(Boolean);
  const matches = modules.filter((c) => {
    const tags = (c.tags || []).map((t) => t.toLowerCase());
    if (wantTags.length && !wantTags.every((t) => tags.includes(t))) return false;
    if (q) {
      const hay = `${c.name} ${c.description || ''} ${tags.join(' ')}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  if (!matches.length) {
    return `_(No modules match${wantTags.length ? ` tags [${wantTags.join(', ')}]` : ''}${q ? ` query "${q}"` : ''}. See the full index in get_slide_spec.)_`;
  }
  return matches
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => {
      const kind = c.type === 'inline' ? 'inline' : c.inlineRender ? 'block→inline' : c.selfClosing ? 'block, no @end' : c.sectioned ? 'block, sectioned' : 'block';
      const tagStr = (c.tags || []).length ? ` [${(c.tags || []).join(', ')}]` : '';
      const desc = shortDescription(c.description);
      return `- \`@${c.name}\` (${kind})${tagStr}${desc ? ` — ${desc}` : ''}`;
    })
    .join('\n');
}

// Content SIGNALS → the tags/modules they suggest. Each rule tests a slide's raw
// markdown; a match contributes its tags (matched against module.tags) plus any
// directly-boosted module names, and a short human reason. Data-light heuristics,
// deliberately conservative — they RANK candidates, they don't decide.
interface SuggestRule { test: RegExp; tags?: string[]; boost?: string[]; reason: string }
const SUGGEST_RULES: SuggestRule[] = [
  { test: /(^|\n)\s*[-*+]\s+\S.*(\n\s*[-*+]\s+\S.*){2,}/, tags: ['list', 'process', 'cycle'], boost: ['steps', 'checklist', 'iconlist', 'agenda', 'cycle'], reason: 'a bullet list (3+ items)' },
  { test: /(^|\n)\s*\d+[.)]\s+\S/, tags: ['process', 'flow'], boost: ['steps', 'flow', 'roadmap'], reason: 'a numbered/ordered list' },
  { test: /\b(first|second|then|next|after that|finally|step\s*\d)\b/i, tags: ['process', 'flow'], boost: ['steps', 'flow', 'process'], reason: 'sequential wording (first/then/finally)' },
  { test: /\$[^$\n]+\$|\\\(|\\\[|\\frac|\\sum|\\int/, tags: ['equations', 'proofs'], boost: ['equation', 'formula', 'theorem', 'cases', 'derivation'], reason: 'inline math' },
  { test: /(^|\n)\s*\|.*\|.*\|/, tags: ['table', 'comparison'], boost: ['comparetable', 'heatmap', 'matrix'], reason: 'a pipe table' },
  { test: /\b(vs\.?|versus|compared? (to|with)|pros?\b.*\bcons?)\b/i, tags: ['comparison'], boost: ['compare', 'comparetable', 'spectrum'], reason: 'a comparison' },
  { test: /\b(strengths?|weakness(es)?|opportunit(y|ies)|threats?)\b/i, boost: ['swot'], reason: 'SWOT vocabulary' },
  { test: /\b(19|20)\d{2}\b|\bQ[1-4]\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i, tags: ['timeline'], boost: ['timeline', 'roadmap', 'gantt'], reason: 'dates / a schedule' },
  { test: /\b\d+(\.\d+)?\s?%/, tags: ['kpi', 'charts'], boost: ['progress', 'gauge', 'stackedbar', 'funnel', 'statdelta'], reason: 'percentages' },
  { test: /(^|\n)\s*#{1,3}\s*\S.*\n[\s\S]*\b\d[\d,]{2,}\b/, tags: ['kpi'], boost: ['bignumber', 'statdelta', 'metrics'], reason: 'a headline number' },
  { test: /```|(^|\n)\s*\$\s+\S|\bnpm |\bgit /, boost: ['terminal', 'browser'], reason: 'code / a shell command' },
  { test: /(^|\n)\s*>\s+\S|["“][^"”]{20,}["”]/, boost: ['quote', 'balloon'], reason: 'a quotation' },
  { test: /!\[[^\]]*\]\([^)]+\)/, tags: ['media'], boost: ['graph', 'gallery'], reason: 'an image' },
  { test: /\b(agenda|outline|contents|today'?s topics|overview)\b/i, boost: ['agenda'], reason: 'an agenda/overview' },
  { test: /(^|\n)\s*-?\s*\w[\w ]*[:|]\s*-?\d+(\.\d+)?(\s*,\s*-?\d+(\.\d+)?)*/, tags: ['charts', 'statistics'], boost: ['barchart', 'stackedbar', 'radar', 'scatter', 'histogram', 'boxplot'], reason: 'numeric label:value data' },
];

/** Recommend modules for a slide's CONTENT (or a described intent). Runs the signal
 *  rules to gather candidate tags + boosts, scores every module against them (tags,
 *  boosts, and name/description keyword overlap), and returns the top matches with a
 *  reason. Powers a `suggest_modules` MCP tool and a future in-editor affordance. */
export function suggestModules(
  modules: ModuleConfig[],
  text: string,
  opts: { limit?: number } = {},
): Array<{ name: string; type: string; tags: string[]; reason: string; description: string }> {
  const src = String(text || '');
  const limit = Math.max(1, Math.min(12, opts.limit || 6));
  const wantTags = new Map<string, number>();
  const boost = new Map<string, number>();
  const reasons = new Map<string, Set<string>>();
  const addReason = (name: string, r: string) => { if (!reasons.has(name)) reasons.set(name, new Set()); reasons.get(name)!.add(r); };

  for (const rule of SUGGEST_RULES) {
    if (!rule.test.test(src)) continue;
    for (const t of rule.tags || []) wantTags.set(t, (wantTags.get(t) || 0) + 1);
    for (const b of rule.boost || []) { boost.set(b, (boost.get(b) || 0) + 3); addReason(b, rule.reason); }
  }

  const scored = modules.map((c) => {
    let score = 0;
    const tags = (c.tags || []).map((t) => t.toLowerCase());
    for (const [t, w] of wantTags) if (tags.includes(t)) { score += w * 2; }
    if (boost.has(c.name)) score += boost.get(c.name)!;
    // Tag hits also earn a reason from the rules that wanted those tags.
    if (score > 0) {
      for (const rule of SUGGEST_RULES) {
        if (!(rule.tags || []).some((t) => tags.includes(t))) continue;
        if (!rule.test.test(src)) continue;
        addReason(c.name, rule.reason);
      }
    }
    return { c, score };
  }).filter((x) => x.score > 0);

  scored.sort((a, b) => b.score - a.score || a.c.name.localeCompare(b.c.name));
  return scored.slice(0, limit).map(({ c }) => ({
    name: c.name,
    type: c.type === 'inline' ? 'inline' : c.inlineRender ? 'block→inline' : 'block',
    ...(c.selfClosing ? { selfClosing: true } : {}),
    ...(c.sectioned ? { sectioned: true } : {}),
    tags: c.tags || [],
    reason: [...(reasons.get(c.name) || [])].join('; '),
    description: shortDescription(c.description),
  }));
}

/** Full self-descriptions for a NAMED subset of modules (what the get_module_spec
 *  tool returns). Unknown names are reported so the AI can correct itself. */
export function describeModulesByName(modules: ModuleConfig[], names: string[]): string {
  const byName = new Map(modules.map((m) => [m.name.toLowerCase(), m]));
  const wanted = names.map((n) => String(n).replace(/^@/, '').trim()).filter(Boolean);
  const found: string[] = [];
  const missing: string[] = [];
  for (const n of wanted) {
    const m = byName.get(n.toLowerCase());
    if (m) found.push(describeModuleForAI(m));
    else missing.push(n);
  }
  const parts: string[] = [];
  if (found.length) parts.push(found.join('\n\n'));
  if (missing.length) parts.push(`_(No module named: ${missing.map((n) => `@${n}`).join(', ')}. Check the index in get_slide_spec.)_`);
  if (!parts.length) parts.push('_(No module names given.)_');
  return parts.join('\n\n');
}

// Effects carry a usage bucket as their first tag. Group + order for the index.
const EFFECT_BUCKETS: Array<{ id: string; label: string }> = [
  { id: 'transition', label: 'Transitions (scene change between slides)' },
  { id: 'emphasis', label: 'Emphasis (draw attention in place / in-slide builds)' },
  { id: 'special', label: 'Special' },
];
function effectBucket(e: EffectConfig): string {
  const primary = (e.tags && e.tags[0]) ? e.tags[0].toLowerCase() : '';
  return EFFECT_BUCKETS.some((b) => b.id === primary) ? primary : 'other';
}

/** A COMPACT one-line-per-effect index, grouped by usage bucket. Like the module
 *  index: the AI screens here, then calls get_effect_spec for the full args/examples
 *  of the few it will use. ~3–4× smaller than dumping every effect's aiSpec. */
export function describeEffectIndex(effects: EffectConfig[]): string {
  const byBucket = new Map<string, EffectConfig[]>();
  for (const e of effects) {
    const b = effectBucket(e);
    if (!byBucket.has(b)) byBucket.set(b, []);
    byBucket.get(b)!.push(e);
  }
  const order = [...EFFECT_BUCKETS.map((b) => b.id), 'other'];
  const label = (id: string) => EFFECT_BUCKETS.find((b) => b.id === id)?.label || 'Other';
  const lines: string[] = [];
  for (const id of order) {
    const list = byBucket.get(id);
    if (!list || !list.length) continue;
    lines.push(`\n### ${label(id)}`);
    for (const e of list.sort((a, b) => a.name.localeCompare(b.name))) {
      const style = (e.tags || []).slice(1);
      const styleStr = style.length ? ` [${style.join(', ')}]` : '';
      const desc = shortDescription(e.description);
      lines.push(`- \`${e.name}\`${styleStr}${desc ? ` — ${desc}` : ''}`);
    }
  }
  return lines.join('\n').trim();
}

/** ONE effect's full self-description (aiSpec if present, else description + args)
 *  — what get_effect_spec returns. */
export function describeEffectForAI(e: EffectConfig): string {
  const out: string[] = [`### \`${e.name}\``];
  if (e.description) out.push(e.description);
  if (e.aiSpec) out.push(e.aiSpec);
  else if (e.parameters.length) { out.push('Parameters:'); out.push(e.parameters.map(describeParam).join('\n')); }
  out.push(`Use as a transition: \`<!-- @transition ${e.name} duration: 500ms -->\` (meta page = deck default; a slide = that slide only). Use in a build: \`<!-- @build effect: ${e.name} -->\`.`);
  const ex = (e.snippets || []).filter((s) => s && s.text).slice(0, 2);
  if (ex.length) { out.push('Examples:'); out.push(ex.map((s) => `  ${s.text}`).join('\n')); }
  return out.join('\n');
}

/** Full self-descriptions for NAMED effects (get_effect_spec tool). */
export function describeEffectsByName(effects: EffectConfig[], names: string[]): string {
  const byName = new Map(effects.map((e) => [e.name.toLowerCase(), e]));
  const found: string[] = [], missing: string[] = [];
  for (const n of names.map((x) => String(x).replace(/^@/, '').trim()).filter(Boolean)) {
    const e = byName.get(n.toLowerCase());
    if (e) found.push(describeEffectForAI(e)); else missing.push(n);
  }
  const parts: string[] = [];
  if (found.length) parts.push(found.join('\n\n'));
  if (missing.length) parts.push(`_(No effect named: ${missing.join(', ')}. See the effect index in get_slide_spec.)_`);
  return parts.length ? parts.join('\n\n') : '_(No effect names given.)_';
}

// intent keyword → effect tags it favors (for suggest_effects).
const EFFECT_INTENT_RULES: Array<{ test: RegExp; tags: string[] }> = [
  { test: /\b(subtle|calm|quiet|professional|formal|minimal|gentle|clean)\b/i, tags: ['subtle', 'fade'] },
  { test: /\b(energetic|lively|fun|playful|dynamic|bold|exciting|punchy)\b/i, tags: ['energetic', 'motion'] },
  { test: /\b(attention|highlight|emphasi|important|call ?out|pop|notice)\b/i, tags: ['attention', 'emphasis'] },
  { test: /\b(reveal|appear|show|unveil|introduce|entrance|enter)\b/i, tags: ['reveal', 'transition'] },
  { test: /\b(move|motion|slide|travel|fly|glide|drift)\b/i, tags: ['motion'] },
  { test: /\b(3d|flip|rotate|depth|perspective)\b/i, tags: ['3d', 'motion'] },
  { test: /\b(mask|wipe|iris|curtain)\b/i, tags: ['mask', 'reveal'] },
  { test: /\b(transition|between slides|scene change)\b/i, tags: ['transition'] },
  { test: /\b(build|step|reveal one by one|in-?slide)\b/i, tags: ['emphasis'] },
];

/** Recommend effects for an INTENT/mood (free text). Scores effects by how many of
 *  the intent's favored tags they carry. Returns a compact, reasoned shortlist. */
export function suggestEffects(effects: EffectConfig[], text: string, opts: { limit?: number } = {}): string {
  const src = String(text || '');
  const want = new Map<string, number>();
  for (const r of EFFECT_INTENT_RULES) if (r.test.test(src)) for (const t of r.tags) want.set(t, (want.get(t) || 0) + 1);
  const limit = Math.max(1, Math.min(12, opts.limit || 6));
  if (!want.size) return '_(Describe the mood/intent, e.g. "subtle", "energetic", "draw attention", "reveal step by step".)_';
  const scored = effects.map((e) => {
    const tags = (e.tags || []).map((t) => t.toLowerCase());
    let s = 0; for (const [t, w] of want) if (tags.includes(t)) s += w;
    return { e, s };
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.e.name.localeCompare(b.e.name)).slice(0, limit);
  if (!scored.length) return '_(No effect matched that intent — see the effect index in get_slide_spec.)_';
  return scored.map(({ e }) => {
    const bucket = effectBucket(e);
    const use = bucket === 'emphasis' ? '@build' : '@transition';
    return `- \`${e.name}\` (${use}) [${(e.tags || []).join(', ')}] — ${shortDescription(e.description)}`;
  }).join('\n');
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
  // Folder-specific house style / instructions (from the `.mdp` chain's aiNotes).
  aiNotes?: string;
  // The author's cached WRITING-STYLE profile (from the `.mdp` chain) — distilled
  // once from their decks, so authoring matches their voice without re-reading.
  styleProfile?: string;
  // Per-folder taxonomy override (from `.mdp/taxonomy.json`). When it has a
  // non-empty `groups` array it fully replaces the bundled default taxonomy that
  // groups/labels the module index; otherwise the default is used.
  taxonomy?: Taxonomy;
}

/** Assemble the full slide-authoring prompt: built-in format spec, then the
 *  workspace's installed themes, animation effects, and modules. */
export function buildSlideSpecPrompt(modules: ModuleConfig[], extras: SlideSpecExtras = {}): string {
  const parts: string[] = [PROMPT_INTRO, SLIDE_FORMAT_SPEC, AUTHORING_RULES];

  if (extras.themes && extras.themes.length) {
    parts.push(`## Themes\n\nApply with \`<!-- @theme NAME -->\` on the meta page. Installed themes:\n\n${describeThemesForAI(extras.themes)}`);
  }
  if (extras.effects && extras.effects.length) {
    parts.push(
      `## Animation effects (${extras.effects.length})\n\n` +
      `A compact INDEX follows — one line per effect, grouped by usage. The SAME names ` +
      `drive slide transitions (\`<!-- @transition NAME … -->\`) and in-slide builds ` +
      `(\`<!-- @build effect: NAME … -->\`). To keep this prompt small, only the index is ` +
      `shown; after picking the few you'll use, call \`get_effect_spec(names: ["fade","zoom"])\` ` +
      `for their full args + examples. \`suggest_effects(text: "energetic")\` recommends by ` +
      `mood. Each line shows style \`[tags]\`.\n\n` +
      describeEffectIndex(extras.effects),
    );
  }

  if (modules.length) {
    const legend = describeCategoryLegend(modules, extras.taxonomy);
    const legendBlock = legend
      ? `**Categories** (screen at this level first, then scan the group you need):\n\n${legend}\n\n`
      : '';
    parts.push(
      `## Installed modules (${modules.length})\n\n` +
      `A compact INDEX follows — one line per module, grouped by category. To keep this ` +
      `prompt small, only the index is shown here, NOT each module's full spec.\n\n` +
      legendBlock +
      `**How to use a module:** scan the index, pick the 1–5 that fit, then call ` +
      `\`get_module_spec(names: ["foo", "bar"])\` to get their FULL specs — parameters, ` +
      `body/section format, and examples — before writing the directive. A module line ` +
      `shows its \`(kind)\` and any secondary \`[tags]\` (it also fits those topics). ` +
      `Invoke a module with its \`<!-- @name … -->\` directive (block modules take a body ` +
      `ending in \`<!-- @end -->\`, with \`<!-- @ -->\` between sections). When a plain ` +
      `heading, list, image or table is clearer than any module, just use Markdown.\n\n` +
      describeModuleIndex(modules, extras.taxonomy),
    );
  } else {
    parts.push(`## Installed modules\n\n_(No modules are available for this folder.)_`);
  }

  // Folder-specific style + instructions come LAST so they override anything above.
  if (extras.styleProfile && extras.styleProfile.trim()) {
    parts.push(`## The author's writing style\n\nA style profile distilled from this author's existing decks — WRITE IN THIS VOICE (wording, density, structure). It is current; you do not need to re-read their decks:\n\n${extras.styleProfile.trim()}`);
  }
  if (extras.aiNotes && extras.aiNotes.trim()) {
    parts.push(`## House style for this folder\n\nThe author has set these instructions for decks in this folder — follow them:\n\n${extras.aiNotes.trim()}`);
  }
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
