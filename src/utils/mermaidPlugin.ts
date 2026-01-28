import mermaid from 'mermaid';

mermaid.initialize({
  startOnLoad: false,
  theme: 'neutral',
  securityLevel: 'loose',
  flowchart: { htmlLabels: false },
  er: { useMaxWidth: false },
});

const mermaidCache = new Map<string, string>();

export const processMermaid = async (div: HTMLElement) => {
  const mermaidNodes = Array.from(div.querySelectorAll('.mermaid'));
  for (const node of mermaidNodes) {
    const code = node.textContent || '';
    if (mermaidCache.has(code)) {
      const wrapper = document.createElement('div');
      wrapper.className = "mermaid-img-wrapper";
      wrapper.innerHTML = mermaidCache.get(code)!;
      node.replaceWith(wrapper);
      continue;
    }
    const id = 'mermaid-' + Math.random().toString(36).substr(2, 9);
    try {
      const { svg } = await mermaid.render(id, code);
      let modifiedSvg = svg;
      const styleBlock = `
        <style>
        </style>
      `;
      modifiedSvg = modifiedSvg.replace('</svg>', `${styleBlock}</svg>`);
      const base64Svg = btoa(unescape(encodeURIComponent(modifiedSvg)));
      const dataUri = `data:image/svg+xml;base64,${base64Svg}`;
      const imgTag = `<img src="${dataUri}" alt="Mermaid Diagram" style="max-width: 100%; height: auto; display: block; margin: 0 auto;" />`;
      const wrapper = document.createElement('div');
      wrapper.className = "mermaid-img-wrapper";
      wrapper.innerHTML = imgTag;
      node.replaceWith(wrapper);
      mermaidCache.set(code, imgTag);
    } catch (error) {
      console.warn("Mermaid render error", error);
      const errDiv = document.createElement('div');
      errDiv.style.cssText = 'color:red; border:1px solid red; padding:4px; font-size:12px; white-space:pre-wrap; background-color:#fff0f0;';
      errDiv.textContent = `Mermaid Error:\n${(error as Error).message}\n\n${code}`;
      node.replaceWith(errDiv);
    }
  }
};