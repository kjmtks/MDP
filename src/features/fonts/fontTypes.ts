// Workspace fonts — font packages stored in a `.mdp/fonts/<id>/` folder (see
// app/fonts.cjs for the on-disk format and the backend listing).

export type FontCategory = 'sans-serif' | 'serif' | 'monospace' | 'other';

export interface FontFaceFile {
  file: string;       // file name inside the package folder
  path: string;       // workspace-relative path of the file
  format: string;     // CSS `format()` hint: woff2 | woff | truetype | opentype
  weight: string;     // CSS font-weight: '400', or a variable range '100 900'
  style: string;      // normal | italic | oblique
  unicodeRange?: string; // one slice of a split font (e.g. from Google Fonts)
  size: number;       // bytes
  version: string;    // changes whenever the file does (cache token)
}

export interface WorkspaceFont {
  id: string;         // package folder name
  dir: string;        // workspace-relative package folder
  configDir: string;  // the `.mdp` that holds it
  family: string;     // the CSS family name decks use
  category: FontCategory;
  faces: FontFaceFile[];
  license?: string;   // e.g. OFL-1.1
  licenseFile?: string;
  source?: string;
  inferred?: boolean; // no font.json — described from the font files themselves
  installedFrom?: string; // downloaded by the installer from here (requirements.json)
  size: number;
  problems?: string[];
}

// Where a declared font can be downloaded from (`requirements.json` → `source`).
export type FontSource =
  | 'google'                                            // Google Fonts, same family name
  | { google: string | true; weights?: number[] }       // Google Fonts, other name / fewer weights
  | { url: string }                                     // one font file
  | { urls: string[] }                                  // several font files
  | { zip: string; files?: string[] };                  // font files inside a ZIP archive

// One DECLARED font (`.mdp/fonts/requirements.json` → `fonts[]`): decks beneath
// that `.mdp` need it — whether MDP can fetch it (a `source`) or not (a font that
// may not be shared: the declaration still says what is missing and where to get it).
export interface FontRequirement {
  family: string;
  category?: FontCategory;
  source?: FontSource;
  license?: string;
  homepage?: string;
  note?: string;
  fallback?: string[]; // used in its place where it is missing (folder defaults)
  configDir: string;   // the `.mdp` declaring it
}

// packaged = a `.mdp` font package provides it (renders the same everywhere);
// local = only this computer has it installed; missing = neither.
export type FontRequirementState = 'packaged' | 'local' | 'missing';

export interface FontRequirementStatus extends FontRequirement {
  state: FontRequirementState;
  packagedIn?: string; // the `.mdp` holding the package, when packaged
}

// A `.mdp`'s requirements.json as the backend returns it (parsed in the renderer).
export interface RequirementsFile {
  configDir: string;
  path: string;
  text: string;
}

export interface FontInstallResult {
  id?: string;
  dir?: string;
  family?: string;
  files?: number;
  bytes?: number;
  error?: string;
}

// What a font file says about itself (backend `inspectFont`).
export interface FontInspection {
  format: string;
  family: string;
  subfamily: string;
  localFamily: string;    // Japanese family name, when the font has one
  fullName: string;
  version: string;
  copyright: string;
  license: string;
  licenseUrl: string;
  licenseKind: string;    // 'OFL-1.1' | 'Apache-2.0' | 'UFL-1.0' | ''
  weight: number;
  weightRange: [number, number] | null;
  italic: boolean;
  fsType: number;
  embedding: 'installable' | 'editable' | 'preview-print' | 'restricted';
  error?: string;
}

// Per-folder default fonts (`.mdp/content.json` → `fonts`), each a family name.
// Empty/absent = keep the theme's own choice.
export interface MdpFontDefaults {
  body?: string;
  heading?: string;
  mono?: string;
}
