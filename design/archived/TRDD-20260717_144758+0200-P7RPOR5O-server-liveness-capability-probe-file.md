---
trdd-id: P7RPOR5O
title: Server liveness+capability probe file — the auth-free coordination seam both janitor backends read
column: complete
created: 2026-07-17T14:47:58+0200
updated: 2026-08-05T00:39:18+0200
current-owner: ai-maestro
task-type: feature
scope: project
min-approval-requirement: none
mandate: true
mandated-by: ai-maestro
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-07-17T14:47:58+0200
relevant-rules: [16, 23, 42]
labels: [family-a, continuity, coordination, liveness, capability-probe, npt]
external-refs: [Emasoft/ai-maestro-janitor#100]
parent-trdd: KCRMSNL7
derived: true
derived-kind: npt
npt: []
eht: []
blocked-by: []
release-via: none
implementation-commits: [f47d2ff4]
---

# Server liveness+capability probe file — the auth-free coordination seam both janitor backends read

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-08-05

**🟢 LIVE AND VERIFIED ON DISK 2026-08-05 — the two caveats below are SPENT.** Measured on the
running server: `~/.aimaestro/server-liveness.json` exists, mtime 2 s old (inside the 30 s beat),
`pid` matching the live server process, and `capabilities: ["family-a", "singleton-chores"]`.
**SUPERSEDED — do NOT carry forward:** ~~"today `capabilities: []`"~~ and ~~"NOT YET LIVE ON
DISK"~~. Both tokens the card called unbuilt are now advertised, and each is honestly gated —
`family-a` on `oauthTickEnabled()` (the USER armed the R16 flag on 2026-07-29) and
`singleton-chores` on `isAbsorbedDutySchedulerRunning()`. `fleet-recovery` is still deliberately
NOT computed, with the comment in `currentCapabilities()` naming [[CHN16JXZ]] as its owner — so the
card's own rule, *"Do NOT advertise a token before its chore runs"*, holds today.
(Checked because the opposite looked plausible: `family-a` reads like CHN16JXZ's token and CHN16JXZ
is still `todo`. It is not — it is the OAuth token. One read of `currentCapabilities()` settled it,
and guessing would have produced a false defect report against working code.)

**✅ IMPLEMENTED 2026-07-17 (`f47d2ff4`).** `lib/server-liveness.ts` +
`server.mjs` boot wiring (beside the OAuth tick) + 8 unit tests (0-IMPACT temp HOME). tsc 0,
`yarn build` 0. The file writes `{ts,pid,capabilities}` atomically every 30 s; today
`capabilities: []` (OAuth INERT via the R16 flag; nothing else built) → the janitor keeps 100%.
**NOT YET LIVE ON DISK:** the file appears only once the running server is restarted onto this
build (governance-rules), and reaches the deployed server on `governance-rules → main`. Until then
a consumer sees "no file → server down → I own everything" (the safe default). Spec relayed to the
janitor: janitor#100 comment 5003418487.

7th NPT of [[KCRMSNL7]], surfaced by the daemon-coordination refinement (janitor#100). The whole
Family-A/B daemon split needs ONE fact from two ends: `#J` (inside the harness) must know "the
server is up and owns capability X" before delegating; `#N` (outside) must know "a live server
owns the harness agents" to hold its exclusion (and "no live server" to adopt the fallback). The
HTTP health endpoint 401s unauthenticated and the frozen CLI needs `$AID_AUTH` — neither works for
the OUTSIDE daemon. The janitor asked me (janitor#100, comment 5003418487) to name the shape; I
proposed an **auth-free file the server maintains**, both consumers `stat` it. This NPT builds it.

**THE LOAD-BEARING RULE (janitor#100):** `capabilities` advertises ONLY what the server ACTUALLY
owns and is RUNNING right now — never what code merely exists. An un-absorbed / INERT chore class
is simply ABSENT, so the janitor keeps doing it until the server proves ownership. This makes the
whole absorption a per-class INCREMENTAL HANDOFF with no flag-day. Today the file ships advertising
`capabilities: []` (OAuth INERT via the R16 flag; nothing else built) → the janitor keeps 100%.

**Capability tokens (each appears only when its class is LIVE):**
- `family-a` — the OAuth rotator tick is ENABLED (the R16 flag `oauth-rotator-tick.enabled` present).
  Reuses [[1GGQ4HWY]]'s `oauthTickEnabled()` — one source of truth for the flag. Absent today.
- `singleton-chores` — marketplace/user-plugins/version-update absorption is running. NOT built →
  intentionally NOT computed (a token without its live chore would silence the janitor on a chore
  nobody runs — the exact failure janitor#100 forbids). Ships WITH `marketplace-op.lock`.
- `fleet-recovery` — server-internal session-liveness/fleet-stop for harness agents ([[CHN16JXZ]],
  design-gated on ai-maestro#60). NOT built → not computed.

**NEXT ACTION:** DONE for the seam itself once built + tested. The 2 unbuilt tokens are added by
their own NPTs (singleton-chores absorption; CHN16JXZ) — each adds its `caps.push(...)` guard here
when its chore goes live. Do NOT advertise a token before its chore runs.

## Problem / Goal

Provide the canonical "server is up / owns capability X" signal the janitor's two backends both
consume, WITHOUT auth (the outside `#N` daemon has no `$AID_AUTH`) and WITHOUT the HTTP-401 problem.
An auth-free file under `~/.aimaestro/` that the server maintains and both backends `stat`.

## Scope (the seam only — the tokens' chores are other NPTs)

- `lib/server-liveness.ts` — `SERVER_LIVENESS_FILE = statePath('server-liveness.json')`;
  `currentCapabilities()` (honest, live-only — today just the `family-a` guard on `oauthTickEnabled()`);
  `writeServerLiveness()` (atomic tmp+rename, never throws); `startServerLiveness()` (write-once on
  boot + a 30 s unref'd interval — a third of the 90 s staleness consumers use).
- `server.mjs` — dynamic-import + `startServerLiveness()` at boot, right after the OAuth-rotator tick
  start, mirroring that pattern (unconditional start; the honesty lives inside `currentCapabilities`).
- The file shape is `{ ts: <epoch_s>, pid: <server pid>, capabilities: string[] }`.

## Reuse (do not reinvent)

- `oauthTickEnabled()` (`lib/oauth-rotator/server-tick.ts`) — the single source for the R16 flag,
  reused for the `family-a` token so the flag name is never duplicated.
- `statePath()` re-resolved via `path.basename(SERVER_LIVENESS_FILE)` on every write — honors a
  test's HOME override (the exact idiom `server-tick.ts` uses for `oauthTickEnabled`).
- The `setInterval(...).unref()` + never-throw beat pattern from `server-tick.ts`.

## Verification

- Unit (`tests/unit/server-liveness.test.ts`, 0-IMPACT temp-HOME): the file is written with the 3
  fields; `capabilities` is `[]` when the R16 flag is absent and `['family-a']` when present;
  `writeServerLiveness` never throws on an unwritable dir; the write is atomic (no partial file).
- `bash scripts/with-node.sh npx tsc --noEmit` clean; `yarn build` clean.

## ⏹ TRANSITION 2026-08-02 — `testing` → `ai_review` ([[5YRLA53W]])

Every verification item this card set for itself is met and re-run: 16 unit tests green, `tsc` 0,
`yarn build` 0, and the one condition its STATE left open — *"NOT YET LIVE ON DISK"* — is now
satisfied and measured on the running server. That is the exempt mechanical transition (all
test-requirements PASSED), not a judgement call.

The single `[~]` box is a **superseded goal**, not a failed test: the per-class handoff was
abandoned by the consumer, not by this card. Advancing with it struck through is honest; leaving
the card in `testing` would assert that tests are still pending when none are.

## ⏱ VERIFIED LIVE 2026-08-02 — the seam works, and the CONSUMER'S design changed underneath it

Two things this card could not know when it was written, both measured today:

**1. It IS live on disk, and both built tokens are advertised.** The STATE above says *"NOT YET LIVE
ON DISK"* and *"today `capabilities: []`"*. Neither holds now: `~/.aimaestro/server-liveness.json`
was **16 s old** when checked (inside the 90 s staleness window the consumers use) and carries
`capabilities: ['family-a', 'singleton-chores']`. Both tokens went live via their own NPTs exactly
as designed; `fleet-recovery` is still correctly absent, because [[CHN16JXZ]]'s Phase B is pending —
the honesty rule holding, not an omission.

**2. THE PER-CLASS INCREMENTAL HANDOFF THIS CARD WAS BUILT FOR WAS SUPERSEDED BY THE CONSUMER.**
This card's LOAD-BEARING RULE is that `capabilities` drives a per-class handoff *"with no flag-day"*.
`janitor#100` closed on 2026-08-01 with the opposite: their `TRDD-LU0C5KAR` makes the yield
**BINARY ON LIVENESS**, quoting the owner — *"if the ai-maestro server is running, those chores are
its responsibility"* — with **no per-class capability checks**. Their SSOT (`harness_backend.py`)
reads `server_is_alive()` and yields all five `SERVER_ABSORBED_TASKS` at once.

**What that changes, and what it does NOT.** The seam itself is unaffected and still exactly right:
the file, its atomic write, its 30 s beat and its `ts` are what the binary probe reads, so this card
delivered the substrate the consumer actually uses. What changed is that **`capabilities` is now
ADVISORY** — written honestly, read by nobody. The safety property inverts accordingly, and this is
the part worth carrying forward: under the old design an un-advertised chore stayed with the
janitor; under binary yield, **a chore this server fails to run while merely being alive is run by
NOBODY**. The honesty rule below is therefore still worth obeying — but it no longer protects
anything by itself. Full reading on [[KCRMSNL7]].

## Acceptance

Transcribed from this card's own `## Verification` list and the two NEXT-ACTION conditions its STATE
names. Re-run live 2026-08-02 (16 tests green; the card recorded 8, it has since doubled).

- [x] the file is written with its 3 fields (`ts`, `pid`, `capabilities`) — `f47d2ff4`
- [x] `capabilities` is `[]` when the R16 flag is absent and carries `family-a` when present,
      reusing `oauthTickEnabled()` so the flag name is never duplicated
- [x] `writeServerLiveness` NEVER throws on an unwritable dir — a coordination beat that dies
      because its own write failed is worse than no beat
- [x] the write is ATOMIC (tmp + rename); no consumer can ever `stat` a partial file
- [x] `tsc --noEmit` clean; `yarn build` clean
- [x] **live on disk** — the STATE's one open condition. Verified 2026-08-02: 16 s old, inside the
      90 s window, `['family-a','singleton-chores']`
- [x] the honesty rule holds in code — `lib/server-liveness.ts:90-92`: `family-a` gated on
      `oauthEnabled()`, `singleton-chores` on `singletonChoresLive()`, and `fleet-recovery`
      deliberately NOT computed until its chore is live
- [~] the per-class INCREMENTAL HANDOFF this card's rule was written to enable — **superseded by
      the consumer** (`janitor#100` → their `TRDD-LU0C5KAR`, binary on liveness). Marked struck
      rather than checked or dropped: it was a real goal, it is no longer reachable from here, and
      recording that is what stops the next reader re-deriving a design the peer has abandoned

## Approval log
- 2026-08-05T00:39:18+0200 — `testing → complete`. The card's ONE remaining caveat was "NOT YET
  LIVE ON DISK", which is a claim about the running system rather than about code — so it was
  settled by measuring the system, not by re-reading the card: the file is present, freshly
  written inside its 30 s beat, with a pid matching the live server. Both previously-unbuilt
  capability tokens are now advertised and honestly gated, and `fleet-recovery` remains correctly
  withheld pending [[CHN16JXZ]]. Its own NEXT ACTION already scoped this card to the SEAM, with the
  tokens' chores delegated to other NPTs, so nothing here is owed. 7/7 boxes `[x]`, checklist
  non-empty, `npt`/`eht` both `[]` — both completion gates satisfied. Archived as `completed`.

- 2026-07-17T14:47:58+0200 — Tier-0 self-mandate (derived NPT of [[KCRMSNL7]], coordination
  substrate the janitor is blocked on; in-scope server dev, no token material). Authored as `dev`.
