---
trdd-id: 9JOCY2EJ
title: Pillar CLI defects - help path, fix target, write gate, blocker semantics
column: dev
created: 2026-09-13T02:34:17+0200
updated: 2026-09-13T05:07:27+0200
current-owner: ai-maestro-0a
created-by: ai-maestro-0a
task-type: bugfix
min-approval-requirement: none
scope: project
project-id: ai-maestro
assignee: ai-maestro-0a
mandate: true
mandated-by: none
approved: true
approval-judge: ai-maestro-0a
approval-datetime: 2026-09-13T02:34:17+0200
implementation-commits: [9c07ffcc2, b16d60e2b, ac94f564b, c81ebf203, 2126059aa, f4ba6fd41]
---

# Pillar CLI defects - help path, fix target, write gate, blocker semantics

Umbrella for four bounded fixes, each with its own derived card. GitHub issues 159, 160, 161 and 158. Details and file:line references are in the approved plan at nested-sprouting-pelican.md under the claude plans folder. Constraint on every change under lib: never cite a rule id in a comment there; the coverage scanner classifies any rule cited in lib as enforced, and the enforcement-coverage governance test already fails at baseline so a new violation would hide inside an existing red.

## Approval log

- 2026-09-13T02:34:17+0200 — MANDATE issued by ai-maestro-0a (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.

## Acceptance

- [x] 158 — a superseded blocker no longer clears a hold (SHIPPED set; b16d60e2b, ac94f564b)
- [x] 159 — help/--help/-h work with no corpus present (ac94f564b)
- [x] 160 — fix requires a target, selector narrows the WRITE not the READ (2126059aa)
- [x] 161 — the fix/edit write gate moved into scripts/pillar-cli, covering all three names (9c07ffcc2)
- [x] 162 — pillar-CLI usage rules shipped in-repo as a distributed overlay (c81ebf203, f4ba6fd41)
- [ ] 161 remainder — retire the orphan scripts/install-pillar-tooling.sh and its two docs/SCRIPT-MANIFEST.md refs (BLOCKED: deletion needs USER approval)
- [ ] 160 reading — NARROW shipped (fix <id> repairs that card only); confirm with USER, broad is one line away
- [ ] DUPLICATION — ~/.claude/rules/three-pillars-tools-only.md and rules/aimaestro/aimaestro-pillar-cli-usage.md differ on 21 of ~84 lines and neither is canonical; needs a decision with the janitor repo
- [ ] 161 BYPASS (found 2026-09-13, live in 9c07ffcc2) — `trddgrep --design-dir <path> fix <id>` REPAIRED a file from /tmp with NO AIM_PILLAR_ALLOW_WRITE. Measured: seeded 2 autofixable defects in a corpus copy, ran the command from /tmp, output "REPAIRED 1 file(s)", lint went 2 errors to 0. The gate claims fix is disabled outside the checkout; --design-dir walks past it.
- [x] VERIFIED 2026-09-13 first-hand: 159 help/--help/-h rc=0 from a corpus-less dir; 161 gate refuses trddgrep+prrdgrep edit (specgrep has no gate by design); 160 verb detection survives a preceding flag (fix requires a target, not the path); 160 selector narrows the WRITE — fix <id> changed EXACTLY 1 of 668 cards and left the second seeded defect intact.
- [ ] 158 is UNPINNED — no test reddens on it (neuter of all 4 lib sites reddened zero tests) and it is inert on the live corpus; needs a synthetic corpus with a card blocked by a superseded blocker.
