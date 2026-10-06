export interface SlideContextMeta {
  title?: string;
  subtitle?: string;
  date?: string;
  presenter?: string;
  affiliation?: string;
  contact?: string;
}

// A reference to an effect (from the .effect folder) plus its resolved args.
// Used for slide transitions and for in-slide build defaults.
export interface MotionSpec {
  name: string;
  args: Record<string, string>;
}

// `<!-- @answers show|hide, key: value, … -->` on the meta page: whether the
// `@answer` blocks are shown (the instructor's copy — the default) or left blank
// (a handout), plus deck-wide defaults for them (`label`, `frame`, `space`). The
// editor's answers toggle overrides `hide` for the deck it previews.
export interface AnswerSpec {
  hide: boolean;
  args: Record<string, string>;
}

export interface SlideContext {
  numberOfPages: number;
  aspectRatio: [number, number];
  /** Explicit canvas size in CSS px from @resolution (width optional -> derived from the aspect). */
  resolution?: { width?: number; height: number };
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
  answers?: AnswerSpec;
}

export const createDefaultContext = (): SlideContext => ({
  numberOfPages: 0,
  aspectRatio: [16, 9],
  meta: {},
});