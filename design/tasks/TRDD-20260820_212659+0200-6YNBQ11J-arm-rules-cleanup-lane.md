---
trdd-id: 6YNBQ11J
title: Arm or permanently decline the rules-cleanup lane (AIM_RULES_CLEANUP)
column: backburner
scope: project
project-id: ai-maestro
created: 2026-08-20T21:26:59+0200
updated: 2026-08-20T21:26:59+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: infra
min-approval-requirement: user
---

## Problem

The rules-cleanup absorption's engineering landed and closed under TRDD-5II83KK4 (`design/archived/`),
but the feature is deliberately **not armed**. It is gated behind the env flag `AIM_RULES_CLEANUP`,
which the USER has withheld because arming it is the single IRREVERSIBLE item among four look-alike
absorbed-lane flags shipped the same day.

Three sibling flags were armed under commit `574e13bb` the same day (2026-08-19/20): the fleet-stop
lane, the memory-guard lane, and the fleet-plugins-update lane — all reversible or detect-only.
`AIM_RULES_CLEANUP` is different: armed, it calls `fs.unlinkSync` on real rule files. Recovery from a
wrong deletion is not a config revert — it requires reinstalling the janitor plugin.

`ecosystem.config.js` carries a comment at the flag's declaration telling readers **not** to
"complete the set" by arming this one alongside its siblings — the asymmetry is intentional, not an
oversight to be swept away.

## Proposed fix

None — this card exists to make the withheld decision visible and trackable, not to force it. Arming
is a USER-only Tier-3 act (irreversible, destructive). To arm: set `AIM_RULES_CLEANUP=1` in
`ecosystem.config.js`'s `env` block, then `pm2 restart ecosystem.config.js --update-env` — a plain
`pm2 restart <name>` replays the cached env and silently does nothing.

## Acceptance

- [ ] USER decides: arm `AIM_RULES_CLEANUP` (and this card records the restart + verification), or
      permanently decline (and this card closes as `cancelled` with the decision recorded)

## Approval log

