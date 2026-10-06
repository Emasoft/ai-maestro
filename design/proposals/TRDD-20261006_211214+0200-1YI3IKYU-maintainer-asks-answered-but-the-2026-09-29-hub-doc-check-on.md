---
trdd-id: 1YI3IKYU
title: MAINTAINER asks answered but the 2026-09-29 hub doc check on rules seeding is unaddressed
column: proposal
status: proposed
created: 2026-10-06T21:12:14+0200
updated: 2026-10-06T21:12:14+0200
current-owner: main-agent@ai-maestro
created-by: main-agent@ai-maestro
task-type: docs
min-approval-requirement: manager
scope: project
project-id: ai-maestro
approved: false
---

# MAINTAINER asks answered but the 2026-09-29 hub doc check on rules seeding is unaddressed

## Problem
Issue 120 (MAINTAINER, four asks). Two asks were answered by issue 67; the remaining two were ruled first-hand by the hub: validateCwd for an adopted folder delegates to assertAuthorizedAgentWorkdir (lib/agent-workdir-policy.ts) and authorizes an external cwd only if the registry recorded it as that agent's own workdir, failing by throw; and AUTONOMOUS and MAINTAINER reach MANAGER directly with no COS edge (lib/communication-graph.ts). The covering card WLWHVMKT is not cited by the issue.
## Current open ask
Per the issue thread (not a ruling): The last comment (2026-09-29, from the MANAGER docs pass for Claude Code 2.1.284) leaves a hub-side doc check owed: Claude Code 2.1.284 changed loading of externally symlinked rules (a one-time external-imports approval prompt), and whether ai-maestro seeds workdir rules by copy or by symlink is unresolved. If symlink-based, user-perceived seed and restore behaviour on registered agent workdirs changes. Determine copy versus symlink in the dep-rules seeding and record the answer on the issue; no MANAGER doc change is needed either way.
## Evidence
Audit docs_dev/issue-coverage-audit-20261006.md row 120: NONE; WLHP card WLWHVMKT covers the validateCwd subject but does not cite 120; rulings posted 2026-08-21; the 2026-09-29 follow-up is unaddressed.
## Acceptance
- [ ] Seeding mechanism (copy or symlink) verified in code and recorded
- [ ] Any 2.1.284 prompt impact on registered workdirs stated
- [ ] Answer posted on the issue
external-refs: Emasoft/ai-maestro issue #120 (https://github.com/Emasoft/ai-maestro/issues/120)

## Approval log
