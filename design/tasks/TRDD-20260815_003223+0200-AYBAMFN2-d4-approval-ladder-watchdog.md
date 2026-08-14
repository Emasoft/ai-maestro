---
trdd-id: AYBAMFN2
title: Build the §D4 approval-ladder watchdog in the hub — ai-maestro owns TRDD enforcement
column: todo
created: 2026-08-15T00:32:23+0200
updated: 2026-08-15T00:32:23+0200
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

- [ ] Watchdog script exists, exit codes 0/1/2 (clean/findings/could-not-run)
- [ ] Each §D4 check implemented with a seeded-violation test (one per shape the corpus uses)
- [ ] Wired to an idle cadence (janitor heartbeat or yarn task), never per-creation
- [ ] ai-maestro#146 answered with the landing sha
