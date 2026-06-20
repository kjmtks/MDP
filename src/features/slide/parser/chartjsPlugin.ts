// Bake `@chartjs` placeholders into a static <img> directly in the slide HTML —
// the SAME model as mermaid/plantuml (see slidePostProcessing). Doing it here, at
// slide-GENERATION time, means `slide.html` already contains the rendered chart,
// so it appears on EVERY surface (live preview, thumbnails, PDF/print, overview)
// with no runtime hydration. A runtime <canvas> approach failed on those surfaces:
// it depended on layout/visibility/animation timing that thumbnails and the print
// snapshot don't satisfy. Rendered off-screen once and cached by config.

// Fixed off-screen render resolution (the placeholder is `width:100%; height:400px`
// ≈ 3.2:1 for a 16:9 slide); the <img> then scales to the box via object-fit.
const RENDER_W = 1280;
const RENDER_H = 400;

const chartCache = new Map<string, string>(); // base64 config -> <img> tag

export const processCharts = async (div: HTMLElement): Promise<void> => {
  const nodes = Array.from(div.querySelectorAll<HTMLElement>('.chartjs-render'));
  if (!nodes.length) return;

  const { default: Chart } = await import('chart.js/auto');

  for (const node of nodes) {
    const base64 = node.getAttribute('data-chart');
    if (!base64) continue;

    if (chartCache.has(base64)) {
      node.innerHTML = chartCache.get(base64)!;
      node.removeAttribute('data-chart');
      continue;
    }

    let imgTag = '';
    let ok = false;
    try {
      const binString = atob(base64);
      const bytes = new Uint8Array(binString.length);
      for (let i = 0; i < binString.length; i++) bytes[i] = binString.charCodeAt(i);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const config: any = JSON.parse(new TextDecoder().decode(bytes));
      if (!config.options) config.options = {};
      config.options.responsive = false;
      config.options.maintainAspectRatio = false;
      config.options.animation = false;

      // Attach off-screen (a fully detached canvas may not paint) and force a
      // synchronous draw — Chart.js routes the initial render through its animation
      // loop, so even with animation:false the paint can land AFTER toDataURL.
      const canvas = document.createElement('canvas');
      canvas.width = RENDER_W;
      canvas.height = RENDER_H;
      canvas.style.cssText = `position:fixed;left:-99999px;top:0;width:${RENDER_W}px;height:${RENDER_H}px;`;
      document.body.appendChild(canvas);
      try {
        const chart = new Chart(canvas, config);
        chart.draw();
        const url = canvas.toDataURL('image/png');
        chart.destroy();
        imgTag = `<img src="${url}" alt="chart" style="width:100%;height:100%;object-fit:contain;" />`;
        ok = true;
      } finally {
        canvas.remove();
      }
    } catch (e) {
      console.warn('Chart render error', e);
      imgTag = `<div style="color:red">Chart Render Error</div>`;
    }

    if (ok) chartCache.set(base64, imgTag); // never cache an error — let it retry
    node.innerHTML = imgTag;
    node.removeAttribute('data-chart');
  }
};
