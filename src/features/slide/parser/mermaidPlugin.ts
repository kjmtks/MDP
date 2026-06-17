import mermaid from 'mermaid';

mermaid.initialize({
  theme: 'neutral',
  securityLevel: 'loose',
  startOnLoad: true,
  // Never inject mermaid's built-in "Syntax error" diagram into the DOM. By
  // default a failed render appends that error SVG to <body>, where it floats at
  // the bottom of the app and breaks the layout. We render our own contained
  // error instead (see the catch below).
  suppressErrorRendering: true,
  // htmlLabels:true so labels (and KaTeX math) render as HTML in <foreignObject>.
  // Math is written as `$$ … $$` in a label; mermaid typesets it with KaTeX.
  // The diagram is emitted as an SVG data-URI <img>, then INLINED by SlideView
  // (registerDataUri → processSvg), so the foreignObject HTML lands in the live
  // DOM where the global katex.css can style it. processSvg skips `.katex`
  // subtrees so the math glyph fonts survive the font-var rewrite.
  flowchart: { htmlLabels: true },
  er: { useMaxWidth: false },
});

// Remove any mermaid temp/error nodes that leaked to <body> (e.g. from a render
// that errored before suppressErrorRendering, or older app versions). Mermaid
// names them after the render id, which we always prefix with `mermaid-`.
const sweepOrphanMermaidNodes = () => {
  document.querySelectorAll('body > svg[id^="mermaid-"], body > [id^="dmermaid-"]').forEach(el => el.remove());
};

const mermaidCache = new Map<string, string>();

const showError = (node: Element, message: string, code: string) => {
  const errDiv = document.createElement('div');
  errDiv.style.cssText = 'color:red; border:1px solid red; padding:4px; font-size:12px; white-space:pre-wrap; background-color:#fff0f0;';
  errDiv.textContent = `Mermaid Error:\n${message}\n\n${code}`;
  node.replaceWith(errDiv);
};

export const processMermaid = async (div: HTMLElement) => {
  sweepOrphanMermaidNodes();
  const mermaidNodes = Array.from(div.querySelectorAll('.mermaid'));
  for (const node of mermaidNodes) {
    const code = (node.textContent || '').trim();
    // An empty/whitespace block (often a half-typed diagram) is NOT an error —
    // drop it silently instead of letting mermaid throw a syntax error.
    if (!code) { node.remove(); continue; }
    if (mermaidCache.has(code)) {
      const wrapper = document.createElement('div');
      wrapper.className = "mermaid-img-wrapper";
      wrapper.innerHTML = mermaidCache.get(code)!;
      node.replaceWith(wrapper);
      continue;
    }
    const id = 'mermaid-' + Math.random().toString(36).substr(2, 9);
    // Validate first (suppressErrors → resolves false instead of throwing AND
    // without drawing anything), so invalid input never reaches render().
    let valid = true;
    try { valid = (await mermaid.parse(code, { suppressErrors: true })) !== false; }
    catch { valid = false; }
    if (!valid) { showError(node, 'Syntax error in diagram', code); continue; }
    try {
      const { svg } = await mermaid.render(id, code);
      let modifiedSvg = svg;
      const styleBlock = `
        <style>
        </style>
      `;
      modifiedSvg = modifiedSvg.replace('</svg>', `${styleBlock}</svg>`);
      const bytes = new TextEncoder().encode(modifiedSvg);
      const binString = Array.from(bytes, (byte) => String.fromCodePoint(byte)).join("");
      const base64Svg = btoa(binString);
      const dataUri = `data:image/svg+xml;base64,${base64Svg}`;
      const imgTag = `<img src="${dataUri}" alt="Mermaid Diagram" style="max-width: 100%; height: auto; display: block; margin: 0 auto;" />`;
      const wrapper = document.createElement('div');
      wrapper.className = "mermaid-img-wrapper";
      wrapper.innerHTML = imgTag;
      node.replaceWith(wrapper);
      mermaidCache.set(code, imgTag);
    } catch (error) {
      console.warn("Mermaid render error", error);
      showError(node, (error as Error).message, code);
    } finally {
      // Drop mermaid's temporary measurement nodes so nothing lingers in <body>.
      document.getElementById(id)?.remove();
      document.getElementById('d' + id)?.remove();
    }
  }
};