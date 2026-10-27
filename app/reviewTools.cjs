// The MCP tools of the review (app/review.cjs): a deck's findings, its snapshots and
// what changed since one, its flow. Made for a loop of AI sessions — an author, a
// reviewer reading as the students would, the author again — with the person
// reading the result in MDP:
//   get_review / add_review / resolve_review — the findings beside the deck
//   snapshot_deck / get_changes — the deck as it was, and what changed since
//   get_flow / write_flow — the lecture's understanding design (`<deck>.flow.md`)
//   get_audience / write_audience — who the decks are for (`.mdp/audience/<name>.md`)
//   review_readiness — what a review of a deck needs, what is in place, what to do
// The bridge passes its helpers in (file access through .mdplink, the renderer
// relay, the per-path lock), so this file has no state of its own.

const review = require('./review.cjs');
const audience = require('./audience.cjs');
const skills = require('./skills.cjs');
const { loopCommand } = require('./claudeReviewKit.cjs');

const METHODS = new Set(['get_review', 'add_review', 'resolve_review', 'snapshot_deck', 'get_changes', 'get_flow', 'write_flow', 'get_audience', 'write_audience', 'review_readiness']);

function createReviewTools(h) {
  const { mdplink, vres, rly, withDeckLock, wsKeyOf, currentDeckText, splitBlocks, backupFiles, activeDeckPath, requireDeckPath, BOM, mdpChainDirs } = h;
  const kitStatus = typeof h.kitStatus === 'function' ? h.kitStatus : null;   // desktop only
  const noBom = (s) => { const t = String(s || ''); return t.startsWith(BOM) ? t.slice(1) : t; };
  const lockKey = (baseDir, kind, deckPath) => `${wsKeyOf(baseDir)}::${kind}::${deckPath}`;

  async function readReview(baseDir, deckPath) {
    try { return review.parseReview(noBom(await mdplink.vfsReadText(vres(baseDir, review.reviewPathFor(deckPath)))), deckPath); }
    catch { return review.emptyReview(deckPath); }
  }
  async function writeReview(baseDir, deckPath, file) {
    await mdplink.vfsWrite(vres(baseDir, review.reviewPathFor(deckPath), 'w'), Buffer.from(review.serializeReview(file), 'utf-8'));
  }
  // The open deck's Review panel reads it again (and the tree shows the files).
  const changed = (baseDir, deckPath) => {
    rly(baseDir, 'reviewChanged', { path: deckPath }, 5000).catch(() => rly(baseDir, 'refreshTree', {}, 5000).catch(() => {}));
  };
  // The deck as it is NOW (the editor's text when open): its slides.
  async function deckOf(baseDir, deckPath, mustExist) {
    const cur = await currentDeckText(baseDir, deckPath);
    if (cur.missing && mustExist) throw new Error(`No deck at "${deckPath}".`);
    return { text: cur.text, facts: review.slideFacts(splitBlocks(cur.text)) };
  }
  const deckPathOf = async (p, baseDir) => (p.path ? requireDeckPath(p.path) : activeDeckPath(baseDir));
  const snapshotList = (file) => file.snapshots.map(({ id, label, at, slides, by }) => ({ id, label, at, slides, by }));

  async function readFlow(baseDir, deckPath) {
    try { return noBom(await mdplink.vfsReadText(vres(baseDir, review.flowPathFor(deckPath)))).replace(/\r\n?/g, '\n'); }
    catch { return null; }
  }

  async function handle(method, p, baseDir) {
    switch (method) {
      case 'get_review': {
        const deckPath = await deckPathOf(p, baseDir);
        const [{ facts }, file] = await Promise.all([deckOf(baseDir, deckPath, true), readReview(baseDir, deckPath)]);
        const status = p.status || 'open';
        const items = review.listItems(file, facts, { status, ...(p.slide !== undefined ? { slide: Number(p.slide) } : {}) });
        return {
          path: deckPath, file: review.reviewPathFor(deckPath), counts: review.countItems(file), status, items,
          snapshots: snapshotList(file),
          note: 'Each item: `slide` = where it is NOW (found again by the slide\'s @id / heading; `moved: true` = a guess), `page` = the number printed on it, `at` = what it points at (`target` as get_focus_targets names it, `quote` = words selected), `by` (human = the author of the deck, the person you work for — their comments come first), `kind` (comment / finding / question), `aspect` (clarity = will the students understand it, accuracy, effect = does it serve the lesson\'s goal, flow, style), `severity`, `rule: true` = the person wants this kept as a rule (record it in the folder\'s skill with patch_skill, then fix every slide of the same kind), `thread` = replies (the person\'s are `by: "human"` — follow them), `decision` = the PERSON\'s judgment of an AI\'s finding: "fix" = do it (right after their own comments), "later" = leave it open and untouched (not now), "skip" = will not fix — declined by the person (its reason in the thread; do not raise that kind again); no decision = not judged yet (`counts.toDecide`). After fixing, call resolve_review (resolved / declined with the reason / answered).',
        };
      }

      case 'add_review': {
        const deckPath = requireDeckPath(p.path);
        return withDeckLock(lockKey(baseDir, 'review', deckPath), async () => {
          const { facts } = await deckOf(baseDir, deckPath, true);
          const file = await readReview(baseDir, deckPath);
          const ids = review.addItems(file, p.items, facts, { by: p.by || 'reviewer', round: Number.isInteger(p.round) ? p.round : undefined, kind: p.kind });
          await writeReview(baseDir, deckPath, file);
          changed(baseDir, deckPath);
          return { path: deckPath, file: review.reviewPathFor(deckPath), added: ids, counts: review.countItems(file) };
        });
      }

      case 'resolve_review': {
        const deckPath = requireDeckPath(p.path);
        return withDeckLock(lockKey(baseDir, 'review', deckPath), async () => {
          // a judgment (fix / later / skip) is the person's: an AI records one only as
          // told by them (by: "human")
          if (Array.isArray(p.updates) && p.updates.some((u) => u && u.decision !== undefined) && p.by !== 'human') {
            throw new Error('A "decision" (fix / later / skip) is the person\'s judgment: pass it only when the person decided it, with by: "human". The reviser answers with status and reply.');
          }
          const file = await readReview(baseDir, deckPath);
          const r = review.updateItems(file, p.updates, p.by || 'author');
          if (r.done.length) { await writeReview(baseDir, deckPath, file); changed(baseDir, deckPath); }
          return { path: deckPath, updated: r.done, ...(r.unknown.length ? { unknown: r.unknown } : {}), counts: review.countItems(file) };
        });
      }

      case 'snapshot_deck': {
        const deckPath = requireDeckPath(p.path);
        return withDeckLock(lockKey(baseDir, 'review', deckPath), async () => {
          const { text, facts } = await deckOf(baseDir, deckPath, true);
          const id = review.newId('s');
          const dir = review.snapshotDirFor(deckPath);
          const rel = `${dir}/${id}.txt`;
          await mdplink.vfsMkdirp(vres(baseDir, dir, 'w'));
          await mdplink.vfsWrite(vres(baseDir, rel, 'w'), Buffer.from(text, 'utf-8'));
          const file = await readReview(baseDir, deckPath);
          const label = String(p.label || '').trim().slice(0, 120);
          const dropped = review.addSnapshot(file, { id, label, at: new Date().toISOString(), path: rel, slides: facts.length, by: String(p.by || 'author').slice(0, 60) });
          await writeReview(baseDir, deckPath, file);
          for (const d of dropped) mdplink.vfsRemove(vres(baseDir, d.path, 'w')).catch(() => {});
          changed(baseDir, deckPath);
          return {
            path: deckPath, snapshot: { id, label, slides: facts.length },
            note: 'The deck as it is now (the editor\'s text when open) is kept. get_changes compares the deck with the newest snapshot by default — a reviewer can then read only the slides that changed; the person sees them in MDP\'s Review panel (Changes) and can put a slide back.',
          };
        });
      }

      case 'get_changes': {
        const deckPath = await deckPathOf(p, baseDir);
        const file = await readReview(baseDir, deckPath);
        if (!file.snapshots.length) throw new Error('This deck has no snapshot yet — take one with snapshot_deck before it is revised.');
        const since = p.since === 'first' ? file.snapshots[0]
          : p.since ? file.snapshots.find((s) => s.id === p.since)
            : file.snapshots[file.snapshots.length - 1];
        if (!since) throw new Error(`No snapshot "${p.since}" — get_review lists them.`);
        let before;
        try { before = noBom(await mdplink.vfsReadText(vres(baseDir, since.path))); }
        catch { throw new Error(`The snapshot "${since.id}" file is gone (${since.path}).`); }
        const { text } = await deckOf(baseDir, deckPath, true);
        const r = review.deckChanges(splitBlocks(before), splitBlocks(text), { withDiff: p.diff !== false, context: 1 });
        return {
          path: deckPath, since: { id: since.id, label: since.label, at: since.at }, ...r,
          note: '`slide` = the slide now, `oldSlide` = where it was in the snapshot. Slides are matched by @id, then by their text, by heading, then in order. `diff`: "-" = the snapshot\'s line, "+" = now, "  …" = lines left out.',
        };
      }

      case 'get_flow': {
        const deckPath = await deckPathOf(p, baseDir);
        const flowPath = review.flowPathFor(deckPath);
        const [content, deck] = await Promise.all([readFlow(baseDir, deckPath), deckOf(baseDir, deckPath, false)]);
        if (content == null) {
          const title = ((/<!--\s*@title\s+([\s\S]*?)\s*-->/.exec(splitBlocks(deck.text)[0] || '') || [])[1] || '').trim();
          return {
            path: deckPath, flow: flowPath, exists: false, template: review.flowTemplate(title),
            note: 'No flow yet. Write one with write_flow BEFORE the slides (or now, from them): the template\'s form — per step the slides it covers (#id: give those slides `<!-- @id … -->`), the student\'s question at that point, the device that answers it, the sentence that should land, the link to the next step. A step whose question you cannot write is a flat one: rethink it before writing slides.',
          };
        }
        const flow = review.parseFlow(content);
        return {
          path: deckPath, flow: flowPath, exists: true, content,
          steps: flow.steps.map(({ n, title, ids, fields }) => ({ n, title, ids, fields })),
          check: review.checkFlow(flow, deck.facts),
          note: 'check: `missing` = #ids the flow names that no slide has; `unnamed` = slides with an @id no step names; `noId` = content slides without an @id (a step cannot name them — give them one); `noSlides` = steps naming no slide; `noQuestion` = steps without the student\'s question (flat steps).',
        };
      }

      case 'write_flow': {
        const deckPath = requireDeckPath(p.path);
        if (typeof p.content !== 'string' || !p.content.trim()) throw new Error('"content" is required (the whole flow file, Markdown).');
        const flowPath = review.flowPathFor(deckPath);
        return withDeckLock(lockKey(baseDir, 'flow', deckPath), async () => {
          const backups = await backupFiles(baseDir, [flowPath]);
          const content = p.content.replace(/\r\n?/g, '\n');
          await mdplink.vfsWrite(vres(baseDir, flowPath, 'w'), Buffer.from(content, 'utf-8'));
          const { facts } = await deckOf(baseDir, deckPath, false);
          const flow = review.parseFlow(content);
          changed(baseDir, deckPath);
          return { path: deckPath, flow: flowPath, steps: flow.steps.length, check: review.checkFlow(flow, facts), ...(backups.length ? { backup: backups[0] } : {}) };
        });
      }

      case 'get_audience': {
        const deckPath = p.deck ? requireDeckPath(p.deck) : await activeDeckPath(baseDir).catch(() => '');
        const chain = await mdpChainDirs(baseDir, deckPath);
        const list = await audience.listAudience(chain, (rel) => vres(baseDir, rel), mdplink);
        if (p.name) {
          const one = audience.findAudience(list, p.name);
          if (!one) throw new Error(`No persona "${p.name}" for this folder${list.length ? ` (there are: ${list.map((x) => x.name).join(', ')})` : ''}.`);
          return { deck: deckPath || null, name: one.name, description: one.description, ...(one.primary ? { primary: true } : {}), from: one.configDir, path: one.path, ...(one.problem ? { problem: one.problem } : {}), text: one.body };
        }
        if (!list.length) {
          return {
            deck: deckPath || null, personas: [], template: audience.audienceTemplate('学部2年'),
            note: 'No persona for this folder (nor its parents). Ask the person who the decks are for — or draft one from the course\'s skill and the decks, show it to them — and write it with write_audience. Without one, a reviewer only guesses who the students are.',
          };
        }
        return {
          deck: deckPath || null, from: list[0].configDir, personas: audience.describeAudience(list),
          note: 'The audience the decks of this folder are for — the personas of the nearest .mdp that has any (its parents\' are not added). Write every slide and script FOR them; a reviewer reads the deck as each of them would (primary first) and names the persona in `by` ("reviewer:<name>").',
        };
      }

      case 'write_audience': {
        const name = String(p.name || '').trim().replace(/\.md$/i, '');
        if (!audience.NAME_RE.test(name)) throw new Error('"name": letters, digits, - _ . (e.g. "学部2年", "struggling-student").');
        if (typeof p.content !== 'string' || !p.content.trim()) throw new Error('"content" is required (the persona file, Markdown with a frontmatter `description`; get_audience gives the template).');
        // Read as the readers will: a second frontmatter block would hide its fields.
        const fm = skills.parseFrontmatter(p.content);
        if (fm.stray) throw new Error(`The persona's ${skills.strayProblem(fm.stray)}. Nothing was written.`);
        const deckPath = p.deck ? requireDeckPath(p.deck) : await activeDeckPath(baseDir).catch(() => '');
        let cdir;
        if (typeof p.dir === 'string') {
          const d = requireDeckPath(`${p.dir.replace(/\/+$/, '')}/x`).replace(/\/?x$/, '');
          cdir = d ? `${d}/.mdp` : '.mdp';
        } else {
          // Join the audience in effect (where it lives), else the deck's nearest .mdp.
          const chain = await mdpChainDirs(baseDir, deckPath);
          const list = await audience.listAudience(chain, (rel) => vres(baseDir, rel), mdplink);
          cdir = list.length ? list[0].configDir : (chain[chain.length - 1] || '.mdp');
        }
        const rel = `${cdir}/${audience.DIR}/${name}.md`;
        return withDeckLock(lockKey(baseDir, 'audience', rel), async () => {
          let exists = false;
          try { await mdplink.vfsReadText(vres(baseDir, rel)); exists = true; } catch { /* new */ }
          const ok = await rly(baseDir, 'confirmAssetWrite', { kind: 'persona', action: exists ? 'update' : 'create', name, rel, hasScript: false, content: p.content }, 300000);
          if (!ok || !ok.approved) throw new Error('The user declined to write this persona. Nothing was changed.');
          const backups = exists ? await backupFiles(baseDir, [rel]) : [];
          await mdplink.vfsWrite(vres(baseDir, rel, 'w'), Buffer.from(p.content.replace(/\r\n?/g, '\n'), 'utf-8'));
          rly(baseDir, 'refreshTree', {}, 5000).catch(() => {});
          return {
            path: rel, [exists ? 'updated' : 'created']: true, ...(backups.length ? { backup: backups[0] } : {}),
            ...(fm.data.description ? {} : { warning: 'No frontmatter `description` (one line: who this is) — get_audience lists the personas by it.' }),
            note: 'A persona in a folder\'s .mdp makes the audience there that folder\'s own: personas of the folders above no longer apply beneath it.',
          };
        });
      }

      case 'review_readiness': {
        const deckPath = await deckPathOf(p, baseDir);
        const { facts } = await deckOf(baseDir, deckPath, true);
        const chain = await mdpChainDirs(baseDir, deckPath);
        const res = (rel) => vres(baseDir, rel);
        const [file, flowText, personas, skillList] = await Promise.all([
          readReview(baseDir, deckPath), readFlow(baseDir, deckPath),
          audience.listAudience(chain, res, mdplink).catch(() => []), skills.listSkills(chain, res, mdplink).catch(() => []),
        ]);
        const fc = flowText == null ? null : review.checkFlow(review.parseFlow(flowText), facts);
        const kit = kitStatus ? (() => { try { return kitStatus(); } catch { return null; } })() : null;
        const { checks, canStart } = review.readinessChecks({
          personas: personas.map((x) => ({ name: x.name, primary: !!x.primary, configDir: x.configDir })),
          skills: skillList.map((x) => x.name), flow: fc, facts, lastSnapshot: file.snapshots[file.snapshots.length - 1] || null, kit,
        });
        const counts = review.countItems(file);
        return {
          path: deckPath, slides: facts.length, canStart, checks, command: loopCommand(deckPath),
          ...(counts.total ? { review: counts } : {}),
          note: `To review this deck with AI subagents, the person types the command in Claude Code (a session where the MDP tools are connected): the loop reviews (mdp-lecture-reviewer), revises (mdp-lecture-reviser) and repeats, then reports. Items marked fix "loop" are done by the loop itself; "you" needs the person; "optional" helps but is not needed.${canStart ? '' : ' It cannot start until the "you" items are done.'}`,
        };
      }

      default:
        throw new Error(`Unknown review method ${method}`);
    }
  }

  /** For bootstrap: the audience of a chain, as an index. */
  async function audienceIndex(baseDir, chain) {
    const list = await audience.listAudience(chain, (rel) => vres(baseDir, rel), mdplink).catch(() => []);
    return list.map((x) => ({ name: x.name, ...(x.description ? { description: x.description } : {}), ...(x.primary ? { primary: true } : {}), from: x.configDir }));
  }

  /** For check_deck: the deck's open findings and its flow's check (null = none). */
  async function summary(baseDir, deckPath, text) {
    const facts = review.slideFacts(splitBlocks(text));
    const [file, content] = await Promise.all([readReview(baseDir, deckPath), readFlow(baseDir, deckPath)]);
    const counts = review.countItems(file);
    const flow = content == null ? null : review.checkFlow(review.parseFlow(content), facts);
    if (!counts.total && !flow) return null;
    return { ...(counts.total ? { review: counts } : {}), ...(flow ? { flow } : {}) };
  }

  return { handles: (m) => METHODS.has(m), handle, summary, audienceIndex };
}

module.exports = { createReviewTools, REVIEW_METHODS: METHODS };
