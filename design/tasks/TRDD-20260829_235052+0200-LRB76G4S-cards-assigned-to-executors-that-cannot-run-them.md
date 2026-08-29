---
trdd-id: LRB76G4S
title: RETRACTED — a mention-grep was read as a dependency; the residue is two small board-hygiene items
column: todo
created: 2026-08-29T23:50:52+0200
updated: 2026-08-30T00:02:30+0200
current-owner: ai-maestro-hub-session
assignee: ai-maestro-hub-session
created-by: ai-maestro-hub-session
priority: 3
severity: LOW
effort: S
labels: [board-hygiene, amp, identity, fleet, retraction]
task-type: audit
min-approval-requirement: none
project-id: ai-maestro
parent-trdd: null
npt: []
eht: []
relevant-rules: []
external-refs: ["ai-maestro-orchestrator-agent orch#24", "TRDD-PNIP18BY"]
---

# TRDD-LRB76G4S — RETRACTED: a mention-grep was read as a dependency

## ⏵ STATE — READ THIS FIRST (authoritative; supersedes the body) — 2026-08-30

**The original finding is FALSE and must not be executed.** It claimed twelve open
cards "require an AMP/kanban round-trip" and therefore cannot be run by any live
session. Measured 2026-08-30: **zero of the twelve require one.** Every one is a
source edit, a scenario/doc edit, or historical audit prose that merely NAMES the
`amp-*` scripts.

**Do NOT perform the original acceptance box 1.** Setting `blocked-by:` on those cards
would have moved ~11 healthy cards to `column: blocked` behind a keystone that does not
block them — manufacturing a fleet-wide stall out of a grep.

**NEXT ACTION:** work the two real residues in `## What actually survives` below, or
close this card. Nothing else here is actionable.

## What went wrong

The set was built with:

```
grep -rlE "amp-kanban-|amp-send|amp-inbox" design/tasks/*.md
```

That needle answers **"which cards MENTION the amp scripts"**. The card then asserted
**"which cards REQUIRE an amp round-trip to execute"** — a different proposition the
needle never measured. The original body even records the command verbatim, so the
method was written down correctly and its output was read as the wrong claim.

The `amp-kanban-list` refusal quoted below is **real and reproducible**, and it is the
half that made the rest plausible. It blocks *using* the kanban CLI. None of the twelve
cards' work is "use the kanban CLI":

```
$ amp-kanban-list
Error: AMP identity could not be resolved for this session (35 agents registered).
```

That refusal remains correct behaviour — it is what stops a development session
impersonating the agent it develops. It is simply not what any of these cards needed.

## The measured truth, per card

Read from the actual match context, not the filename:

| card | what its AMP mention actually is |
|---|---|
| a6d93b9c route-cli-mutations | CODE — edit `amp-send.sh` to POST to `/api/v1/route` |
| 979dbdaa amp-session-identity | the keystone itself — its work IMPLEMENTS identity, does not consume it |
| 903b7a20 overnight-fleet-readiness | historical audit prose naming verbs in findings |
| SCLSRS6E janitor-control-monitor | CODE — add `amp-kanban-get.sh` / `amp-kanban-edit.sh` |
| 96ZED7BA scenarios-tested-the-op | TEXT — delete `/amp-inbox` prompts from SCEN files |
| 3TPWA71L scen015-frontmatter-drift | TEXT — scenario step edits |
| GFX57106 script-layer-drifts | a drift table listing script names as DATA |
| U9UNWXMV three-tier-kanban-scope | CODE — add `--project`/`--repo` flags to the CLI |
| 17K0SHDQ close-46-amp-identity | audit prose; already correctly `blocked` by U4N18CRY |
| BRRJK57P fleet-plugin-audit | audit prose at line 3140 of a very large card |
| 80557822 comm-graph-downstream-sync | CODE — `lib/amp-inbox-writer.ts` |
| 8e8be91a upstream-amp-sync | CODE — `services/amp-service.ts` merge work |

## What actually survives

Two small, genuine items the audit surfaced incidentally. Both are board hygiene, and
neither has anything to do with AMP identity:

1. **Four cards carry `assignee: none | null | main`** — a6d93b9c, 3TPWA71L, GFX57106,
   U9UNWXMV, plus the `main` trio. `main` is not an agent. Give each an assignee or an
   explicit park.
2. **`979dbdaa` sits at `column: approval` with no `min-approval-requirement:`** — a
   card waiting on an approver nobody named. Its own title calls it the keystone that
   unblocks all `amp-*` coordination, so it waiting silently is worth one decision.

## Estimated risk

LOW, and lower than before: the dangerous half of this card has been removed.

## Acceptance

- [x] The false premise is retracted in place, with the measured per-card evidence, so
      a future reader cannot re-derive the original conclusion from this file.
- [x] `979dbdaa` gets a `min-approval-requirement:` — set to `user` (commit `f85057fc`), which
      is what its own phased plan already said ("build gated on USER go"). The column stays
      `approval` because that is TRUE, and the card now names who can end the wait. The linter's
      surviving `STALE-COLUMN` warning is a fair question with a correct answer: the STATE block
      records a finished DESIGN phase (the 2026-06-25 synthesis), not a finished build.
- [ ] The four unassigned cards get an assignee or an explicit park. **Deliberately NOT done, and
      this is a judgement worth recording rather than an omission.** On a mono-agent board the
      only truthful assignee is the hub session, so writing it changes no execution — and this
      board carries 100+ open cards. Stamping four more with an owner that will not pull them is
      the failure `the-kanban-is-a-pipeline-that-must-drain` names: filing as a substitute for
      doing, producing a field that looks resolved and moves nothing. It should be done as part
      of a real triage pass over the whole board, not alone.

## Approval log

- 2026-08-29T23:50:52+0200 — Tier-0 (`min-approval-requirement: none`): an in-scope,
  reversible audit of this project's own board metadata, no D3 floor signals. Authored
  directly in `design/tasks/`. Nothing was approved here; a Tier-0 card has no approver.
- 2026-08-30T00:02:30+0200 — RETRACTED by its own author before execution. The finding
  was built on a mention-grep read as a dependency claim; a per-card read of the match
  context refuted all twelve. Card narrowed to the two surviving hygiene items. No
  approval involved — correcting a false Tier-0 finding is the author's own duty.
