---
trdd-id: GIA2LC83
title: Wire the dashboard banner off getTmuxServerKeychainAlarm — the split-out UI half of 78J4I4QS
column: todo
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-18T23:34:36+0200
updated: 2026-08-18T23:34:36+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: feature
min-approval-requirement: none
mandate: true
mandated-by: self
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 3
severity: low
effort: S
labels: [ui, dashboard, watchdog, TRDD-78J4I4QS]
external-refs: [TRDD-78J4I4QS]
---

# Dashboard banner for the tmux-server keychain alarm

## Problem

TRDD-78J4I4QS shipped the keychain-blind tmux-server watchdog end to end (module, wiring, tests,
live-verified) and exported the alarm state via `getTmuxServerKeychainAlarm()` — queryable, but no
UI consumes it. A keychain-blind tmux server is a whole-fleet outage class; today the alarm reaches
whoever reads the API, not the human looking at the dashboard. That half was deliberately descoped
at review (explicitly not gating the watchdog card) and split here so the parent's checklist stays
truthful.

## Proposed fix

A dashboard banner (same surface as existing fleet-level warnings) rendered when
`getTmuxServerKeychainAlarm()` reports an active alarm, carrying the alarm's own remediation text.
Silent when clear — the alarm-fatigue pin from the parent card applies to the UI too.

## Acceptance

- [ ] With the alarm state active (test/fixture), the dashboard shows the banner with the
      remediation text; with `rc=0`, no banner and no residue.
- [ ] Suite + build green; the banner has one test that fails when the banner is unconditionally
      hidden (neuter-verified).

## Approval log

- 2026-08-18T23:34:36+0200 — MANDATE (self, Tier 0 in-scope UI work), authored at the hub's
  ai_review of TRDD-78J4I4QS under the USER delegation recorded in TRDD-BRRJK57P.
