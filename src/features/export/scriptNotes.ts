// A slide's @script as the notes of an exported PowerPoint slide — what the
// presenter reads, as plain text (PowerPoint renders nothing in its notes pane):
// the markers gone, each ruby its word, Markdown marks dropped, and every formula
// written out in Unicode (ω₀ = 2π/T, 𝐖ᵀ𝐱) with its spoken reading in brackets when
// the script gives one — the narrator's words for it.
import { scriptForReader, slideScript } from '../autoplay/autoplay';

const GREEK: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π',
  varpi: 'ϖ', rho: 'ρ', varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'ϕ',
  varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ',
  Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
};
const SYMBOLS: Record<string, string> = {
  times: '×', cdot: '·', pm: '±', mp: '∓', div: '÷', le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠',
  neq: '≠', approx: '≈', sim: '∼', simeq: '≃', equiv: '≡', propto: '∝', infty: '∞', partial: '∂',
  nabla: '∇', sum: 'Σ', prod: 'Π', int: '∫', iint: '∬', oint: '∮', to: '→', rightarrow: '→',
  leftarrow: '←', gets: '←', Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔', iff: '⇔',
  implies: '⇒', leftrightarrow: '↔', mapsto: '↦', in: '∈', notin: '∉', ni: '∋', subset: '⊂',
  subseteq: '⊆', supset: '⊃', supseteq: '⊇', cup: '∪', cap: '∩', emptyset: '∅', varnothing: '∅',
  forall: '∀', exists: '∃', neg: '¬', lnot: '¬', land: '∧', wedge: '∧', lor: '∨', vee: '∨',
  ldots: '…', cdots: '⋯', dots: '…', vdots: '⋮', ddots: '⋱', prime: '′', circ: '∘', star: '⋆',
  ast: '∗', top: '⊤', bot: '⊥', perp: '⊥', mid: '|', parallel: '∥', langle: '⟨', rangle: '⟩',
  lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉', ll: '≪', gg: '≫', otimes: '⊗', oplus: '⊕',
  odot: '⊙', setminus: '∖', angle: '∠', triangle: '△', hbar: 'ℏ', ell: 'ℓ', aleph: 'ℵ',
  degree: '°', lbrace: '{', rbrace: '}', vert: '|', Vert: '‖', lvert: '|', rvert: '|', lVert: '‖',
  rVert: '‖', leqslant: '≤', geqslant: '≥', coloneqq: '≔', triangleq: '≜', quad: ' ', qquad: ' ',
  '|': '‖', '{': '{', '}': '}', '%': '%', '#': '#', '&': '&', _: '_', $: '$',
  ',': ' ', ';': ' ', ':': ' ', '!': '', ' ': ' ',
};
// Written as words, as KaTeX sets them upright (\sin x, \log p, \max_i).
const FUNCS = new Set([
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh',
  'log', 'ln', 'lg', 'exp', 'max', 'min', 'sup', 'inf', 'lim', 'limsup', 'liminf', 'det', 'dim',
  'ker', 'arg', 'deg', 'gcd', 'Pr', 'mod', 'bmod',
]);
const SUP: Record<string, string> = {
  0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻',
  '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', a: 'ᵃ', b: 'ᵇ', c: 'ᶜ', d: 'ᵈ', e: 'ᵉ', f: 'ᶠ', g: 'ᵍ',
  h: 'ʰ', i: 'ⁱ', j: 'ʲ', k: 'ᵏ', l: 'ˡ', m: 'ᵐ', n: 'ⁿ', o: 'ᵒ', p: 'ᵖ', r: 'ʳ', s: 'ˢ', t: 'ᵗ',
  u: 'ᵘ', v: 'ᵛ', w: 'ʷ', x: 'ˣ', y: 'ʸ', z: 'ᶻ', T: 'ᵀ', '⊤': 'ᵀ', '*': '*', '∗': '*', '′': '′', "'": '′',
};
const SUB: Record<string, string> = {
  0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '-': '₋',
  '−': '₋', '=': '₌', '(': '₍', ')': '₎', a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ',
  m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ', r: 'ᵣ', s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ',
};
const ACCENT: Record<string, string> = {
  hat: '\u0302', widehat: '\u0302', bar: '\u0304', overline: '\u0305', tilde: '\u0303', widetilde: '\u0303',
  vec: '\u20d7', dot: '\u0307', ddot: '\u0308', check: '\u030c', breve: '\u0306', acute: '\u0301', grave: '\u0300',
};
const BLACKBOARD: Record<string, string> = { R: 'ℝ', N: 'ℕ', Z: 'ℤ', Q: 'ℚ', C: 'ℂ', P: 'ℙ', E: '𝔼', H: 'ℍ' };
const SCRIPT_GAPS: Record<string, string> = { B: 'ℬ', E: 'ℰ', F: 'ℱ', H: 'ℋ', I: 'ℐ', L: 'ℒ', M: 'ℳ', R: 'ℛ' };
const PLAIN = new Set([
  'mathrm', 'text', 'textrm', 'textnormal', 'mathit', 'textit', 'mathsf', 'textsf', 'mathtt', 'texttt',
  'operatorname', 'mbox', 'hbox', 'mathop', 'mathrel', 'mathbin', 'mathord', 'mathopen', 'mathclose',
  'boxed', 'underbrace', 'overbrace', 'underline', 'phantom',
]);
// Two arguments, of which only the second is shown: \focus{name}{…} (MDP's named
// place), \textcolor{red}{…}, \htmlData{…}{…}, \overset{over}{base}.
const SECOND = new Set(['focus', 'textcolor', 'colorbox', 'htmlData', 'htmlClass', 'htmlId', 'htmlStyle', 'overset', 'underset', 'stackrel']);
// Switches with nothing to show.
const SILENT = new Set(['displaystyle', 'textstyle', 'scriptstyle', 'limits', 'nolimits', 'nonumber', 'notag']);
const BOLD = new Set(['mathbf', 'boldsymbol', 'bm', 'textbf', 'pmb']);
const SIZES = new Set(['left', 'right', 'big', 'Big', 'bigg', 'Bigg', 'bigl', 'bigr', 'Bigl', 'Bigr', 'middle']);
const ENV_OPEN: Record<string, string> = { pmatrix: '(', bmatrix: '[', Bmatrix: '{', vmatrix: '|', Vmatrix: '‖', cases: '{' };
const ENV_CLOSE: Record<string, string> = { pmatrix: ')', bmatrix: ']', Bmatrix: '}', vmatrix: '|', Vmatrix: '‖' };

const cp = (c: string) => c.codePointAt(0) || 0;
/** Mathematical bold for Latin letters, digits and Greek (𝐱, 𝐖, 𝛉); other characters as they are. */
function bold(s: string): string {
  return [...s].map((c) => {
    const n = cp(c);
    if (c >= 'A' && c <= 'Z') return String.fromCodePoint(0x1d400 + n - 65);
    if (c >= 'a' && c <= 'z') return String.fromCodePoint(0x1d41a + n - 97);
    if (c >= '0' && c <= '9') return String.fromCodePoint(0x1d7ce + n - 48);
    if (n >= 0x391 && n <= 0x3a9 && n !== 0x3a2) return String.fromCodePoint(0x1d6a8 + n - 0x391);
    if (n >= 0x3b1 && n <= 0x3c9) return String.fromCodePoint(0x1d6c2 + n - 0x3b1);
    return c;
  }).join('');
}
const blackboard = (s: string) => [...s].map((c) => BLACKBOARD[c] || c).join('');
const script = (s: string) => [...s].map((c) => (c >= 'A' && c <= 'Z' ? SCRIPT_GAPS[c] || String.fromCodePoint(0x1d49c + cp(c) - 65) : c)).join('');
const accent = (s: string, mark: string, every: boolean) => {
  const chars = [...s];
  if (!chars.length) return '';
  return every ? chars.map((c) => (/\s/.test(c) ? c : c + mark)).join('') : chars[0] + mark + chars.slice(1).join('');
};
// A part of a fraction or a root needs brackets when it is more than one term.
const compound = (s: string) => [...s].length > 1 && /[\s+\-−×·/=<>≤≥±,]/.test(s);
const bracket = (s: string) => (compound(s) ? `(${s})` : s);
function script2(s: string, map: Record<string, string>, mark: string): string {
  if (!s) return '';
  const chars = [...s];
  if (chars.every((c) => map[c] !== undefined)) return chars.map((c) => map[c]).join('');
  return chars.length === 1 ? `${mark}${s}` : `${mark}(${s})`;
}

// Spaced as typeset: a relation or a binary operator between spaces (a = b + c), a
// sign at the start or after a bracket or an operator unary (-x); the source's own
// spaces mean nothing in maths, as in LaTeX.
const REL = new Set(['=', '<', '>', '≠', '≤', '≥', '≈', '∼', '≃', '≡', '∝', '∈', '∉', '∋', '⊂', '⊆', '⊃', '⊇', '→', '←', '⇒', '⇐', '⇔', '↔', '↦', '≪', '≫', '∥', '≔', '≜']);
const BIN = new Set(['+', '-', '−', '±', '∓', '×', '·', '÷', '∪', '∩', '∖', '⊗', '⊕', '⊙', '∘', '∧', '∨']);
const LARGE = new Set(['sum', 'prod', 'int', 'iint', 'oint', 'bigcup', 'bigcap', 'coprod']);
// Text, not maths: its spaces stay.
const TEXT = new Set(['text', 'textrm', 'textnormal', 'textit', 'textsf', 'texttt', 'textbf', 'mbox', 'hbox']);
const NOT_MARK = String.fromCharCode(0x338);

/** A LaTeX formula (no delimiters) written out in Unicode — readable, not exact:
 *  \frac{a}{b} → a/b, x^2 → x², \mathbf{W}^\top → 𝐖ᵀ, \sqrt{x+1} → √(x + 1).
 *  `spaced` = false inside a sub- or superscript (x⁻¹, not x⁻ ¹). */
export function latexToText(tex: string, spaced = true): string {
  const s = String(tex || '');
  const envs: string[] = [];
  // the argument at i: a {group}, a \command, or one character — and where it ends
  const arg = (i: number): [string, number] => {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (s[i] === '{') {
      let depth = 0;
      for (let j = i; j < s.length; j++) {
        if (s[j] === '\\') { j++; continue; }
        if (s[j] === '{') depth++;
        else if (s[j] === '}' && --depth === 0) return [s.slice(i + 1, j), j + 1];
      }
      return [s.slice(i + 1), s.length];
    }
    if (s[i] === '\\') {
      let j = i + 1;
      if (/[A-Za-z]/.test(s[j] || '')) while (j < s.length && /[A-Za-z]/.test(s[j])) j++;
      else j++;
      return [s.slice(i, j), j];
    }
    return [s[i] ?? '', Math.min(s.length, i + 1)];
  };
  let out = '';
  // After Σ / ∫ / sin … (and their scripts): a space before what they act on.
  let operand = false;
  const emit = (t: string) => {
    if (!t) return;
    if (operand) {
      operand = false;
      if (spaced && !/^[()[\]{}.,;!']/.test(t) && !/\s$/.test(out)) out += ' ';
    }
    out += t;
  };
  const op = (t: string) => {
    operand = false;
    if (!spaced) { out += t; return; }
    const prev = out.replace(/\s+$/, '');
    const last = [...prev].pop() || '';
    if (BIN.has(t) && (!prev || /[([{⟨⌊⌈,;|]/.test(last) || REL.has(last) || BIN.has(last))) {
      out = prev + (prev && !/[([{⟨⌊⌈|]/.test(last) ? ' ' : '') + t;   // a sign: -x, a = -b, (a, -b)
      return;
    }
    out = `${prev} ${t} `;
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '\\') {
      let j = i + 1;
      if (/[A-Za-z]/.test(s[j] || '')) while (j < s.length && /[A-Za-z]/.test(s[j])) j++;
      else j++;
      const name = s.slice(i + 1, j);
      i = j;
      const raw = () => { const [a, k] = arg(i); i = k; return a; };
      const one = (sp = spaced) => latexToText(raw(), sp);
      if (name === 'frac' || name === 'dfrac' || name === 'tfrac' || name === 'cfrac') { const a = one(); const b = one(); emit(`${bracket(a)}/${bracket(b)}`); continue; }
      if (name === 'binom' || name === 'dbinom') { const a = one(); const b = one(); emit(`C(${a}, ${b})`); continue; }
      if (name === 'sqrt') {
        let index = '';
        if (s[i] === '[') { const e = s.indexOf(']', i); if (e > i) { index = latexToText(s.slice(i + 1, e), false); i = e + 1; } }
        const a = one();
        emit(`${index ? script2(index, SUP, '^') : ''}√${bracket(a)}`);
        continue;
      }
      if (ACCENT[name]) { emit(accent(one(false), ACCENT[name], name === 'overline' || name === 'widehat' || name === 'widetilde')); continue; }
      if (BOLD.has(name)) { emit(bold(name === 'textbf' ? raw() : one())); continue; }
      if (name === 'mathbb') { emit(blackboard(one(false))); continue; }
      if (name === 'mathcal' || name === 'mathscr') { emit(script(one(false))); continue; }
      if (TEXT.has(name)) { emit(raw()); continue; }
      if (name === 'operatorname') { emit(one(false)); operand = true; continue; }
      if (PLAIN.has(name)) { emit(one()); continue; }
      if (SECOND.has(name)) { raw(); emit(one()); continue; }
      if (name === 'color') { raw(); continue; }
      if (SILENT.has(name)) continue;
      if (SIZES.has(name)) { while (s[i] === ' ') i++; if (s[i] === '.') i++; continue; }
      if (name === 'begin' || name === 'end') {
        const env = raw();
        if (name === 'begin') { envs.push(env); emit(ENV_OPEN[env] || ''); } else { envs.pop(); emit(ENV_CLOSE[env] || ''); }
        continue;
      }
      if (name === '\\') { out = `${out.replace(/\s+$/, '')}; `; continue; }
      if (name === 'not') {
        const a = latexToText(raw(), false);
        if (a === '=') op('≠');
        else if (a === '∈') op('∉');
        else emit(a + NOT_MARK);
        continue;
      }
      if (name === 'mid') { op('|'); continue; }
      if (GREEK[name]) { emit(GREEK[name]); continue; }
      if (LARGE.has(name)) { emit(SYMBOLS[name]); operand = true; continue; }
      if (SYMBOLS[name] !== undefined) {
        const t = SYMBOLS[name];
        if (REL.has(t) || BIN.has(t)) op(t);
        else if (t === ' ') out += ' ';
        else emit(t);
        continue;
      }
      if (FUNCS.has(name)) { emit(name); operand = true; continue; }
      emit(name);   // anything else: its name (KaTeX would not hide it either)
      continue;
    }
    if (c === '^' || c === '_') {
      const [a, k] = arg(i + 1);
      i = k;
      const body = latexToText(a, false);
      out += c === '^' ? script2(body, SUP, '^') : script2(body, SUB, '_');
      continue;
    }
    if (c === '{') { const [a, k] = arg(i); i = k; emit(latexToText(a, spaced)); continue; }
    if (c === '}') { i++; continue; }
    if (c === '&') { out = `${out.replace(/\s+$/, '')}${envs.length && ENV_OPEN[envs[envs.length - 1]] ? ', ' : ' '}`; i++; continue; }
    if (c === '~') { out += ' '; i++; continue; }
    if (REL.has(c) || BIN.has(c)) { op(c); i++; continue; }
    emit(c);
    i++;
  }
  return out
    .replace(/\s{2,}/g, ' ')
    .replace(/([([{⟨]) /g, '$1')
    .replace(/ ([)\]}⟩,;])/g, '$1')
    .trim()
    .normalize('NFC');
}

const JA = /[぀-ヿ㐀-鿿]/;
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
// Kept away from the Markdown clean-up: a formula and a [[…]] marker.
const PROTECT = /\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\[\[[\s\S]*?\]\]/g;

/** Markdown and HTML as plain text: emphasis marks, code ticks, link targets and
 *  tags gone; headings' #s gone; lists and line breaks kept. */
function plainMarkdown(text: string): string {
  const kept: string[] = [];
  const masked = text.replace(PROTECT, (m) => { kept.push(m); return `\ue010${kept.length - 1}\ue011`; });
  const plain = masked
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[A-Za-z][^>\n]*>/g, '')
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_m, e: string) => ENTITIES[e])
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/(^|[^*\w])\*(?=\S)([^*\n]*?\S)\*(?!\*)/g, '$1$2')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '');
  return plain.replace(/\ue010(\d+)\ue011/g, (_m, k: string) => kept[Number(k)]);
}

/** The text of a formula (or of a ruby's base that holds one) for the notes. */
const formulaText = (math: string): string =>
  math.replace(/\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]/g, (_m, a?: string, b?: string) => latexToText(a ?? b ?? ''));

/** The notes of an exported slide: its @script, for the presenter to read ('' = none). */
export function scriptNotes(raw: string): string {
  const s = slideScript(raw);
  if (!s) return '';
  return scriptForReader(plainMarkdown(s), (math, reading) => {
    const shown = formulaText(math);
    if (!reading) return shown;
    return JA.test(reading) ? `${shown}（${reading}）` : `${shown} (${reading})`;
  });
}
