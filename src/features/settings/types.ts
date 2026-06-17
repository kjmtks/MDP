// App-level (chrome) settings, persisted PER-WORKSPACE in `.mdp/settings.json`.
// These are distinct from slide themes (`@theme`, .mdp/themes) — they style the
// editor app itself (header, panels, menus, editor font, shortcuts).

export interface AppSettings {
  version: 1;                            // schema version, for forward migration
  appTheme: string;                      // AppThemeDef.id (e.g. 'dark' | 'light')
  appFontSize: number;                   // app UI base font size, px
  editorFontSize: number;                // CodeMirror editor font size, px
  // Sparse keybinding OVERRIDES: actionId -> list of key combos. Unspecified
  // actions fall back to the registry defaults, so "reset" = delete the key.
  shortcuts: Record<string, string[]>;
}

export const SETTINGS_PATH = '.mdp/settings.json';

export const DEFAULT_SETTINGS: AppSettings = {
  version: 1,
  appTheme: 'dark',
  appFontSize: 14,
  editorFontSize: 16,
  shortcuts: {},
};

// Merge a parsed (possibly partial / older) settings object over the defaults.
export function normalizeSettings(raw: unknown): AppSettings {
  const r = (raw && typeof raw === 'object') ? raw as Partial<AppSettings> : {};
  return {
    version: 1,
    appTheme: typeof r.appTheme === 'string' ? r.appTheme : DEFAULT_SETTINGS.appTheme,
    appFontSize: typeof r.appFontSize === 'number' ? r.appFontSize : DEFAULT_SETTINGS.appFontSize,
    editorFontSize: typeof r.editorFontSize === 'number' ? r.editorFontSize : DEFAULT_SETTINGS.editorFontSize,
    shortcuts: (r.shortcuts && typeof r.shortcuts === 'object') ? r.shortcuts as Record<string, string[]> : {},
  };
}
