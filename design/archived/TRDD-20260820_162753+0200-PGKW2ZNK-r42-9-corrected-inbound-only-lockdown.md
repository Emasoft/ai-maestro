---
trdd-id: PGKW2ZNK
title: R42.9 corrected — the AMP-only lockdown is inbound-only and the SendMessage deny is reverted fleet-wide
column: complete
created: 2026-08-20T16:27:53+0200
updated: 2026-08-20T16:27:53+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: bugfix
scope: project
project-id: ai-maestro
min-approval-requirement: user
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-20T16:27:53+0200
derived: false
npt: []
eht: []
blocked-by: []
implementation-commits: []
priority: 0
severity: high
labels: [governance, r42-9, amp-only-messaging]
release-via: none
---

# R42.9 corrected — inbound-only lockdown, SendMessage deny reverted

## Problem

TRDD-027HZOYN shipped R42.9 with TWO halves: outbound `permissions.deny: ["SendMessage"]` +
inbound `crossSessionInbound: "refuse"`. The USER corrected it mid-turn 2026-08-20 (verbatim:
"SendMessages is needed to handle subagents! only crossSessionInbound: 'refuse' must be added
to the settings.local.json!"). The deny keys on the whole client TOOL, and that tool also
handles a session's OWN sub-agents — so the outbound half broke subagent handling in every
harness workdir it reached.

## What was done

- `lib/agent-invariants.ts` — the `amp-only-messaging` invariant now writes the inbound key
  ONLY, and REMOVES a `SendMessage` deny entry wherever the pre-correction version wrote one
  (exact-name removal; sibling deny entries and sibling keys kept). `HARNESS_DENIED_TOOLS`
  deleted; `REVERTED_DENY_ENTRY` documents the revert target.
- Spec led: `design/specs/governance-spec.md` 2.5.0 → 2.6.0 (R42.9 rewritten, the deny now
  FORBIDDEN); catalog `docs/GOVERNANCE-RULES.md` 5.4.0 → 5.5.0 follows.
- Tests rewritten (22/22 green); the removal branch neuter-pinned (1 red / 21 green, observed).
- Built + deployed (yarn build + pm2 restart); the 5-min periodic watchdog then stripped the
  deny from live workdirs.
- Fleet correction relayed to all 10 previously-notified sessions; janitor confirmed for
  USER relay.

## Acceptance

- [x] invariant writes crossSessionInbound=refuse ONLY; never a SendMessage deny
- [x] invariant REMOVES a pre-correction SendMessage deny, keeping every other deny entry (neuter-pinned)
- [x] spec + catalog corrected, spec first (2.6.0 / 5.5.0)
- [x] live-verified by effect: frank reads deny:[] + inbound refuse; a sweep of every ~/agents/* workdir finds ZERO remaining SendMessage deny entries
- [x] fleet correction relayed (10 sessions) — the earlier FYI's outbound half retracted

## Approval log

- 2026-08-20T16:27:53+0200 — MANDATE issued by USER (min-approval-requirement: user). Direct mid-turn directive; pre-approved, no request sent.
- 2026-08-20T16:27:53+0200 — COMPLETED by the hub: all boxes verified by effect.
