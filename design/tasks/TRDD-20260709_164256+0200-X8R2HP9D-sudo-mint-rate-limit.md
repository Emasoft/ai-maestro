---
trdd-id: X8R2HP9D
title: Successful sudo-token mints consume a global 5-per-minute bucket
column: planned
approval-tier: 2
created: 2026-07-09T16:42:56+0200
updated: 2026-07-10T00:11:36+0200
current-owner: ai-maestro-session
assignee: null
priority: 2
severity: MEDIUM
effort: S
task-type: security
release-via: none
parent-trdd: TRDD-6A2I6ZO0
npt: []
eht: []
blocked-by: []
relevant-rules: []
labels: [sudo, rate-limit, usability]
test-requirements: [unit]
review-requirements: [human-review]
runtime-targets: [macos, linux]
impacts: []
external-refs: []
---

# TRDD-X8R2HP9D — the sudo mint throttles legitimate work, machine-wide

**Tier 2.** Changing a password endpoint's rate limit is a security-policy change,
so it is proposed rather than fixed in place.

## Problem

`app/api/auth/sudo-password/route.ts`:

```ts
const rateCheck = checkAndRecordAttempt('sudo-password', 5)   // GLOBAL key, 5 / 60s
```

and, unlike `app/api/auth/login/route.ts`, it never calls `resetRateLimit` on
success. `checkAndRecordAttempt` records **every allowed attempt**, so a
*successful* mint is charged against the same bucket as a failed password guess.

Sudo tokens are one-shot and bound to a single `(method, pathTemplate)`. So each
strict operation costs exactly one mint, and the ceiling is:

> **5 strict operations per minute, for the entire machine.**

The key is a constant string — not per-user, not per-session, not per-IP — so one
browser tab exhausts it for every other caller.

## Evidence

Hit live while running the TRDD-6A2I6ZO0 panel walkthrough on 2026-07-09. Six
consecutive `POST /api/agents/[id]/panel` calls: the first five succeeded, the
sixth mint returned

```
HTTP 429 {"error":"Too many sudo attempts. Try again later."}
```

The walkthrough had to poll and wait out the window.

## Why it matters beyond tests

Ordinary UI flows exceed five strict operations per minute. A cleanup that deletes
six agents fails on the sixth with a 429 that the sudo modal surfaces as a generic
"Try again later". So does deleting a team with several agents, or any scripted
batch. There is no user-visible hint that the limit is global and time-based.

The AGENT path never mints a sudo token (R32), so it is unaffected — but agents are
currently 403'd on the strict routes anyway (`TRDD-D3RP7KQZ`). Between the two,
every strict route this epic shipped is effectively undrivable at any real cadence.

## Options

1. **Reset the bucket on a successful mint** (mirrors `/api/auth/login`, which calls
   `resetRateLimit` on success). Failed guesses still throttle; correct passwords
   do not. Smallest change; keeps the brute-force property intact — an attacker
   who knows the password has already lost.
2. **Key the bucket per session/user** rather than the constant `'sudo-password'`,
   with a generous global cap on top (the pattern `/api/v1/auth/token` already uses:
   `aid-token-exchange:global` 200 + `aid-token-exchange:<identity>` 30).
3. **Raise the limit.** Papers over it; the wrong shape stays wrong.

Option 1 + 2 together match the codebase's own established pattern and are
mutually reinforcing.

## Verification

- Unit: five successful mints followed by a sixth must succeed; five *failed*
  password attempts followed by a sixth must 429.
- Unit: two distinct sessions must not share a bucket.
- Manual: delete six agents in a row from the UI without a 429.

## Estimated risk

LOW-MEDIUM. Resetting on success weakens nothing an attacker can exploit — an
attacker supplying the correct governance password is already authenticated. The
per-key change must keep a global backstop so an attacker cannot mint unbounded
buckets by rotating sessions.

## Approval log

- 2026-07-09T23:34:05+0200 — HELD BACK from the batch of four. The USER approved
  it against a description I had written from the label in a pending list without
  opening the file: "add a global rate limit on sudo-token minting — narrow,
  self-contained hardening." That is backwards. The limit already exists; this
  proposal RELAXES it. An approval obtained on a wrong description is not an
  approval for the actual change, least of all on a password endpoint's rate
  limit under a standing "prioritize security" directive. Re-asked instead of
  assuming.
- 2026-07-10T00:11:36+0200 — APPROVED by USER (tier 2), on the corrected
  description: **options 1 + 2 together.**
  - Option 1 — call `resetRateLimit` on a SUCCESSFUL mint, mirroring
    `/api/auth/login`. Failed guesses still throttle, so brute-force resistance
    is unchanged: an attacker supplying the correct governance password has
    already won, and charging them for it protects nothing.
  - Option 2 — key the bucket per session/user instead of the constant
    `'sudo-password'`, with a generous global cap on top. This is the shape
    `/api/v1/auth/token` already uses (`aid-token-exchange:global` 200 +
    `aid-token-exchange:<identity>` 30), so it is a codebase pattern rather than
    an invention. The global backstop is load-bearing per the risk note: without
    it, an attacker mints unbounded buckets by rotating sessions.
  Promoted `proposal → planned`, moved to `design/tasks/`.
