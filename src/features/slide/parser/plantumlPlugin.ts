import '@plantuml/core/viz-global.js';
import { render } from '@plantuml/core/plantuml.js';

const plantumlCache = new Map<string, string>();

export const processPlantUml = async (div: HTMLElement) => {
  const nodes = Array.from(div.querySelectorAll('.plantuml'));

  await Promise.all(nodes.map(async (node) => {
    let code = node.textContent || '';
    if (!code.trim()) return;

    code = code.replace(/\r/g, '');

    code = code.replace(/^@plantuml\s*\n?/, '');

    if (!code.includes('@startuml')) {
      code = `@startuml\n${code}\n@enduml`;
    }

    if (plantumlCache.has(code)) {
      const wrapper = document.createElement('div');
      wrapper.className = "plantuml-svg-wrapper";
      wrapper.innerHTML = plantumlCache.get(code)!;
      const svgEl = wrapper.querySelector('svg');
      if (svgEl) {
        svgEl.style.maxWidth = '100%';
        svgEl.style.height = 'auto';
        svgEl.style.display = 'block';
        svgEl.style.margin = '0 auto';
      }
      node.replaceWith(wrapper);
      return;
    }

    try {
      const tempId = 'plantuml-temp-' + Math.random().toString(36).substring(2, 11);
      const tempDiv = document.createElement('div');
      tempDiv.id = tempId;

      tempDiv.style.position = 'absolute';
      tempDiv.style.visibility = 'hidden';
      tempDiv.style.top = '-9999px';
      tempDiv.style.left = '-9999px';
      document.body.appendChild(tempDiv);

      const lines = code.split('\n');

      await render(lines, tempId);

      let svgEl = tempDiv.querySelector('svg');

      if (!svgEl) {
        await new Promise<void>((resolve) => {
          let attempts = 0;
          const interval = setInterval(() => {
            svgEl = tempDiv.querySelector('svg');
            attempts++;
            if (svgEl || attempts >= 20) {
              clearInterval(interval);
              resolve();
            }
          }, 50);
        });
      }

      if (!svgEl) {
        const output = tempDiv.innerHTML.trim();
        throw new Error(`SVG element not found after wait.\nDOM Output: ${output.substring(0, 150)}`);
      }

      svgEl.style.maxWidth = '100%';
      svgEl.style.height = 'auto';
      svgEl.style.display = 'block';
      svgEl.style.margin = '0 auto';

      const svgContent = tempDiv.innerHTML;
      tempDiv.remove();

      const wrapper = document.createElement('div');
      wrapper.className = "plantuml-svg-wrapper";
      wrapper.innerHTML = svgContent;
      node.replaceWith(wrapper);

      plantumlCache.set(code, svgContent);

    } catch (e) {
      console.error("PlantUML error:", e);
      const errDiv = document.createElement('div');
      errDiv.style.cssText = 'color:red; border:1px solid red; padding:4px; font-size:12px; white-space:pre-wrap; background-color:#fff0f0;';
      errDiv.textContent = `PlantUML Error:\n${(e as Error).message}`;
      node.replaceWith(errDiv);
    }
  }));
};