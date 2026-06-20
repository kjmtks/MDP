import { processMermaid } from './mermaidPlugin';
import { processPlantUml } from './plantumlPlugin';
import { processCharts } from './chartjsPlugin';

export const processSlidesPostHtml = async (htmlContent: string): Promise<string> => {
  const hasChart = htmlContent.includes('chartjs-render');
  if (!htmlContent.includes('class="mermaid"') && !htmlContent.includes('class="plantuml"') && !hasChart) {
    return htmlContent;
  }
  const div = document.createElement('div');
  div.innerHTML = htmlContent;
  if (htmlContent.includes('class="mermaid"')) {
    await processMermaid(div);
  }
  if (htmlContent.includes('class="plantuml"')) {
    await processPlantUml(div);
  }
  if (hasChart) {
    await processCharts(div);
  }
  return div.innerHTML;
};