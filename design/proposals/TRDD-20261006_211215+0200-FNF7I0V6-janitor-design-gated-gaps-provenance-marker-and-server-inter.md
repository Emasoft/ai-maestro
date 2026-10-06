---
trdd-id: FNF7I0V6
title: Janitor design-gated gaps, provenance marker and server interrupt still unanswered
column: proposal
status: proposed
created: 2026-10-06T21:12:15+0200
updated: 2026-10-06T21:12:15+0200
current-owner: main-agent@ai-maestro
created-by: main-agent@ai-maestro
task-type: spike
min-approval-requirement: manager
scope: project
project-id: ai-maestro
approved: false
---

# Janitor design-gated gaps, provenance marker and server interrupt still unanswered

## Problem
Issue 68 is the coordination anchor for the janitor audit's eight findings gated on ai-maestro direction (janitor card AM8JD9SG). The body groups them as A provenance (F1, F3, F4), B CLI-channel auth, interrupt and managed-pane priority (F2, F6, F10), and C managed-agent relaunch (F7).
## Current open ask
The thread corrected itself on C: a managed self-restart exists (POST /api/sessions/me/restart and aimaestro-continuity.sh restart-self, card 4P1M8I18, deployed), so the unmanaged sibling relaunch workaround is unnecessary; continuity is opt-in via --continue. Still open: A provenance is confirmed real (queue-layer provenance exists, turn-layer does not); the hub proposed a side-channel ledger and rejected an in-band sentinel, but built nothing and wants the janitor to shape the contract, because match versus proof is a security-bearing design decision. B interrupt is absent (no verb, no interrupt route); until it exists the janitor must stop reporting delivered for a frozen target. Prefer-server-CLI over raw tmux for managed panes is agreed, with aimaestro-session.sh queue as the injection answer. Daemon authentication is issue 60 and is not folded in here.
## Evidence
Audit docs_dev/issue-coverage-audit-20261006.md row 68: MENTION-ONLY (SB5I53K1 planned, KCRMSNL7 blocked), self-restart half corrected, other gaps unclear.
## Acceptance
- [ ] Contract decision for turn-layer provenance (side-channel ledger or alternative)
- [ ] Decision on a server interrupt primitive, or a stated no
- [ ] The issue is narrowed to the surviving gaps
external-refs: Emasoft/ai-maestro issue #68 (https://github.com/Emasoft/ai-maestro/issues/68)

## Approval log
