---
trdd-id: W636KQBN
title: A Node deprecation warning reaches stderr before STALE, breaking the pillar CLIs first-token contract
column: todo
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-21T16:31:10+0200
updated: 2026-08-21T16:31:10+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-08-21T16:31:10+0200
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 2
severity: medium
effort: small
labels: [pillar-tooling, cli-contract, toolchain]
external-refs: []
---

# `STALE` is no longer the first stderr token, and the test that says so is right

## Problem — reproduced first-hand, not read off a failing assertion

`tests/unit/pillar-grep-cli.test.ts` asserts that a stale pillar edit prints **`STALE ` as its
FIRST stderr token**, and the test's own comment says why that matters: *"A retry loop keying on
the exit code alone would spin forever in the wrong directory. The token is the only thing that
separates 're-read and retry' from 'you are not where you think you are' — no code in the
trichotomy can carry it."* Exit 2 means BOTH.

Reproduced 2026-08-21 against a throwaway fixture under `mktemp -d` (removed after; no live
corpus touched):

```
$ npx tsx scripts/prrdgrep.mjs edit S7.4 --expect 'not there' --replace X --design-dir $T/design
exit=2
stderr:
  (node:81088) [DEP0205] DeprecationWarning: `module.register()` is deprecated. Use `module.registerHooks()` instead.
  (Use `node --trace-deprecation ...` to show where the warning was created)
  STALE prrdgrep: The content of the TRDD/PRRD/SPEC file changed since your command was enqueued…
```

**The tool is emitting `STALE ` correctly.** Node's own deprecation warning gets to stderr first,
so `stderr.startsWith('STALE ')` is false — and so is the same check for any consumer that keys on
the first token, which is the whole point of having one.

**This is a real contract break, not a test that needs relaxing.** A machine consumer reading the
first stderr token now reads `(node:81088)`.

## What is and is not explained

Three tests fail in `pillar-grep-cli.test.ts` at HEAD (measured with an unrelated change reverted,
so they are not fallout from it — same three names, same count, before and after):

| test | explained by this card? |
|---|---|
| `prrdgrep edit … prints STALE as its FIRST stderr token` | **yes** — reproduced above |
| `specgrep edit … blocks the same command on its second run` | **yes, by inspection** — the identical `stderr.startsWith('STALE ')` assertion, same shim. Not separately reproduced; say so rather than claim it |
| `trddgrep validate --rule STALE-COLUMN prints exactly the 2 STALE-COLUMN findings` | **NO** — expects 2 findings, gets 1. A different failure that happens to share the word STALE; undiagnosed, and it needs its own reproduction before anyone guesses at a cause |

The third is listed because it is in the same red set, not because it belongs to this card. If it
turns out to be a fixture that drifted, it is a one-line fix; if the rule stopped firing, it is
not. **Do not fold it in without reproducing it.**

## The likely fix, and the one it must not be

`DEP0205` comes from the `tsx` loader's `module.register()`, on the Node in use — it is not our
call site. Candidates, cheapest first:

- suppress deprecation noise on the CLI shims (`NODE_OPTIONS=--no-deprecation`, or
  `process.removeAllListeners('warning')` in the shim before the loader runs) — but a blanket
  suppression also hides warnings we would want;
- write the machine-facing diagnostic to a channel Node does not share (stdout is taken by the
  porcelain contract, so this means fd 3 or a `--porcelain`-style error mode) — bigger, and it
  changes a published contract;
- bump/replace the loader once `tsx` moves to `registerHooks()`.

**What it must NOT be: relaxing the assertion to `stderr.includes('STALE ')`.** That is the exact
shape of a test rewritten to match a defect — `includes` is satisfied by a STALE line buried under
any amount of noise, which is the condition the contract exists to forbid.

## Verification

- The reproduction above exits 2 with `STALE ` as the first stderr byte.
- The three named tests: the two STALE ones green; the third stated explicitly as in or out of
  scope, never silently left red.
- **Neuter:** re-introduce the noise (prepend any stderr write before the diagnostic) → exactly the
  two STALE tests redden.

## Acceptance

- [ ] The `STALE ` first-token contract holds under the current toolchain, reproduced from a shell
      and not only from vitest.
- [ ] Both STALE tests green, with the assertion still `startsWith`, never widened to `includes`.
- [ ] The `trddgrep validate --rule STALE-COLUMN` failure is reproduced and either fixed here or
      given its own card — not left in the red set unexplained.
- [ ] Neuter run recorded by name.

## Approval log

- 2026-08-21T16:31:10+0200 — MANDATE (self, Tier-0): our own CLI, our own repo, reversible, no
  baseline/governance/release surface. Found while closing TRDD-DXQNUJII; filed separately rather
  than folded in, because a red set found during other work is a different card's evidence.
