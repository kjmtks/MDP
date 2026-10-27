// Audience — who a folder's decks are for (the students of a course, the listeners of
// a talk): one persona per file, `<cdir>/audience/<name>.md` in a folder's `.mdp`.
// Not added up like glossaries: the NEAREST `.mdp` that has personas defines the
// audience whole (a folder without any inherits its parent's). Read by the slide spec
// (authors write for them) and by an AI reviewer (it reads the deck as each of them
// would). The backend lists them (app/audience.cjs — KEEP the template and the shape
// in step with it).

export interface AudiencePersona {
  name: string;
  description: string;
  /** The audience the decks must work for (reviewed first). */
  primary?: boolean;
  title?: string;
  /** The text, without its frontmatter. */
  body: string;
  path: string;
  configDir: string;
  truncated?: boolean;
  /** A second frontmatter block under the first: its fields are ignored. */
  problem?: string;
}

export const AUDIENCE_NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}_.-]{0,63}$/u;

/** A new persona — the sections a reviewer reads a deck by (as app/audience.cjs). */
export const audienceTemplate = (name: string): string => [
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
