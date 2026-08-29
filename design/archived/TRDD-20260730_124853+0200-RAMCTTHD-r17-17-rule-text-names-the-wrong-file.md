---
trdd-id: RAMCTTHD
title: R17.17's rule text names settings.local.json but the guard must target settings.json
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
column: complete
created: 2026-07-30T12:48:53+0200
updated: 2026-08-29T16:56:00+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: docs
min-approval-requirement: manager
mandate: false
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-08-21T22:02:08+0200
derived: false
relevant-rules: [R17]
blocked-by: []
npt: []
eht: []
implementation-commits: []
external-refs: [TRDD-L42SKUBW]
---

## Problem

**R17.17 (`docs/GOVERNANCE-RULES.md:672`) tells the server to read the wrong file, and the code
correctly disobeys it.**

The rule text says:

> If the AI Maestro server detects the plugin enabled at user scope
> (**`~/.claude/settings.local.json`**), it MUST disable it at user scope on startup.

The guard — now `lib/startup-user-scope-guard.mjs`, extracted from `server.mjs` by TRDD-L42SKUBW —
deliberately targets **`~/.claude/settings.json`** instead, and has carried a comment saying why
since BUG-POLLUTION-001: `settings.local.json` is a **project-scoped override**. Claude Code reads
it per-directory. At the user-home level nothing reads it, so a guard that wrote there would log
success and enforce nothing.

**The code is right and the rule text is wrong.** Verified first-hand on this host: the real
user-scope enablement lives in `~/.claude/settings.json` (`enabledPlugins` →
`ai-maestro-plugin@ai-maestro-plugins: false`), and no `~/.claude/settings.local.json` exists at
all.

## Why it must be corrected rather than left alone

Left as written, the next reader "fixes" the code to match the rule — and re-introduces a guard that
writes to a file nobody reads. That is worse than no guard, because it is a guard that REPORTS
SUCCESS: the startup log prints the R17.17 line, the enforcement map says ENFORCED with a test, and
the plugin stays enabled at user scope in every Claude project on the host.

The parenthetical is the entire defect. Everything else in R17.17 — the MUST NOT, the local-scope
requirement, the rationale — is correct and unchanged.

## Proposed fix

In `docs/GOVERNANCE-RULES.md:672`, replace the parenthetical `(~/.claude/settings.local.json)` with
`(~/.claude/settings.json)`, and add the reason inline so the next reader cannot "correct" it back:

> If the AI Maestro server detects the plugin enabled at user scope
> (`~/.claude/settings.json` — **not** `settings.local.json`, which is a project-scoped override
> that nothing reads at the user-home level), it MUST disable it at user scope on startup.

Nothing else changes. No guard changes: the code already does the right thing.

## Why this is a proposal and not a Tier-0 edit

`docs/GOVERNANCE-RULES.md` is a governance file, so the objective floor in
`aimaestro-trdd-approval.md` §D3 puts it at `min-approval-requirement: manager` regardless of how
small the diff is. TRDD-L42SKUBW recorded the mismatch and explicitly declined to fold a governance
edit into a refactor; this is the routing it promised, not a second discovery.

## Verification

- `grep -n "settings.local.json" docs/GOVERNANCE-RULES.md` no longer matches inside R17.17.
- `tests/unit/startup-guards.test.ts` is unchanged and still green — the test already asserts the
  target file explicitly (`writes settings.json — NOT settings.local.json`), so the corrected rule
  text and the pinned behaviour agree instead of contradicting each other.
- The enforcement map's R17.17 row is unchanged (the guard did not move).

## Estimated risk

LOW. A one-parenthetical doc correction with no code change and an existing test that already pins
the corrected behaviour. The risk of NOT doing it is strictly higher than the risk of doing it.

## Acceptance

- [x] R17.17's parenthetical names `~/.claude/settings.json`, with the reason inline so the next
      reader cannot "correct" it back.
      **DONE 2026-08-29.** The row (now `docs/GOVERNANCE-RULES.md:681`; it has drifted from :672 to
      :680 to :681 across unrelated edits, which is why the check below is by CONTENT and not by
      line) reads `(~/.claude/settings.json` — **not** `settings.local.json`, which is a
      PROJECT-scoped override that nothing reads at the user-home level, so a guard writing there
      would log success and enforce nothing`)`.
- [x] The card's own verification check passes.
      **DONE.** In R17.17 the string `settings.local.json` now appears exactly ONCE — inside the
      deliberate NOT-clause — and the wrong TARGET form `~/.claude/settings.local.json` appears
      **zero** times. Stated this way rather than as the card's original
      `grep -n "settings.local.json" … no longer matches`, because that criterion as written would
      now FAIL: the fix deliberately keeps the filename in a negation, and a check that forbids the
      word cannot tell a wrong target from an explicit warning against it.
- [x] No guard changed, and the pinned behaviour still agrees with the corrected text.
      **DONE.** `lib/startup-user-scope-guard.mjs:55` still targets `settings.json`;
      `tests/unit/startup-guards.test.ts` 17/17 green, unchanged; the whole
      `tests/governance/` suite 56 files / 548 tests green, so the enforcement map and the
      governance-table checks accept the edited row.
- [x] **DERIVED, not in the original card:** the guard's own docstring no longer asserts a defect
      that has been fixed.
      **DONE.** It read *"R17.17's rule TEXT still says settings.local.json and is wrong; correcting
      it is a governance edit"* — true when written, false the moment this card landed, and left
      alone it would send the next reader to "fix" a rule that is now correct. Rewritten to record
      that the correction HAPPENED (citing this TRDD) and to warn against reverting it to match a
      remembered version of the rule. This is the card's own thesis applied to itself: a comment
      claiming a live defect is a false claim once the defect is gone.

## Approval log

- 2026-08-21T22:02:08+0200 — APPROVED by ai-maestro-hub-session (min-approval-requirement: manager).
  Re-measured: `docs/GOVERNANCE-RULES.md:680` (R17.17, line shifted from :672 by unrelated edits) still
  reads `(~/.claude/settings.local.json)`. `tests/unit/startup-guards.test.ts:85/:99` already asserts
  the correct target file, unchanged, still green. Trivial, low-risk, one-parenthetical doc fix.
- 2026-08-29T16:56:00+0200 — COMPLETED by ai-maestro-hub-session. One-parenthetical governance-text
  correction plus the derived docstring fix; no guard changed. tests/unit/startup-guards.test.ts
  17/17 and tests/governance/ 548/548 green.
