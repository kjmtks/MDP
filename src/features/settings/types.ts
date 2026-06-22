// App-level (chrome) settings, persisted PER-WORKSPACE in `.mdp/settings.json`.
// These are distinct from slide themes (`@theme`, .mdp/themes) — they style the
// editor app itself (header, panels, menus, editor font, shortcuts).

export interface AppSettings {
  version: 1;                            // schema version, for forward migration
  appTheme: string;                      // AppThemeDef.id (e.g. 'dark' | 'light')
  appFontSize: number;                   // app UI base font size, px
  editorFontSize: number;                // CodeMirror editor font size, px
  editorCaretWidth: number;              // text cursor (caret) thickness, px
  editorLineHeight: number;              // editor line height (unitless multiplier)
  // Sparse keybinding OVERRIDES: actionId -> list of key combos. Unspecified
  // actions fall back to the registry defaults, so "reset" = delete the key.
  shortcuts: Record<string, string[]>;
  // Author profile: defaults pre-filled into a new slide's cover meta
  // (@presenter / @affiliation / @contact). Empty fields leave the template's
  // own placeholder untouched.
  authorName: string;
  authorAffiliation: string;
  authorEmail: string;
}

export const SETTINGS_PATH = '.mdp/settings.json';

export const DEFAULT_SETTINGS: AppSettings = {
  version: 1,
  appTheme: 'dark',
  appFontSize: 14,
  editorFontSize: 16,
  editorCaretWidth: 2,                    // thicker than CodeMirror's ~1.2px default for visibility
  editorLineHeight: 1.6,
  shortcuts: {},
  authorName: '',
  authorAffiliation: '',
  authorEmail: '',
};

// Merge a parsed (possibly partial / older) settings object over the defaults.
export function normalizeSettings(raw: unknown): AppSettings {
  const r = (raw && typeof raw === 'object') ? raw as Partial<AppSettings> : {};
  return {
    version: 1,
    appTheme: typeof r.appTheme === 'string' ? r.appTheme : DEFAULT_SETTINGS.appTheme,
    appFontSize: typeof r.appFontSize === 'number' ? r.appFontSize : DEFAULT_SETTINGS.appFontSize,
    editorFontSize: typeof r.editorFontSize === 'number' ? r.editorFontSize : DEFAULT_SETTINGS.editorFontSize,
    editorCaretWidth: typeof r.editorCaretWidth === 'number' ? r.editorCaretWidth : DEFAULT_SETTINGS.editorCaretWidth,
    editorLineHeight: typeof r.editorLineHeight === 'number' ? r.editorLineHeight : DEFAULT_SETTINGS.editorLineHeight,
    shortcuts: (r.shortcuts && typeof r.shortcuts === 'object') ? r.shortcuts as Record<string, string[]> : {},
    authorName: typeof r.authorName === 'string' ? r.authorName : '',
    authorAffiliation: typeof r.authorAffiliation === 'string' ? r.authorAffiliation : '',
    authorEmail: typeof r.authorEmail === 'string' ? r.authorEmail : '',
  };
}

// Fill a new slide's cover meta directives (@presenter / @affiliation / @contact)
// with the configured author profile. Only non-empty profile fields replace the
// directive value; directives absent from the template are left as-is (we never
// inject new lines — the template decides which meta it carries). The directive
// is single-line, so the value capture stops at the closing `-->`.
export function applyAuthorProfile(
  content: string,
  profile: { authorName?: string; authorAffiliation?: string; authorEmail?: string },
): string {
  const fill = (text: string, directive: string, value: string | undefined): string => {
    const v = (value ?? '').trim();
    if (!v) return text;
    const re = new RegExp('(<!--\\s*@' + directive + '\\s+)(.*?)(\\s*-->)', 'g');
    return text.replace(re, (_m, pre: string, _old: string, post: string) => pre + v + post);
  };
  let out = content;
  out = fill(out, 'presenter', profile.authorName);
  out = fill(out, 'affiliation', profile.authorAffiliation);
  out = fill(out, 'contact', profile.authorEmail);
  return out;
}
