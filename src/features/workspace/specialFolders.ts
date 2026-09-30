// Central definition of the app-managed workspace folders. They all live under
// a single `.mdp/` directory so the workspace root stays clean and future
// app-wide settings / themes can share the same home.
//
// NOTE: this is a breaking layout change — folders are read ONLY from `.mdp/`.
// The CommonJS dev server (`server.cjs`) and Electron main (`app/main.cjs`)
// hardcode the same paths; keep them in sync with this file.

export const MDP_DIR = '.mdp';

export const TEMPLATES_DIR = `${MDP_DIR}/templates`;
export const SNIPPETS_DIR = `${MDP_DIR}/snippets`;
export const THEMES_DIR = `${MDP_DIR}/themes`;
export const MODULES_DIR = `${MDP_DIR}/modules`;
export const EFFECTS_DIR = `${MDP_DIR}/effects`;
export const IMAGES_DIR = `${MDP_DIR}/images`;
// Workspace fonts: one folder per family (font files + font.json + licence).
export const FONTS_DIR = `${MDP_DIR}/fonts`;
// Slide skills: the author's guides for AI authoring, one folder per skill (SKILL.md).
export const SKILLS_DIR = `${MDP_DIR}/skills`;

// Special subfolder names (no leading dot) shown under `.mdp/` in the sidebar.
export const SPECIAL_SUBFOLDERS = ['templates', 'snippets', 'themes', 'modules', 'effects', 'fonts', 'skills'] as const;
