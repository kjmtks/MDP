---
name: mdp-review-loop
description: Run a review loop on an MDP lecture deck with two subagents — mdp-lecture-reviewer reads it as its students would and records findings, mdp-lecture-reviser fixes them — for a few rounds, then tell the person what changed and what is left for them. Use when the person asks to review / improve / polish a lecture deck "automatically" or "with a reviewer", e.g. "/mdp-review-loop lectures/ビッグデータ解析/03.slide.md 3".
---

# MDP review loop (author ⇄ reviewer)

The person wants lecture decks that students will surely understand, without reading 40 slides themselves to find the flat ones. This loop has a fresh reviewer read the deck as the students would, a reviser fix what it found, and repeats, so the person only reads the result: the findings in MDP's Review panel and what changed. **No AI API is used**: the reviewer and the reviser are Claude Code subagents.

## Inputs
- The deck path, workspace-relative, as the MDP tools take it. If none is given, use the active deck (`get_active_deck`).
- The number of rounds: default 2, at most 4.

## Before starting
1. **`review_readiness`** with the deck path: what is in place for a review (personas, the flow, the slides' `@id`s, a snapshot, this kit in Claude Code) and the steps still to do. If the tool does not exist, the MDP running is older than its review tools: tell the person to install the new MDP, and stop. If MDP does not answer at all, tell the person to start it.
2. The person and other sessions must not edit this deck while the loop runs. If the deck has unsaved changes in the editor, say so and continue (the loop's edits join them).
3. Audience: if `review_readiness` reports no persona, tell the person, and offer to draft one from the course's skill and decks (`get_audience` gives the template; `write_audience` — they confirm it). Without one the reviewer only guesses who the students are.
4. Flow: if the deck has no flow file (the lecture's understanding design), first have **mdp-lecture-reviser** write one from the deck as it is (`write_flow`; it gives the slides each step names an invisible `<!-- @id … -->`). Its steps' "学生の問い" lines are where flat steps show.
5. `snapshot_deck` with the label "before the review loop". The final report compares with this snapshot.

## Each round r = 1 … N
1. **Review.** Start the **mdp-lecture-reviewer** subagent (Agent tool). Give it the deck path and round r. In round 1 it reads the whole deck. From round 2 on, tell it to read the slides changed since the previous snapshot (`get_changes`) and their neighbours — for its ledger of what the students hold (the `uptake` aspect), from where what a changed slide uses first appeared to where what it introduces is used — and to check that the resolved findings were really fixed.
2. **Stop?** `get_review` (open). If no open finding by a reviewer is major or minor (nits and questions only), stop the loop.
3. `snapshot_deck` with the label "before revision r".
4. **Revise.** Start the **mdp-lecture-reviser** subagent with the deck path. It fixes the open findings (the person's own first), answers each with resolve_review, and keeps the flow in step.

## Report to the person (in Japanese)
- How many rounds ran, and why the loop stopped (clean, or the round limit).
- Findings: how many were found, resolved and declined (with the reasons for the declined ones). Name the `uptake` ones apart (where the students would not yet hold, or would have forgotten, what a slide builds on — the reviewer's ledger), and the lesson-structure questions (a missing bridge-in, prediction before a surprising core, or check of the goals).
- **What only the person can decide**: the open questions and the declined findings worth a look.
- What changed since "before the review loop" (`get_changes`): the slides by printed page (p.N), one line each, and the estimated time before and after (`get_deck_outline`).
- Where to look: MDP's **Review** panel (Findings / Changes / Flow). There, "Put back" returns a slide to the snapshot.
- Saving: when the deck is open in MDP, the changes are unsaved edits in the editor; the person saves them.

## Rules
- Never let the reviewer edit the deck (its tools cannot), and never let the reviser make big rewrites nobody asked for.
- Keep the person's own comments (`by: "human"`) first in every round.
- Keep the time budget of the course (lecture-pace skill). If the reviewer only asks for additions, the reviser also looks for what to cut.
