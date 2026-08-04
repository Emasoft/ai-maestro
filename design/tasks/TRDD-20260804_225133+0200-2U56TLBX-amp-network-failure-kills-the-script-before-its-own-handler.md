---
trdd-id: 2U56TLBX
title: A network failure kills every AMP script at the curl assignment, before its own error handler can run
column: dev
created: 2026-08-04T22:51:33+0200
updated: 2026-08-04T22:59:49+0200
implementation-commits: [8b91f884]
current-owner: governance-rules
assignee: governance-rules
created-by: governance-rules
task-type: bugfix
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: governance-rules
approval-datetime: 2026-08-04T22:51:33+0200
derived: false
npt: []
eht: []
blocked-by: []
priority: 1
severity: high
effort: medium
release-via: none
labels: [amp, messaging, network-errors, fail-open, shell]
---

# A network failure kills every AMP script at the curl assignment, before its own error handler can run

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-08-04

- **Diagnosis: COMPLETE and MEASURED** (both layers below, empirically, not read).
- **PHASE 1 DONE** — `scripts/amp-fetch.sh`, landed as `8b91f884`, with 3 tests in
  `tests/unit/amp-fetch-network-failure.test.ts` and two neuters recorded below.
- **NEXT ACTION:** phase 2 — the rest of the `-w "%{http_code}"` family. Take them ~5 files
  at a time, in this order: `amp-send.sh` (2 sites), `amp-register.sh` (2), `amp-init.sh` (2),
  then the six `amp-kanban-*.sh` (1 each), then `amp-helper.sh` (6). Each site needs the same
  TWO halves; the exit-status half is the one a reviewer will skip.
- **The trap that makes the obvious fix wrong:** `|| true` alone is NOT the fix. Measured —
  it trades a silent crash for a silent lie. Both halves are required, and neuter B below is
  what proves the second half is load-bearing rather than decorative.
- **SUPERSEDED — do NOT carry forward:** the line numbers in the Problem section below are
  pre-fix. `amp-fetch.sh`'s curl assignment is no longer at 148; re-locate by symbol.

## Problem

Every AMP script sets `set -eo pipefail` and then captures curl into a variable:

```bash
RESPONSE=$(curl -s -w "\n%{http_code}" --connect-timeout 5 ... 2>&1)
```

Under `set -e`, an assignment whose command substitution fails takes the script down **with
the command's exit status**. So when the network is unreachable, curl exits 7 and the script
**dies at the assignment** — before any line that inspects `HTTP_CODE`.

Which means the error handling the authors wrote is **unreachable dead code**. `amp-fetch.sh`
contains, verbatim:

```bash
elif [ "$HTTP_CODE" = "000" ]; then
    echo "Error: Could not connect to ${provider}"
    echo "  Check your internet connection."
```

That branch can never execute. What the agent actually gets is a bare `exit 7` and **no
output whatsoever** — there is no `ERR` trap anywhere in the AMP scripts to turn it into a
diagnosis.

**Measured, contained (`AMP_DIR` pointed at a temp dir, provider at `127.0.0.1:1`):**

| variant | exit | what the caller sees |
|---|---|---|
| today | **7** | *nothing* |
| with `\|\| true` on the assignment | **0** | the diagnostic, then `No new messages from external providers.` |

And the mechanism in isolation, so the claim rests on nothing script-specific:

```
$ bash -c 'set -eo pipefail; R=$(curl -s -w "\n%{http_code}" --connect-timeout 2 http://127.0.0.1:1/ 2>&1); echo "REACHED: [$R]"'
exit=7                       # the echo never ran
$ bash -c            'R=$(curl -s -w "\n%{http_code}" --connect-timeout 2 http://127.0.0.1:1/ 2>&1); echo "REACHED: [$R]"'
REACHED: [
000]                         # exit=0 — the branch is reachable only without set -e
```

### The consequence that is worse than the missing message

`amp-fetch.sh` loops over **every registered provider**. The abort happens inside that loop,
so **one unreachable provider stops the agent fetching from all the others** — a healthy
provider's messages are never collected, and nothing says so.

### Scale

**34 curl assignments across 20 scripts** abort under `set -e` (scanner in
`scratchpad/scan-curl-abort.py`, carrying a positive control — `amp-helper.sh:416` ends in
`|| true` and must classify as guarded; if it does not, the list is meaningless). `set -e` is
never turned off anywhere in `scripts/amp-*.sh`.

Only **three** scripts even attempt to handle HTTP 000 — `amp-fetch.sh`, `amp-init.sh`,
`amp-register.sh` — and in all three the branch is unreachable. The other ~28 sites do not
handle it at all; they simply die.

## Root cause

`set -e` plus `VAR=$(cmd)` is a well-known bash trap, and it is invisible at the call site:
the code reads as "capture the response, then decide", and the deciding half is simply never
reached. The author's handler is right there, three lines down, which is exactly why nobody
notices it cannot run — reviewing this file, you see error handling.

## Proposed fix — BOTH halves, because either alone is wrong

1. **Guard the assignment** so `set -e` does not abort: `... 2>&1) || true`. curl still writes
   `000` through `-w`, so the existing branches then work as written (measured above).
2. **Make the failure REACH the caller.** With (1) alone, `amp-fetch.sh` prints the diagnostic
   and then reports `No new messages from external providers.` and **exits 0** — "could not
   read" rendered as "nothing to read", which is the lenient-reader defect this repo already
   has a lessons entry for. So: count failures, say so in the summary, and exit non-zero.

   Use the repo's existing exit-code trichotomy rather than inventing one — the pillar CLIs
   already mean **`0` clean · `1` findings · `2` COULD NOT RUN**. A network outage is
   *could-not-run*, and it must be distinguishable from *no messages*.

**Do NOT blanket-apply `|| true` to the `curl -sf … | jq` family** (`amp-project-info.sh`,
`amp-task-blocked.sh`, `amp-task-done.sh`, `amp-team-members.sh`, `amp-project-repos.sh`).
There the variable receives a parsed *value*, so a guard leaves it EMPTY and the script
proceeds with a blank team id — turning a loud abort into a fail-open. Those sites need an
explicit emptiness check and belong in a separate phase.

## Verification

- A contained probe (`AMP_DIR` = temp dir, provider at `127.0.0.1:1`) asserting all three of:
  the diagnostic is PRINTED, the summary does NOT claim an empty inbox, and the exit status
  is non-zero. All three are needed — the first two pass under a fix that still exits 0.
- **Positive control in the same test:** a reachable provider returning `{"messages":[]}`
  still reports no messages and exits 0. Without it, "it failed" is satisfied by a change
  that fails on everything.
- **Multi-provider control:** two providers, one unreachable and one healthy — the healthy
  one's messages must still be fetched. This is the consequence that motivated the card, and
  no single-provider test can see it.
- Neuter: remove the guard and confirm the exit-7-with-no-output behaviour returns.

## Estimated risk

**MEDIUM to fix** — mechanical per site, but 34 sites in two families needing different
treatments, and shell has no type checker to catch a mistake. Phase it.

**HIGH to leave.** AMP is how agents coordinate, and this repo's own CLAUDE.md makes unread
messages a stop-everything priority. A transient network blip currently produces either
silence or a false "no messages", and the multi-provider case loses a healthy provider's
mail with no signal at all.

## Provenance

Found on 2026-08-04 while working the part of the USER's `/code-review high --fix` brief that
both review fleets skipped (they scoped to the pillar/write-seam; the brief also named "poor
handling of network errors by the messaging protocol"). Every claim above was measured
first-hand — the isolation test, the contained end-to-end probe in both variants, the scanner
with its positive control, and the absence of any `ERR` trap.

## Approval log

- 2026-08-04T22:51:33+0200 — MANDATE (self). Tier 0: this repo's own scripts, no baseline
  deviation, no cross-team or release surface.

## Phase 1 — neuter record (a COMPLEMENTARY PAIR, because the fix has two halves)

One neuter would have certified half of it. The two are independent by construction — neuter A
removes the guard so the script dies before any branch; neuter B keeps the guard and removes
only the honest summary + exit — and each reddens a DIFFERENT set:

| Mutation | Reddened | Left green |
|---|---|---|
| **A** — drop `\|\| true` (the original bug) | the 2 unreachable-provider tests | the positive control |
| **B** — keep the guard, drop the `TOTAL_UNREACHED` summary + `exit 2` (the naive one-token "fix") | the same 2, now on *"No new messages from external providers"* being printed and on the exit status | the positive control |

Neuter B is the important one: it is the fix a reviewer would call sufficient, and it fails
here for exactly the reason the card exists — the outage is announced AND then reported as an
empty inbox.

**One flake, and how it was handled:** under neuter B the positive control failed once with a
60 s timeout. Re-run in isolation (`-t "POSITIVE CONTROL"`) it passed in 324 ms, and the full
file re-run reproduced only the intended 2 failures. So the timeout was a harness flake, not
an attribution — recorded because "3 failed" would otherwise read as a richer result than the
honest "2 failed, and the control is untouched by this neuter".

Both restored and proved byte-identical to `HEAD` with `git hash-object` ==
`git rev-parse HEAD:<path>`.

## Acceptance

- [x] `amp-fetch.sh` prints its diagnostic, does NOT report an empty inbox, and exits non-zero
      when a provider is unreachable
- [x] one unreachable provider no longer stops the loop — a healthy sibling is still fetched
      (asserted from the test server's OWN request record, not from log text — a banner proves
      nothing about whether the request was made)
- [ ] the `-w "%{http_code}"` family across the AMP scripts is guarded, with the dead branches
      made live — **phase 2, ~20 sites, not started**
- [ ] the `curl -sf … | jq` family is handled SEPARATELY, with an emptiness check rather than
      a guard that fails open — **phase 3, not started**
- [x] tests exist with a positive control and a recorded neuter (for phase 1; phases 2-3 owe
      their own)
