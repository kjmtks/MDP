import { parseArguments } from '../../modules/moduleProcessor';

// Converts in-slide build blocks
//   <!-- @build step: 1 --> ...markdown... <!-- @end -->
// into a wrapper element the slideshow runtime can drive:
//   <div class="mdp-build" data-mdp-enter="1" data-mdp-effect="fade"> ...markdown... </div>
// `step: N` is shorthand for `enter: N`. A single block may declare a lifecycle
// across steps: `enter`, `emphasis`, `exit` (plus per-action effect overrides).
//
// Builds are processed BEFORE module processing. `@end`/`@endbuild` closes the
// nearest open `@build`; any other `@end` is left untouched for the module
// processor. Returns the rewritten markdown and the slide's total step count.

const escAttr = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

interface Frame { argsStr: string; inner: string; }

const wrapBuild = (frame: Frame, globalArgs: Record<string, string>): { html: string; stepCount: number } => {
  const args = { ...globalArgs, ...parseArguments(frame.argsStr) };

  const enter = Number(args.enter ?? args.step ?? 1) || 1;
  const emphasis = args.emphasis != null && args.emphasis !== '' ? Number(args.emphasis) : undefined;
  const exit = args.exit != null && args.exit !== '' ? Number(args.exit) : undefined;
  const effect = args.effect || 'fade';

  const attrs: string[] = [
    'class="mdp-build"',
    `data-mdp-enter="${enter}"`,
    `data-mdp-effect="${escAttr(effect)}"`,
  ];
  if (emphasis != null && !Number.isNaN(emphasis)) attrs.push(`data-mdp-emphasis="${emphasis}"`);
  if (exit != null && !Number.isNaN(exit)) attrs.push(`data-mdp-exit="${exit}"`);
  if (args.emphasisEffect) attrs.push(`data-mdp-emphasis-effect="${escAttr(args.emphasisEffect)}"`);
  if (args.exitEffect) attrs.push(`data-mdp-exit-effect="${escAttr(args.exitEffect)}"`);
  if (args.duration) attrs.push(`data-mdp-duration="${escAttr(args.duration)}"`);
  if (args.easing) attrs.push(`data-mdp-easing="${escAttr(args.easing)}"`);
  if (args.stagger) attrs.push(`data-mdp-stagger="${escAttr(args.stagger)}"`);
  // auto: <ms> → after this build enters, automatically advance to the next
  // step after <ms> (in addition to the build's own duration). Omit for manual.
  if (args.auto != null && args.auto !== '') {
    const autoMs = Number(args.auto);
    attrs.push(`data-mdp-auto="${Number.isNaN(autoMs) ? 0 : autoMs}"`);
  }

  const stepNums = [enter, emphasis, exit].filter(
    (n): n is number => typeof n === 'number' && !Number.isNaN(n),
  );
  const stepCount = stepNums.length ? Math.max(...stepNums) : 0;

  // Blank lines around the inner markdown so marked parses it as markdown
  // (CommonMark ends the opening <div> HTML block at the blank line).
  const html = `\n\n<div ${attrs.join(' ')}>\n\n${frame.inner}\n\n</div>\n\n`;
  return { html, stepCount };
};

export const applyBuildsToMarkdown = (
  markdown: string,
  globalBuildArgs: Record<string, string> = {},
): { markdown: string; stepCount: number } => {
  if (!markdown || !/@build\b/.test(markdown)) {
    return { markdown: markdown || '', stepCount: 0 };
  }

  const codeBlocks: string[] = [];
  const processed = markdown.replace(/```[\s\S]*?```|`[^`]+`/g, (m) => {
    codeBlocks.push(m);
    return `__MDP_BUILD_CB_${codeBlocks.length - 1}__`;
  });

  const tokenRegex = /([ \t]*)<!--\s*@(endbuild|end|build)\b\s*([\s\S]*?)\s*-->/g;
  const stack: Frame[] = [];
  let root = '';
  let maxStep = 0;
  let lastIndex = 0;
  let m: RegExpExecArray | null;

  const append = (text: string) => {
    if (stack.length) stack[stack.length - 1].inner += text;
    else root += text;
  };

  while ((m = tokenRegex.exec(processed)) !== null) {
    if (m.index > lastIndex) append(processed.substring(lastIndex, m.index));
    lastIndex = tokenRegex.lastIndex;

    const kind = m[2];
    const argsStr = m[3] || '';

    if (kind === 'build') {
      stack.push({ argsStr, inner: '' });
    } else if (stack.length) {
      const frame = stack.pop()!;
      const { html, stepCount } = wrapBuild(frame, globalBuildArgs);
      if (stepCount > maxStep) maxStep = stepCount;
      append(html);
    } else {
      // A stray @end (e.g. a module's): leave it for the module processor.
      append(m[0]);
    }
  }
  if (lastIndex < processed.length) append(processed.substring(lastIndex));

  while (stack.length) {
    const frame = stack.pop()!;
    const { html, stepCount } = wrapBuild(frame, globalBuildArgs);
    if (stepCount > maxStep) maxStep = stepCount;
    append(html);
  }

  codeBlocks.forEach((b, i) => { root = root.replace(`__MDP_BUILD_CB_${i}__`, () => b); });
  return { markdown: root, stepCount: maxStep };
};
