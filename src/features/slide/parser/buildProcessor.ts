import { parseArguments } from '../../modules/moduleProcessor';
import type { AnswerSpec } from './SlideContext';

// Converts in-slide build blocks
//   <!-- @build step: 1 --> ...markdown... <!-- @end -->
// into a wrapper element the slideshow runtime can drive:
//   <div class="mdp-build" data-mdp-enter="1" data-mdp-effect="fade"> ...markdown... </div>
// `step: N` is shorthand for `enter: N`. A single block may declare a lifecycle
// across steps: `enter`, `emphasis`, `exit` (plus per-action effect overrides).
//
// The same pass handles ANSWER blocks
//   <!-- @answer --> ...markdown... <!-- @end -->
// on one stack, so a build may hold an answer and an answer a build. Shown (the
// default), an answer is a plain wrapper. Hidden (`@answers hide` on the meta
// page, or the editor's answers toggle) it keeps its place — by default its
// size too — but nothing in it is painted, so a handout printed from the
// instructor's deck has a frame to write in where each answer was.
//
// Runs AFTER module processing (modules consume their own `@end`). `@end` /
// `@endbuild` / `@endanswer` closes the nearest open build or answer; an `@end`
// with nothing open is left in place. Returns the rewritten markdown and the
// slide's total step count.

const escAttr = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

interface Frame { kind: 'build' | 'answer'; argsStr: string; inner: string; }

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

// `space:` as a CSS length. A bare number is in slide pixels (it follows
// @resolution, like the modules' lengths); characters that could leave the
// style attribute are dropped.
const spaceLength = (v: string): string => {
  const s = v.replace(/[<>"';{}]/g, '').trim();
  return /^\d+(\.\d+)?$/.test(s) ? `calc(${s} * var(--mdp-px, 1px))` : s;
};

// Args (the block's own over the deck's `@answers` defaults):
//   space: auto (default) — the blank is exactly as large as the answer
//          <length>       — a blank of that height; the answer is left out
//          none           — nothing at all (content only the instructor's copy has:
//                           hidden, it leaves no gap)
//   label: text shown in the corner of the blank (e.g. 解答欄)
//   frame: box (default) | none — the outline marking the blank
const wrapAnswer = (frame: Frame, spec: AnswerSpec | undefined): string => {
  if (!spec?.hide) return `\n\n<div class="mdp-answer">\n\n${frame.inner}\n\n</div>\n\n`;
  const args = { ...spec.args, ...parseArguments(frame.argsStr) };
  const space = (args.space || 'auto').trim();
  if (/^(none|0+(\.0+)?[a-z%]*)$/i.test(space)) return '\n\n';
  const noFrame = /^(none|off|false|no)$/i.test((args.frame || '').trim());
  const cls = `mdp-answer mdp-answer-hidden${noFrame ? ' mdp-answer-noframe' : ''}`;
  const label = (args.label || '').trim();
  const labelHtml = label ? `<div class="mdp-answer-label">${escAttr(label)}</div>` : '';
  if (space.toLowerCase() !== 'auto') {
    return `\n\n<div class="${cls} mdp-answer-space" style="height: ${spaceLength(space)}">${labelHtml}</div>\n\n`;
  }
  // Laid out (so the blank keeps the answer's exact size) but not painted — not
  // in a PDF, a PNG or a PPTX either (see .mdp-answer-hidden in SlideViewer.css).
  return `\n\n<div class="${cls}">${labelHtml}<div class="mdp-answer-body" aria-hidden="true">\n\n${frame.inner}\n\n</div></div>\n\n`;
};

export const applyBuildsToMarkdown = (
  markdown: string,
  globalBuildArgs: Record<string, string> = {},
  answers?: AnswerSpec,
): { markdown: string; stepCount: number } => {
  if (!markdown || !/@(build|answer)\b/.test(markdown)) {
    return { markdown: markdown || '', stepCount: 0 };
  }

  const codeBlocks: string[] = [];
  const processed = markdown.replace(/```[\s\S]*?```|`[^`]+`/g, (m) => {
    codeBlocks.push(m);
    return `__MDP_BUILD_CB_${codeBlocks.length - 1}__`;
  });

  const tokenRegex = /([ \t]*)<!--\s*@(endbuild|endanswer|end|build|answer)\b\s*([\s\S]*?)\s*-->/g;
  const stack: Frame[] = [];
  let root = '';
  let maxStep = 0;
  let lastIndex = 0;
  let m: RegExpExecArray | null;

  const append = (text: string) => {
    if (stack.length) stack[stack.length - 1].inner += text;
    else root += text;
  };
  const close = (frame: Frame) => {
    if (frame.kind === 'answer') { append(wrapAnswer(frame, answers)); return; }
    const { html, stepCount } = wrapBuild(frame, globalBuildArgs);
    if (stepCount > maxStep) maxStep = stepCount;
    append(html);
  };

  while ((m = tokenRegex.exec(processed)) !== null) {
    if (m.index > lastIndex) append(processed.substring(lastIndex, m.index));
    lastIndex = tokenRegex.lastIndex;

    const kind = m[2];
    const argsStr = m[3] || '';

    if (kind === 'build' || kind === 'answer') {
      stack.push({ kind, argsStr, inner: '' });
    } else if (stack.length) {
      close(stack.pop()!);
    } else {
      // A stray @end (e.g. a module's): leave it in place.
      append(m[0]);
    }
  }
  if (lastIndex < processed.length) append(processed.substring(lastIndex));

  while (stack.length) close(stack.pop()!);

  codeBlocks.forEach((b, i) => { root = root.replace(`__MDP_BUILD_CB_${i}__`, () => b); });
  return { markdown: root, stepCount: maxStep };
};
