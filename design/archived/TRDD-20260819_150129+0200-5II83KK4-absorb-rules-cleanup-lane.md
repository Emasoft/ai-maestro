---
trdd-id: 5II83KK4
title: Absorb the rules-cleanup chore into the server
column: complete
created: 2026-08-19T15:01:29+0200
updated: 2026-08-20T21:26:59+0200
current-owner: hub-session-brrjk57p-phase2
created-by: hub-session-brrjk57p-phase2
assignee: hub-session-brrjk57p-phase2
task-type: feature
scope: project
min-approval-requirement: none
mandate: true
mandated-by: self
derived: true
derived-kind: npt
parent-trdd: KCRMSNL7
npt: []
eht: []
blocked-by: []
implementation-commits: [6262fd97]
project-id: ai-maestro
labels: [family-a, janitor-absorption, npt]
release-via: none
---

# Absorb the rules-cleanup chore into the server

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-08-20 01:16

- **Lane LANDED + LIVE, dark-shipped (6262fd97).** `lib/rules-cleanup.ts` + scheduler in
  `server.mjs` after fleet-plugins-update; verified by effect after `pm2 restart`: startup line
  01:15:23 `rules-cleanup scheduler started (1h, detect-only: AIM_RULES_CLEANUP not set)`, and
  `absorbed_chores` correctly does NOT carry `rules-cleanup` (claim follows the arming — the
  janitor daemon keeps executing the chore until armed). Steady-state silence is designed: the
  janitor is installed, so the beat returns at the two cheap checks.
- **Predicate parity (box 1):** `janitorUninstalled` = the janitor's own BOTH-signals AND
  (`rules_installer.py::janitor_uninstalled`, docstring quoted in the module header): no user
  settings.json reference AND data dir gone; a merely-disabled plugin still references ⇒ never
  fires. Server posture = daemon posture (user scope only; sessions keep project scope).
- **Neuters (scripts/dev/neuter, blob-verified):** marker gate → 3 red (incl. the card's
  mandatory "unmarked rule NEVER removed" pin); settings-signal dropped → 2 red;
  installed-guard dropped → 1 red; claim-unconditional → 1 red; detect-only gate dropped →
  1 red. 14/14 green restored; tsc 0; lint 0; sibling suites 51/51.
- **NEXT ACTION (USER, optional):** arm removal with `AIM_RULES_CLEANUP=1` in
  `ecosystem.config.js` + `pm2 restart ecosystem.config.js --update-env`. Until armed the lane
  is detect-only and the janitor's own default-ON daemon half still performs the deletion in
  its ≤7-day post-uninstall window; armed, the server covers it indefinitely (the strict
  improvement this card exists for).

Server-side sweep of janitor task_rules_cleanup (3600s): remove the janitor's
provenance-MARKED rules from ~/.claude/rules/ ONLY when the janitor is CONFIRMED fully
uninstalled (referenced in no settings.json scope AND its data dir gone). Never touches
an unmarked (user-authored) rule. Strictly improves on the daemon: the orphaned-cache
daemon survives uninstall <=7 days, the server indefinitely.

The per-chore disposition table, the three cross-cutting axes (stamp+cadence contract,
claim-only-when-live, default-OFF destructive lanes), and the three measured incident
requirements live on the parent [[KCRMSNL7]] (DESIGN RESOLVED 2026-08-19 section) — read
that FIRST; this card does not restate it.

## Acceptance

- [x] marker-gated sweep implemented; the confirmed-uninstalled predicate matches the janitor's own (cite both)
- [x] stamp + cadence contract honored; claim token added only when live
- [x] test: an unmarked rule NEVER removed (neuter the marker gate -> exactly that test reds); nothing removed while the janitor is installed

## Approval log

- 2026-08-19T15:01:29+0200 — MANDATE issued as Tier-0 self-mandate (derived NPT of [[KCRMSNL7]],
  server-internal, reversible, dark-shipped where destructive). No approval request sent.
- 2026-08-20T21:26:59+0200 — COMPLETED by ai-maestro hub session under the USER's standing rule of 2026-08-20 (acceptance gate mechanically satisfied: 3/3 boxes checked).
- 2026-08-20T21:26:59+0200 — NOTE: closed as ENGINEERING COMPLETE, deliberately UNARMED. AIM_RULES_CLEANUP is withheld (USER, 2026-08-20); tracked by TRDD-6YNBQ11J.
