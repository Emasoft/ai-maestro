---
trdd-id: ZR5WUQJZ
title: Two workdir-policy tests fail whenever the checkout lives outside $HOME
column: complete
scope: project
project-id: ai-maestro
created: 2026-08-05T04:58:45+0200
updated: 2026-08-05T05:04:12+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-08-05T04:58:45+0200
severity: low
effort: small
relevant-rules: []
npt: []
eht: []
blocked-by: []
release-via: none
implementation-commits: [0963a64d]
labels: [tests, portability, workdir-policy]
---

# Two workdir-policy tests fail whenever the checkout lives outside $HOME

## ⏵ STATE — DONE, 2026-08-05. Shipped in `0963a64d`, same session it was filed.

**The guard-order question is answered: the recursion guard now runs BEFORE the outside-`$HOME`
catch-all.** `INSTALL_ROOT` is `process.cwd()` at module load, so it is only USUALLY under `$HOME`;
with the generic check first, asking for the install tree itself was answered `outside $HOME`. Both
arms return `ok: false`, so **reordering cannot change a verdict — only which reason is reported**,
and specific beats generic when both apply. Nothing was ever unsafe; the hazard this policy exists
to NAME simply went unnamed exactly where an unusual layout makes naming it most useful.

One edit, not two: `agent-workdir-policy` delegates to `checkWorkdirPathPolicy`, so both consumers
share one predicate and cannot drift.

**Measured, both locations, 36/36 each:** normal checkout `~/ai-maestro` and a worktree at
`/private/tmp/aim-loc`. Full suite `361 files / 5070 passed`, exit 0.

**The neuter (`if (isUnder(resolved, INSTALL_ROOT))` → `if (false)`) reddens from BOTH locations,
and the ASYMMETRY is the finding worth keeping:**

| run from | red |
|---|---|
| inside `$HOME` | **4** — every install-tree test |
| outside `$HOME` | **2** — only the two asserting the specific MESSAGE |

Outside `$HOME` the catch-all still denies, so tests asserting merely *"was it denied"* stay green
with the recursion guard deleted. The only two that fail are the ones pinning the message — i.e.
**the exact assertions the tempting portability fix (`expect(allowed).toBe(false)`) would have
removed.** Relaxing them would have left the guard deletable with a green suite from any location.

**SUPERSEDED — do NOT carry forward:** the NEXT ACTION below (answered) and the framing of the
guard order as an open question.

## ⏹ The original report — 2026-08-05 (resolved above)

Found while running the full suite in a scratch worktree at `/private/tmp/aim-base` (the control
run for [[BLBNDGZ1]]). Two tests fail there and pass in the normal checkout:

```
tests/lib/agent-workdir-policy.test.ts
  > checkAuthorizedAgentWorkdir — hard denials (these must never regress)
  > denies the ai-maestro install tree — THE RECURSION GUARD

tests/unit/workdir-path-policy.test.ts
  > forbidden working directories — these must never regress
  > refuses the ai-maestro install tree (an agent must not rebuild its own server)

AssertionError: expected 'outside $HOME (/private/tmp/aim-base)' to match /ai-maestro installation/i
```

**The guard is NOT broken — it denies in both cases.** What differs is the REASON. From a checkout
outside `$HOME`, an earlier guard fires first and returns `outside $HOME (...)`; the assertion
demands the later, more specific `ai-maestro installation` message.

**NEXT ACTION:** decide the guard ORDER question before touching the assertions — read
`lib/workdir-path-policy.ts` and its sibling and determine whether the install-tree check SHOULD
run before the outside-`$HOME` check. If yes, reorder and the tests pass unchanged. If no, the
tests must accept either denial *without* losing what they pin.

## Why the obvious fix is the wrong one

Both tests are labelled **"these must never regress"**, and one is named **THE RECURSION GUARD** —
an agent must not be handed the ai-maestro source tree as its own working directory and start
rebuilding the server it is running on. Loosening the assertion to `expect(allowed).toBe(false)`
would make both tests pass everywhere and pin almost nothing: a denial for *any* reason satisfies
it, so the recursion guard could be deleted entirely and the suite would stay green. That is the
exact vacuity these tests exist to prevent, and it is what a "just make it portable" fix produces.

If the tests end up accepting either message, they need a second assertion that keeps the specific
guard pinned — e.g. drive the install-tree check directly with a fake `$HOME` that CONTAINS the
install root, so the outside-`$HOME` guard cannot pre-empt it and the specific message is the only
possible outcome.

## Who this actually bites

Not a theoretical portability worry:

- a scratch worktree under `/tmp`, which this project's own subagent write-guard explicitly permits
  as a write root, and which `BLBNDGZ1`'s prescribed control-run recipe tells you to create;
- a container build that checks out to `/app`, `/workspace`, or `/srv`;
- any contributor who keeps repos outside their home directory.

In each case `yarn test` is 2 red on a clean tree, which trains the reader to ignore a red suite —
the failure mode that makes every other guard in it worthless.

## What was measured

| checkout | result |
|---|---|
| `~/ai-maestro` (normal), HEAD, ×5 full-suite runs | `5070 passed / 2 skipped`, exit 0 |
| `/private/tmp/aim-base` (worktree at `0fcf7116`) | `4928 passed`, **these 2 failed** |

The two failures are the ONLY failures in the worktree run, and neither is in the seven files
`BLBNDGZ1` was about — which is how they were isolated as an artifact of location rather than of
the base commit.

## Verification

```bash
# Reproduce (the failure is deterministic, not load-dependent):
git worktree add /tmp/aim-loc HEAD && ln -s "$PWD/node_modules" /tmp/aim-loc/node_modules
(cd /tmp/aim-loc && bash scripts/with-node.sh npx vitest run tests/lib/agent-workdir-policy.test.ts tests/unit/workdir-path-policy.test.ts)
rm -f /tmp/aim-loc/node_modules && git worktree remove /tmp/aim-loc --force
```

Pass criteria: those two files green from BOTH checkout locations, AND a neuter deleting the
install-tree guard still reddens a named test from both — otherwise the portability fix bought
itself by discarding the guard.

## Estimated risk

LOW to change, MEDIUM to get wrong. One conditional or two assertions; the risk is entirely in
weakening a "must never regress" guard while making it portable.

## Acceptance

- [x] the guard-ORDER question answered explicitly: **install-tree BEFORE outside-`$HOME`**, because
      both arms deny so the order can only change which REASON is reported, and the specific hazard
      should be named over the generic catch-all. Reasoning recorded in the STATE block and in a
      comment at the reorder site.
- [x] both tests pass from a checkout inside `$HOME` AND from one outside it — 36/36 each, verified
      in `~/ai-maestro` and in a worktree at `/private/tmp/aim-loc`
- [x] a neuter deleting the install-tree denial reddens a NAMED test from BOTH locations — 4 red
      inside `$HOME`, 2 outside. The asymmetry is recorded in the STATE block: outside `$HOME` only
      the two MESSAGE-asserting tests fail, which is exactly why relaxing them to
      `expect(allowed).toBe(false)` would have left the guard deletable with a green suite.
- [x] `yarn test` exits 0 in the normal checkout with no new exclusions — `361 files / 5070 passed`

## Approval log

- 2026-08-05T04:58:45+0200 — SELF-MANDATE (min-approval-requirement: none). Bugfix in the authoring
  agent's own scope; reversible, no baseline deviation, no cross-team reach. Split out of
  [[BLBNDGZ1]] rather than absorbed into it: that card's premise was refuted, and this is a
  different, reproducible defect that its control run exposed.
- 2026-08-05T05:04:12+0200 — CLOSED `todo → complete` by ai-maestro, same session it was filed.
  Fixed in `0963a64d` (one conditional reordered, no assertion touched). All four acceptance boxes
  met; the neuter reddens from both checkout locations, so the portability fix did not cost the
  recursion guard its teeth.
