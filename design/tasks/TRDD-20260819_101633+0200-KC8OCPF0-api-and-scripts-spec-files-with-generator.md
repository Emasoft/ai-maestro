---
trdd-id: KC8OCPF0
title: Generated API spec and scripts spec files with a drift-gating generator
column: dev
created: 2026-08-19T10:16:33+0200
updated: 2026-08-19T10:16:33+0200
implementation-commits: []
current-owner: hub-session-brrjk57p-phase2
created-by: hub-session-brrjk57p-phase2
assignee: hub-session-brrjk57p-phase2
task-type: infra
min-approval-requirement: none
mandate: true
mandated-by: user
priority: 1
project-id: ai-maestro
labels: [specs, decoupling-layer, dx, orchestration-mandate]
external-refs: [USER directive 2026-08-19 (orchestrator mandate), TRDD-ARY3NRFC]
---

# Generated API spec and scripts spec files with a drift-gating generator

## Problem

USER mandate 2026-08-19: plugins never call the ai-maestro HTTP API directly — always
through the `scripts/aimaestro-*.sh` CLIs (the frozen decoupling layer). Plugin Claudes
therefore need the EXACT contract of every script command to embed in their skills/agents,
and the hub needs one authoritative machine-derived spec of both layers so "what exists"
is never answered from memory. Today that knowledge lives in 14 script headers and 251
route files — unenumerated anywhere.

## Design

Two git-tracked spec files under `design/specs/`, both GENERATED:

1. `aimaestro-scripts-spec.md` — the PLUGIN-FACING contract. One section per
   `scripts/aimaestro-*.sh`: version, header usage block verbatim, dispatch verb list.
   This file is what plugin sessions consume to pick commands for their skills.
2. `aimaestro-api-spec.md` — the INTERNAL surface (hub + script authors only; plugins
   must not call it). One row per route: method, path template, strict classification
   (from `security-registry.json`), source file, first doc-comment line.

Generator `scripts/gen-specs.mjs` (node, runtime — no build):
- default: regenerate both files in place;
- `--check`: regenerate to temp, byte-compare, exit 1 on drift (CI/pre-publish gate) —
  three-state exits: 0 in-sync, 1 drift, 2 could-not-run.

Workflow after bootstrap (per USER directive): SPEC FIRST — a new capability edits the
spec via its own TRDD, the generator's `--check` stays red until the implementation
catches up. The generated fences carry that instruction.

## Acceptance

- [x] `node scripts/gen-specs.mjs` produces both spec files; scripts spec covers all 14
      `scripts/aimaestro-*.sh` (14 `##` sections); API spec covers every
      `app/api/**/route.ts` (357 method rows from 251 files) with strict flags (45)
- [x] `--check` exits 0 immediately after generation; 1 on drift — NEUTER RUN 10:20:
      header edit on aimaestro-teams.sh → exit 1 `DRIFT: design/specs/
      aimaestro-scripts-spec.md`, revert verified byte-identical (git hash-object
      8de4004d); 2 on wrong repo root (scratchpad copy → exit 2 with a named cause —
      first attempt exited 1 via an uncaught ENOENT, fixed with try/die(2))
- [ ] both files committed; scripts-spec path announced to the fleet as the contract
      source

## Findings

- security-registry.json carries a DEAD key: `DELETE_/api/settings/marketplaces = strict`
  — the route file exports only GET+POST (no const-export routes exist repo-wide, so this
  is not a generator blind spot). Removing a strict entry is security-config surface:
  flagged to the USER rather than edited unilaterally.

## Approval log

- 2026-08-19T10:16:33+0200 — MANDATE issued by the USER (orchestration directive names
  these deliverables explicitly: "keep a specs file for the ai-maestro api, and a specs
  file for the ai-maestro script, with an automated specs generator at start").
