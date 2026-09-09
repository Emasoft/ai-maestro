---
trdd-id: WLHP34KZ
title: network-down degraded branch admits a no-refresh slot and max-expiry selection then prefers it over every healthy slot
column: proposal
created: 2026-09-09T16:27:06+0200
updated: 2026-09-09T16:35:13+0200
current-owner: unassigned
created-by: governance-rules-session
assignee: unassigned
task-type: bugfix
min-approval-requirement: user
approved: false
labels: [oauth-rotator, continuity, setup-token]
external-refs: [TRDD-RE9AVNJF, TRDD-8148P30S, TRDD-W11LAPSC]
---

# network-down degraded branch admits a no-refresh slot and max-expiry selection then prefers it over every healthy slot

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-09-09

NOT STARTED. No code written.

**Reachability — TRACED IN SOURCE 2026-09-09 16:3x, first-hand, after a review fork flagged that
the earlier version of this card asserted it second-hand.** The `degraded` fallback IS reached on
a network-down tick, but only under a precondition the first draft omitted: **the LIVE blob must
be LOCALLY EXPIRED.** Full trace in Problem. Both intervening guards are provably inert on that
path. The earlier sentence "the `degraded` fallback IS reached", stated flatly, was an inference
taken from a review fork that makes zero tool calls and therefore never read `tick.ts`.

**Two facts that were fused into one and are now separated:**
- MEASURED locally 2026-09-09 (janitor DATA `oauth-rotator/state.json`): all 3 slots record
  `via: slot_capture_browser(full-oauth)`. That is the META's provenance field, not a read of the
  blob — no slot is recorded as a setup-token capture today.
- REPORTED (cross-session message from the janitor Claude, 2026-09-09), NOT verified here: they
  are holding `/janitor-import-oauth-tokens` as not-runnable-by-default pending the owner's ruling
  on this card. That is their stated intention about another repo's runtime, which this card
  cannot inspect. Do not read it as a system property.

NEXT ACTION: owner decides. The fix is one line at the primary site (below). It is NOT authorised
yet, and the `server.mjs` build/restart hold (TRDD-8148P30S) means a landed fix would not be
running.

## Problem

VERIFIED FIRST-HAND in this repo 2026-09-09 (`lib/oauth-rotator/`):

`tick.ts:1281-1285` is the `else` arm taken when `networkUp` is false. It pushes ANY slot with
a datable expiry into `degraded`:

    } else {
      const eh = expiresInH(b)
      if (eh === null) continue
      degraded.push([email, b, eh])
    }

There is no `refreshToken` requirement — unlike its sibling at `:1247`, which has one. Selection
at `:1367-1369` then picks the maximum `expiresInH`. `expiresInH` (`slots.ts:181`) reads
`claudeAiOauth.expiresAt` off the BLOB, not `expires_at` in `state.json`.

(Range correction: the `else` arm is `:1282-1286`; `:1281` is the `candidates.push` above it.
The first draft cited `:1281-1285`, off by one at both ends.)

### The control flow, traced — and its precondition

`networkUp` (`:1090`) is `liveStatus !== 0 || liveOutcome.reason !== 'error'`, so it is false only
when the probe neither answered nor was self-throttled. That state is reachable:
`network.ts:383` returns `{ status, data: json, reason: 'error' }`, and `status` is 0 on a
transport failure. With `networkUp` false the tick takes the `else if (liveExpired)` arm at
`:1174`; **every other arm either returns or does not apply**, and the final `else` at `:1191`
returns `false` outright ("usage unreachable … but token still valid locally; staying put").

**So the whole hazard requires the LIVE blob to be locally expired.** That is a real narrowing the
first draft did not state — network-down alone is not enough.

Past that arm, on a network-down tick:

- `candidates` stays empty. Its only two writers are `:1281` (inside `if (networkUp)`) and
  `:1311` `candidates.push(...scopedOnly)` — and `scopedOnly` is likewise only written inside the
  `networkUp` branch.
- `drainsLastEscapeHatch` (`:1332`) cannot fire: its first line is `if (!f.expiryOnly) return
  false` (`:690`), and `expiryOnly` is assigned only in the `liveStatus === 200` arm (`:1168`).
- `best = networkUp ? selectDrainFirst(candidates) : null` (`:1342`) → `null`.
- The scoped-only stop at `:1356` cannot fire: `scopedWall` is likewise assigned only in the 200
  arm (`:1167`), so it is still `false`.
- `if (degraded.length)` (`:1367`) is a plain `if`, not an `else if`. **Reached.**

Healthy full-OAuth slots land in that same bucket carrying hours of runway. A one-year token
outranks all of them.

### A SECOND site with the same omission (found by this trace, missed by the first draft)

`:1259` — inside the `networkUp` branch — also pushes to `degraded` with **no** `refreshToken`
test:

    if (st2 !== 200) {
      if (st2 !== 429) {
        const eh = expiresInH(b)
        if (eh !== null && !blobLocallyExpired(b)) degraded.push([email, b, eh])
      }
      continue
    }

Its comment describes the intended case ("transient probe failure on a FRESH token"), which is
reached after a SUCCESSFUL refresh — and such a slot has a refresh grant by construction, so the
missing test costs nothing there. But it is also reached when `unread` is true (`st2 === 0` with
reason `cooldown` or `lock_contended`, `:1240`), which SKIPS the refresh block entirely. A
no-refresh slot that lands in a probe cooldown therefore enters `degraded` with the network UP —
the common case, not the rare one. Narrower than the primary site (it needs the cooldown), and it
is the same one-line omission.

REPORTED, not read here (cross-session message from the janitor Claude, 2026-09-09): its
importer sets `claudeAiOauth.expiresAt` unconditionally to now + 1 year in milliseconds. The
first-hand links above are read in this repo; this last one is second-hand and is what closes the
chain. It has not been read in the janitor's source by anyone on this side.

## Root cause

The network-down arm was written for the case "we cannot probe, so fall back to any slot we can
still date". Before setup-tokens existed, every datable slot also carried a refresh grant, so
the missing check cost nothing. A no-refresh credential with a one-year expiry breaks both
assumptions at once: it is maximally datable and minimally verifiable, so the ranking key that
was a reasonable proxy for health becomes an inversion of it.

## Proposed fix (not written)

Add the same `oauthOf(b).refreshToken` test the sibling branch at `:1247` already applies:

- **Primary — `:1282-1286`**, the network-down arm. One line. This is the janitor session's own
  suggestion and it is consistent with the stay-put design in TRDD-W11LAPSC.
- **Secondary — `:1259`**, the `unread`/cooldown path described above. Same one-line test.
  Listed separately because the owner may reasonably gate only the primary site: `:1259` is
  correct for the case its comment names and wrong only for the cooldown entry.

## Related

The 401/403 thrash finding that used to live in this card is now **TRDD-W11LAPSC** — a separate
defect (a rotation LOOP, not a target-ranking inversion) with its own acceptance. Split out
2026-09-09 so the boxes below cover exactly one thing.

## Verification (when it is authorised)

A test seeding one healthy full-OAuth slot (short expiry, refresh grant present) and one
no-refresh slot with a one-year expiry, driving a tick, asserting the switch target is the
full-OAuth slot. Three preconditions, each of which the trace above shows is load-bearing —
a test missing any of them can pass while the defect stands, or fail for an unrelated reason:

1. **The live blob must be LOCALLY EXPIRED.** Without it the tick returns at `:1191` and never
   reaches the loop.
2. **"Network down" must be a transport failure** — the probe resolving `status: 0` with reason
   `error`. Simulating it with a 403 leaves `networkUp` TRUE (`:1090`), the probe branch runs,
   and the test fails somewhere else entirely.
3. **Assert the ordering precondition explicitly.** Selection at `:1368-1369` is a max over
   `expiresInH`; give the no-refresh slot a strictly larger `expiresInH` than every other seeded
   slot and assert that BEFORE the tick. Otherwise the healthy slot can win for an unrelated
   reason and the assertion passes without the fix.

It must FAIL before the fix — the current code picks the one-year token — which is what makes it
a guard rather than decoration.

## Risk

LOW to fix. The excluded slots are exactly the ones that cannot be verified offline, which is
the condition the branch's own comment names ("cannot confirm validity offline → not a safe
degraded target"). The change makes the arm agree with its own stated intent.

## Acceptance

- [ ] owner rules on whether to apply the gate, and at one site or both
- [ ] the `:1247` refreshToken test added to the `:1282-1286` arm
- [ ] decided + done or declined: the same test at `:1259` (the cooldown entry)
- [ ] the failing-first test above written and passing, with all three preconditions asserted
- [ ] janitor told the branch is gated, so it can ship the import as runnable-by-default

## Approval log

- 2026-09-09T16:27:06+0200 — Authored as a PROPOSAL. NOT self-mandated. First written at
  `column: todo` with `min-approval-requirement: none`; `trddgrep validate` correctly flagged
  APPROVAL-UNAPPROVED-IN-WORK-ZONE — a card cannot sit in the authorized-work set while
  asserting nobody approved it. Its default repair sets `approved: true`, which was not the
  right resolution here; the linter has no way to compute a D3 floor, so that is a default, not
  a ruling. Re-filed as a proposal.
- 2026-09-09T16:35:13+0200 — **The floor rationale recorded above was WRONG and is corrected
  here** (review fork, finding 3). It read: "the fix writes the live `Claude Code-credentials`
  item, so the objective floor is `user`." That confuses the branch's CONTEXT with the CHANGE's
  effect. The change adds a presence test to a selection filter: it writes nothing, touches no
  credential, and strictly REDUCES the set of slots that can become a rotation target — it makes
  the credential write it is accused of LESS likely. By `aimaestro-trdd-approval` §D3 the
  objective floor is `none` (in-scope bugfix), or `manager` at the outside. Left as declared
  `user` — declared ≥ floor is conformant — for a different and honest reason: the janitor is
  holding a user-facing command pending the owner's ruling, so the owner is the decision-maker on
  this regardless of the tier. Recording the wrong rationale would have taught the next reader
  that any fix inside a branch that eventually writes a credential is `user`-tier, which would
  escalate a large class of ordinary bugfixes.
