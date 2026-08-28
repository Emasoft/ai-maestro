---
trdd-id: 55H0DOO6
title: Triage the five frozen archived-card validate ERRORs one card at a time
column: complete
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-28T21:45:42+0200
updated: 2026-08-28T22:23:12+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: audit
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-08-28T21:45:42+0200
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 2
severity: medium
effort: S
labels: [governance, trdd-hygiene, false-completion]
external-refs: [TRDD-3OS166YI, TRDD-9QV4ZCYY]
relevant-rules: [12]
---

## Problem

`yarn trddgrep validate` has exited **1 with the same 5 ERRORs at every measurement taken**:
18:31 (handoff rev 30.1), 21:40 and 21:47 (this session, first-hand), and the server's own
`[trdd-watchdog] sweep ran: 595 scanned, 5 error(s)` at 21:45:44 — four readings over ~3 h,
one session, same five ids. How long before 18:31 they stood is NOT measured here; the
watchdog's sweep reports (gitignored `reports/trdd-watchdog/<ts>-d4-sweep.md`, one per sweep —
the 21:45:44 one is `20260828T194544Z-d4-sweep.md`) carry the per-sweep error ids and would
date the onset. Every one is an ARCHIVED card, so rule 12 freezes its body, and every session since has
correctly refused to mass-repair them — and then left them. A red gate nobody may touch and
nobody owns is a gate that trains everyone to read `exit 1` as background noise, which is how the
next REAL finding gets ignored.

| id | class | what the linter says |
|---|---|---|
| `DXJZM3BW` | TERMINAL-WITH-OPEN-BOX | `complete` with **1 of 8** boxes unchecked |
| `IBKR7F74` | TERMINAL-WITH-OPEN-BOX | `complete` with **1 of 3** boxes unchecked |
| `G6A54OYK` | TERMINAL-WITHOUT-CHECKLIST | `completed`, no checklist at all |
| `39OPYXQ9` | TERMINAL-WITHOUT-CHECKLIST | `complete`, no checklist at all |
| `7123D51A` | BODY-STATE-CLAIM | body asserts "Implemented …" state the frontmatter does not carry |

**These are three different defects, not one, and only one of them has an owner.**
TRDD-3OS166YI owns the *gate* for the WITHOUT-CHECKLIST class (and names `39OPYXQ9` as the
frozen exemplar it must allowlist). Nothing owns the two **WITH-OPEN-BOX** cards, which are the
serious ones: each claims `complete` while one of its own acceptance boxes says the work is not
done. That is either a false completion (the work never shipped) or a stale box (it shipped and
nobody ticked it) — and those have OPPOSITE repairs.

## Why per-card and not a script

Rule 12's freeze has exactly one carve-out that applies here: *a body line FALSELY,
MACHINE-VERIFIABLY contradicting the terminal column MAY be removed.* Whether an open box is
"false" is a question about the CODE — did `DXJZM3BW`'s 8th box actually land? — so each card
needs its box read against the tree before anyone decides which side is lying. A sweep cannot
make that call, and the lessons file already records what a scripted repair over prose costs.

## Proposed fix — one decision per card, recorded in its `## Approval log` (append-only, exempt)

For each of the 5, in this order:

1. **`DXJZM3BW`, `IBKR7F74` (open box):** read the unchecked box; grep/run the tree for the thing
   it names. **Landed** ⇒ tick it, citing the commit/file:line that proves it, in an Approval-log
   line (the tick IS the rule-12 "closing edit", made late). **Not landed** ⇒ the card is a false
   completion: `git mv` it back to `design/tasks/`, `column: dev`, `pre-block-column` unset, and
   say so in the log — the archive was the lie, not the box.
2. **`G6A54OYK`, `39OPYXQ9` (no checklist):** do NOT retro-author a checklist (that manufactures
   evidence). Leave frozen; confirm 3OS166YI's allowlist names BOTH ids, not just `39OPYXQ9` —
   today it names one.
3. **`7123D51A` (body state claim):** this is a v1-era UUID card. Read the claimed state against
   the frontmatter; if the claim is true and merely un-mirrored, the carve-out permits removing
   nothing (it does not contradict the column) — instead record in the log that the claim is
   historical and the linter's `BODY-STATE-CLAIM` rule should exempt pre-v2 UUID filenames, and
   file THAT as a one-line change to `lib/trdd-doctor.ts` under this card.

Expected end state: `validate` exit **1 → 0 or 1 with ≤2 findings, each named in 3OS166YI's
allowlist**. The number matters less than every remaining red having an owner.

## Verification

- `bash scripts/with-node.sh yarn trddgrep validate` — record the exit code and the exact
  finding ids before and after; the after-list must be a subset of 3OS166YI's allowlist.
- For each open-box card, the Approval-log line cites a resolvable commit sha or file:line.

## Estimated risk

LOW. Every edit is an append to `## Approval log`, a checkbox tick with cited evidence, or a
`git mv` that UN-archives — nothing is deleted. Dependency: 3OS166YI (its allowlist).

## Acceptance

- [x] `DXJZM3BW` decided: box ticked with evidence, OR card un-archived to `dev` — log line cites why — TICKED: `_api()` at `scripts/aimaestro-continuity.sh:72` (commit `20f44bad`), bare PATH command reaches the server (401, never 127)
- [x] `IBKR7F74` decided the same way — TICKED: COS repo `design/archived/…8e8d6618-remove-direct-api-calls.md` is `column: complete`, updated 2026-08-25
- [x] 3OS166YI's allowlist names `G6A54OYK` as well as `39OPYXQ9` (or 3OS166YI's log says why not) — its gate box now names BOTH; log line added
- [x] `7123D51A` decided; if a doctor-rule exemption is the answer it is a ≤5-line change with a test — `lib/trdd-doctor.ts`: BODY-STATE-CLAIM is WARN on a v1 UUID-named file (2 code lines + comment); pinned by a new test with a v2 positive control (neuter run reddened exactly that test)
- [x] `validate` re-run recorded here: exit code + remaining ids, every one owned by a named card — BEFORE: exit 1, 5 ERROR (DXJZM3BW, IBKR7F74, G6A54OYK, 39OPYXQ9, 7123D51A). AFTER: exit 1, 2 ERROR (G6A54OYK, 39OPYXQ9 — both TERMINAL-WITHOUT-CHECKLIST, both owned by TRDD-3OS166YI); 7123D51A now a WARN

## Approval log

- 2026-08-28T21:45:42+0200 — MANDATE issued by ai-maestro-hub-session (min-approval-requirement: none). Self-mandate: in-scope governance hygiene, reversible, no other team touched. No approval request was sent.
- 2026-08-28T22:23:12+0200 — COMPLETE by ai-maestro-hub-session. All five decided per card (see the
  boxes). Two census tests that pinned the old red state were re-pinned (`pillar-grep-cli` 5→2,
  `trdd-doctor` gate: JANITOR_139 set emptied, 7123D51A now asserted as WARN). The two remaining
  ERRORs are frozen and owned by TRDD-3OS166YI (its gate/allowlist box now names both). `todo →
  complete` directly: a one-session hygiene card with no dev/testing hand-offs.
- 2026-08-28T22:23:12+0200 — implementation commit: `fa4b9564` (recorded in a follow-up, never inside the commit that carries it).
