---
name: mdp-review-loop
description: Run a review loop on an MDP lecture deck with two subagents — mdp-lecture-reviewer reads it as its students would (the experience first: is there a pulling question, where is it boring, what is said twice) and records findings, mdp-lecture-reviser fixes them by cutting and reordering before adding — for a few rounds, without letting the lesson grow, then tell the person what changed and what is left for them. Use when the person asks to review / improve / polish a lecture deck "automatically" or "with a reviewer", e.g. "/mdp-review-loop lectures/ビッグデータ解析/03.slide.md 3".
---

# MDP review loop (author ⇄ reviewer)

The person wants lectures that give students the feeling of having understood, that convince, and that are interesting — so that the students go on to study by themselves (lecture-exemplar skill, section 1) — without reading 40 slides to find the flat or long-winded ones. This loop has a fresh reviewer take the lecture as a student, a reviser fix what it found, and repeats, so the person only reads the result: the findings in MDP's Review panel and what changed. **No AI API is used**: the reviewer and the reviser are Claude Code subagents.

**What went wrong before, and what this loop guards against**: a reviewer that only looks for what is missing makes the reviser add a sentence here and a note there; each addition is small and correct, and after a few rounds every slide weighs the same and the lecture is long-winded (the person, 2026-11-13). So: the reviewer reads the experience first, most findings say what to cut or reorder, an addition is paired with a cut, and the loop stops when the lesson grows.

## Inputs
- The deck path, workspace-relative, as the MDP tools take it. If none is given, use the active deck (`get_active_deck`).
- The number of rounds: default 2, at most 4.
- If the deck sits outside its course's folder (a trial copy somewhere else), its folder chain has neither the course's skills nor its personas: give both subagents a deck of the course to name as `deck` in `get_skill` and `get_audience`.

## Before starting
1. **`review_readiness`** with the deck path: what is in place for a review (personas, the flow, the slides' `@id`s, a snapshot, this kit in Claude Code) and the steps still to do. If the tool does not exist, the MDP running is older than its review tools: tell the person to install the new MDP, and stop. If MDP does not answer at all, tell the person to start it. If it reports the Claude Code kit as *different from this MDP's*, the kit here may be NEWER than the running MDP's copy (the kit is updated in MDP's source first, and an installed MDP keeps the kit of its own version): do not tell the person to reinstall it from the Review panel — that would put the older kit back. Say in the report that the running MDP is older than the kit, and go on.
2. The person and other sessions must not edit this deck while the loop runs. If the deck has unsaved changes in the editor, say so and continue (the loop's edits join them).
3. Audience: if `review_readiness` reports no persona, tell the person, and offer to draft one from the course's skill and decks (`get_audience` gives the template; `write_audience`). Without one the reviewer only guesses who the students are.
4. Flow and story sheet: the flow file (`get_flow`) should start with the lecture's **story sheet** (`## 筋書き`: the thought to take home, the pulling question, the high point, the predictions, what is left unsaid, the ending — lecture-exemplar's story.md). If there is no flow file, or it has no story sheet, first have **mdp-lecture-reviser** write one from the deck as it is (`write_flow`; the slides each step names get an invisible `<!-- @id … -->`). A deck whose story sheet cannot be written in a page (no pulling question, no single high point) has a flow problem: tell the reviewer so.
5. Record the size: `get_deck_outline` → the estimated minutes. This number must not grow over the loop.
6. `snapshot_deck` with the label "before the review loop". The final report compares with this snapshot.

## Each round r = 1 … N
1. **Review.** Start the **mdp-lecture-reviewer** subagent (Agent tool). Give it the deck path and round r. In round 1 it reads the whole deck. From round 2 on, tell it to read the slides changed since the previous snapshot (`get_changes`) with enough before and after them to feel the flow, and to check that the resolved findings were really fixed. Keep its report: the feelings per slide (bored / ordinary / oh / I see / left behind / fed up), its three-sentence retelling, and **what works** (3–5 places).
2. **Stop?** `get_review` (open). If no open finding by a reviewer is major or minor (nits and questions only) — leaving out the ones the person put off (`decision: "later"`) — stop the loop.
3. `snapshot_deck` with the label "before revision r".
4. **Revise.** Start the **mdp-lecture-reviser** subagent with the deck path and the reviewer's "what works" list (it must not break those). It fixes the open findings — the person's own comments first, then the findings the person marked Fix, then flow → cut → accuracy → stuck points → voice; never the ones put off for later — answers each with resolve_review, keeps the flow in step, and reports the estimated minutes before and after.
5. **Size check.** If the estimated minutes grew in this round for a reason other than the person's own comment, tell the reviser to cut it back before the next round. If it grew in two rounds in a row, stop the loop and report.

## Report to the person (in Japanese)
- How many rounds ran, and why the loop stopped (clean, the round limit, or the lesson kept growing).
- The experience, first and last reviewer pass side by side: how many slides were bored / fed up, how many oh / I see, the three-sentence retelling and whether it matches the story sheet's thought to take home.
- Findings: how many were found, resolved and declined (with the reasons for the declined ones), by kind: flow (the story), cut, accuracy, stuck points, voice.
- **What was cut and what was moved** (one line each), and the estimated time before and after (`get_deck_outline`).
- **What only the person can decide**: the open questions (a new activity, a personal remark of theirs, a source), the declined findings worth a look, and the findings still without the person's judgment (`counts.toDecide` — in MDP's Review panel each card has **Fix / Later / Won't fix**; the next loop follows them). Say how many are put off for later.
- If the person has marked the same kind of finding **Won't fix** several times (the reviewer reports it), propose recording it in the course's skill so the reviewer stops raising it — ask first. When a rule is recorded, an existing rule that says the same is edited; the skill does not grow by one rule per comment.
- What changed since "before the review loop" (`get_changes`): the slides by printed page (p.N), one line each.
- Where to look: MDP's **Review** panel (Findings / Changes / Flow). There, "Put back" returns a slide to the snapshot.
- Saving: when the deck is open in MDP, the loop's changes are unsaved edits in the editor. Save them yourself with `save_deck` at the end and say so (the snapshots keep every earlier version, and "Put back" still works after a save) — unless the deck already had unsaved edits before the loop started (step 2 of "Before starting"): those are the person's, so leave the saving to them and say so. If it answers that the file changed on disk, take the `merge` way out and report what was merged; on a conflict, leave the edits unsaved and tell the person. Only when this session has no `save_deck` tool, tell the person that the edits are unsaved.

## Rules
- Never let the reviewer edit the deck (its tools cannot), and never let the reviser make big rewrites nobody asked for (it may reorder and merge slides only for a flow finding or the person's comment).
- Keep the person's own comments (`by: "human"`) first in every round.
- Follow the person's judgments (`decision`): Fix first after their comments; never touch Later; never undo a Won't fix. The person's replies on a finding (`thread`, `by: "human"`) are instructions.
- A decision is the person's: record one with resolve_review only when they told you (`by: "human"`).
- The time budget of the course is fixed (lecture-pace skill). The loop makes a lecture better by cutting, reordering and not giving things away — not by adding.
