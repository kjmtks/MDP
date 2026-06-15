import { loadedModules } from './moduleManager';
import type { ModuleData } from '../../utils/moduleParser';

export function parseArguments(argString: string): Record<string, string> {
  const args: Record<string, string> = {};
  if (!argString || !argString.trim()) return args;

  const parts: string[] = [];
  let currentPart = '';
  let inBracket = false;
  let inQuote = false;
  let escapeNext = false;

  for (let i = 0; i < argString.length; i++) {
    const char = argString[i];

    if (escapeNext) {
      currentPart += char;
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      escapeNext = true;
      continue;
    }

    if (char === '"' && !inBracket) {
      inQuote = !inQuote;
      continue;
    }

    if (char === '[' && !inQuote) inBracket = true;
    else if (char === ']' && !inQuote) inBracket = false;

    if (char === ',' && !inBracket && !inQuote) {
      parts.push(currentPart.trim());
      currentPart = '';
    } else {
      currentPart += char;
    }
  }
  parts.push(currentPart.trim());

  parts.forEach(part => {
    const colonIndex = part.indexOf(':');
    if (colonIndex > -1) {
      const key = part.substring(0, colonIndex).trim();
      let value = part.substring(colonIndex + 1).trim();
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      args[key] = value.replace(/\\,/g, ',');
    }
  });
  return args;
}

function renderModuleTemplate(mod: ModuleData, sections: string[], argsStr: string): string {
  const { parameters } = mod.config;
  const userArgs = parseArguments(argsStr || '');
  const finalArgs = { ...userArgs };

  if (parameters) {
    parameters.forEach(param => {
      if (finalArgs[param.name] === undefined && param.default !== undefined) {
        finalArgs[param.name] = param.default;
      }
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderArgs: Record<string, any> = { ...finalArgs };
  Object.keys(renderArgs).forEach(key => {
    const val = renderArgs[key];
    if (typeof val === 'string' && val.startsWith('[') && val.endsWith(']')) {
      const arrStr = val.substring(1, val.length - 1);
      if (arrStr.trim() === '') {
        renderArgs[key] = [];
      } else {
        renderArgs[key] = arrStr.split(/(?<!\\),/).map(s =>
          s.trim()
           .replace(/^["']|["']$/g, '')
           .replace(/\\,/g, ',')
           .replace(/\\\]/g, ']')
           .replace(/\\\[/g, '[')
        );
      }
    }
  });

  if (!mod.render) {
    return `<div style="color:red; border:1px solid red; padding:1em; margin:1em 0; border-radius:4px;">
      <strong>Module Error (${mod.config.name})</strong><br/>
      This module does not have a valid &lt;render&gt; tag.
    </div>`;
  }

  try {
    const renderFn = new Function('args', 'sections', 'content', mod.render);
    const generatedHtml = renderFn(renderArgs, sections, (sections[0] || '').trim());
    return generatedHtml;
  } catch (e) {
    console.error(`[MDP] Module Render Error (${mod.config.name}):`, e);
    return `<div style="color:red; border:1px solid red; padding:1em; margin:1em 0; border-radius:4px;">
      <strong>Module Render Error (${mod.config.name})</strong><br/>
      ${(e as Error).message}
    </div>`;
  }
}

type Token =
  | { type: 'text', text: string }
  | { type: 'start', name: string, argsStr: string, indent: string }
  | { type: 'separator', indent: string }
  | { type: 'end', name: string, indent: string };

interface StackContext {
  name: string;
  argsStr: string;
  sections: string[];
  currentSectionStr: string;
  indent: string;
}

export const applyModulesToMarkdown = (markdown: string): string => {
  if (!markdown) return '';
  const codeBlocks: string[] = [];
  let processed = markdown.replace(/```[\s\S]*?```|`[^`]+`/g, (match) => {
    const index = codeBlocks.length;
    codeBlocks.push(match);
    return `__MDP_CODE_BLOCK_${index}__`;
  });

  Object.values(loadedModules).forEach(mod => {
    if (mod.config.type !== 'inline') return;
    const { name } = mod.config;
    const inlineStart = "([ \\t]*)<" + "!--\\s*@" + name + "\\s*(.*?)\\s*--" + ">";
    const inlineRegex = new RegExp(inlineStart, "g");

    processed = processed.replace(inlineRegex, (_match, indent, argsStr): string => {
      let html = renderModuleTemplate(mod, [], argsStr);
      if (indent) {
        html = html.replace(/\n/g, '\n' + indent);
      }
      return indent + html;
    });
  });

  const tokens: Token[] = [];
  const tokenRegex = /([ \t]*)<!--\s*@(end)?([a-zA-Z0-9_-]*)\s*(.*?)\s*-->/g;
  let lastIndex = 0;
  let match;

  while ((match = tokenRegex.exec(processed)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', text: processed.substring(lastIndex, match.index) });
    }
    const indent = match[1] || '';
    const isEnd = !!match[2];
    const name = match[3];
    const argsStr = match[4];

    if (!isEnd && name === '' && argsStr === '') {
      tokens.push({ type: 'separator', indent });
    } else if (isEnd) {
      tokens.push({ type: 'end', name: name || '', indent });
    } else if (!isEnd && name) {
      tokens.push({ type: 'start', name, argsStr, indent });
    } else {
      tokens.push({ type: 'text', text: match[0] });
    }
    lastIndex = tokenRegex.lastIndex;
  }
  if (lastIndex < processed.length) {
    tokens.push({ type: 'text', text: processed.substring(lastIndex) });
  }

  const stack: StackContext[] = [];
  let rootStr = "";

  for (const token of tokens) {
    if (token.type === 'text') {
      if (stack.length > 0) stack[stack.length - 1].currentSectionStr += token.text;
      else rootStr += token.text;
    }
    else if (token.type === 'start') {
      const mod = loadedModules[token.name];
      if (mod && mod.config.type === 'block') {
        stack.push({
          name: token.name,
          argsStr: token.argsStr,
          sections: [],
          currentSectionStr: '',
          indent: token.indent
        });
      } else {
        const text = `${token.indent}<!-- @${token.name} ${token.argsStr} -->`;
        if (stack.length > 0) stack[stack.length - 1].currentSectionStr += text;
        else rootStr += text;
      }
    }
    else if (token.type === 'separator') {
      if (stack.length > 0) {
        const currentMod = stack[stack.length - 1];
        currentMod.sections.push(currentMod.currentSectionStr);
        currentMod.currentSectionStr = '';
      } else {
        rootStr += `${token.indent}<!-- @ -->`;
      }
    }
    else if (token.type === 'end') {
      if (stack.length > 0 && (!token.name || stack[stack.length - 1].name === token.name)) {
        const currentMod = stack.pop()!;
        currentMod.sections.push(currentMod.currentSectionStr);

        const mod = loadedModules[currentMod.name];
        let html = renderModuleTemplate(mod, currentMod.sections, currentMod.argsStr);

        if (currentMod.indent) {
          html = html.replace(/\n/g, '\n' + currentMod.indent);
        }
        html = currentMod.indent + html;

        if (stack.length > 0) stack[stack.length - 1].currentSectionStr += html;
        else rootStr += html;
      } else {
        const text = token.name ? `${token.indent}<!-- @end${token.name} -->` : `${token.indent}<!-- @end -->`;
        if (stack.length > 0) stack[stack.length - 1].currentSectionStr += text;
        else rootStr += text;
      }
    }
  }

  while (stack.length > 0) {
    const currentMod = stack.pop()!;
    currentMod.sections.push(currentMod.currentSectionStr);
    const mod = loadedModules[currentMod.name];
    let html = renderModuleTemplate(mod, currentMod.sections, currentMod.argsStr);

    if (currentMod.indent) {
      html = html.replace(/\n/g, '\n' + currentMod.indent);
    }
    html = currentMod.indent + html;

    if (stack.length > 0) stack[stack.length - 1].currentSectionStr += html;
    else rootStr += html;
  }
  codeBlocks.forEach((block, index) => {
    rootStr = rootStr.replace(`__MDP_CODE_BLOCK_${index}__`, () => block);
  });

  return rootStr;
};