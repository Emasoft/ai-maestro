---
trdd-id: IPSNDKGM
title: Porcelain output mode for trddgrep and specgrep
column: ai_review
created: 2026-08-19T04:42:17+0200
updated: 2026-08-19T05:10:59+0200
implementation-commits: [5f10772e]
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

## ⏵ STATE — 2026-08-19 05:11 — IMPLEMENTED (5f10772e), live via the tsx launcher

Pillar core (`lib/pillar/cli.ts` — specgrep/prrdgrep show/list/search): `path<TAB>id<TAB>
line<TAB>zone`, path absolute. trddgrep show + default search: `path<TAB>id<TAB>column<TAB>
zone<TAB>title` (title LAST — a rogue tab in it cannot shift machine fields). Capped
listings note the cap on STDERR. Flag stripped BEFORE the unknown-option refusal (positive
control pinned). 6 new tests, 35/35 green; NEUTER RUNS via scripts/dev/neuter: pillar
field-order swap → 2 red (exact), trddgrep swap → 1 red (exact). Trichotomy demonstrated
by-effect on the deployed launcher: trddgrep 0/1/2, specgrep 0/1/2. AMOA notified ~05:12.

## Acceptance

- [x] `--porcelain` on the verbs AMOA's F1/F3 need, TAB-separated, path-first, no prose
      (stdout pure; cap note on stderr)
- [x] exit trichotomy demonstrated on the porcelain path (0, 1, and 2 each — in tests AND
      by-effect on the deployed launcher, both CLIs)
- [x] help text documents the field order (additive-only contract stated in both helps)
- [x] AMOA notified 2026-08-19 ~05:12; F1/F3 migration unblocked on their side
- [ ] AMOA's F1/F3 migration confirmed against the real format (their reply ledgered on
      BRRJK57P — the acceptance test that the format is actually consumable; split from the
      box above: the notification is the hub's act, the migration is theirs)

## Approval log

- 2026-08-19T04:42:17+0200 — MANDATE issued as Tier-0 self-mandate (in-scope tooling work
  in the repo that owns the CLIs; reversible, local). No approval request needed.
