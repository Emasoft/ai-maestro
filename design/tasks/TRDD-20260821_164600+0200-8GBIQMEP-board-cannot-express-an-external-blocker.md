---
trdd-id: 8GBIQMEP
title: The board cannot express an external blocker so external waits go stale unwatched — 9 of 12 cited issues already closed
column: todo
scope: project
project-id: ai-maestro
created: 2026-08-21T16:46:00+0200
updated: 2026-08-21T16:46:00+0200
current-owner: ai-maestro-orchestrator-agent
created-by: ai-maestro-orchestrator-agent
assignee: unassigned
task-type: infra
min-approval-requirement: none
severity: high
effort: medium
relevant-rules: []
npt: []
eht: []
blocked-by: []
labels: [kanban, blockers, drift, measurement]
external-refs: [janitor#73, janitor#77, janitor#100, janitor#139, janitor#167, janitor#283, ai-maestro#46, ai-maestro#55, orch#27]
---

# TRDD-8GBIQMEP — the board cannot express an external blocker

Filed by the ORCHESTRATOR session on hub instruction (ai-maestro-e7, 2026-08-21), out of the
hub-authorized stale-blocker sweep. Evidence report:
`reports/orchestrator/20260821_164101+0200-blocker-sweep-and-checkbox-census.md`.

**Parent context (cited, not `parent-trdd:`): [[5YRLA53W]].** That card already recorded the
*vocabulary* half of this under "VOCABULARY GAP" — `blocked-by:` takes TRDD ids only, so a card
waiting on a GitHub issue cannot use `column: blocked` without making `blocked-by:` a lie, and the
`todo` + `external-refs:` precedent ([[35VKIGTC]] ← `janitor#167`) is also wrong because `todo`
asserts "ready to be pulled". **This card does not restate that. It adds the consequence and the
measurement, which are new.**

## Problem

The gap is not only that an external wait is *unsayable*. It is that an external wait is
**unwatchable**, and the two compound:

1. An external dependency can only be recorded in **prose**.
2. Prose is checked **once**, at write time, by whoever wrote it.
3. Nothing re-checks it. No field holds it, so no detector can sweep it and nothing ever reddens.
4. Parking a card is precisely what stops anyone re-reading it — **so the staler a claim gets, the
   less likely anyone is to look at it.** Staleness is self-concealing.

The board has a live, machine-checkable edge for internal dependencies and **no edge at all** for
external ones. It is not a missing convenience; it is a whole class of dependency that the corpus
cannot represent and therefore cannot monitor.

## Measurement (2026-08-21, read-only, `gh issue view --json state,closedAt`)

Two sweeps over `design/tasks/*.md`, 122 cards:

| surface | result |
|---|---|
| `blocked-by:` (TRDD-id blockers) — 14 blocked cards, 20 distinct ids | **20/20 live. 0 stale.** |
| GitHub issues named in blocking prose ("blocked on" / "waiting on" / "gated on") | **9 of 12 CLOSED (75%)** |

**The contrast IS the finding.** The machine-checkable surface is perfectly clean. The prose-only
surface is 75% dead. Same board, same authors, same week — the only variable is whether the
dependency had a field that something could sweep.

Longest dead waits found: `janitor#73` closed 2026-07-09 (**43 days**) and `orch#27` closed
2026-07-16 (**36 days**), both still cited as an active WAIT on gate G2 of [[903B7A20]].

## The sub-finding worth its own sentence

The worst instance was not a careless claim — it was a **checked** one. [[5YRLA53W]] line 138 read:

> blocked on `janitor#139` — **verified OPEN, 0 comments, untouched since 2026-07-30**

`janitor#139` closed **2026-08-05**, three days after that line was written; the claim then stood
for 16 more days. A bare "blocked on `janitor#139`" invites the next reader to check. A dated
verification **forecloses** the check — it is trusted *because* it looks checked. **A verification
claim with no expiry becomes more trusted as it becomes less true.** Any fix here has to handle the
checked claim, not just the lazy one.

Two closures also carried a title saying the *finding itself* was a detector bug (e.g.
`janitor#283`), so a stale external wait can outlive not only its blocker but the premise the card
was filed on.

## The question this raises (deliberately NOT answered here)

Per the hub: state the problem and the measurement, do not design the answer. The two candidate
shapes already on the table, from [[5YRLA53W]]:

- **`blocked-by:` grows an external-ref form** (e.g. `blocked-by: [gh:Emasoft/ai-maestro-janitor#139]`),
  making the edge machine-checkable, plus possibly a `blocked-external` column so `blocked` /
  `todo` both stop lying; or
- **a detector sweeps cited issues on a cadence** and reddens a card whose cited issue is closed —
  which needs no schema change but only works on refs it can find, i.e. prose parsing.

Open sub-questions either way: what a "cited" issue is (any `owner/repo#N` in the body, or only one
in a declared field); what the cadence is; and whether a closed blocker should auto-move the card or
only flag it (auto-move is wrong when the closure is unrelated to why the card cited it).

## Acceptance

- [ ] Decision recorded on which shape is taken (field, detector, or both), with the rejected one's
      reason stated.
- [ ] Whichever is taken, the mechanism can answer "is every externally-cited blocker on this board
      still open?" **without a human reading prose**.
- [ ] The 4 cards corrected on 2026-08-21 (`903B7A20` ×2, `5YRLA53W`, plus `KCRMSNL7` / `SCLSRS6E`
      handed to the hub as out-of-lane) are re-checked under the new mechanism and it finds them.
- [ ] Re-run the 12-issue sweep after the mechanism lands; a second 75% means the mechanism did not
      work.
- [ ] The dated-verification failure mode is addressed explicitly, not just the bare-citation one.

## Verification

Re-run the read-only sweep in the evidence report: extract every `owner/repo#N` cited in a blocking
context under `design/tasks/*.md`, resolve each with `gh issue view N --repo <o>/<r> --json state`,
and report `TRDD-<id8> | blocker | OPEN|CLOSED|MISSING`. Baseline to beat: 9 of 12 closed,
2026-08-21.

## Out of scope

The 3 `dev` cards naming dead pseudo-identities (hub-queued, separate). `GIONLYAF`'s boxlessness
(mid-correction, in the owner's decision queue — do not add boxes to a card whose scope is under
revision). The disk/`alcore` host signal (hub owns the escalation).

## Approval log

- 2026-08-21T16:46:00+0200 — Filed at `column: todo` under Tier-0 authority, on explicit hub
  instruction (ai-maestro-e7). No CLI verb invoked; `aimaestro-trdd.sh` remains 401 host-wide.
