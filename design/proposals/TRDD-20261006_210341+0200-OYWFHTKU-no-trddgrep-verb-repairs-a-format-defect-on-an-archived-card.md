---
trdd-id: OYWFHTKU
title: no trddgrep verb repairs a format defect on an archived card — blocks a strict lint gate
column: proposal
status: proposed
created: 2026-10-06T21:03:41+0200
updated: 2026-10-06T21:17:55+0200
current-owner: main-agent@ai-maestro
created-by: main-agent@ai-maestro
task-type: bugfix
min-approval-requirement: manager
scope: project
project-id: ai-maestro
approved: false
---

# no trddgrep verb repairs a format defect on an archived card — blocks a strict lint gate

Source: Emasoft/ai-maestro issue #170.

A card in design/archived/ carries a duplicate H1, which fails markdownlint MD025 under cpv --strict and blocks the janitor 3.7.0 publish; it is the only remaining finding.

No sanctioned tool can clear it: `AIM_PILLAR_ALLOW_WRITE=1 trddgrep edit` refuses any change to an archived card (TRDD-MQE5D28T D8 — archived cards are immutable, definitive history), and `trddgrep fix` does not treat a duplicate H1 as a finding, so there is no verb that reports or repairs it.

Two open cards (JSQSJ3PZ, K9AHY1ZB) had the same shape — the duplicate H1 comes from card creation, not hand editing.

What is missing (design decision needed on which): either a fix-verb finding class for format-only defects on archived cards (distinguishable from content edits, which stay frozen), or a narrowly-scoped format-repair verb that touches only the defect the linter names and records the repair in an append-only log. The immutability ruling (terminal columns frozen) is NOT up for change.

external-refs: Emasoft/ai-maestro issue #170 (https://github.com/Emasoft/ai-maestro/issues/170)

Supersedes TRDD-2KSHY3TO, which was minted with a self-issued mandate at the wrong approval floor (adversarial review of commit c7555c0bb).

## Approval log

## Correction

The archived original's Approval-log line says the mandate was withdrawn and the card became a proposal. Neither happened: trddgrep refused the mandate rewrite and the move back to proposal. This card is the correction.

## Acceptance

- [ ] OPTION for the owner: the linter treats approval invariants (MANDATE-FORGED etc.) on superseded cards in archived/ as history, not errors — a frozen card cannot be repaired, so a permanent ERROR there carries no actionable signal (see the four superseded cards of 2026-10-06)
