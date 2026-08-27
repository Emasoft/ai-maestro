---
trdd-id: IPTGKX36
title: Twenty scenario files still declare the deprecated chrome-devtools required_tools block instead of browser_stack dev-browser
column: complete
created: 2026-08-27T21:37:13+0200
updated: 2026-08-27T22:53:50+0200
implementation-commits: [55e5c3f4]
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

## Implemented — 2026-08-27, in commit 55e5c3f4 — 22 files, not 20

The card's scan set was "files carrying the deprecated tools block". Running the acceptance sweep
over ALL 40 files instead of over that set found **two more**: SCEN-003 and SCEN-013 had migrated
their tools block long ago but still carried `Chrome browser open with DevTools accessible via
CDP`. Invisible to the card's own predicate by construction; fixed in the same pass. And the
Problem statement above undercounted the CDP line — "18 of them" was measured with a regex that
missed the second spelling (`Chrome browser with DevTools accessible`, SCEN-019); the true count
inside the 20 was 17 (three files had no Chrome line at all), plus the two stragglers = 19 removed.

Three parallel workers did the 20 edits from a written spec; their reports summed to 19 Chrome
lines removed inside the 20 while the diff says 17 — two over-counted. The diff is what is
recorded; every worker claim was re-verified per file rather than tallied.

## Acceptance

- [x] 0 of 40 files match `mcp__chrome-devtools` (was 20).
- [x] 0 of 40 files match a Chrome/CDP prerequisite, BOTH spellings (was 22 — 20 + the two
      stragglers).
- [x] 40 of 40 carry `browser_stack: dev-browser` (the other 18 already did at HEAD).
- [x] Setup's own fail-fast `yq` parser accepts all 22 edited files, exercised through
      `assert-clean-governance.sh` (which reads the frontmatter on the real setup path) — 0
      parse problems. Not my own awk; the gate the runner actually hits.
- [x] No edit landed below any file's frontmatter: every diff hunk in all 22 files sits above
      line 60; the body prose that still mentions chrome-devtools historically is untouched.
- [x] Gates: tsc 0 · 6511 passed / 492 files · pillars:lint 0 · `trddgrep validate` 266
      (unchanged).

## Approval log

- 2026-08-27T21:37:13+0200 — MANDATE issued by ai-maestro-hub-session (min-approval-requirement:
  none). Found while closing TRDD-JU6Y2V7X; a sibling of that card's item (1), not a child of it.
- 2026-08-27T22:53:50+0200 — column → human_review by user. Human review delegated to the hub session by the USER (2026-08-27, 'you can do the human review in my stead'); every acceptance box re-measured against the tree, not read
- 2026-08-27T22:53:50+0200 — COMPLETE by user. USER-delegated human review passed: 22 scenario files migrated; 0/40 deprecated blocks remain, measured corpus-wide.
