---
name: mdp-review-loop
description: Run a review loop on an MDP lecture deck with two subagents — mdp-lecture-reviewer reads it as its audience would and records findings, mdp-lecture-reviser fixes them — for a few rounds, then tell the person what changed and what is left for them. What a good lecture is, what to flag, how to revise and when to stop come from the folder's slide skills (their review instructions, e.g. a skill's review.md); this skill holds only the procedure. Use when the person asks to review / improve / polish a lecture deck "automatically" or "with a reviewer", e.g. "/mdp-review-loop lectures/ビッグデータ解析/03.slide.md 3".
---

# MDP review loop (author ⇄ reviewer)

The person wants a lecture deck improved without reading every slide to find the weak ones. This loop has a fresh reviewer read the deck as its audience would, a reviser fix what it found, and repeats, so the person only reads the result: the findings in MDP's Review panel and what changed. **No AI API is used**: the reviewer and the reviser are Claude Code subagents.

**The policy is not in this kit.** What makes a lecture good, what a reviewer flags, how a reviser fixes it, and any extra reason to stop come from the deck folder's slide skills: a skill's review instructions (a reference file such as `review.md`; `get_skill` lists a skill's `files`). Where this skill and those instructions disagree, the instructions win. To change how decks are reviewed, edit that skill file (`write_skill` / `patch_skill`); this kit and MDP itself do not change.

## Inputs
- The deck path, workspace-relative, as the MDP tools take it. If none is given, use the active deck (`get_active_deck`).
- The number of rounds: default 2, at most 4.
- If the deck sits outside its course's folder (a trial copy somewhere else), its folder chain has neither the course's skills nor its personas: give both subagents a deck of the course to name as `deck` in `get_skill` and `get_audience`.

## Before starting
1. **`review_readiness`** with the deck path: what is in place for a review (personas, the flow, the slides' `@id`s, a snapshot, this kit in Claude Code) and the steps still to do. If the tool does not exist, the MDP running is older than its review tools: tell the person to install the new MDP, and stop. If MDP does not answer at all, tell the person to start it. If it reports the Claude Code kit as *different from this MDP's*: the loop works with the kit that is in Claude Code, whichever copy the running MDP carries. Do not tell the person to reinstall it from the Review panel; mention it in the report and go on.
2. The person and other sessions must not edit this deck while the loop runs. If the deck has unsaved changes in the editor, say so and continue (the loop's edits join them).
3. Audience: if `review_readiness` reports no persona, tell the person, and offer to draft one from the course's skill and decks (`get_audience` gives the template; `write_audience`). Without one the reviewer only guesses who the audience is.
4. Read the folder's review instructions yourself (`get_skill` without a name lists the skills; read the skill's `review.md` with `file`): they say what the flow file should hold, what the loop records before it starts, when it stops, and what the report contains. Follow them in the steps below.
5. Flow: `get_flow`. If there is no flow file, or it lacks what the review instructions ask of it, first have **mdp-lecture-reviser** write it from the deck as it is (`write_flow`; the slides each step names get an invisible `<!-- @id … -->`).
6. Record the size: `get_deck_outline` → the estimated minutes.
7. `snapshot_deck` with the label "before the review loop". The final report compares with this snapshot.

## Each round r = 1 … N
1. **Review.** Start the **mdp-lecture-reviewer** subagent (Agent tool). Give it the deck path and round r (and the course deck to name, if the deck sits outside its course's folder). In round 1 it reads the whole deck. From round 2 on, tell it to read the slides changed since the previous snapshot (`get_changes`) with enough before and after them to follow the lecture, and to check that the resolved findings were really fixed. Keep its report, including what the review instructions make it report (for instance the places that work and must be kept).
2. **Stop?** `get_review` (open). If no open finding by a reviewer is major or minor (nits and questions only) — leaving out the ones the person put off (`decision: "later"`) — stop the loop.
3. `snapshot_deck` with the label "before revision r".
4. **Revise.** Start the **mdp-lecture-reviser** subagent with the deck path and what the reviewer reported as to be kept. It fixes the open findings — the person's own comments first, then the findings the person marked Fix, then the rest in the order the review instructions give; never the ones put off for later — answers each with resolve_review, keeps the flow in step, and reports the estimated minutes before and after.
5. **After the round**, apply what the review instructions ask (for instance: the estimated minutes must not grow — have the reviser cut it back; stop when they grew twice in a row). Without such a rule, go on to the next round.

## Report to the person (in Japanese)
- How many rounds ran, and why the loop stopped.
- Findings: how many were found, resolved and declined (with the reasons for the declined ones), by aspect.
- What changed since "before the review loop" (`get_changes`): the slides by printed page (p.N), one line each, and the estimated time before and after (`get_deck_outline`).
- Whatever the review instructions ask the report to contain (for instance the reviewer's reading notes of the first and the last pass, what was cut and what was moved).
- **What only the person can decide**: the open questions, the declined findings worth a look, and the findings still without the person's judgment (`counts.toDecide` — in MDP's Review panel each card has **Fix / Later / Won't fix**; the next loop follows them). Say how many are put off for later.
- If the person has marked the same kind of finding **Won't fix** several times (the reviewer reports it), propose recording it in the skill's review instructions so the reviewer stops raising it — ask first.
- Where to look: MDP's **Review** panel (Findings / Changes / Flow). There, "Put back" returns a slide to the snapshot.
- Saving: when the deck is open in MDP, the loop's changes are unsaved edits in the editor. Save them yourself with `save_deck` at the end and say so (the snapshots keep every earlier version, and "Put back" still works after a save) — unless the deck already had unsaved edits before the loop started (step 2 of "Before starting"): those are the person's, so leave the saving to them and say so. If it answers that the file changed on disk, take the `merge` way out and report what was merged; on a conflict, leave the edits unsaved and tell the person. Only when this session has no `save_deck` tool, tell the person that the edits are unsaved.

## Rules
- Never let the reviewer edit the deck (its tools cannot), and never let the reviser make big rewrites nobody asked for (how far a revision may go is in the review instructions).
- Keep the person's own comments (`by: "human"`) first in every round.
- Follow the person's judgments (`decision`): Fix first after their comments; never touch Later; never undo a Won't fix. The person's replies on a finding (`thread`, `by: "human"`) are instructions.
- A decision is the person's: record one with resolve_review only when they told you (`by: "human"`).
