import { loadedModules, isModuleDisabled } from './moduleManager';
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
      // Inside an array literal, keep the backslash so the array splitter (not
      // this pass) resolves `\,` `\[` `\]`; elsewhere it just escapes the char.
      currentPart += inBracket ? '\\' + char : char;
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
      // Keep `\,` (and `\[` `\]`) intact inside an array literal so the array
      // splitter — not this top-level pass — decides item boundaries. For plain
      // values, `\,` still means a literal comma.
      args[key] = (value.startsWith('[') && value.endsWith(']')) ? value : value.replace(/\\,/g, ',');
    }
  });
  return args;
}

// Wrap a manipulable module's output in a positioning layer the ManipulationLayer
// can grab. Transform args (x,y = center %, w,h = canvas % , rot deg) become CSS;
// when x/y are absent the element stays in normal flow ("unlifted") until the
// first on-preview drag injects them. Blank lines keep nested markdown rendering.
function wrapManipulable(
  inner: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  manip: NonNullable<ModuleData['config']['manipulate']>,
  args: Record<string, string>,
  ord: number | undefined,
  inlineModule: boolean,
): string {
  const num = (v: string | undefined): number | undefined => {
    const n = v == null ? NaN : parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const x = num(args.x), y = num(args.y), w = num(args.w), h = num(args.h);
  const rot = num(args.rot) ?? 0;
  const hasPos = x !== undefined && y !== undefined;

  // A module with NO move/resize/rotate axes is "select-only": it can be framed
  // (red dashed) + given a context menu in Edit layout, but never dragged/lifted.
  const selectOnly = !manip.move && !manip.resize && !manip.rotate;

  const styles: string[] = [];
  if (selectOnly) {
    // display:contents → the wrapper generates NO box, so the module renders
    // exactly as before (zero layout impact). The overlay measures the inner
    // element instead. Keep it out of the text-selection / flow otherwise.
    styles.push('display:contents');
  } else if (hasPos) {
    styles.push('position:absolute', `left:${x}%`, `top:${y}%`);
    if (w !== undefined) styles.push(`width:${w}%`);
    if (h !== undefined) styles.push(`height:${h}%`);
    styles.push(`transform:translate(-50%,-50%) rotate(${rot}deg)`, 'transform-origin:center center');
  } else {
    styles.push('position:relative');
    // Inline modules stay in the text line until lifted (a div would force a
    // block); display:inline-block keeps the flow while still being a box the
    // ManipulationLayer can size.
    if (inlineModule) styles.push('display:inline-block', 'vertical-align:middle');
  }
  if (!selectOnly) {
    if (manip.minW != null) styles.push(`min-width:${manip.minW}%`);
    if (manip.maxW != null) styles.push(`max-width:${manip.maxW}%`);
    if (manip.minH != null) styles.push(`min-height:${manip.minH}%`);
    if (manip.maxH != null) styles.push(`max-height:${manip.maxH}%`);
  }

  const attrs = [
    'class="mdp-manip"',
    'data-mdp-manip="1"',
    ord != null ? `data-mdp-ord="${ord}"` : '',
    `data-move="${manip.move}"`,
    `data-resize="${manip.resize}"`,
    `data-rotate="${manip.rotate ? '1' : '0'}"`,
    `data-lifted="${hasPos ? '1' : '0'}"`,
    manip.minW != null ? `data-minw="${manip.minW}"` : '',
    manip.maxW != null ? `data-maxw="${manip.maxW}"` : '',
    manip.minH != null ? `data-minh="${manip.minH}"` : '',
    manip.maxH != null ? `data-maxh="${manip.maxH}"` : '',
  ].filter(Boolean).join(' ');

  // Inline modules: a <span> with no surrounding blank lines so markdown keeps it
  // in the text flow (the inner is already final HTML). Block modules: a <div>
  // padded with blank lines so the inner renders as markdown.
  if (inlineModule) return `<span ${attrs} style="${styles.join('; ')}">${inner}</span>`;
  return `\n\n<div ${attrs} style="${styles.join('; ')}">\n\n${inner}\n\n</div>\n\n`;
}

function renderModuleTemplate(mod: ModuleData, sections: string[], argsStr: string, ord?: number): string {
  const { parameters } = mod.config;
  const userArgs = parseArguments(argsStr || '');
  const finalArgs = { ...userArgs };

  if (parameters) {
    parameters.forEach(param => {
      if (finalArgs[param.name] === undefined && param.default !== undefined) {
        finalArgs[param.name] = param.default;
      }
    });

    // A required parameter with no default that the directive doesn't provide
    // can't be rendered meaningfully — surface it as a module error rather than
    // silently passing `undefined` to the render function.
    const missing = parameters.filter(p =>
      p.required && p.default === undefined &&
      (finalArgs[p.name] === undefined || String(finalArgs[p.name]).trim() === ''),
    );
    if (missing.length) {
      return `<div style="color:red; border:1px solid red; padding:1em; margin:1em 0; border-radius:4px;">
        <strong>Module Error (${mod.config.name})</strong><br/>
        Missing required argument${missing.length > 1 ? 's' : ''}: ${missing.map(m => m.name).join(', ')}.
      </div>`;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderArgs: Record<string, any> = { ...finalArgs };

  // Split a `[a, b, c]` literal into trimmed, unescaped string items.
  const splitArrayLiteral = (val: string): string[] => {
    const inner = val.slice(1, -1);
    if (inner.trim() === '') return [];
    return inner.split(/(?<!\\),/).map(s =>
      s.trim()
        .replace(/^["']|["']$/g, '')
        .replace(/\\,/g, ',')
        .replace(/\\\]/g, ']')
        .replace(/\\\[/g, '['),
    );
  };
  // Coerce string items to the param's item type (numbers for `[number]`,
  // booleans for `[boolean]`; everything else stays a string).
  const coerceItems = (items: string[], itemType?: string): unknown[] => {
    if (itemType === 'number') return items.map(s => { const n = parseFloat(s); return Number.isFinite(n) ? n : s; });
    if (itemType === 'boolean') return items.map(s => s === 'true' || s === '1');
    return items;
  };

  const paramByName = new Map((parameters || []).map(p => [p.name, p]));
  Object.keys(renderArgs).forEach(key => {
    const val = renderArgs[key];
    const meta = paramByName.get(key);
    if (meta?.isArray) {
      // Declared array: always pass a real array (typed items). A non-bracketed
      // value is treated leniently as a single-item list.
      if (typeof val !== 'string') return; // already an array (shouldn't happen)
      const t = val.trim();
      const items = (t.startsWith('[') && t.endsWith(']')) ? splitArrayLiteral(t) : (t === '' ? [] : [t]);
      renderArgs[key] = coerceItems(items, meta.type);
    } else if (typeof val === 'string' && val.startsWith('[') && val.endsWith(']')) {
      // Backward-compat: an untyped `[...]` value still becomes a string array.
      renderArgs[key] = splitArrayLiteral(val);
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
    // Wrap EVERY module: manipulable ones get a real positioning wrapper; the
    // rest get a layout-neutral select-only wrapper (display:contents) so they
    // can still be framed + given a context menu in Edit layout.
    const manip = mod.config.manipulate || { move: '' as const, resize: '' as const, rotate: false };
    // Inline modules, and block modules that opted into inline rendering, get the
    // inline (span, no surrounding blank lines) wrapper so they flow within text.
    const asInline = mod.config.type === 'inline' || !!mod.config.inlineRender;
    return wrapManipulable(generatedHtml, manip, finalArgs, ord, asInline);
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
  // Document-order index among manipulable block modules (identity fallback
  // until the directive gets an explicit `id`). undefined for non-manipulable.
  ord?: number;
}

export const applyModulesToMarkdown = (markdown: string): string => {
  if (!markdown) return '';
  const codeBlocks: string[] = [];
  const processed = markdown.replace(/```[\s\S]*?```|`[^`]+`/g, (match) => {
    const index = codeBlocks.length;
    codeBlocks.push(match);
    return `__MDP_CODE_BLOCK_${index}__`;
  });

  // NOTE: inline modules are rendered INSIDE the token walk below (not in a
  // separate pre-pass), so `manipOrd` is assigned to inline AND block manipulable
  // directives in a single document-order sequence — matching
  // parseModuleDirectives (moduleDocEdits.ts) so on-preview transforms write back
  // to the right directive.

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
  let manipOrd = 0; // assigned in document order at each manipulable block's start

  for (const token of tokens) {
    if (token.type === 'text') {
      if (stack.length > 0) stack[stack.length - 1].currentSectionStr += token.text;
      else rootStr += token.text;
    }
    else if (token.type === 'start') {
      // A disabled module is treated as unknown → its directive passes through
      // (renders as nothing) and its body, if any, stays as plain markdown.
      const mod = isModuleDisabled(token.name) ? undefined : loadedModules[token.name];
      if (mod && mod.config.type === 'block') {
        stack.push({
          name: token.name,
          argsStr: token.argsStr,
          sections: [],
          currentSectionStr: '',
          indent: token.indent,
          // Every module gets a document-order ord (selectable in Edit layout);
          // it identifies the directive for transforms / property / delete.
          ord: manipOrd++
        });
      } else if (mod && mod.config.type === 'inline') {
        // Self-contained inline module: render in place. Takes an `ord` from the
        // same document-order counter as blocks (so it's selectable too).
        const ord = manipOrd++;
        let html = renderModuleTemplate(mod, [], token.argsStr, ord);
        if (token.indent) html = html.replace(/\n/g, '\n' + token.indent);
        html = token.indent + html;
        if (stack.length > 0) stack[stack.length - 1].currentSectionStr += html;
        else rootStr += html;
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
        let html = renderModuleTemplate(mod, currentMod.sections, currentMod.argsStr, currentMod.ord);

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
    let html = renderModuleTemplate(mod, currentMod.sections, currentMod.argsStr, currentMod.ord);

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