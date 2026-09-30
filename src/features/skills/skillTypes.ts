// Slide skills — the author's guides for AI authoring, kept per folder in
// `.mdp/skills/<name>/SKILL.md` (Agent Skills format; see app/skills.cjs for the
// on-disk format and the backend listing).

export interface SlideSkill {
  name: string;          // folder name — what get_skill takes
  title?: string;        // frontmatter name, when it differs from the folder name
  description: string;   // one line: what it covers and when to read it
  always: boolean;       // whole text goes into the slide spec
  tags?: string[];
  body: string;          // Markdown without the frontmatter
  checklist: string[];   // items under its "Checklist" heading
  path: string;          // workspace-relative SKILL.md
  dir: string;           // workspace-relative skill folder
  configDir: string;     // the `.mdp` that holds it
  truncated?: boolean;
  problem?: string;      // e.g. missing frontmatter
}
