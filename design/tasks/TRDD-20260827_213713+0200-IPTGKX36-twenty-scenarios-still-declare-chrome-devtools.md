---
trdd-id: IPTGKX36
title: Twenty scenario files still declare the deprecated chrome-devtools required_tools block instead of browser_stack dev-browser
column: planned
created: 2026-08-27T21:37:13+0200
updated: 2026-08-27T21:37:13+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: docs
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-08-27T21:37:13+0200
priority: 2
severity: minor
effort: small
labels: [scenario-improvement, test-infrastructure]
---

## Problem

`TRDD-JU6Y2V7X` fixed the deprecated `required_tools:` block (five `mcp__chrome-devtools__*`
entries, retired 2026-04-15 per SCENARIOS_TESTS_RULES.md Rule 8) in SCEN-001 only, because that
is the file the card named. Measured on closing it, 2026-08-27: **20 of 40** scenario files still
carry the block — SCEN-002, 004–012, 014–016, 018–024 — and **18** of them also keep the stale
prerequisite line `Chrome browser open with DevTools accessible via CDP`. **0** of the 20 carry
`browser_stack: dev-browser`, so none is merely contradictory; all are unmigrated.

The USER surfaced this by asking why chrome-devtools was being installed when dev-browser is
already the dependency — it is not being installed; the stale declarations just make it look
required.

## Proposed fix

Per file: replace the `required_tools:` block with `browser_stack: dev-browser`; replace the CDP
prerequisite with `AI Maestro server running at http://localhost:23000 (dev-browser handles
browser launch)`. Nothing else in the files changes. SCEN-001 (commit for TRDD-JU6Y2V7X) is the
worked example. Use the Edit tool per file, never a scripted rewrite — the frontmatter is
hand-authored YAML and a regex that misses one file's indentation silently no-ops.

## Verification

- `grep -l 'mcp__chrome-devtools' tests/scenarios/SCEN-*.scen.md | wc -l` → 0.
- `grep -l 'DevTools accessible via CDP' tests/scenarios/SCEN-*.scen.md | wc -l` → 0.
- For each edited file, `yq '.browser_stack'` on its frontmatter → `dev-browser`.
- `tests/scenarios/scripts/scenario-setup.sh <NNN>` still parses each file's frontmatter (the
  `yq` fail-fast parser would abort on a broken block).

## Acceptance

- [ ] 0 files match `mcp__chrome-devtools`.
- [ ] 0 files match the CDP prerequisite.
- [ ] All 20 carry `browser_stack: dev-browser`.
- [ ] Setup's frontmatter parser accepts every edited file.

## Approval log

- 2026-08-27T21:37:13+0200 — MANDATE issued by ai-maestro-hub-session (min-approval-requirement:
  none). Found while closing TRDD-JU6Y2V7X; a sibling of that card's item (1), not a child of it.
