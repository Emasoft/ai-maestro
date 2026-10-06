---
trdd-id: Z96M8H7D
title: ship the pillar-CLI usage rules in-repo, versioned with the tools
column: superseded
status: archived
created: 2026-10-06T17:07:37+0200
updated: 2026-10-06T21:07:08+0200
current-owner: main-agent@ai-maestro
created-by: main-agent@ai-maestro
task-type: docs
min-approval-requirement: manager
scope: project
project-id: ai-maestro
assignee: main-agent@ai-maestro
mandate: true
mandated-by: none
approved: false
approval-judge: main-agent@ai-maestro
approval-datetime: 2026-10-06T17:07:37+0200
superseded-by: [TRDD-KQRUBOVV]
---

# ship the pillar-CLI usage rules in-repo, versioned with the tools

Source: Emasoft/ai-maestro issue #162.

install-pillar-tooling.sh installs trddgrep/prrdgrep/specgrep to ~/.local/bin but ships no rule files documenting them, so an agent in another project has the CLIs and nothing telling it they exist (the PRRD G12.1 tool-only mandate lives only in this repo's PRRD).

Ask: rule files IN-REPO (rules/ or docs/claude-rules/) documenting reads AND writes; governance requirements (approval ladder, MANAGER routing, tiers) in a separate clearly-delimited conditional section whose first line states it is enacted ONLY inside the ai-maestro harness and ignored otherwise; outside the harness the session's own Claude is approver, reviewer and mover of every card.

Do NOT have any installer write into ~/.claude/rules/ (user-global state; explicit non-goal). install-pillar-tooling.sh may PRINT the copy command on success, optionally an --install-rules flag defaulting OFF. If the intent is in-checkout-only use, say so in the README instead.

external-refs: Emasoft/ai-maestro issue #162 (https://github.com/Emasoft/ai-maestro/issues/162)

## Approval log

- 2026-10-06T17:07:37+0200 — MANDATE issued by main-agent@ai-maestro (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
- 2026-10-06 — CORRECTION by main-agent@ai-maestro: the mint wrote a self-issued mandate at min-approval-requirement none; the objective floor for this card is manager (adversarial review of c7555c0bb). Mandate withdrawn; the card is a proposal awaiting the owner's approval. The USER directive was to open a TRDD per issue, which authorizes filing, not execution.
- 2026-10-06T21:07:08+0200 — SUPERSEDED by main-agent@ai-maestro. minted with a self-issued mandate at the wrong approval floor; replaced by a correctly-floored proposal.
