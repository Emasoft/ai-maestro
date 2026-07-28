---
trdd-id: 8KDIB2LT
title: Propagate the new pillar CLI contract to every consumer and document
column: blocked
pre-block-column: todo
scope: project
project-id: ai-maestro
created: 2026-07-28T20:00:06+0200
updated: 2026-07-28T20:00:06+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: docs
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-28T20:00:06+0200
derived: true
derived-kind: eht
parent-trdd: L55IYKL4
priority: 1
severity: normal
effort: small
release-via: none
relevant-rules: []
npt: []
eht: []
blocked-by: [7JK3NCV4]
external-refs: []
---

# Propagate the new pillar CLI contract to every consumer and document

## The hole this handles

The parent changes the CLI contract in three ways at once:

1. **Exit codes become a trichotomy** — `0` clean · `1` findings · `2` the check could not run.
   Today `greptrdd validate` returns 0 or 1 only, and returns **0** when it read nothing.
2. **`--design-dir` exists**, so the tools stop being "must be run from the repo root".
3. **Two new commands exist** — `prrdgrep`, `specsgrep`.

Every one of those is a documented surface somebody or something reads.

## Verified starting position

Nothing in `.github/workflows/`, no git hook, and no `package.json` script branches on these exit
codes today — the only automated gate is the vitest test
`tests/unit/trdd-doctor.test.ts:436`. So this is a **documentation and consumer sweep, not a live
break** — which is exactly why it is easy to forget, and why it is an EHT rather than a footnote.

## What must be swept

- `scripts/aimaestro-trdd.sh` (387 lines) — the script-layer wrapper agents call
- `docs/SCRIPT-LAYER.md` — the canonical per-subcommand reference
- `CLAUDE.md` — the pillar-tooling section
- `package.json` scripts (add `prrdgrep` / `specsgrep` / `pillars:lint` alongside `greptrdd`)
- the `install-messaging.sh` distribution decision: today **no `*.mjs` is copied to
  `~/.local/bin`** and the pillar CLIs are repo-local. If that changes, each copied CLI must carry
  the Node-22 wrapper, because `better-sqlite3` is native and hard-caps at Node 25
- any skill or agent definition that tells a reader "exit 0 means clean"

## Acceptance

- [ ] Every document that states an exit-code meaning states the trichotomy
- [ ] `docs/SCRIPT-LAYER.md` and `CLAUDE.md` name `prrdgrep` and `specsgrep` with their subcommands
- [ ] The distribution decision is recorded explicitly — either "repo-local, and here is why" or
      "distributed, wrapper included"
- [ ] A grep for the old two-outcome wording returns nothing

## Approval log

- 2026-07-28T20:00:06+0200 — MANDATE issued by USER (min-approval-requirement: none).
  Pre-approved: issuer authority >= required approver. No approval request was sent.
