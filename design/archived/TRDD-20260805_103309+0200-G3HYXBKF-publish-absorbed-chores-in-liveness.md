---
trdd-id: G3HYXBKF
title: Publish the absorbed-chore list in server-liveness so the janitor can narrow its daemon suppression
column: complete
created: 2026-08-05T10:33:09+0200
updated: 2026-08-05T10:52:41+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: infra
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-08-05T10:33:09+0200
derived: false
npt: []
eht: []
priority: 0
severity: high
effort: s
release-via: none
labels: [janitor-interface, chore-ownership, cross-repo]
external-refs: [Emasoft/ai-maestro#111, Emasoft/ai-maestro#103, Emasoft/ai-maestro#102, Emasoft/ai-maestro#95]
relevant-rules: []
implementation-commits: [464dad08]
---

# Publish the absorbed-chore list in server-liveness

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-08-05

- **Code: DONE.** `lib/server-liveness.ts` now emits `absorbed_chores: [...ABSORBED_CHORES]`;
  `tests/unit/server-liveness.test.ts` 18/18; `tsc` 0 lines.
- **NEXT ACTION:** neuter-verify the two new tests, then answer `#111` and `#103` on GitHub with
  the live measurement below.
- **Do NOT** absorb the remaining five chores — that decision is already made and documented at
  `lib/janitor-chore-stamp.ts:44-53` and in `[[janitor-chore-absorbability]]`.

## Problem

`Emasoft/ai-maestro#111` (janitor, 2026-08-05) reports that a live ai-maestro server does not take
a *handover* — it **forbids the janitor daemon from starting at all** (`_server_owns_host()`), while
the janitor's `harness_backend.SERVER_ABSORBED_TASKS` claims only part of that daemon's work. The
janitor offered two acceptable resolutions and named the third — suppress everything, claim part,
leave the rest unowned — as what is happening today.

Our position on WHICH chores we absorb was already settled (TRDD-14HI8ZPR): six, with the other five
staying with the janitor because they enumerate live host processes and sessions the server cannot
see. So the resolution we want is the janitor's **option 2 — narrow the suppression**.

That option has a precondition nobody had built: **the janitor has no machine-readable way to learn
what we claim.** It hardcodes the boundary, and its copy is already stale — a frozen literal of five
names against our six (`github-config-audit` joined 2026-08-05 on USER go-ahead).

## Root cause

`server-liveness.json` published `ts / pid / sha / sha_full / dirty / capabilities` and nothing about
chore ownership. `capabilities` looks like the natural place and is not: it is **write-only across the
whole ecosystem** (measured on both sides 2026-08-02 and documented at length on `currentCapabilities`)
— the janitor's `server_capabilities()` has one caller which only tests it for `None`.

## Proposed fix — LANDED

Add a first-class `absorbed_chores: string[]` to the liveness payload, sourced from the existing
`ABSORBED_CHORES` constant so there is one source of truth and no second list to drift.

Two properties the code comments carry, because both are silent-failure traps:

1. **An ABSENT field must never read as "absorbs nothing."** A consumer on an older server must fall
   back to its own list; reading absence as emptiness hands every chore back to a daemon that is
   still suppressed.
2. **The payload ships a COPY.** `ABSORBED_CHORES` is `as const`; handing the tuple itself out lets a
   caller poison every later heartbeat.

## Why this is a precondition, not a convenience

While the daemon is suppressed outright, the five-vs-six drift is harmless — nobody runs the extra
chore twice because the janitor runs nothing. The moment suppression narrows to "run what the server
does not claim", a stale five-name list makes **both** sides run `github-config-audit`: the
two-owners-per-chore condition the one-daemon-per-host invariant exists to prevent. Publishing the
list has to land before, or with, their narrowing — not after.

## Verification

- `bash scripts/with-node.sh npx tsc --noEmit` → 0 lines.
- `bash scripts/with-node.sh npx vitest run tests/unit/server-liveness.test.ts` → 18 passed.
- Two new tests, both non-vacuous by construction:
  - the registry names are asserted **literally**, not read back from `ABSORBED_CHORES` — comparing
    the payload against the constant that produced it would pass through any rename, which is the one
    change that actually breaks the consumer;
  - the copy test mutates the first payload and asserts a later beat is unaffected.
- Neuter: delete `absorbed_chores` from the payload → the literal-names test must red.

## Live measurement taken while diagnosing (2026-08-05 ~10:30 +0200)

`#111`'s own table is already out of date — every stamp it reported at 10–14 days stale is now fresh,
because the server was restarted at 10:06:42. The mechanism it describes is nonetheless confirmed:

| time | event |
|---|---|
| 10:02–10:07 | janitor daemon's final beats — it stamps its five chores |
| **10:06:42** | pm2 starts `ai-maestro`; `server-liveness.json` goes fresh |
| 10:07 | `daemon.heartbeat.ts` stops advancing — the daemon was suppressed |
| 10:19 → 10:29 | our six stamps keep ticking (`oauth-rotator-tick` 60 s, supervisor 10 min) |

So the five janitor-owned chores stop the instant we come up, exactly as `#111` says — their stamps
simply look fresh right now because the suppression is 23 minutes old rather than 10 days.

## Estimated risk

LOW. Additive field on a file whose only consumers treat unknown keys as ignorable; no behaviour
changes on our side; the write path already never throws.

## Acceptance

- [x] `absorbed_chores` published from the single `ABSORBED_CHORES` constant
- [x] `tsc` clean, `server-liveness` suite green
- [x] neuter run recorded — deleting the field reddened **exactly 2**, both predicted (the
      literal-names test and the copy test); restored and blob-hash verified
- [x] `#111` answered — resolution **2** (narrow the suppression), the six we absorb, why the other
      five stay theirs, and the new field · comment `5189499546`
- [x] `#103` answered with the per-chore execution table + the capability-vocabulary correction
      (`family-a` is NOT the whole set — `singleton-chores` exists) · comment `5189514244`
- [x] janitor told their `SERVER_ABSORBED_TASKS` is stale at five names, and told WHY it only starts
      to matter once they narrow suppression

## Approval log

- 2026-08-05T10:33:09+0200 — MANDATE issued by ai-maestro (min-approval-requirement: none).
  Pre-approved: Tier-0 self-mandate, in-scope infra on this repo's own server. No approval request
  was sent.
