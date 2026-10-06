---
trdd-id: 2KSHY3TO
title: no trddgrep verb repairs a format defect on an archived card — blocks a strict lint gate
column: superseded
status: archived
created: 2026-10-06T17:01:59+0200
updated: 2026-10-06T21:07:04+0200
current-owner: main-agent@ai-maestro
created-by: main-agent@ai-maestro
task-type: bugfix
min-approval-requirement: manager
scope: project
project-id: ai-maestro
assignee: main-agent@ai-maestro
mandate: true
mandated-by: none
approved: false
approval-judge: main-agent@ai-maestro
approval-datetime: 2026-10-06T17:01:59+0200
superseded-by: [TRDD-OYWFHTKU]
---

# no trddgrep verb repairs a format defect on an archived card — blocks a strict lint gate

Source: Emasoft/ai-maestro issue #170.

A card in design/archived/ carries a duplicate H1, which fails markdownlint MD025 under cpv --strict and blocks the janitor 3.7.0 publish; it is the only remaining finding.

No sanctioned tool can clear it: `AIM_PILLAR_ALLOW_WRITE=1 trddgrep edit` refuses any change to an archived card (TRDD-MQE5D28T D8 — archived cards are immutable, definitive history), and `trddgrep fix` does not treat a duplicate H1 as a finding, so there is no verb that reports or repairs it.

Two open cards (JSQSJ3PZ, K9AHY1ZB) had the same shape — the duplicate H1 comes from card creation, not hand editing.

What is missing (design decision needed on which): either a fix-verb finding class for format-only defects on archived cards (distinguishable from content edits, which stay frozen), or a narrowly-scoped format-repair verb that touches only the defect the linter names and records the repair in an append-only log. The immutability ruling (terminal columns frozen) is NOT up for change.

external-refs: Emasoft/ai-maestro issue #170 (https://github.com/Emasoft/ai-maestro/issues/170)

## Approval log

- 2026-10-06T17:01:59+0200 — MANDATE issued by main-agent@ai-maestro (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
- 2026-10-06 — CORRECTION by main-agent@ai-maestro: the mint wrote a self-issued mandate at min-approval-requirement none; the objective floor for this card is manager (adversarial review of c7555c0bb). Mandate withdrawn; the card is a proposal awaiting the owner's approval. The USER directive was to open a TRDD per issue, which authorizes filing, not execution.
- 2026-10-06T21:07:04+0200 — SUPERSEDED by main-agent@ai-maestro. minted with a self-issued mandate at the wrong approval floor; replaced by a correctly-floored proposal.
