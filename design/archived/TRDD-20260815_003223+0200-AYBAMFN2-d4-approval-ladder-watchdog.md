---
trdd-id: AYBAMFN2
title: Build the §D4 approval-ladder watchdog in the hub — ai-maestro owns TRDD enforcement
column: completed
created: 2026-08-15T00:32:23+0200
updated: 2026-08-15T01:12:30+0200
implementation-commits: [80898e1e, bcce6e97]
current-owner: ai-maestro-hub
created-by: ai-maestro-hub
assignee: ai-maestro-hub
task-type: feature
min-approval-requirement: none
mandate: true
mandated-by: self
priority: 2
severity: medium
effort: medium
release-via: none
scope: project
project-id: ai-maestro
labels: [governance, watchdog, d4, trdd]
external-refs: [ai-maestro#146]
npt: []
eht: []
blocked-by: []
---

# §D4 approval-ladder watchdog

ai-maestro#146 (janitor referral, 2026-08-14): the hub owns the TRDD system, so it owns
§D4's enforcement. Build the lazy watchdog `aimaestro-trdd-approval.md` §D4 specifies —
idle-cadence sweep over `design/tasks/` + `design/proposals/`:

1. Compute each card's D3 objective floor; flag/auto-correct declared < floor
   (unambiguous → raise + un-authorize; ambiguous → MANAGER queue).
2. Verify every `mandate: true` against `authority(mandated-by) >= authority(floor)` —
   revoke forged mandates.
3. The two platelet invariants (derived ⇔ one parent names it; depth exactly 1).
4. Completion gates (terminal column ⇒ NPT/EHT terminal + checklist exists and fully
   checked, post-2026-07-31 boundary).
5. Approval-record invariant (`approved:` ⇔ column zone; judge present ⇔ decided).
6. Supersede authority (only `T_new.created-by` may set `superseded-by`).

All pure-grep checks (the overlay's §D4 enumerates them); a report the MANAGER drains,
never a per-creation interrupt. Reuse `lib/trdd-doctor.ts` infrastructure where the
predicates already exist there.

## Sequencing (MANAGER guidance, 2026-08-15)

Priority 2 — AFTER the fleet correctness items (#131, #145) in TRDD-BDRWMBDC; nothing is
currently bleeding from its absence.

## Acceptance

- [x] Watchdog script exists, exit codes 0/1/2 (clean/findings/could-not-run) —
      `scripts/trdd-watchdog.mjs` / `yarn trdd:watchdog`, non-vacuity in the tool
- [x] Each §D4 check implemented with a seeded-violation test — checks 3-6 were ALREADY in
      `lib/trdd-doctor.ts`/`trdd-graph.ts` (inventoried, reused, not duplicated); the missing
      checks 1-2+7 land in `lib/trdd-watchdog.ts` with 19 tests incl. positive controls and
      two recorded neuter runs (each reddened exactly the predicted test)
- [x] Wired to an idle cadence, never per-creation — STRONGER than this box's "yarn task"
      option: 3P-ZON-11 says a watchdog scheduled nowhere satisfies nothing, so the sweep is
      scheduled in the SERVER (lib/trdd-watchdog-scheduler.ts, 6h, reporting-only), the one
      host that owns the ladder model. Live-verified: `[trdd-watchdog] sweep ran: 439
      scanned…` in pm2-error.log at 2026-08-15 01:05:16, report written without any command
- [x] ai-maestro#146 answered with the landing sha (80898e1e + bcce6e97) and closed

## Approval log

- 2026-08-15T01:12:30+0200 — COMPLETED by ai-maestro (self-mandate, floor none — in-scope
  tooling; the .github/-shaped floors are what the delivered code COMPUTES, not what this
  card touched). First sweep found and floor-corrected two live under-classified cards
  (F181A4AE, Z3T7DVL4) per §D4 auto-correct. Closes with siblings 8F8PJEXI + TGNU1EP7.
