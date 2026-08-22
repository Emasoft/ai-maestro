---
trdd-id: 3Q4G9ZK6
title: Purging a cemetery archive orphans the agent workdir with no UI path left to remove it
column: planned
created: 2026-07-29T19:37:18+0200
updated: 2026-08-22T21:38:01+0200
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-08-21T22:02:08+0200
current-owner: scenario-runner
task-type: bugfix
min-approval-requirement: manager
priority: 1
severity: major
effort: small
labels: [scenario-improvement, scen-001, cemetery, cleanup]
external-refs: [reports/scenarios-runner/SCEN-001_20260729T170344Z.report.md]
---

# Cemetery purge leaves a permanently unreachable agent folder

## Problem

A soft delete ("Move to Cemetery") keeps three things: the registry tombstone, the cemetery
zip, and `~/agents/<name>/`. Purging the archive removes only the zip. The agent is then
invisible under every sidebar filter — SCEN-001 checked ALL, HIBER and ACTIVE with the name
in the search box and got `false` from all three — so there is no UI affordance left that
can reach it, and the DeleteAgent pipeline is the only sanctioned remover of a workdir
(scenario Rule 1 forbids `rm -rf`, and the server legitimately re-creates folders whose
records survive). Every soft-delete-then-purge therefore leaves permanent litter, and a
scenario that follows its own cleanup rules cannot discharge it.

## Root cause

Purge is scoped to the archive file. Nothing in the purge path asks what the archive was the
last recoverable copy OF. Once it is gone the tombstone is unrevivable, so keeping the
tombstone and the folder buys nothing — but no code owns their removal.

## Proposed fix

Make purge complete the deletion it is the last step of. In the cemetery purge handler
(`DELETE /api/agents/cemetery`), after removing the zip:

- if a registry tombstone exists for that agent name and no other archive references it,
  route it through the existing DeleteAgent hard path so the tombstone, the persisted
  session row, the tmux session and — behind an explicit "also remove the folder" choice in
  the Purge Forever dialog — the workdir all go together;
- gate the folder removal on the same `~/agents/` guard DeleteAgent already applies, so an
  adopted external workdir is never touched.

Surface it honestly in the dialog: today it says "Permanently delete the archive of X? This
cannot be undone" while leaving two other artifacts behind.

## Verification

- Soft-delete an agent, purge its archive, then confirm: `ls ~/agents/<name>` fails,
  `jq '.[].name' ~/.aimaestro/agents/registry.json` does not contain it, and
  `jq '.[].id' ~/.aimaestro/sessions.json` has no row for it.
- An adopted-workdir agent (outside `~/agents/`) keeps its folder after the same sequence.

## Estimated risk

MED — it makes a purge more destructive than it is today, so the dialog copy and the
`~/agents/` guard are load-bearing. Depends on DeleteAgent's hard path being callable with
only a tombstone as input.

## ⚠ DESIGN FINDING — 2026-08-22T21:38:01+0200 — the Proposed fix, as written, deletes the WRONG folder

**Do not implement "Proposed fix" literally.** It says to look up "a registry tombstone for that
agent **name**". Resolving by name is unsafe here, and the failure mode is the worst one this
change could have: **deleting a LIVE agent's workdir.**

Two measured facts compose:

1. **`lib/agent-registry.ts:358` — the name lookup EXCLUDES tombstones:**
   `agents.find(a => !a.deletedAt && a.name?.toLowerCase() === name.toLowerCase())`.
   So the obvious helper returns the LIVE agent and *never* the tombstone the archive belongs to.
2. **A tombstone and a live agent can share a name — and a workdir.** That is `TRDD-HNJ3T3W0`,
   reproduced: *"registry.json briefly contained two entries named `scen-test-title-agent` — one
   tombstoned, one live — sharing one workdir and one tmux session name."*

Purge is `.zip`-keyed and the filename carries only `<name>-export-<ts>`, so name is the only key
the handler is handed. Follow the card's wording and a purge of a DEAD agent's archive resolves to
a LIVE agent and, with "also remove the folder" checked, removes a folder that is in use.

### The corrected design — resolve to a TOMBSTONE, by ID, and REFUSE when ambiguous

- Candidates are registry entries where **`deletedAt` is set** AND the name matches. Never the
  live-name helper.
- **Exactly one candidate** → use its `id`, and route that id through DeleteAgent's hard path.
- **Zero or more than one** → purge the zip and STOP. Report what was left behind rather than
  guessing; an ambiguous key is precisely when a destructive default is wrong.
- Keep the `~/agents/` guard (DeleteAgent already refuses `deleteFolder` outside it), and keep the
  folder removal behind the explicit dialog choice.

The refusal branch is not a corner case — it is the HNJ3T3W0 state, which is reachable today.

### The dependency runs BOTH ways, and the board records only one

The board has `HNJ3T3W0 blocked-by: [3Q4G9ZK6]`, and HNJ3T3W0 explains why: *"this is currently
the ONLY UI-only way to remove an orphaned workdir (re-create the name, then hard-delete with
'Also delete agent folder'). So it should not be closed until that proposal ships, or the orphan
becomes unremovable."*

But the reverse constraint is real and unrecorded: **while HNJ3T3W0 is open, name→agent resolution
is ambiguous, which is exactly the key this card's fix would turn on.** The corrected design above
is what lets this card ship anyway — it makes ambiguity a REFUSAL instead of a wrong guess — so
the two are decoupled by construction rather than by ordering. Stated here so nobody re-derives it
from a `blocked-by` that only points one way.

## Acceptance

Card carried ZERO checkboxes; a `severity: major` destructive change with a vacuous completion
gate. Adding it:

- [ ] purge resolves the archive to a **tombstoned** registry entry (`deletedAt` set), never via
      the live-name helper — with a test seeding a tombstone AND a live agent of the SAME name and
      asserting the live one is untouched
- [ ] zero-or-ambiguous candidates → the zip is purged, nothing else is, and the response SAYS what
      remains (a silent partial purge is what this card exists to fix)
- [ ] the tombstone, persisted-session row and tmux session go together via DeleteAgent's hard path
- [ ] folder removal only behind the explicit dialog choice AND DeleteAgent's `~/agents/` guard —
      an adopted external workdir survives the whole sequence (the card's own second verification)
- [ ] the Purge Forever dialog copy stops saying "delete the archive" while deleting more than that
- [ ] a neuter proves the tombstone-only resolution is load-bearing: swap it for the live-name
      helper and the same-name test must redden

## Approval log

- 2026-08-22T21:38:01+0200 — Design finding recorded by main; card left `planned`, NOT implemented.
  The approved "Proposed fix" is unsafe as written and needed correcting before anyone builds it.
  Also migrated the deprecated `approval-tier: 2` off this card (superseded by
  `min-approval-requirement:` per aimaestro-trdd-approval, migrate-on-next-touch).
- 2026-08-21T22:02:08+0200 — APPROVED by ai-maestro-hub-session (min-approval-requirement: manager).
  Re-measured against the live handler: `app/api/agents/cemetery/route.ts` DELETE still does only
  `fs.unlinkSync(archivePath)` and returns — no tombstone lookup, no DeleteAgent hard-path routing,
  no `~/agents/` guard, no workdir removal. The defect is unchanged from filing.
