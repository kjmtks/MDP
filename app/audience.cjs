'use strict';
// Audience — who a folder's decks are for: the students of a course, the listeners of
// a talk. One file per PERSONA in a folder's `.mdp`, read by everything that writes
// or reviews a deck there (the slide spec lists them; an AI reviewer reads the deck
// as each of them would):
//
//   <cdir>/audience/<name>.md    ---
//                                description: 学部 2 年．確率・統計の講義は受けたが，ほとんど理解していない
//                                primary: true          # optional: the audience the deck must work for
//                                ---
//                                # 〔名前〕
//                                ## 誰か / ## すでに知っていること / ## つまずくこと / …
//
// The body is free Markdown (the template has the sections that help a reviewer).
// Unlike glossaries and skills (stores: more terms or rules never hurt), the audience
// is ONE setting: the NEAREST `.mdp` of the chain that has any persona defines it
// whole, and its parents' are not added (a course's students are not also a talk's
// listeners — mixed, a reviewer would ask for "deeper" and "gentler" at once). A
// folder without personas inherits the nearest parent's. What every audience shares
// (how the author teaches) belongs in a skill. Shared by app/main.cjs, server.cjs and
// app/mcp-bridge.cjs.

const { parseFrontmatter, strayProblem } = require('./skills.cjs');

const DIR = 'audience';
const MAX_FILE = 64 * 1024;
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}_.-]{0,63}$/u;

const clean = (s, max = 2000) => String(s == null ? '' : s).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim().slice(0, max);
const truthy = (v) => v === true || /^(true|yes|1)$/i.test(String(v || '').trim());

/** One persona file: its name, one-line description, whether it is the primary
 *  audience, and its text (the body without the frontmatter); `problem` when a second
 *  frontmatter block hides fields. */
function parseAudience(text, name) {
  const { data, body, stray } = parseFrontmatter(String(text || ''));
  const title = (/^#\s+(.+)$/m.exec(body) || [])[1] || '';
  return {
    name,
    description: clean(data.description, 300),
    ...(truthy(data.primary) ? { primary: true } : {}),
    ...(title.trim() ? { title: clean(title, 120) } : {}),
    body: String(body || '').trim(),
    ...(stray ? { problem: strayProblem(stray) } : {}),
  };
}

/** The personas of one `.mdp` (`<cdir>/audience/*.md`). */
async function personasIn(cdir, resolveTarget, vfs) {
  let files = [];
  try { files = (await vfs.vfsList(resolveTarget(`${cdir}/${DIR}`))).filter((e) => !e.isDir && /\.md$/i.test(e.name) && !e.name.startsWith('.')); }
  catch { return []; }                        // no audience folder in this `.mdp`
  const out = [];
  for (const f of files.sort((a, b) => a.name.localeCompare(b.name))) {
    const name = f.name.replace(/\.md$/i, '');
    if (!NAME_RE.test(name)) continue;
    const path = `${cdir}/${DIR}/${f.name}`;
    let text;
    try { text = String(await vfs.vfsReadText(resolveTarget(path))); } catch { continue; }
    out.push({ ...parseAudience(text.slice(0, MAX_FILE), name), path, configDir: cdir, ...(text.length > MAX_FILE ? { truncated: true } : {}) });
  }
  return out;
}

/** The audience in effect for a deck: the personas of the NEAREST `.mdp` of its chain
 *  (root→nearest) that has any — its parents' are not added; primary ones first. */
async function listAudience(chain, resolveTarget, vfs) {
  for (const cdir of [...chain].reverse()) {
    const list = await personasIn(cdir, resolveTarget, vfs);
    if (list.length) return [...list.filter((p) => p.primary), ...list.filter((p) => !p.primary)];
  }
  return [];
}

/** A persona by name, case-insensitively. */
function findAudience(list, name) {
  const key = String(name || '').trim().replace(/\.md$/i, '').toLowerCase();
  return list.find((p) => p.name.toLowerCase() === key) || null;
}

/** A new persona — the sections a reviewer reads a deck by. */
function audienceTemplate(name) {
  return [
    '---',
    `description: ${name} — 誰か（学年・立場）と，この内容についての出発点を一行で`,
    'primary: true',
    '---',
    '',
    `# ${name}`,
    '',
    '## 誰か',
    '- 学年・所属・人数，この授業（発表）がその人にとって何か（必修か，なぜ聞くのか）',
    '',
    '## すでに知っていること',
    '- 前提にしてよいこと（受けた授業，使える数学・道具）',
    '',
    '## 知らないこと・つまずくこと',
    '- 前提にできないこと，よく誤解すること，置いていかれやすい所',
    '',
    '## 意外なこと・想像しにくいこと',
    '- この人の予想や直感と逆になること，見たことのない抽象的なもの（一度では入らない．予想 → 外れる例 → 考える時間 → 理由，あとでもう一度）',
    '',
    '## 頭に置ける量・覚えていられること',
    '- 1 枚で覚えておける新しいことの数，似た言葉の区別，一度聞いただけのことがいつまで残るか（何枚・何分），前の回のことをどれだけ覚えているか，集中が続く時間',
    '',
    '## 関心・動機',
    '- 何に興味があり，何のために聞くか',
    '',
    '## これまでの反応',
    '- クイズの誤答，授業中の質問，感想（日付と回を添えて書き足していく）',
    '',
    '## 届くもの',
    '- この人に効いた説明の仕方（極端な例，数を入れた式，図，身近な場面…）',
    '',
  ].join('\n');
}

/** The personas for the slide spec / a reviewer: their text, at most `cap` characters
 *  in all (the primary ones first). */
function describeAudience(list, cap = 20000) {
  let left = cap;
  const out = [];
  for (const p of list) {
    if (left <= 0) break;
    const text = p.body.length > left ? `${p.body.slice(0, left)}…` : p.body;
    left -= text.length;
    out.push({ name: p.name, description: p.description, ...(p.primary ? { primary: true } : {}), from: p.configDir, path: p.path, ...(p.problem ? { problem: p.problem } : {}), text });
  }
  return out;
}

module.exports = { DIR, NAME_RE, parseAudience, listAudience, findAudience, audienceTemplate, describeAudience };
