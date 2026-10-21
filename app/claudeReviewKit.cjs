'use strict';
// The Claude Code side of MDP's AI review — the reviewer and reviser subagents and the
// review-loop skill — kept with the app (app/claude-review/, versioned with the code)
// and installed on request into the user's Claude Code folder (~/.claude, or
// $CLAUDE_CONFIG_DIR): agents/… and skills/…. A copy there that differs (an older kit,
// or the person's own edits) is backed up before it is replaced. Used by app/main.cjs
// (Review panel: status / install) and app/reviewTools.cjs (review_readiness).

const fs = require('fs');
const path = require('path');
const os = require('os');

const KIT_DIR = path.join(__dirname, 'claude-review');
const FILES = ['agents/mdp-lecture-reviewer.md', 'agents/mdp-lecture-reviser.md', 'skills/mdp-review-loop/SKILL.md'];
/** What the person types in Claude Code to run the loop on a deck. */
const loopCommand = (deckPath, rounds = 2) => `/mdp-review-loop ${deckPath} ${rounds}`;

const claudeHome = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const read = (p) => { try { return fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n'); } catch { return null; } };

/** Each kit file: missing, current (as the app has it) or different. */
function kitStatus(home = claudeHome()) {
  const files = FILES.map((rel) => {
    const want = read(path.join(KIT_DIR, rel));
    const have = read(path.join(home, rel));
    return { file: rel, state: want == null ? 'unknown' : have == null ? 'missing' : have === want ? 'current' : 'different' };
  });
  const state = files.every((f) => f.state === 'current') ? 'current' : files.some((f) => f.state === 'missing') ? 'missing' : 'different';
  return { home, state, files };
}

/** Install (or update) the kit: every file the app has, a different copy backed up to
 *  <home>/backups/mdp-review-kit/<time>/ first. Returns the status after it. */
function installKit(home = claudeHome()) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backedUp = [];
  for (const rel of FILES) {
    const want = read(path.join(KIT_DIR, rel));
    if (want == null) throw new Error(`The app has no ${rel} (app/claude-review).`);
    const dest = path.join(home, rel);
    const have = read(dest);
    if (have === want) continue;
    if (have != null) {
      const bak = path.join(home, 'backups', 'mdp-review-kit', stamp, rel);
      fs.mkdirSync(path.dirname(bak), { recursive: true });
      fs.copyFileSync(dest, bak);
      backedUp.push(path.relative(home, bak));
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, want);
  }
  return { ...kitStatus(home), installed: true, ...(backedUp.length ? { backedUp } : {}) };
}

module.exports = { KIT_DIR, FILES, loopCommand, claudeHome, kitStatus, installKit };
