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

// A clickable slide-hyperlink hotspot, in FRACTIONS of the slide size (0..1), so
// the remote (which renders the slide image at an arbitrary size) can place it.
export interface SlideLinkRect {
  x: number;
  y: number;
  w: number;
  h: number;
  target: string; // raw `data-mdp-target` (`#5` | `#id` | `deck.slide.md#…`)
}

export interface RasterizeResult {
  dataUrl: string;
  links: SlideLinkRect[];
}
