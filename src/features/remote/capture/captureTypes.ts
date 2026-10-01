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
  // Workspace-font CSS (@font-face + the folder's font variables), for the same
  // reason — without it the capture falls back to the OS fonts.
  fontCss?: string;
  width: number;
  height: number;
  // In-slide build step to show (settled, not animated); omitted = all builds
  // shown. And the page number to print, for themes that show one.
  buildStep?: number;
  pageNumber?: number;
  // Video frames: render the slide scaled to exactly this many pixels and return
  // PNG BYTES instead of a data URL (the video export).
  outWidth?: number;
  outHeight?: number;
  // A subtitle drawn over the bottom of the slide (the video export; may carry
  // `\(…\)` math, typeset with KaTeX like the auto-play's caption).
  caption?: string;
}

/** The web build's capture iframe (CapturePage) ↔ the page that hosts it
 *  (webCapture.ts): the frame is drawn in the iframe and handed back. */
export type WebCaptureMessage =
  | { type: 'hello' }                                        // iframe → host: listening
  | { type: 'capture'; data: CaptureSlideData }              // host → iframe
  | { type: 'captured'; id: number; bitmap: ImageBitmap }
  | { type: 'failed'; id: number; message: string };

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
