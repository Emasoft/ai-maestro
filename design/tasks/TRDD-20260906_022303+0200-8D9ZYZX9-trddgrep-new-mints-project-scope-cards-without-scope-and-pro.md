---
trdd-id: 8D9ZYZX9
title: trddgrep new mints project-scope cards without scope and project-id
column: todo
created: 2026-09-06T02:23:03+0200
updated: 2026-09-06T02:23:03+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
task-type: bugfix
min-approval-requirement: none
assignee: ai-maestro-hub-session
mandate: true
mandated-by: none
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-09-06T02:23:03+0200
---

# trddgrep new mints project-scope cards without scope and project-id

## Problem
`trddgrep new` (scripts/trddgrep.mjs) mints a PROJECT-scope card without `scope:` and without `project-id:`, although the ai-maestro overlay (rules/aimaestro/aimaestro-trdd-approval.md, "Scope discriminators"; rules/aimaestro/aimaestro-kanban-multiagent.md) says a `scope: project` card MUST carry `project-id` — it is the discriminator that binds the card to the project board. Measured 2026-09-06: of 193 cards in design/tasks + design/proposals, 90 carry `project-id:` and 105 carry `scope:`; TRDD-OUAQARPL and TRDD-6B1ND5TD, both minted by the verb this week, carry neither. The PRRD frontmatter carries `project-id: ai-maestro`, so the value is available to the tool. `trddgrep validate --min-severity error` and the doctor both pass such cards (the IND base says the field is "lint-enforced incrementally"), so the gap is invisible until a cross-project query keys on `project-id`.

A second, related observation for a later ruling (NOT a box on this card): at Tier 0 the verb writes `mandated-by: none`. The overlay's mandate section says `mandated-by` is "the TITLE whose authority pre-approves it ('self' at `none`)", while the field's enum in the tool is `none|orchestrator|chief-of-staff|manager|user` — the overlay text and the tool disagree on the Tier-0 spelling. Changing the overlay is a governance edit (MANAGER tier); changing the enum is a tool edit — which side moves needs a ruling first, so this card only records the contradiction.

## Proposed fix
In the mint path of `trddgrep new`: emit `scope: project` and `project-id: <value>` read from `design/requirements/PRRD.md`'s `project-id:` frontmatter field (fail fast with a clear error when the PRRD or the field is missing — never invent a value); do not touch `scope: local`/`user` minting if any exists. Add a validate rule (WARN first, ERROR after the corpus is migrated) for a project-scope card lacking `project-id`. The 103 existing cards without it are a separate migrate-on-next-touch concern, not a mass rewrite (the overlay's own policy for field migrations).

## Acceptance
- [ ] A card minted by `trddgrep new` in this repo carries `scope: project` and `project-id: ai-maestro`
- [ ] Minting with the PRRD `project-id:` absent fails with a named error (unit test)
- [ ] `trddgrep validate` warns on a project-scope card lacking `project-id` (unit test; no ERROR-tier change yet)
- [ ] The two minted-this-week cards (OUAQARPL, 6B1ND5TD) are repaired on next touch via `trddgrep set`, not by a sweep

## Approval log

- 2026-09-06T02:23:03+0200 — MANDATE issued by ai-maestro-hub-session (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
