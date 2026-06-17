// App theme metadata. The actual colors are authored as CSS variable blocks in
// `src/styles/app-theme.css` (`html[data-app-theme="<id>"] { ... }`). This file
// only carries metadata used by the picker UI and — crucially — the `variant`
// flag that drives the systems which CANNOT read CSS variables (the CodeMirror
// color theme and the Dockview theme).

export interface AppThemeDef {
  id: string;
  label: string;
  variant: 'dark' | 'light';
  isCustom?: boolean;
}

export const APP_THEMES: AppThemeDef[] = [
  { id: 'dark',          label: 'Dark',          variant: 'dark'  },
  { id: 'light',         label: 'Light',         variant: 'light' },
  { id: 'midnight',      label: 'Midnight',      variant: 'dark'  },
  { id: 'solarized-dark', label: 'Solarized Dark', variant: 'dark' },
  { id: 'high-contrast', label: 'High Contrast', variant: 'dark'  },
];

export const DEFAULT_APP_THEME = 'dark';

export function appThemeVariant(id: string): 'dark' | 'light' {
  return APP_THEMES.find((t) => t.id === id)?.variant ?? 'dark';
}
