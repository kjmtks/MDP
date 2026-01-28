import { useState, useEffect } from 'react';
import mermaid from 'mermaid';

mermaid.initialize({
  startOnLoad: false,
  theme: 'base',
  securityLevel: 'loose',
  flowchart: { htmlLabels: false },
  er: { useMaxWidth: false },
});

const cache = new Map<string, string>();

export const useMermaid = (htmlContent: string) => {
  const [processedHtml, setProcessedHtml] = useState<string>(() => {
    return cache.get(htmlContent) || htmlContent;
  });
  
  const [prevHtml, setPrevHtml] = useState(htmlContent);
  if (htmlContent !== prevHtml) {
    setPrevHtml(htmlContent);
    const cached = cache.get(htmlContent);
    if (cached) {
      setProcessedHtml(cached);
    } else {
      setProcessedHtml(htmlContent);
    }
  }

  useEffect(() => {
    if (cache.has(htmlContent)) {
      return;
    }
    if (!htmlContent.includes('class="mermaid"')) {
      cache.set(htmlContent, htmlContent);
      return;
    }
    let isMounted = true;
    const process = async () => {
      const div = document.createElement('div');
      div.innerHTML = htmlContent;
      const mermaidNodes = Array.from(div.querySelectorAll('.mermaid'));
      for (const node of mermaidNodes) {
        const code = node.textContent || '';
        const id = 'mermaid-' + Math.random().toString(36).substr(2, 9);
        try {
          const { svg } = await mermaid.render(id, code);
          const wrapper = document.createElement('div');
          wrapper.className = "mermaid-svg-wrapper";
          wrapper.innerHTML = svg;
          node.replaceWith(wrapper);
        } catch (error) {
           const errDiv = document.createElement('div');
           errDiv.style.cssText = 'color:red; border:1px solid red; padding:4px; font-size:12px; white-space:pre-wrap; background-color:#fff0f0;';
           errDiv.textContent = `Mermaid Error:\n${(error as Error).message}\n\n${code}`;
           node.replaceWith(errDiv);
        }
      }
      const result = div.innerHTML;
      if (isMounted) {
        cache.set(htmlContent, result);
        setProcessedHtml(result);
      }
    };
    process();
    return () => { isMounted = false; };
  }, [htmlContent]);

  return processedHtml;
};