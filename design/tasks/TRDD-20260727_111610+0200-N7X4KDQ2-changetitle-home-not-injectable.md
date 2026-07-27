---
trdd-id: N7X4KDQ2
title: ChangeTitle G14 verifies against the real registry.json, so no test can drive it to success
column: complete
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-07-27T11:16:10+0200
updated: 2026-07-27T11:25:31+0200
implementation-commits: [pending-commit]
created-by: claude-ai-maestro
current-owner: claude-ai-maestro
assignee: claude-ai-maestro
task-type: refactor
min-approval-requirement: none
mandate: true
mandated-by: self
derived: false
approved: true
approval-judge: claude-ai-maestro
approval-datetime: 2026-07-27T11:16:10+0200
parent-trdd: DQ6XN2VP
npt: []
eht: []
blocked-by: []
relevant-rules: [50, 51]
labels: [testability, aio, structural]
---

# ChangeTitle G14 verifies against the real registry.json, so no test can drive it to success

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-27

**DONE.** The fix was far smaller than the "MED risk" the body estimated, because the injectable
seam already existed and was already imported: `statePath` (`lib/ecosystem-constants`) is imported
at `element-management-service.ts:28` and used at `:6529`/`:6733`. Three sites hand-rolled
`join(HOME, '.aimaestro', 'agents', 'registry.json')` — ChangeTitle's G14 (`~:2635`), a sibling
verification (`~:3234`) and a G08 check (`~:6964`) — and `statePath('agents', 'registry.json')` is
byte-identical in production (`getStateDir()` IS `~/.aimaestro`). So this became a **3-line change,
no global `HOME` refactor**, and the risk assessment below is superseded.

**Payoff, and the proof it was real:** the `DeleteTeam::G03` test now asserts all THREE restore
steps. Neutering ONLY the title branch (`if (false && rec.previousTitle)`) fails it with
`expected 'autonomous' to be 'member'` — so the title restore is pinned specifically, not
incidentally. Before this change that branch was unreachable, which is exactly why the first
version of that test passed with the whole compensation neutered.

**Not done, deliberately:** `const HOME = homedir()` at `:81` still exists and still feeds other
paths. Replacing it wholesale was the body's plan; it is unnecessary for the testability goal and
would be a large blind-radius edit. If a future gate needs it, convert THAT site to its seam, the
same way — do not do a sweeping rename.

---

### Original analysis (superseded above; kept for the record)

- **What is wrong:** `services/element-management-service.ts:81` does `const HOME = homedir()` at
  MODULE scope. `ChangeTitle`'s G14 persistence check then re-reads
  `join(HOME, '.aimaestro', 'agents', 'registry.json')` **directly from disk** via
  `readFileSync` (around `:2618-2628`) to prove the write landed.
- **Consequence:** for a synthetic agent, that file never contains it, so **every** `ChangeTitle`
  call in a unit test fails with `G14: registry.json does not contain agent <id> after write`.
  The only way to make it succeed is to write into the developer's **live** registry — which
  0-IMPACT forbids outright. Mocking `@/lib/agent-registry` does not help: G14 deliberately
  bypasses it. Mocking `os` does not help either: `homedir()` is captured once at import.
- **NEXT ACTION:** replace the module-scope `const HOME = homedir()` with a lazily-resolved,
  overridable seam (the same shape `lib/ecosystem-constants.ts` already exposes —
  `statePath(...)`, which the r3-r9 fixture successfully redirects). Then G14 reads
  `statePath('agents', 'registry.json')` and every existing fixture's redirect covers it for free.
- **Load-bearing fact:** `tests/governance/r3-r9-team-governance.test.ts` ALREADY redirects
  `getStateDir`/`statePath` to a temp dir precisely because `homedir()`-derived paths could not be
  intercepted (see its comment at ~:74-85, added after an earlier batch wrote real folders under
  the developer's `~/agents/`). This TRDD is the same lesson, one guard later.
- **Do NOT** "fix" this by seeding the real `~/.aimaestro/agents/registry.json` in a test. That is
  the failure this entry exists to prevent.

## Problem

`ChangeTitle` is one of the most-cited pipelines in
`docs/GOVERNANCE-ENFORCEMENT-MAP.md`, and its persistence gate is unreachable in tests. Anything
that depends on a **successful** title change is therefore untestable too — including the
compensation added to `DeleteTeam::G03` (TRDD-DQ6XN2VP), whose title-restore branch is only
entered when a revert previously succeeded.

Discovered while writing the `DeleteTeam::G03` abort test: the first version of that test passed
with the compensation **neutered**, because every revert failed at G14, nothing was recorded as
reverted, and the assertions were satisfied trivially. The neuter run caught it.

## Root cause

A module-scope capture of process state (`homedir()`) that no test can override, feeding a gate
that reads the filesystem directly instead of going through the injectable path helpers the rest
of the module already uses.

## Proposed fix

1. Resolve HOME through `lib/ecosystem-constants`' existing `statePath()` helper at CALL time, not
   at import time, in `element-management-service.ts` (and audit for sibling `homedir()` captures).
2. Re-point G14 at `statePath('agents', 'registry.json')`.
3. Extend the `DeleteTeam::G03` test to also assert the title restore, and neuter-verify it.

## Verification

- The `DeleteTeam::G03` test's currently-unreachable title branch becomes assertable, and FAILS
  when the restore loop is neutered.
- `bash scripts/with-node.sh npx tsc --noEmit` clean; full suite green.
- No test writes anywhere under the real `$HOME`.

## Estimated risk

MED — `HOME` is referenced widely in an 8000-line module; changing it from a constant to a call
touches many sites, and a mistake would silently repoint production paths. The retype should be
mechanical and compiler-checked, done in one pass with no behavioural edits alongside it.

## Notes and lessons learned

[^1]: [id:ATOM-N7X4-KDQ2, status:valid, keywords:"test_passed_with_guard_neutered vacuous_test homedir_captured_at_module_scope unmockable_guard", ocd:2026-07-27, lmd:2026-07-27]
  DO NOT conclude a compensation works because its test is green, BECAUSE a fixture that cannot
  reach the compensated branch satisfies the assertions trivially — here every revert failed at an
  unmockable G14, so nothing was ever recorded to restore. DO run the neuter (break the guard,
  watch THAT test fail) before believing any green.

## Approval log

- 2026-07-27T11:16:10+0200 — MANDATE issued by claude-ai-maestro (min-approval-requirement: none).
  Pre-approved: Tier-0 derived work under TRDD-DQ6XN2VP. No approval request was sent.

## Acceptance checklist

- [x] the registry-verification reads resolve through an overridable seam (all 3 sites), rather
      than a module-scope `homedir()`. The blanket `HOME` replacement was NOT done and is not
      needed — see the STATE block.
- [x] G14 reads via `statePath('agents', 'registry.json')`
- [x] `DeleteTeam::G03` test asserts the title restore, neuter-verified (title branch alone →
      `expected 'autonomous' to be 'member'`)
- [x] tsc clean, 251/251 test files, nothing written under the real `$HOME`
