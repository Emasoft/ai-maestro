---
trdd-id: 8D9ZYZX9
title: trddgrep new mints project-scope cards without scope and project-id
column: todo
created: 2026-09-06T02:23:03+0200
updated: 2026-09-06T02:30:12+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
task-type: bugfix
min-approval-requirement: none
assignee: ai-maestro-hub-session
mandate: true
mandated-by: none
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-09-06T02:23:03+0200
---

# trddgrep new mints project-scope cards without scope and project-id

## Problem
`trddgrep new` (its mint path is lib/trdd-create.ts, called from scripts/trddgrep.mjs) mints a PROJECT-scope card without `scope:` and without `project-id:`, although the ai-maestro overlay (rules/aimaestro/aimaestro-trdd-approval.md, "Scope discriminators"; rules/aimaestro/aimaestro-kanban-multiagent.md) says a `scope: project` card MUST carry `project-id` — the discriminator that binds the card to the project board. Measured 2026-09-06 over design/tasks + design/proposals (193 cards, every column — not the board's `todo` count): 105 carry `scope: project` (no other scope value occurs), 90 carry `project-id:`; 26 `scope: project` cards and 78 cards carrying neither field lack `project-id` — 104 in total; TRDD-OUAQARPL and TRDD-6B1ND5TD, both minted by the verb this week, carry neither. No code under lib/ or scripts/ writes `project-id` (the same grep finds the `mandated-by` writer at lib/trdd-create.ts:205, so its coverage is not in doubt). The PRRD frontmatter carries `project-id: ai-maestro`, so the value is one read away. `trddgrep validate --min-severity error` and the doctor both pass such cards (the IND base says the field is "lint-enforced incrementally"), so the gap is invisible until a cross-project query keys on `project-id`.

A second observation, recorded for a ruling and NOT a box on this card: at Tier 0 the create library writes `mandated-by` as the AUTHOR's authority rank (lib/trdd-create.ts:205 — `mandated-by: ${opts.authorAuthority}`, introduced by commit 744cc331 on TRDD-40DYBI4T, 2026-08-20; `git log -S authorAuthority` on that file shows no other commit), so `none` there means "an author holding no approval authority", which is what the §D4 comparison authority(mandated-by) >= authority(min-approval-requirement) needs on one ladder; the overlay's mandate section instead says "'self' at `none`". Tool and rule text disagree on the Tier-0 spelling; which was intended is the ruling requested, and the rule text lives in a governance file, so aligning either side is a MANAGER-tier decision at minimum. This card only records the disagreement; it is NOT routed anywhere an approver drains — the USER, who holds the MANAGER role in this hub session, is told directly in the session reply, and a proposal in design/proposals with min-approval-requirement manager is the formal route if the USER wants one.

## Proposed fix
In lib/trdd-create.ts: when the repo's design/requirements/PRRD.md carries a `project-id:` frontmatter field, emit `scope: project` and `project-id: <that value>`; when the PRRD or the field is absent, mint the card unchanged and print ONE warning naming the missing source — never refuse the mint (trddgrep is installed globally and serves repos without a PRRD; a fail-fast here would be a fleet-wide regression). Add a `trddgrep validate` WARN for a project-zone card lacking `project-id`, where project-zone means: the card sits under a project repo's design/ AND its `scope:` is `project` or absent (a `scope: local` or `scope: user` card found there is a separate misfiling defect, excluded from this WARN because such a card MUST NOT carry project-id; the corpus has none today — all 105 `scope:` values are `project`). WARN only: promoting it to ERROR would redden the `--min-severity error` commit gate on every unrepaired card until a sweep, and the overlay's migration policy is migrate-on-next-touch, never a mass rewrite; ERROR becomes admissible only when validate reports zero remaining project-zone cards lacking `project-id`. The 104 existing cards are repaired as each is next touched, via `trddgrep set`.

## Acceptance
- [ ] A card minted by `trddgrep new` in this repo carries `scope: project` and `project-id: ai-maestro`
- [ ] Minting with the PRRD `project-id:` absent still succeeds and prints one named warning (unit test)
- [ ] `trddgrep validate` WARNS on a project-zone card lacking `project-id`, and no ERROR-tier rule is added (unit test asserts the severity)
- [ ] The two minted-this-week cards (OUAQARPL, 6B1ND5TD) are repaired on next touch via `trddgrep set`, not by a sweep

## Approval log

- 2026-09-06T02:23:03+0200 — MANDATE issued by ai-maestro-hub-session (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
- 2026-09-06T02:30:11+0200 — Review notes on the corrected body (four precisions, none a box). (1) "routes it to the MANAGER queue by this sentence" over-states: a sentence on a Tier-0 card in design/tasks sits in no queue any approver drains — the mandated-by spelling question is NOT routed by this card; the USER, who holds the MANAGER role in this hub session, is told directly in the session reply, and a proposal in design/proposals with min-approval-requirement manager is the formal route if the USER wants one. (2) Provenance of the tool's behaviour: lib/trdd-create.ts writes mandated-by as the author's authority rank since commit 744cc331 (2026-08-20, TRDD-40DYBI4T, server-side minting); that shows what the tool does, not which spelling was intended — the intent question is exactly the ruling requested, so "the overlay is the outlier" is withdrawn as a judgment. (3) Exit condition for the WARN: promoting the validate rule to ERROR becomes admissible only when validate reports zero project-zone cards lacking project-id; until then it stays WARN, so the nag has a closure path. (4) The 104 split into two repair classes — 26 cards that say scope: project and lack only project-id, and 78 that carry neither field, where the path rule (under design/ of a project repo) makes them project-scope and the repair is two fields; "project-zone" in the acceptance means "path under a project's design/ regardless of the scope field", so both classes are in scope. By ai-maestro-hub-session.
