import { processMermaid } from './mermaidPlugin';
import { processPlantUml } from './plantumlPlugin';

export const processSlidesPostHtml = async (htmlContent: string): Promise<string> => {
  if (!htmlContent.includes('class="mermaid"') && !htmlContent.includes('class="plantuml"')) {
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
  return div.innerHTML;
};