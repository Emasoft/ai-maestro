---
trdd-id: WFIMES6U
title: One shared usage cache — throttle the /usage endpoint and stop reading a 429 as exhaustion
column: todo
created: 2026-08-01T12:12:38+0200
updated: 2026-08-01T12:31:05+0200
current-owner: ai-maestro-dev
assignee: ai-maestro-dev
created-by: ai-maestro-dev
task-type: bugfix
project-id: ai-maestro
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro-dev
approval-datetime: 2026-08-01T12:12:38+0200
severity: high
effort: medium
release-via: none
npt: []
eht: []
external-refs: [reports/claude-multi-usage-analysis/20260801_115728+0200-verified-diff-vs-our-rotator.md]
---

# One shared usage cache — throttle the /usage endpoint and stop reading a 429 as exhaustion

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-08-01

Filed straight from a USER directive: *"these endpoints are rate limited, so you must be very
careful to read them and put the values in a shared cache for all tools/functions to share. I
don't know the interval we can use to avoid triggering the rate limits, but I hope the min
interval is max 5 seconds."*

**NEXT ACTION:** implement §Proposed fix step 1 (the cache module) — nothing else is blocked on a
decision. The interval question is ANSWERED below (600 s, not 5 s) with recorded evidence.

## Problem

Four facts, each verified first-hand today:

1. **There is no cache, TTL, cooldown, or `Retry-After` handling anywhere around `usageRequest`.**
   `grep -rn "Retry-After|unified-reset|ratelimit|cooldown|CACHE_TTL" lib/oauth-rotator/` returns
   nothing for the usage path.
2. **Each tick makes 1 + up to 2N calls** — one for the live account (`tick.ts:422`) and, per
   alternate slot, a probe plus a re-probe after a refresh (`:496`, `:509`).
3. **The tick runs every 60 s** (`server-tick.ts:142`, `intervalMs ?? 60_000`). With three
   alternates that is up to **420 calls/hour**.
4. **A 429 on a CANDIDATE is read as "genuinely maxed, drop it"** (`tick.ts:511-513`) with **no
   debounce at all** — only the LIVE path has one (`LIVE_429_DEBOUNCE = 2`).

The known-good practice for this endpoint (ccgauge, recorded in the USER-scope memory note
`claude-subscription-usage-endpoint`, verified working 2026-07-26) is a **600 s TTL** — about
**6 calls/hour**. We are therefore up to **~70× more aggressive than the discipline that is known
to work**, with none of its safeguards.

**Why that is not merely wasteful — it inverts the rotator.** That note's `[^4]`
(`ATOM-429-NOT-EXHAUSTION`) states the failure exactly: the endpoint returns 429 for a
*caller-side throttle* as well as for a real limit, so under throttling the live account 429s
(believed after 2 ticks) **and every candidate 429s and is dropped as maxed immediately** — the
rotator concludes there is no safe target and stops rotating *precisely when it is needed*. The
endpoint also **re-arms its lockout when you knock again**, so a fast retry loop deepens the hole
rather than draining it.

The note also names our own mitigation as insufficient: *"Debouncing the 429 (as
ai-maestro-janitor did with LIVE_429_DEBOUNCE / ALT_429_DEBOUNCE) treats the symptom."*

## The interval question, answered

**5 s is not achievable, and — this is the important half — it is not needed.**

Not achievable: the endpoint 429s hard and re-knocking re-arms the lockout. 5 s is ~120× the
known-good rate; it would live in permanent lockout, which our code currently reads as "every
account maxed".

Not needed, because **`resets_at` makes the timeline reconstructible without polling**. Every
window carries its exact reset instant, and utilization is **monotonic non-decreasing within a
window** (it only rises until the reset rolls it to 0). So a diagnostics tool with two cached
samples knows the window boundaries exactly and can bound the value between them — no sample rate
buys it more than the boundary already gives.

And for "matching the data history across tools", **freshness is the wrong lever entirely**:
tools disagree when they each fetch at different instants. Sharing ONE cache entry with an
explicit `fetched_at` makes every tool report the *same* number for the *same* instant, which is
what consistency actually requires. Polling faster would make them disagree *more*, not less.

## A THIRD caller exists, and it is empirical proof the split works (measured 2026-08-01)

The USER's statusline (`~/.claude/statusline.py`, wired in `~/.claude/settings.json`) hits the
same endpoint and the same bucket, with its own PRIVATE cache — neither it nor the rotator knows
the other exists. This is exactly the fragmentation the USER's "shared cache for all tools"
directive is about.

| | statusline | rotator (today) |
|---|---|---|
| invoked | every **3 s** (`refreshInterval: 3`) | every 60 s |
| endpoint fetch | at most every **300 s** (`statusline.py:262`) | EVERY tick, uncached |
| calls/hour | ≤ 12 | up to 420 |
| User-Agent | `claude-code/<ver>` ✓ | `claude-code/<ver>` ✓ |
| cache | `/tmp/claude/statusline-usage-cache.json` (0600) | none |
| 429 / backoff / lock | **none** (`grep -cE "flock\|Retry-After\|429\|backoff\|cooldown"` → 0) | debounce on live only |

**It settles the interval question empirically: a 3 s DISPLAY on a 300 s FETCH is survivable in
practice** — this statusline has run that way for a long time without lockout. So the answer to
"can we have 5 s" is: yes for the display, no for the fetch, and the split is already proven on
this machine. It also puts the safe TTL floor at 300 s rather than 600 s; 600 s stays the target
because the rotator multiplies by N accounts where the statusline is a single caller.

Three defects found in it (REPORT ONLY — it is the USER's own file, outside any git repo, and
must not be edited without their say-so):

1. **The cache is 12 h stale against a 300 s threshold** and no error log exists, so
   `get_oauth_token()` is returning empty and **no HTTP request is being made at all**. It reads
   the keychain (`security find-generic-password -s 'Claude Code-credentials' -w`), which prompts
   or fails when the calling binary is not ACL'd for the item — and it runs under the
   llm-externalizer venv python, not Claude Code.
2. **It renders stale numbers as live.** The `_stale_expired` sentinel only trips past 24 h, so
   anything between 5 min and 24 h displays with no indicator. Right now it shows
   `five_hour = 53%` for a window that **rolled 12 h ago** — fiction, not staleness. This is the
   `^report-staleness-honestly` hazard, live.
3. **A latent 3-second retry storm.** A failed fetch never touches the cache file's mtime, so the
   next invocation 3 s later sees age > TTL and refetches. With zero backoff, the first real 429
   becomes a 3 s knock loop — the behaviour that RE-ARMS the lockout. Dormant today only because
   the no-token early return precedes any HTTP call.

Defect 3, plus the rotator's 420 calls/hour, plus the "429 ⇒ maxed" misread, is the complete
deadlock mechanism — spread across two tools that cannot see each other. **The shared cache must
therefore be readable by the statusline too**, or we will have three private caches instead of two.

## Root cause

`usageRequest()` is a bare HTTP call with no gate in front of it, and every caller reaches the
network directly. Nothing in the module owns "when may we ask again", so there is no single place
a TTL, a cooldown, or a lock could have been enforced.

## Proposed fix

1. **`lib/oauth-rotator/usage-cache.ts` — the ONE reader.** Keyed per account (its slot
   fingerprint, never the email in plaintext). Every caller goes through it; `usageRequest` stops
   being called directly outside this module.
   - Persist to `~/.aimaestro/usage-cache/` so the cache is shared **across processes** (server,
     CLI, diagnostics), not just within one.
   - **Write it through `lib/json-io.ts`** (`updateJson` / `withJsonLock`) — that gate already
     gives the cross-process lockdir, the atomic tmp+rename, the fsync and the kept backup. Do NOT
     invent a second lock: TRDD-RYFP030K's whole finding was that three lock implementations over
     one file exclude nobody.
   - **Re-check TTL and cooldown AFTER acquiring the lock** (TOCTOU): two callers can both pass
     the check before either writes. The loser serves cache.
   - Degrade unlocked rather than serve cache forever if locking is unavailable.
2. **TTL 600 s**, matching the recorded known-good. The 60 s tick keeps its cadence and simply
   serves from cache on ~9 of every 10 beats.
3. **Honor the server's own backoff on 429**, in this order: `Retry-After` (delta-seconds *or*
   HTTP-date) → `anthropic-ratelimit-unified-reset` / `-unified-5h-reset` / `-requests-reset` /
   `-tokens-reset` (epoch *or* ISO) → exponential backoff doubling per **consecutive** 429,
   600 s → cap 7200 s. This requires reading response HEADERS, which `httpJson` currently
   discards — that is a real signature change, not a wrapper.
4. **Resolution cause, reported not re-derived**: every read returns *why* it resolved as it did
   (`fresh | cached | cooldown | 429 | no_token | lock_contended | http_error`). Re-deriving it
   afterwards mislabels lock contention as "endpoint unreachable".
5. **Fix the inversion (`tick.ts:511-513`): an unreadable candidate is UNKNOWN, never MAXED.** A
   candidate we could not read must not become a target, and must not be *eliminated* either — it
   belongs in `degraded`, exactly where a non-429 failure already puts it. With the throttle in
   place a 429 is rare; when it does happen it must not be evidence about the account.

Out of scope: changing the 60 s tick cadence (the cache makes it cheap), and `severity` /
`is_active` (TRDD-JI7F1236 left those read-but-unused deliberately).

## Verification

- Cache tests on the real fs: a second read inside the TTL performs **no** fetch (assert the
  injected `fetchImpl` call count, not just the returned value); a read after TTL refetches.
- **Neuter:** delete the TTL check ⇒ the "no second fetch" test must redden. If it reddens
  nothing, the fixture's two reads were not inside one TTL window and the test is vacuous.
- Cooldown: a stubbed 429 carrying `Retry-After: 120` must suppress fetches for 120 s and report
  cause `cooldown`; one carrying no headers must fall back to 600 s; consecutive 429s must double
  to the 7200 s cap and **not** past it.
- TOCTOU: two concurrent readers over one key ⇒ exactly ONE fetch. Assert by holding the lock and
  observing the contender cannot fetch, then releasing — never by racing the scheduler, which
  passes with the lock removed (a lottery, not a test).
- Inversion: a candidate returning 429 must land in `degraded`, not be dropped. **Neuter:**
  restoring `if (st2 !== 429)` must redden exactly that test.
- Whole-suite green + `tsc` 0 lines.

## Estimated risk

MEDIUM. It changes when the rotator sees usage numbers, so a stale-cache bug could delay a
rotation by up to one TTL. Mitigated because the local-expiry path (`blobLocallyExpired`) is
API-independent and still fires immediately, and because the failure this replaces — reading a
throttle as "all accounts maxed" — is strictly worse than a 10-minute-old percentage.
Dependencies: none. Touches `lib/json-io.ts` only as a CONSUMER.

## Acceptance

- [ ] `usage-cache.ts` is the only caller of `usageRequest`; cache lives under `~/.aimaestro/`
      and is written through the `json-io` gate (no fourth lock)
- [ ] TTL 600 s honored across processes, re-checked after lock acquisition
- [ ] 429 backoff honors `Retry-After`, then the `anthropic-ratelimit-*` headers, then
      exponential 600→7200 s
- [ ] every read reports its resolution cause; a cached number never renders as live, and the
      reset countdown is suppressed when stale
- [ ] an unreadable candidate is treated as UNKNOWN (degraded), never MAXED
- [ ] both neuters redden exactly their named tests; suite green; `tsc` 0

## Approval log

- 2026-08-01T12:12:38+0200 — MANDATE (self) at `min-approval-requirement: none`: in-scope bugfix
  in ai-maestro's own rotator, filed directly from a USER directive. No governance, release,
  cross-team, or baseline surface.
