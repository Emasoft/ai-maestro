---
trdd-id: D39FH00U
title: The user's statusline holds a third private usage cache with three defects — report only
column: proposal
scope: project
project-id: ai-maestro
created: 2026-08-05T18:24:34+0200
updated: 2026-08-05T18:24:34+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: bugfix
min-approval-requirement: user
mandate: false
approved: false
severity: medium
effort: small
relevant-rules: []
npt: []
eht: []
blocked-by: []
release-via: none
labels: [oauth-rotator, usage-endpoint, user-owned-file, report-only]
external-refs: [reports/claude-multi-usage-analysis/20260801_115728+0200-verified-diff-vs-our-rotator.md]
---

# The user's statusline holds a third private usage cache with three defects — report only

## Why this is its own card

Split out of **TRDD-WFIMES6U** as that card closed. WFIMES6U's acceptance was about the
**rotator's** cache, and every box is now resolved. This is the part its prose recorded but no box
covered, and it must not vanish with the parent — queueing is a handoff, and a handoff nothing
pulls from is how work disappears with a clean conscience.

It is a **proposal, not a task,** for one reason: `~/.claude/statusline.py` is the **USER's own
file, outside any git repo**. Per the cross-project rule I may not edit it, and it is not even
another *project* — it is the user's personal config. Nothing here happens without their word.

## The finding

The statusline hits the SAME endpoint and the SAME rate-limit bucket as the rotator, with its own
PRIVATE cache — neither tool knows the other exists. That is the fragmentation the USER's original
"shared cache for all tools" directive was about.

| | statusline | rotator (now) |
|---|---|---|
| invoked | every **3 s** | every 60 s |
| endpoint fetch | at most every **300 s** | cooldown + 600 s TTL (`usage-cooldown.ts`) |
| cache | `/tmp/claude/statusline-usage-cache.json` (0600) | `globalStateDir()/oauth-usage-cooldown.json`, one cross-process lock |
| 429 / backoff | **none** | `Retry-After` → `anthropic-ratelimit-*` → exponential 600→7200 s |

It also settles the interval question empirically, and worth keeping: a **3 s DISPLAY on a 300 s
FETCH** has run on this machine for a long time without lockout. So "can we have 5 s" is: yes for
the display, no for the fetch — and the split is already proven here.

## The three defects (measured 2026-08-01, NOT re-verified this session)

1. **The cache is 12 h stale against a 300 s threshold**, with no error log — so `get_oauth_token()`
   is returning empty and **no HTTP request is being made at all**. It reads the keychain
   (`security find-generic-password -s 'Claude Code-credentials' -w`), which prompts or fails when
   the calling binary is not ACL'd for the item, and it runs under a different venv python than
   Claude Code.
2. **It renders stale numbers as live.** The staleness sentinel only trips past 24 h, so anything
   between 5 min and 24 h displays with no indicator. It was showing `five_hour = 53%` for a window
   that had rolled 12 h earlier — fiction, not staleness.
3. **A latent 3-second retry storm.** A failed fetch never touches the cache file's mtime, so the
   next invocation 3 s later sees age > TTL and refetches. With zero backoff, the first real 429
   becomes a 3 s knock loop — the behaviour that RE-ARMS the lockout. Dormant today only because
   the no-token early return precedes any HTTP call.

Defect 3 is the dangerous one: it is dormant *because* of defect 1. Fixing the token problem alone
would arm the retry storm.

## What I am NOT proposing

Sharing one cache FILE between the two tools. The rotator's cache is keyed per account behind a
cross-process lock in its own state dir; pointing a 3-second-interval python script at it buys
consistency at the cost of a new contention path into the rotator's state, for a display. The
cheaper answer to "the tools disagree" is that they stop *fetching* independently, not that they
share a mutable file.

## Proposed fix

USER decides. Three options, cheapest first:

1. **Nothing.** Defect 1 keeps 3 dormant; the display is wrong but harmless. Document it and move on.
2. **Fix staleness honesty only** (defect 2) — show an explicit stale marker past the TTL. Small,
   and it stops the display asserting things that are not true.
3. **Fix all three** — resolve the token read, add a backoff, mark staleness. Note the ORDER
   matters: fixing 1 without 3 arms the retry storm.

If the USER wants any of these, the edit is theirs to make or to explicitly delegate — I will not
touch that file otherwise.

## Verification

Whatever is chosen: the cache file's mtime must advance on a *failed* fetch (that is what defeats
the 3 s loop), and a reading older than the TTL must never render without a marker.

## Estimated risk

LOW to leave alone — TODAY. The risk is conditional and worth naming: defect 3 activates the
moment defect 1 is fixed, so a well-meant one-line token fix converts a dead display into a knock
loop against a shared rate-limit bucket the rotator depends on.

## Approval log
