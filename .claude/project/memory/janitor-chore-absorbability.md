---
name: janitor-chore-absorbability
description: "can the ai-maestro server take over this janitor chore / should we absorb chore X / I added a name to SERVER_ABSORBED_TASKS and nothing changed / why is the janitor daemon not running while the server is up / who guards the non-harness claude sessions / the janitor reports a chore dark but we ARE running it / is a hibernated agent broken / auto-update says enabled false and lastRunAt null but something is making hundreds of calls / lastRunSummary shows 38 failed plugin updates that no longer happen / the same plugin appears both failed and updated / is the absorbed lane running at all / is cache-prune absorbed now or does the table still say no / is there a per-chore handover now or does the daemon still exit wholesale / which chores does the janitor still run while the server is up / is the absorbability table out of date / is memory-guard absorbed or armed / why does the liveness beat not claim memory-guard / detect-only memory guard would kill / AIM_MEMORY_GUARD claim follows arming activeAbsorbedChores CONDITIONAL_CHORES / is rules-cleanup absorbed or does the row still say no / orphaned janitor rules never removed — fixed / AIM_RULES_CLEANUP dark-shipped lib rules-cleanup / is fleet-stop absorbed or does the row still say no / who delivers janitor-disarm on the kill-switch / AIM_FLEET_STOP AND: the janitor still runs a chore the server absorbed / a chore runs on both sides / which capability tokens does the janitor honour - a token it does not know claims nothing, publish the exact chore name / why are three chores deliberately not published / chore ownership flapped / server-liveness late beat warning / absence of a warn does not mean healthy."
ocd: 2026-08-05
lmd: 2026-09-06
metadata:
  node_type: memory
  type: project
  tier: aspect
  topic: reliability-patterns
publish-globally: false
split-lineage: 7381dedd309c4442890dc1bdf222dc3f
---

# janitor-chore-absorbability

Can the ai-maestro server take over a given janitor chore? **A chore is absorbable IFF its
population is DATA the server holds, or a host observation the server can make with the
daemon's own instrument AND safety cutoff** — never when the population is processes or
sessions on the host. This page is the map; the detail lives in four sub-pages:

- [[janitor-chore-absorbability-test-and-handover]] — the absorbability TEST itself, the verdict
  table for all six unabsorbed-at-time-of-writing chores, and the PER-CHORE handover mechanism
  that replaced the old wholesale-exit `SERVER_ABSORBED_TASKS` model.
- [[janitor-chore-absorbability-hibernation-and-guard-gaps]] — why agent hibernation is a
  DERIVED state (not stored), and the two measured consequences of the binary
  claim/no-claim suppression: non-harness sessions go unguarded and `rules-cleanup` becomes
  unreachable.
- [[janitor-chore-absorbability-github-audit-and-autoupdate-monitoring]] — `github-config-audit`'s
  population source and its findings-publishing boundary, plus how to read the absorbed
  auto-update lane's observability signals (`lastAbsorbedRunAt`, the rolling `lastRunSummary`
  trail, the 15-min poll's phase-skew behaviour) without mistaking stale reporting for a dead lane.
- [[janitor-chore-absorbability-ownership-and-liveness-signals]] — the capability-token
  vocabulary that decides which ownership claims mean anything, the on-disk stamp files that
  record an attempted chore run, and the server-liveness late-beat warning that can catch a
  stale claim before the janitor's own 90s staleness check would.

## See also

[[family-a-continuity-absorption-plan]] — the SEPARATE Family-A (oauth / continuity) absorption question; this page covers the janitor's GLOBAL chore set instead.

## Notes and lessons learned

