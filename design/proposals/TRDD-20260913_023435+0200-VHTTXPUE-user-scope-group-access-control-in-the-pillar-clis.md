---
trdd-id: VHTTXPUE
title: USER-scope group access control in the pillar CLIs
column: proposal
created: 2026-09-13T02:34:35+0200
updated: 2026-09-13T03:04:21+0200
current-owner: ai-maestro-0a
created-by: ai-maestro-0a
task-type: feature
min-approval-requirement: manager
scope: project
project-id: ai-maestro
approved: false
blocked-by: []
npt: []
---

# USER-scope group access control in the pillar CLIs

GitHub issue 164. Owner ruling - non-member group folders are refused, not made non-enumerable, and the group folder name is the registered group name with no default for a host that has no group. None of the foundation exists - there is no group registry, lib/authorization.ts:717 lookupTeamIdForAgent is a team lookup and the directive is explicit that a group spans many teams and repos, authorize() at lines 243-248 takes no corpus or group argument, and pillarPreWriteCheck at lib/pillar/edit-guard.ts:182 takes no actor at all. Blocked on the caller-supplied-corpus card - until the corpus is derived from auth, a membership check has nothing trustworthy to check against.

## Approval log

## Dependencies

Depends on G6EBLBIQ (Phase 0, the corpus-selection authorization defect). Group access control has nothing trustworthy to check membership against until corpus selection is caller-derived rather than caller-supplied. Recorded here in prose deliberately rather than in frontmatter: a proposal has no runtime, so it cannot carry a runtime blocked-by edge, and npt would assert a derivation edge (parenthood) that does not exist between two independent peer proposals. On promotion to a board column, set blocked-by to G6EBLBIQ with pre-block-column recorded, if G6EBLBIQ is still open.
