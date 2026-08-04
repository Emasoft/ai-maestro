---
trdd-id: 2U56TLBX
title: A network failure kills every AMP script at the curl assignment, before its own error handler can run
column: complete
created: 2026-08-04T22:51:33+0200
updated: 2026-08-04T23:25:33+0200
implementation-commits: [8b91f884, d18c11ba, 8636bcc7, 9129d791, 98a24478, 38416723]
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
  `tests/unit/amp-network-failure.test.ts` and two neuters recorded below.
- **PHASE 2 PART A DONE** — `amp-send.sh` (2 sites) + `amp-register.sh` (2), landed as
  `d18c11ba`, with 2 more tests and a neuter. Scanner: **34 → 29** unguarded sites; the three
  messaging-core scripts are clear.
- **PHASE 2 PART B DONE** — the six `amp-kanban-*.sh` + `amp-helper.sh`'s six attachment
  sites, landed as `8636bcc7`, plus a structural ratchet as `9129d791`. Scanner: **34 → 17**,
  and the `-w "%{http_code}"` family in `scripts/amp-*.sh` is now **100% guarded**.
- **PHASE 3 DONE** — the `curl -sf … | jq` family, all 11 sites, landed as `98a24478` +
  `38416723`, with the ratchet widened to cover EVERY AMP curl assignment. Scanner:
  **34 → 6**, and **zero AMP scripts remain unguarded**.
- **CLOSED.** Nothing outstanding on this card.
- **OUT OF SCOPE, recorded so nobody counts them as debt against this card:** the remaining 6
  sites are in `export-agent.sh`, `import-agent.sh`, `list-agents.sh` — not AMP messaging.
- **Each site needs ONE or TWO halves, and that is a per-script QUESTION, not a template.**
  The guard is always needed. The exit-status half is needed only where the script's own
  SUMMARY would misreport — true for `amp-fetch.sh` (it announced an empty inbox), false for
  `amp-send.sh`/`amp-register.sh` (their failure branches already `exit 1`). Applying both
  everywhere is cargo cult; ask what the caller would wrongly conclude.
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
`amp-register.sh` — and in **two** of them the branch is unreachable. The other ~28 sites do
not handle it at all; they simply die.

> **CORRECTED 2026-08-04, while starting phase 2.** This paragraph first said the branch was
> unreachable in **all three**. It is not: **`amp-init.sh` already ends BOTH its curl
> assignments with `|| true`** (lines 286 and 363), so its two `000` branches are reachable
> and its "not reachable — skipping" messages really do print. I generalized from the two I
> had opened to a third I had not. The scanner never flagged `amp-init.sh` — the error was in
> the prose, not the instrument, which is the direction that is hardest to catch because the
> data was right in front of me.
>
> This makes the card STRONGER, not weaker: `amp-init.sh` is proof that the correct pattern
> was already known in this codebase, so the fix everywhere else is *restoring consistency*
> with a sibling rather than introducing a new convention. Use it as the model.

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

## Phase 2 part A — neuter record

ONE neuter here, not a pair, because the send fix has only ONE half: dropping the `|| true`
from `amp-send.sh`'s external-send site reddened **exactly** the new send test and left the
other four green. Its output is the bug verbatim — the whole captured output was the identity
auto-fix noise, with the `Failed to send message (HTTP 000)` line absent. The script died
mute on a message that was never delivered.

Restored and proved byte-identical to `HEAD` with `git hash-object` ==
`git rev-parse HEAD:<path>`.

## Phase 2 part B — the ratchet, and why it replaces twelve behavioural tests

Twelve sites landed with **no behavioural test each, deliberately and not silently.** Two of
them cannot be driven, and neither reason is laziness:

- the **kanban scripts REFUSE** to run without a resolvable AMP identity, and their refusal
  says in as many words not to pass an arbitrary `--id`, because every registered uuid
  belongs to a real, possibly LIVE agent. That guard is correct; subverting it to make a test
  pass would be the worst trade on this card.
- `amp-helper.sh`'s six are inside the attachment upload/download path, reachable only
  through a full signed send to a real provider.

So the instrument is `tests/unit/amp-curl-abort-ratchet.test.ts`, which reads the source.
It covers all twelve AND every future curl anyone adds — which is the failure this card is
actually about, since the trap is invisible at the call site.

**Neuter:** reintroducing the bug at ONE site (`amp-kanban-move.sh`) reddened the ratchet,
naming `amp-kanban-move.sh:143` exactly; the scan-set floor and the classifier control stayed
green. Restored and proved byte-identical to `HEAD`.

**Two traps the ratchet itself had to survive**, both caught before commit:

1. Its scan-set floors were written from **numbers I had not measured** (20/13). The real
   figures, re-derived by running the scan itself, are **31 scripts / 20 sites**. A floor
   taken from a guess is exactly the vacuity the floor exists to prevent.
2. The classifier must accept `||` **inside** the substitution — `$(curl … || echo '{}')`
   genuinely suspends `set -e`. A version that knew only the trailing form reported
   already-correct code as broken, which cost a re-scan earlier in this card.

## Phase 3 — the `-sf | jq` family, and the neuter that justifies the whole design

This family was held back from phases 1-2 because **the fix that worked there is a fail-open
here**, and that is not a theory — it was demonstrated on running code, against a server that
answers the AGENT lookup and 404s the TEAM lookup (a *partial* outage, the only shape that
reaches `amp-task-blocked.sh`'s `exit 0` branch):

| variant | exit | what the caller sees |
|---|---|---|
| **the fix** (fetch-then-parse) | **1** | `Error: no answer for team T1 … — the blocker was NOT reported.` |
| **neuter A** — fuse the lookup back (the original bug) | **7** | *nothing at all* |
| **neuter B** — the naive `\|\| true` | **0** | `Warning: No orchestrator assigned — nothing was sent.` |

Neuter B is the load-bearing one. The naive guard returns **success**, and its warning
misattributes the cause — it blames the team for having no orchestrator when in fact nobody
answered. An agent reporting that it is BLOCKED would be told the report went through.

So each lookup is split into FETCH then PARSE, which is the only way to keep "the server did
not answer" distinguishable from "the answer is legitimately empty". Without the split the
pre-existing message is itself a lie: *"Agent is not in a team"* when the truth is that
nobody could be asked.

**`jq` needed guarding too, and only measurement showed it:** jq exits **0** on EMPTY input
but **5** on NON-JSON (a proxy's HTML error page under HTTP 200) — which would abort the
script all over again, one line after the curl was handled.

**A false claim corrected in passing, unrelated to any network fault:** `amp-task-done.sh`'s
no-orchestrator branch printed *"sending to team"* and then `exit 0` **without sending
anything to anyone**. It now says nothing was sent, because that is what happens.

**Two sites had no check at all**, so the failure was invisible rather than merely mute:
`amp-team-members.sh` emitted an EMPTY ROSTER and `amp-project-repos.sh` printed nothing —
both indistinguishable from a real answer.

## The ratchet, widened

With every AMP curl assignment guarded, `tests/unit/amp-curl-abort-ratchet.test.ts` dropped
its `%{http_code}` filter and now covers **all 43** assignments under `set -e`. Widening it
immediately found a false positive **in the ratchet itself**: `amp-statusline.sh` has no
`set -e`, so its unguarded curl cannot kill anything, and flagging it would be the kind of
cry-wolf finding people learn to ignore. The scan is now conditional on `set -e` per file —
which also means it starts demanding a guard the day someone adds `set -e` to such a script,
exactly when the site becomes dangerous.

## Acceptance

- [x] `amp-fetch.sh` prints its diagnostic, does NOT report an empty inbox, and exits non-zero
      when a provider is unreachable
- [x] one unreachable provider no longer stops the loop — a healthy sibling is still fetched
      (asserted from the test server's OWN request record, not from log text — a banner proves
      nothing about whether the request was made)
- [x] the `-w "%{http_code}"` family across the AMP scripts is guarded, with the dead branches
      made live — **DONE**. 34 → 17 unguarded sites; the family is 100% guarded in
      `scripts/amp-*.sh`, and a ratchet keeps it that way. The 17 that remain are the 11 of
      phase 3 plus 6 in non-AMP scripts
- [x] the `curl -sf … | jq` family is handled SEPARATELY, with an emptiness check rather than
      a guard that fails open — **DONE**, all 11 sites, split fetch-from-parse. The neuter
      proved the guard-alone form returns exit 0 on a dropped blocker
- [x] tests exist with a positive control and a recorded neuter — 5 behavioural tests across
      the two drivable scripts, a structural ratchet over all 43 AMP curl assignments, and
      four recorded neuters (two for phase 1, one for 2A, one for 2B, two for phase 3)
