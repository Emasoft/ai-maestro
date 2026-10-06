---
trdd-id: 8I77XISF
title: Gate the five remaining trddgrep write verbs and index-verify repair outside the checkout
column: proposal
status: proposed
created: 2026-10-06T21:12:10+0200
updated: 2026-10-06T21:12:10+0200
current-owner: main-agent@ai-maestro
created-by: main-agent@ai-maestro
task-type: security
min-approval-requirement: manager
scope: project
project-id: ai-maestro
approved: false
---

# Gate the five remaining trddgrep write verbs and index-verify repair outside the checkout

## Problem
Issue 169 is the residue of issue 161. The write gate in lib/pillar/write-gate.ts (commits 66b6bbbe9 and 6f6812102) now covers prrdgrep add and edit, but trddgrep new, set, append, check-box and move, plus index-verify --repair, still run ungated from outside the checkout. That is exactly the scenario the gate exists for: an agent in an unrelated project mutating a corpus it wandered into. set writes an arbitrary frontmatter field and move relocates a card between lifecycle folders, both higher impact than the gated edit, which carries --expect.
## Current open ask (no comments on the issue, so the original ask stands)
Owner policy call, option (a) or (b). (a) Extend WRITE_VERBS in lib/pillar/write-gate.ts to every mutation verb on all three tools, update the refusal message and tests/unit/pillar-write-gate.test.ts. If (a), resolve the inside check via git rev-parse --show-toplevel and --git-common-dir in the same change, or the gate revokes write verbs for linked git worktrees, which this repo actively uses (the current inside check is a cwd-prefix heuristic). (b) Keep the current scope and document a stated reason per ungated verb.
## Evidence
Audit docs_dev/issue-coverage-audit-20261006.md row 169: verdict NONE, no card mentions it, 0 comments, open ask unresolved. The gate module's own comment records the deferral and the refusal message names the ungated set, but disclosure is not tracking.
## Acceptance
- [ ] Owner picks (a) or (b) and the choice is recorded in this card
- [ ] If (a): all write verbs gated, worktree-safe inside check, tests pin each verb with a neuter run
- [ ] If (b): a stated reason per ungated verb is documented next to the gate
external-refs: Emasoft/ai-maestro issue #169 (https://github.com/Emasoft/ai-maestro/issues/169)

## Approval log
