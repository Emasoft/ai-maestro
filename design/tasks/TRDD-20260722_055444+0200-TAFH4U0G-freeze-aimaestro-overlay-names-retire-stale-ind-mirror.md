---
trdd-id: TAFH4U0G
title: Freeze the aimaestro-* overlay filenames with a pin test and retire the stale pre-split IND mirror
column: testing
created: 2026-07-22T05:54:44+0200
updated: 2026-07-22T05:59:15+0200
current-owner: ai-maestro
task-type: infra
scope: project
project-id: ai-maestro
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-22T05:54:44+0200
relevant-rules: []
labels: [governance-rules, ind-dep-split, cross-repo-contract, plugin35, am83]
external-refs: [Emasoft/ai-maestro#83, Emasoft/ai-maestro-plugin#35, Emasoft/ai-maestro-janitor#73, Emasoft/ai-maestro-janitor-DE9757LJ]
release-via: none
implementation-commits: [ec3c6a7a]
---

# Freeze the aimaestro-* overlay filenames with a pin test and retire the stale pre-split IND mirror

The two server-side follow-through items I committed to publicly on `ai-maestro#83`, fulfilling
the 3-pillars IND/DEP split cleanup (janitor `#35`/`#83`, DE9757LJ). Both are ai-maestro-internal
and reversible; the cross-repo decision was already coordinated on `#35`/`#83` with the janitor.

## Problem

1. **Silent-orphan risk (the #83 contract).** The janitor's IND base rules cite ai-maestro's DEP
   overlays BY FILENAME in their layering notes (`prrd-design-rules.md` → `aimaestro-prrd-governance.md`;
   `universal-kanban.md` → `aimaestro-kanban-multiagent.md`). But `lib/agent-rules-seed.ts:115`
   discovers overlays by GLOB (`readdir(...).filter(.md).sort()`), so a rename does NOT break seeding —
   it silently seeds the new name while the janitor's prose-pointer dangles. Nothing in ai-maestro CI
   catches it. The overlay filenames are a cross-repo interface and must be frozen.
2. **Stale pre-split mirror (my side's R1).** ai-maestro still carries the original DE9757LJ handoff
   source at `design/rules-refactor/independent/{trdd-design-tasks,prrd-design-rules,universal-kanban}.md`
   — now 951/466/13 lines divergent from the janitor's canonical shipped IND (156/114/118 ln). Read by
   no code/CI (verified). A second, wrong source of truth: a maintainer editing the 951-line copy sees
   no effect, and an agent reading it in-repo reads a superseded pillar. Same landmine as CORE's R1.

## Proposed fix

1. **Pin test** — `tests/unit/aimaestro-overlay-filename-contract.test.ts`:
   - the 4 governance overlay filenames MUST exist, each annotated with the janitor IND base it guards;
   - the FULL `aimaestro-*.md` set, discovered the SAME way the seeder discovers it, MUST equal the
     expected 5 — so any add/rename/remove trips CI and forces a deliberate test update (and, for the
     IND-cited names, coordination with the janitor on `#83` before the rename lands).
2. **Retire the stale mirror** — `git rm` the 3 divergent copies, replace with a single
   `design/rules-refactor/README.md` pointer naming the janitor repo as canonical and the current
   IND-delta channel (janitor proposal issues, e.g. `#103`). Git history preserves the old content.
3. **Doc** — fix `CLAUDE.md`'s IND bullet: the DE9757LJ handoff is complete; the in-repo source was
   retired; the janitor is canonical.

## Files
- `tests/unit/aimaestro-overlay-filename-contract.test.ts` (new)
- `design/rules-refactor/README.md` (new pointer) — replaces `independent/{3 files}.md` (removed)
- `CLAUDE.md` (IND bullet wording)

## Edge cases considered (per USER caution — the details are where it breaks)
- **Glob seeding ≠ break on rename** → the pin is the ONLY ai-maestro-side guard; that is exactly its job.
- **The 5th file `aimaestro-agent-rules.md`** is the internal operating rule (its CONTENT is guarded by
  `agent-operating-rules.test.ts`); the pin guards the NAME SET including it, so a rename/removal of any
  of the 5 is caught — a deliberate change updates both tests. Only the 4 governance overlays are the
  janitor cross-repo contract (agent-rules is internal), and the test comments say so.
- **Set discovery must mirror the seeder** (`readdir`+`.endsWith('.md')`+`sort`) so the test asserts what
  is actually shipped, not a hand-list that could drift from the seeder.
- **Retirement safety**: the 3 files are git-tracked (recoverable) and read by no CI/script (verified
  `grep rules-refactor .github/ scripts/` = 0). Referenced only by `CLAUDE.md` (fixed here) and 2 TRDDs
  (DE9757LJ terminal — frozen, left as historical record; U9UNWXMV already calls the source stale). The
  pointer README resolves any reader who follows a stale path.
- **RULE 0**: removal is a tracked-file `git rm` + commit — fully recoverable from git history.
- **`design/` is NOT gitignored** (TRDD invariant) → the README + removal are tracked as intended.

## Verification
- `bash scripts/with-node.sh yarn test tests/unit/aimaestro-overlay-filename-contract.test.ts` → pass.
- Sanity: temporarily renaming an overlay makes the test FAIL (the guard actually guards). Reverted.
- `grep -rn rules-refactor .github/ scripts/ lib/` still 0 after retirement.
- Commit by name (no push — ai-maestro is not a plugin); append SHA to `implementation-commits`.

## Approval log
- 2026-07-22T05:54:44+0200 — MANDATE (Tier-0, self, in-scope infra in own repo). USER "generally
  agree to your proposal, but be careful with implementation details / edge cases" (2026-07-22).
  Cross-repo half already coordinated + agreed on `#35`/`#83`.
