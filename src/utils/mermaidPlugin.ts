import mermaid from 'mermaid';

mermaid.initialize({
  startOnLoad: false,
  theme: 'neutral',
  securityLevel: 'loose',
  flowchart: { htmlLabels: false },
  er: { useMaxWidth: false },
});

export const processMermaid = async (div: HTMLElement) => {
  const mermaidNodes = Array.from(div.querySelectorAll('.mermaid'));
  for (const node of mermaidNodes) {
    const code = node.textContent || '';
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
      const wrapper = document.createElement('div');
      wrapper.className = "mermaid-img-wrapper";
      wrapper.innerHTML = `<img src="${dataUri}" alt="Mermaid Diagram" style="max-width: 100%; height: auto; display: block; margin: 0 auto;" />`;
      node.replaceWith(wrapper);
    } catch (error) {
      console.warn("Mermaid render error", error);
      const errDiv = document.createElement('div');
      errDiv.style.cssText = 'color:red; border:1px solid red; padding:4px; font-size:12px; white-space:pre-wrap; background-color:#fff0f0;';
      errDiv.textContent = `Mermaid Error:\n${(error as Error).message}\n\n${code}`;
      node.replaceWith(errDiv);
    }
  }
};