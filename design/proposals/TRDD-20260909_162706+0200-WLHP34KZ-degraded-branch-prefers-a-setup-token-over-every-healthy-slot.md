---
trdd-id: WLHP34KZ
title: network-down degraded branch admits a no-refresh slot and max-expiry selection then prefers it over every healthy slot
column: proposal
created: 2026-09-09T16:27:06+0200
updated: 2026-09-09T17:04:30+0200
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

NEXT ACTION: owner decides. The fix is the same one line at EACH OF TWO sites (below — the card
makes no ranking between them, having got that ranking wrong twice). It is NOT authorised yet,
and the `server.mjs` build/restart hold (TRDD-8148P30S) means a landed fix would not be running.

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
no-refresh slot that lands in a probe cooldown therefore enters `degraded` with the network UP.
It is the same one-line omission. **No frequency claim is made here about either site** — see
Proposed fix for the full precondition sets and for the two rankings this card got wrong.

**READ FIRST-HAND 2026-09-09 16:4x** (installed plugin cache `ai-maestro-janitor/3.4.15`; reading
another project's source is permitted, editing is not) — this was second-hand until now, and the
first draft correctly labelled it as the one link nobody on this side had read:
`slot_capture_token.py:185` sets `"expiresAt": int((time.time() + ONE_YEAR_S) * 1000)` — now + 1
year, in milliseconds, unconditionally, in the same literal that sets `"refreshToken": None`.
**First-hand IN SOURCE at the point the value is constructed, and through the storage path; see the blob-shape acceptance box for exactly what that read covers, what it does not, and when to re-read it.**

## Root cause

The network-down arm was written for the case "we cannot probe, so fall back to any slot we can
still date". Before setup-tokens existed, every datable slot also carried a refresh grant, so
the missing check cost nothing. A no-refresh credential with a one-year expiry breaks both
assumptions at once: it is maximally datable and minimally verifiable, so the ranking key that
was a reasonable proxy for health becomes an inversion of it.

## Proposed fix (not written)

Add the same `oauthOf(b).refreshToken` test the sibling branch at `:1247` already applies:

**GATE BOTH SITES.** They take the same one-line test and the second line costs nothing, so there
is no ranking to make and the card offers none.

This section has been wrong twice, in opposite directions, and both errors are recorded rather
than quietly replaced — the second is the more instructive:

1. The first draft called `:1282-1286` "primary" and `:1259` "secondary". That was an artefact of
   which site I found first, not a ranking.
2. The correction then said *"if only one site is gated, gate `:1259` — it needs only a probe
   cooldown"*. **Also wrong**, and wrong in the direction that flattered the peer report I had
   just adopted. **A push into `degraded` is only harmful if `degraded` is ever CONSULTED**, and I
   had traced reachability as far as the push, stopping one statement short of the selection.

The complete precondition sets, traced to the selection (`selectDrainFirst([])` returns `null`,
`:637-642`):

| site | what must hold for the harmful selection to run |
|---|---|
| `:1282-1286` | network DOWN · live blob LOCALLY EXPIRED. `candidates` is then empty and `scopedWall` false **by construction**, so `best === null` comes free. **Two conditions.** |
| `:1259` | live near/exhausted (past the `!near` return at `:1193`) · the no-refresh slot in a probe cooldown · **no usage-confirmed candidate at all** (else `best !== null` at `:1343` and `degraded` is never read) · **not a scoped-only wall** (else `:1356` returns first). **Four conditions.** |

So the asymmetry runs OPPOSITE to what the correction claimed: `:1259` has to earn `best === null`
by every healthy alternate failing, while `:1282-1286` is handed it by the outage. Neither
"common path" nor "two conditions, both uncommon" was measured by anyone.

What is true, and is a frequency claim about THIS machine only: the rotator logged "all paid
accounts maxed" every minute from 00:00 to 13:39 on 2026-09-09, so "no usage-confirmed candidate"
is not an exotic state here. That is an observation about one deployment, not the structural
argument this section previously pretended to make.

The `:1259` MECHANISM is first-hand (I read the loop): `unread` makes the guard
`st2 !== 200 && st2 !== 429 && !unread` false, so the refresh block — the one that DOES test
`refreshToken` — is skipped entirely, control falls to `if (st2 !== 200)`, `st2` is 0 so it is not
429, and the push runs untested. `blobLocallyExpired` is checked there, but a fabricated one-year
`expiresAt` passes it. The janitor session REPORTS having traced the same mechanism and reached
the same conclusion — reported, not witnessed by me. Agreement between two parties who have each
been wrong today, about a ranking neither measured, is not corroboration.

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

- [ ] owner rules on whether to apply the gate
- [x] **the blob shape both gates rest on — READ FIRST-HAND at EVERY HOP, 2026-09-09 16:5x**, in
      the installed plugin cache **version `ai-maestro-janitor/3.4.15`** (reading another
      project's source is permitted, only editing is not). This box was FIRST CLOSED at 16:4x on
      two greps and a `sed`, with three hops unread and the key clause taken from a DOCSTRING —
      recorded here because it is the same cheapest-evidence-labelled-as-strongest error this
      card corrected four times already today, committed inside the correction itself. The hops
      are now actually read:
      · `slot_capture_token.py:184-185` — `"refreshToken": None` and
        `"expiresAt": int((time.time() + ONE_YEAR_S) * 1000)` in one literal;
      · that literal is passed to `rotator.file_slot(...)` (`rotator.py:1022`), which calls
        `write_slot(email, blob)` at `:1045` with the blob UNCHANGED (and stores `expires_at`
        separately in the state.json index at `:1050` — two copies; `expiresInH` reads the BLOB's);
      · `write_slot:1230` `inner = _oauth(blob)`, and `_oauth` (`:1013-1014`) is
        `blob.get("claudeAiOauth", {})` — **a bare dict `.get`. No filtering, no normalisation,
        nothing that could drop or rewrite the key.** This is the clause that was previously
        docstring-only;
      · `:1232` `blob = {"claudeAiOauth": inner}` strips top-level siblings only;
      · both storage paths serialise with `json.dumps(blob, separators=(",", ":"))` —
        `_slot_keychain_write:1152` and the 0600 plaintext fallback at `:1243`.
      JS side, read this repo: `slots.ts:300/315/383` `JSON.parse(...) as CredentialBlob`, and
      `oauthOf` (`:163-169`) returns `blob.claudeAiOauth` as-is. So a slot written by that path
      **would** carry Python `None` → JSON `null` → JS `null` → `oauthOf(b).refreshToken` falsy,
      and the gate would fire on it. **Nothing was executed and no stored blob was read** — this
      is a source read, not an execution trace, so the subjunctive is the strongest honest mood.
      **NOT "on the real artifact"** — and the NEGATIVE is weaker than the first correction of
      this box claimed. All 3 slots here RECORD `via: slot_capture_browser(full-oauth)`, which is
      a provenance LABEL written at capture time, not a read of any blob: a browser-captured slot
      that later lost its refresh grant (a partial write, a refresh that nulled the field) would
      carry that same label and BE a no-refresh blob. So the supported claim is *no slot is
      RECORDED as a setup-token capture* — not "none exists". Correcting a proxy claim by
      asserting a more confident proxy claim is the same error one turn later.
      **THIS READ EXPIRES WITH THE VERSION.** `setup_token_blob()` — the builder the janitor named
      — does NOT exist in 3.4.15; what is there is an inline dict literal. The first draft recorded
      that as the peer misnaming their own function. **More likely it is VERSION SKEW**: they cited
      a commit (`f4457513`, "one shared blob definition for the single-account and bulk paths")
      that is plausibly not in the published 3.4.15 I read. So (a) recording it as a peer error was
      itself a small unfair second-hand claim, withdrawn here, and (b) on the version I read there
      may be NO shared definition, which means the bulk path is not merely "another caller I
      skipped" — it is unread and possibly separate. Re-check this box against any newer published
      version before relying on it.
      This also closes TRDD-W11LAPSC's dependency on the same fact.
- [ ] the `:1247` refreshToken test added at `:1259`
- [ ] the same test added at `:1282-1286` — both, not one; the card makes no ranking
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
