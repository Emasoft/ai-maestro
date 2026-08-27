---
trdd-id: ENFCF8O7
title: A block-first comment stripper blinds ten governance scanners over arbitrary regions
column: complete
created: 2026-08-27T14:38:20+0200
updated: 2026-08-27T15:29:37+0200
current-owner: hub-claude
assignee: hub-claude
created-by: hub-claude
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
task-type: security
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: hub-claude
approval-datetime: 2026-08-27T14:38:20+0200
priority: 0
severity: high
effort: medium
release-via: none
labels: [governance, security, tooling, detector]
npt: []
eht: []
implementation-commits: [4d155c53, 47848d73, 77e50b31]
---

# A block-first comment stripper blinds ten governance scanners over arbitrary regions

## Problem

Ten test files strip comments as `src.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'')`
— **block comments FIRST, line comments second.** A `/**` that occurs inside a `//` line
comment (or inside a string or regex literal) is therefore read as a BLOCK-COMMENT OPENER, and
everything up to the next `*/` anywhere in the file is deleted before any detection runs.

**MEASURED on `services/headless-router.ts`:**

| | |
|---|---|
| raw lines | 4 733 |
| after block-comment strip | 2 687 |
| lines silently deleted | **2 046 (43%)** |
| largest "block comment" matched | **75 157 chars**, opening `/**.\n    const auth = authenticateAgent(` |

The opener is line 2626: `// this path: headless reimplements routes and never executes app/api/**.`
— the `**.` in `app/api/**.` is the `/**`. Everything from there to the next `*/` vanishes,
including the two LIVE `await updateTeam(teamId, …, managerId)` calls at lines 2999 and 3053.

**The failure direction is the dangerous one: findings are silently REMOVED.** The scanner
concluded `headless-router.ts` touches ONE store when it touches two, and
`r51-multistore-scan-surface` duly reported "no longer a finding — remove it and lower
MAX_UNWRAPPED". Acting on that instruction removes a legitimate allowlist entry and tightens a
DOWN-ONLY ratchet on a false premise. That change was made (756b90ea) and reverted (d6b88501)
once the stripper was measured.

## Blast radius

**10 files** carry the identical strip, and **all 10 feed it REAL TREE FILES** — measured, not
inferred from names: every one calls `readFileSync`/`execFileSync`/`find app/api`/`ls-files`
(1-7 sites each; r51 at 5 as the positive control). None is fixture-only, so none is exempt on
corpus-exposure grounds. Several are authorization scanners, where a removed finding means an
unguarded route reads as guarded; that DIRECTION is measured for r51 only (see below):

`queue-cancel-authorization` · `portfolio-no-sudo` · `queue-enqueue-authorization` ·
`wake-hibernate-authcontext-required` · `chat-send-authorization` · `email-address-authorization`
· `session-patch-sudo-gate` · `dangerous-primitive-authorization` ·
`r51-multistore-scan-surface` · `r2-r8-team-registry-invariants`

**What is MEASURED vs INFERRED, because this card is the durable record.** Measured: all ten
carry the identical strip (two independent needles — an escaped regex and a literal `grep -F` —
both return 10, with r51 as positive control); two sampled at random (`chat-send-authorization`,
`dangerous-primitive-authorization`) read real files via `readFileSync`/`execFileSync`, so they
scan the corpus rather than fixtures; and r51 is measurably WRONG on a real file today.

Inferred, not measured: that the other nine currently produce a wrong verdict. The exposure
argument is a shared code shape plus corpus-reading, not nine observed misbehaviours — each is
blind over any region between a `/**` inside a line comment or string and the next `*/`, and
whether that region contains anything they look for is per-file. One instance of the trigger was
observed (a glob, `app/api/**`); that it generalises to doc references and markdown emphasis is
reasoning about the regex, not an observation.

## Why the existing controls did not catch it

`r51` carries a NON-VACUITY test and a POSITIVE CONTROL, and **both pass**. They prove the
scanner sees a substantial surface and finds a seeded violation; neither can detect that a
specific real file is being read with 43% of its body removed. A control that feeds synthetic
input cannot observe what the stripper does to the real corpus.

## Proposed direction (not decided)

Strip LINE comments before block comments, or use a small tokenizer that respects string and
regex literals. A regex-only fix must be tested against a file containing `/**` inside a line
comment AND inside a string literal — one is not the other.

## Acceptance

- [x] The stripper fixed in ONE shared place, not ten copies — `tests/helpers/strip-comments.ts`, a context-aware tokenizer; all ten import it
- [x] A test feeding a fixture with `/**` in a line comment, in a string, and in a regex literal — `strip-comments.test.ts`, 8 cases; the motivating case is asserted AGAINST the old strip too
- [x] ~~A per-file line-count floor~~ MOOT, deliberately: the tokenizer PRESERVES line count (comment bytes become spaces, newlines kept — pinned by a test), so stripped == raw by construction and a ratio check would be vacuous. The regression guard is instead the neuter: regressing the tokenizer toward the bug reds THE BUG test (1 red / 7 green), and restoring the old strip in r51 reds r51 on the headless-router row
- [x] All ten consumers re-run and their allowlists/ratchets re-derived from the corrected scan — r51 re-derived BEFORE wiring: 6 unwrapped, exactly the existing set at MAX_UNWRAPPED=6; every other consumer green with NO set change. Full suite 483/483
- [x] `headless-router.ts` re-assessed against the fixed scanner — two stores (team-registry + agent-import), unwrapped, entry stays; the earlier ratchet-down was wrong and its revert is confirmed

## Approval log

- 2026-08-27T14:38:20+0200 — MANDATE issued by hub-claude (min-approval-requirement: none). Tier-0 self-mandate:
  measurement and filing. The fix touches ten governance scanners and is deliberately NOT done
  here — it needs its own change with the fixture above, not a same-turn patch.
- 2026-08-27T15:29:37+0200 — COMPLETED by hub-claude. Helper 4d155c53, neuter record 47848d73, wiring 77e50b31. No allowlist grew, no ratchet moved; the instrument was the only thing wrong.
