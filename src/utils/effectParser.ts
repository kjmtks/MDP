// Parser for `*.mdpfx.xml` effect-definition files. Effects are a separate
// first-class concept from modules (they live in the `.effect` folder and never
// transform markdown). An effect defines enter / emphasis / leave phases via a
// CSS phase-class convention and/or optional JS hooks.

import { parseParamElements, type ModuleParam } from './moduleParser';

// Effect params share the module param shape (settings-UI metadata: type / label
// / options / min / max …) so the same settings dialog can edit them.
export type EffectParam = ModuleParam;

export interface EffectConfig {
  name: string;
  description: string;
  // Optional hand-written self-description for the AI slide-authoring prompt
  // (features/ai/slideSpecPrompt.ts). Falls back to description + params when absent.
  aiSpec?: string;
  parameters: EffectParam[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  snippets: any[];
  // Taxonomy tags (from `<tags>a, b, c</tags>`): FIRST tag = usage bucket
  // (transition | emphasis | special), the rest style descriptors. Used to group
  // the compact effect index and power suggest_effects. Empty when unset.
  tags: string[];
}

export interface EffectData {
  config: EffectConfig;
  style: string;
  script: string;
}

export const parseMdpfxXml = (content: string): EffectData | null => {
  if (!content) return null;
  const cleanContent = content.replace(/^﻿/, '').trim();

  const parser = new DOMParser();
  const doc = parser.parseFromString(cleanContent, 'application/xml');

  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    console.error('[MDP] Effect XML Parse Error:', parseError.textContent);
    return null;
  }

  const root = doc.querySelector('effect');
  if (!root) return null;

  const name = root.querySelector('name')?.textContent?.trim() || '';
  const description = root.querySelector('description')?.textContent?.trim() || '';
  const aiSpec = root.querySelector('aiSpec')?.textContent?.trim() || undefined;
  const tags = (root.querySelector('tags')?.textContent || '')
    .split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);

  const parameters = parseParamElements(root);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snippets: any[] = [];
  root.querySelectorAll('snippets > snippet').forEach((s) => {
    snippets.push({
      category: s.querySelector('category')?.textContent?.trim() || 'Effects',
      label: s.querySelector('label')?.textContent?.trim() || name,
      text: s.querySelector('text')?.textContent?.trim() || '',
      description: s.querySelector('description')?.textContent?.trim() || '',
      isModule: true,
    });
  });

  return {
    config: { name, description, aiSpec, parameters, snippets, tags },
    style: root.querySelector('style')?.textContent?.trim() || '',
    script: root.querySelector('script')?.textContent?.trim() || '',
  };
};
