export interface SlideContextMeta {
  title?: string;
  subtitle?: string;
  date?: string;
  presenter?: string;
  affiliation?: string;
  contact?: string;
  // Deck tags (from `<!-- @tags a, b, c -->`). Used for search/organization only;
  // not rendered on slides.
  tags?: string[];
}

// A reference to an effect (from the .effect folder) plus its resolved args.
// Used for slide transitions and for in-slide build defaults.
export interface MotionSpec {
  name: string;
  args: Record<string, string>;
}

export interface SlideContext {
  numberOfPages: number;
  aspectRatio: [number, number];
  meta: SlideContextMeta;
  themeName?: string;
  cssPath?: string;
  header?: string;
  footer?: string;
  caption?: string;
  pageClass?: string;
  columnsRatio?: number[];
  columnIndex?: number;
  // Global defaults from the meta page.
  transition?: MotionSpec;
  build?: MotionSpec;
}

export const createDefaultContext = (): SlideContext => ({
  numberOfPages: 0,
  aspectRatio: [16, 9],
  meta: {},
});