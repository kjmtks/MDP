export interface SlideContextMeta {
  title?: string;
  subtitle?: string;
  date?: string;
  presenter?: string;
  affiliation?: string;
  contact?: string;
}

export interface SlideContext {
  numberOfPages: number;
  aspectRatio: [number, number];
  meta: SlideContextMeta;
  themeCss?: string;
  caption?: string;
  pageClass?: string;
  columnsRatio?: number[];
  columnIndex?: number;
  addclasses: Record<string, string>;
  addstyles: Record<string, string>;
}

export const createDefaultContext = (): SlideContext => ({
  numberOfPages: 0,
  aspectRatio: [16, 9],
  themeCss: undefined,
  meta: {},
  addclasses: {},
  addstyles: {},
});