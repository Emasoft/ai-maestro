---
trdd-id: Y5M4ZOES
title: R19.5 mandates the $HOME path that ai-maestro#32 calls a governance violation
column: proposal
scope: project
project-id: ai-maestro
created: 2026-08-05T17:35:51+0200
updated: 2026-08-05T17:35:51+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: docs
min-approval-requirement: user
mandate: false
approved: false
severity: medium
effort: small
relevant-rules: [19]
npt: []
eht: []
blocked-by: []
release-via: none
labels: [governance, r19, workdir-containment]
external-refs: [Emasoft/ai-maestro#32]
---

# R19.5 mandates the $HOME path that ai-maestro#32 calls a governance violation

## Problem

`docs/GOVERNANCE-RULES.md:760`, R19.5, verdict **Explicit**, still reads:

> …compares against `~/.aimaestro/maintainer/<agentId>/processed-issues.json` to detect new issues

That is the exact path ai-maestro#32 calls a governance violation, because backup and host-migration
ship the **workdir** — so a `$HOME`-rooted ledger is silently lost on restore and the agent
re-processes already-handled issues.

The MAINTAINER plugin has already moved to `$AGENT_WORK_DIR/.aimaestro/state/…` and is compliant
with the issue. **So the plugin is currently compliant with the ISSUE by violating the RULE.**

## Why this is worse than an ordinary stale rule

A rule that merely fails to help is inert. This one **actively instructs the defect**: any future
implementer who follows R19.5 literally reintroduces the bug and has the governance corpus as
justification. That is the most expensive shape a stale rule can take.

## Proposed fix

Path only — the `gh` polling mechanism is unchanged and correct:

> …compares against `$AGENT_WORK_DIR/.aimaestro/state/processed-issues.json` (resolution chain
> `AGENT_WORK_DIR → CLAUDE_PROJECT_DIR → PWD`) to detect new issues. The ledger MUST live inside the
> agent working directory: backup and host-migration ship the workdir, so a `$HOME`-rooted ledger is
> silently lost on restore and the agent re-processes already-handled issues.

`AGENT_WORK_DIR` is the correct anchor and is stronger than a convention: it is injected at
`lib/session-env.ts:89`, allowlisted at `:40`, and is the **anchor of the shell directory guard's
allow-list** (`lib/agent-shell-guard.ts:62`, `$AGENT_WORK_DIR/**`) — the mechanism that enforces
this very invariant.

## Verification

After the edit, `grep -n '~/.aimaestro/maintainer' docs/GOVERNANCE-RULES.md` returns nothing, and
the enforcement-map rows for R19 still resolve (see risk).

## Estimated risk

LOW technically, MED procedurally. R19 carries enforcement-map entries —
`ai-maestro-maintainer-agent`, `components/AgentCreationWizard.tsx`,
`SCEN-018_maintainer-lifecycle.scen.md` — and a text change must be reconciled against them or the
ratchet reddens.

**This is a USER edit and deliberately not mine.** Editing the governance corpus is above what I
take on unprompted; a ruling that requires rewriting `GOVERNANCE-RULES.md` is by construction not
one I may make under a general delegation. The patch is ready; the decision is not mine.

## Approval log
