---
trdd-id: LBFB7VST
title: Watch the ai-maestro-plugin repo land the three MANAGER directives, then unblock
column: todo
scope: project
project-id: ai-maestro
created: 2026-08-06T00:40:56+0200
updated: 2026-08-06T00:40:56+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: infra
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-08-06T00:40:56+0200
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
relevant-rules: []
labels: [cross-repo, plugin, watch, owner-ours]
external-refs: [Emasoft/ai-maestro#123, Emasoft/ai-maestro#124, Emasoft/ai-maestro#125]
---
# Watch the ai-maestro-plugin repo land the three MANAGER directives, then unblock

## Why this card exists

Three MANAGER cards are blocked on work that lands in `Emasoft/ai-maestro-plugin`
(another project — issues/PRs only, never its tree). The board's graph accepts only
in-corpus TRDD ids as blockers (`GRAPH-UNKNOWN-BLOCKER`), so this card is the LOCAL
representation of that external dependency: the three cards name it in `blocked-by:`,
and its own work is the verification-and-unblock action, which IS ours.

| blocked card | plugin work | durable work order |
|---|---|---|
| `TRDD-N1F0QY77` | directory-guard: `/dev/null` + quote-aware redirect tokenizer | ai-maestro#123 comment 5198192106 |
| `TRDD-BCECOHJ2` | agent-messaging: field semantics + sender-authority procedure | ai-maestro#124 comment 5198195161 |
| `TRDD-AODXPI5E` | ama-session: cross-agent unblock docs + behavioural check | ai-maestro#125 comment 5198197291 |

Measured absent at plugin v3.0.4 (0 `/dev/null` in `scripts/directory-guard.cjs`,
0 `governanceTitle` in the agent-messaging SKILL.md).

## The action (runnable when the plugin ships)

1. On a new `ai-maestro-plugin` release (or a reply on #123/#124/#125): re-measure the
   two absence probes above against the shipped version, and drive each directive's
   acceptance list as REAL checks — never message-text alone.
2. For each directive verified landed: tick the corresponding blocked card's remaining
   boxes with the measured evidence, clear it from `blocked-by:`, restore the card to
   its `pre-block-column:`, and advance it honestly.
3. When all three are clear, close this card.

## Acceptance criteria

- [ ] Plugin release verified to land directive 1 (#123) — N1F0QY77 unblocked.
- [ ] Plugin release verified to land directive 2 (#124) — BCECOHJ2 unblocked.
- [ ] Plugin release verified to land directive 3 residual (#125) — AODXPI5E unblocked.

## Approval log

- 2026-08-06T00:40:56+0200 — SELF-MANDATE (Tier 0). A watch-and-verify chore inside
  this repo; the plugin work itself is the other project's, via the posted issues.
