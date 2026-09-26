---
trdd-id: H6U9HBUY
title: Seven PROJECT wikimem pages carry machine-private data and are pushed with the repo
column: proposal
status: proposed
created: 2026-09-27T00:20:44+0200
updated: 2026-09-27T00:20:44+0200
current-owner: main-agent@ai-maestro
created-by: main-agent@ai-maestro
task-type: security
min-approval-requirement: manager
scope: project
project-id: ai-maestro
approved: false
---

# Seven PROJECT wikimem pages carry machine-private data and are pushed with the repo

## Problem
The 2026-09-26/27 memory-scope-leak detector found 7 pages in .claude/project/memory/ (PROJECT scope: git-tracked AND pushed to every cloner of a repo verified PUBLIC 2026-09-27 (gh repo view Emasoft/ai-maestro → isPrivate:false)) carrying private data per memory-scope-leak-proposed.md. PROJECT scope must never carry a home path, hostname, username, or machine state (rules/reports-and-memory.md). The buffer note was re-mirrored by the harvest agent but the flagged pages themselves were not yet demoted.

## Root cause
Pages were authored into PROJECT scope with machine-specific content; scope routing (LOCAL vs PROJECT) was not applied at write time.

## Proposed fix
Read memory-scope-leak-proposed.md; per page: genericize the private content in the PROJECT page (keep the fact true), move the machine-specific part to a LOCAL note, cross-link [[both ways]], and record the why as a dated footnote lesson — per the corpus scope-leak protocol. Run through memgrep write verbs only, validate after each.

## Verification
memory-scope-leak detector re-run over PROJECT scope reports 0 flagged pages; every moved fact still recallable from its new scope (memgrep recall on the moved symptom).

## Estimated risk
MED — edits 7 shared pages; transaction-gated, non-destructive (relocate, never delete). Should be dispatched as a janitor-memory-update chore, one page per run.

## Approval log
