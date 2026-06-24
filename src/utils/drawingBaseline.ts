// Strip drawing data and normalize whitespace so two versions of a slide file can
// be compared for EXTERNAL TEXT changes, ignoring drawing-anchor differences. The
// editor holds `<!-- @drawing: id -->` anchors while disk holds the expanded
// `<!-- @draw: base64 -->` blocks, so a raw compare would always differ — this
// removes both forms plus CR/trailing-space/blank-line noise.
export const stripDrawingData = (s: string): string => s
  .replace(/<!--\s*@draw:[\s\S]*?-->/g, '')
  .replace(/<!--\s*@drawing:\s*[a-zA-Z0-9]+\s*-->/g, '')
  .replace(/\r/g, '')
  .replace(/[ \t]+$/gm, '')
  .replace(/\n{3,}/g, '\n\n')
  .trim();
