---
trdd-id: W636KQBN
title: trddgrep validate --rule STALE-COLUMN returns one finding where its test expects two
column: complete
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-21T16:31:10+0200
updated: 2026-08-21T16:50:53+0200
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
implementation-commits: [680fb986]
release-via: none
priority: 2
severity: low
effort: small
labels: [pillar-tooling, cli-contract, toolchain, harness]
external-refs: []
---

# `trddgrep validate --rule STALE-COLUMN` returns 1 finding, its test expects 2

## ⏵ STATE — READ THIS FIRST — 2026-08-21T16:34

**THIS CARD WAS FILED ON A REFUTED PREMISE AND HAS BEEN RETITLED. The refutation is the more
useful half and is kept below, not deleted.** Filed at 16:31 claiming a broken CLI stderr
contract; refuted at 16:34 by re-running on the project's pinned Node. What survives is one real
failing test — the STALE-COLUMN count — and one process hazard worth more than it.

NEXT ACTION: reproduce the STALE-COLUMN failure **under `bash scripts/with-node.sh`**, then decide
whether the fixture drifted (one card no longer produces the finding) or the rule stopped firing.

## The one real defect

Under the pinned toolchain, `tests/unit/pillar-grep-cli.test.ts` fails exactly one test:

```
FAIL > trddgrep validate — --min-severity and --rule actually filter
     > --rule STALE-COLUMN prints exactly the 2 STALE-COLUMN findings and exits 0
AssertionError: expected [ Array(1) ] to have a length of 2 but got 1
```

Undiagnosed on purpose. Two shapes, and they are not the same bug: a fixture whose second
STALE-COLUMN card stopped qualifying (one-line fix) versus the rule itself no longer firing on a
shape it used to catch (not a one-line fix, and it would mean the linter silently got weaker).
**Reproduce before guessing** — a count that dropped by one is exactly the kind of finding that
gets "fixed" by editing the expectation.

## ⏹ REFUTED 2026-08-21T16:34 — there is no stderr-contract break. I measured the wrong Node.

The original claim: *"Node's DEP0205 warning about the tsx loader's `module.register()` reaches
stderr before `STALE `, so the pillar CLIs' first-token contract is broken."* Reproduced from a
shell against a `mktemp` fixture, exit code and all — **and the shell was on Node v26.5.0.**

Re-run through the project's own pin:

```
$ node -v                                   → v26.5.0     ← my shell
$ bash scripts/with-node.sh node -v         → v22.23.1    ← the project's pin

$ bash scripts/with-node.sh node --import tsx scripts/prrdgrep.mjs edit S7.4 \
      --expect 'not there' --replace X --design-dir $T/design
exit=2
stderr line 1: STALE prrdgrep: The content of the … changed since your command was enqueued.
```

**`STALE ` is the first token. The contract holds. The tool was never broken.**

| suite | Node 26 (my shell) | Node 22 (`with-node.sh`) |
|---|---|---|
| `pillar-grep-cli.test.ts` | 3 failed / 32 passed | **1 failed / 34 passed** |
| the 6-file pillar cluster | 3 failed / 117 passed | **1 failed / 119 passed** |

Two of the three "pre-existing failures" I reported were **manufactured by my own shell**.

### Why this was convincing, and what actually catches it

I did the right things and still got it wrong: I split mine from pre-existing by reverting my
change and re-running at HEAD (correct), and I reproduced from a shell rather than trusting the
assertion (correct). **Both measurements ran in the same wrong environment, so agreeing with each
other proved nothing.** The corpus rule is already written — *verify the HARNESS before blaming
the component* — and rigour inside a wrong harness reads exactly like rigour.

The tell was in output I had already printed and skimmed past: `node -v` → **v26.5.0**, next to a
`package.json` whose `engines` caps at `<26`, in a repo whose CLAUDE.md opens by calling Node 22
*"a hard ABI constraint, not a preference"* and gives the exact prefix to use.

**The gap is that nothing enforces it at the point of use.** Yarn checks `engines` before running a
*script*, so `yarn test` is protected — but `npx vitest run <file>`, which is what anyone reaches
for to run one file, bypasses that entirely and fails in a way that looks like a product bug. That
is worth its own card if the STALE-COLUMN fix does not already force the habit.

## Verification

- The STALE-COLUMN failure reproduced **under `with-node.sh`**, with the cause named before any
  edit — fixture drift or rule regression, stated explicitly.
- If it is the rule: a neuter recorded by name. If it is the fixture: the seeded card is shown to
  produce the finding, so the count is 2 because two cards qualify, not because the number was
  edited to match.
- Every measurement in this card re-run through `bash scripts/with-node.sh`, never a bare `npx`.

## RESOLVED 2026-08-21T16:50 — FIXTURE DRIFT, not a rule regression

Reproduced under `bash scripts/with-node.sh node --import tsx scripts/trddgrep.mjs validate --rule
STALE-COLUMN`: exactly one live WARN, `979DBDAA`. `2XV78BND` (the second card the test's own
comment names) still exists, still sits in `design/tasks/`, still `column: todo` — but its STATE
block no longer trips `STATE_READS_DONE`.

Diffed the card's history: commit `bb031694` (2026-08-20T22:35, "mark the STATE line that would
reverse a MANAGER ruling") appended ~700 chars to the top of its `## STATE` block, for a reason
unrelated to this rule — documenting that an ASSISTANT-MANAGER approval superseded stale prose.
`STATE_READS_DONE` (`lib/trdd-doctor.ts:355-356`) scans only the first 1200 chars after the `##
STATE` heading. Running that same regex against the PRE-commit blob
(`git show bb031694^:<path>`) found a match at offset 875: the standalone word **"resolved"**
inside "arrives with neither `isUserMessage` nor **a resolved** `userSender` block" — a
pre-existing false-positive hit on the rule's own `\bRESOLVED\b` alternative, describing normal
prose about code, not a finished-work claim. The August 20 insertion pushed that substring past
the 1200-char cutoff, so the card legitimately stopped qualifying. `979DBDAA`'s STATE is unchanged
and still qualifies.

So: the corpus changed (an editorial fix, made for an unrelated reason, incidentally cleared a
pre-existing false positive on this rule); the rule itself was not touched and did not regress.
Test updated 1:1 with this reproduction (2 → 1 finding, pinned to `979DBDAA` by id, comment
extended with the full chain rather than replaced) — no rule-code edit, so no neuter is owed.

## Acceptance

- [x] `pillar-grep-cli.test.ts` is green under `bash scripts/with-node.sh npx vitest run` — 35/35.
- [x] The cause is named (fixture vs rule) and recorded here, from a reproduction, not a guess —
      FIXTURE DRIFT (see above).
- [x] The expectation is NOT edited to match the observed count unless the fixture is shown to be
      the thing that changed — shown via `git show bb031694^:<path>` + a direct regex re-run
      against the pre-commit blob, both quoted above.
- [x] Neuter run recorded by name, if the fix touches the rule — N/A, `lib/trdd-doctor.ts` was not
      touched.

## Approval log

- 2026-08-21T16:31:10+0200 — MANDATE (self, Tier-0): our own CLI, our own repo, reversible.
- 2026-08-21T16:34:13+0200 — RETITLED after self-refutation. The stderr-contract premise was an
  artifact of running on Node 26 instead of the project's pinned Node 22; two of the three
  failures it was filed for do not exist on the sanctioned harness. The refuted claim is kept in
  full above, because the reason it was convincing is the transferable part.
- 2026-08-21T16:50:53+0200 — COMPLETED. Shipped in `680fb986`; every acceptance check re-run by the
  coordinator, not accepted from the worker's report. Ledger: `reports/colony/DELEGATION.md`.
