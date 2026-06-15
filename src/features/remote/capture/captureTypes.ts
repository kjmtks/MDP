export interface CaptureSlideData {
  id: number;
  html: string;
  className?: string;
  header?: string;
  footer?: string;
  basePath?: string;
  themeCssUrl?: string;
  // Concatenated CSS of all registered modules. The offscreen capture window has
  // its own document (no module CSS), so it must be shipped in for the rasterized
  // image to reflect module styling.
  moduleCss?: string;
  width: number;
  height: number;
}

export interface RasterizeOptions {
  width: number;
  height: number;
  basePath?: string;
  themeCssUrl?: string;
  scale?: number;
}
