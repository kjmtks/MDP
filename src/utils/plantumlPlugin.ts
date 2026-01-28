import plantumlEncoder from 'plantuml-encoder';

const PLANTUML_SERVER = '/plantuml/svg/';
const plantumlCache = new Map<string, string>();

export const processPlantUml = async (div: HTMLElement) => {
  const nodes = Array.from(div.querySelectorAll('.plantuml'));
  await Promise.all(nodes.map(async (node) => {
    const code = node.textContent || '';
    if (!code.trim()) return;
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
      const encoded = plantumlEncoder.encode(code);
      const url = `${PLANTUML_SERVER}${encoded}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`PlantUML Server Error: ${response.status}`);
      const svg = await response.text();
      const wrapper = document.createElement('div');
      wrapper.className = "plantuml-svg-wrapper";
      wrapper.innerHTML = svg;
      const svgEl = wrapper.querySelector('svg');
      if (svgEl) {
        svgEl.style.maxWidth = '100%';
        svgEl.style.height = 'auto';
        svgEl.style.display = 'block';
        svgEl.style.margin = '0 auto';
      }
      node.replaceWith(wrapper);
      plantumlCache.set(code, svg);
    } catch (e) {
      console.error("PlantUML error:", e);
      const errDiv = document.createElement('div');
      errDiv.style.cssText = 'color:red; border:1px solid red; padding:4px; font-size:12px; white-space:pre-wrap; background-color:#fff0f0;';
      errDiv.textContent = `PlantUML Error:\n${(e as Error).message}`;
      node.replaceWith(errDiv);
    }
  }));
};