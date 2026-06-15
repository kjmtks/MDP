declare module '@plantuml/core/viz-global.js';

declare module '@plantuml/core/plantuml.js' {
  export function render(lines: string[], targetId: string): Promise<void>;
}