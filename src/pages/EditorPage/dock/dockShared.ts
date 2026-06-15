

// v3: new 3-column default layout. Bumping the key discards older saved layouts
// so everyone picks up the new default once (they can still rearrange + it persists).
export const LAYOUT_KEY = 'mdp_dock_layout_v3';
export const RESET_LAYOUT_EVENT = 'mdp-reset-dock-layout';
export const TOGGLE_PANEL_EVENT = 'mdp-dock-toggle-panel';
export const SHOW_PANEL_EVENT = 'mdp-dock-show-panel';
export const VISIBLE_PANELS_EVENT = 'mdp-dock-visible-panels';
export const REQUEST_VISIBLE_EVENT = 'mdp-dock-request-visible';

export const STATIC_PANELS: { id: string; title: string }[] = [
  { id: 'explorer', title: 'Explorer' },
  { id: 'thumbnails', title: 'Thumbnails' },
  { id: 'bookmarks', title: 'Bookmarks' },
  { id: 'snippets', title: 'Snippets' },
  { id: 'images', title: 'Images' },
  { id: 'preview', title: 'Preview' },
];
