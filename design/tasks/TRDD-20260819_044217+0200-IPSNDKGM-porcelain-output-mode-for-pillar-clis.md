---
trdd-id: IPSNDKGM
title: Porcelain output mode for trddgrep and specgrep
column: todo
created: 2026-08-19T04:42:17+0200
updated: 2026-08-19T04:42:17+0200
current-owner: hub-session-brrjk57p-phase2
created-by: hub-session-brrjk57p-phase2
assignee: hub-session-brrjk57p-phase2
task-type: feature
min-approval-requirement: none
mandate: true
mandated-by: self
priority: 2
project-id: ai-maestro
labels: [3-pillars, tooling, dx]
external-refs: [TRDD-Z70X3LEW, AMOA TRDD-8DH44UXH]
---

# Porcelain output mode for trddgrep and specgrep

## Problem

AMOA declined migrating 2 of its 7 pillar-CLI call sites (F1 `find_trdd`, F3
`compile_handoff` spec lookup) because `trddgrep show` and `specgrep` emit only
human-oriented ranked output — a library parsing that text is brittle by construction.
Proposal TRDD-Z70X3LEW's 3P-TOOL-04 clause requires a machine-readable mode; this card is
the implementation in the repo that owns the CLIs.

## Proposed fix

Add a `--porcelain` flag (alias `--paths` where the record is just a path) to the affected
verbs of `trddgrep` and `specgrep`: one record per line, stable TAB-separated fields
(path first), no ranking prose, no headers, exit trichotomy unchanged (0/1/2). Scope by
consumer need first: the two verbs AMOA's F1/F3 parse (`trddgrep show`, the `specgrep`
lookup surface), then sibling verbs opportunistically. Document the field order in each
CLI's help text — the field list IS the contract, so it changes only additively.

## Verification

- `trddgrep show --porcelain <id>` emits TAB-separated records, `cut -f1` yields exact
  paths, exit codes unchanged (0/1/2 each demonstrated, including 2 on a bogus root).
- AMOA migrates F1/F3 against it and reports; their migration is the acceptance test that
  the format is actually consumable.
- Human output byte-unchanged when the flag is absent.

## Acceptance

- [ ] `--porcelain` on the verbs AMOA's F1/F3 need, TAB-separated, path-first, no prose
- [ ] exit trichotomy demonstrated on the porcelain path (0, 1, and 2 each)
- [ ] help text documents the field order
- [ ] AMOA notified; F1/F3 migration unblocked (their reply ledgered on BRRJK57P)

## Approval log

- 2026-08-19T04:42:17+0200 — MANDATE issued as Tier-0 self-mandate (in-scope tooling work
  in the repo that owns the CLIs; reversible, local). No approval request needed.
