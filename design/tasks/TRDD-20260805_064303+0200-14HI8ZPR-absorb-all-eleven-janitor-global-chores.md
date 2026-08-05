---
trdd-id: 14HI8ZPR
title: Server suppresses the janitor daemon entirely but absorbs only 5 of its 11 global chores
column: dev
scope: project
project-id: ai-maestro
created: 2026-08-05T06:43:03+0200
updated: 2026-08-05T08:02:01+0200
implementation-commits: [01a56c40c06e4982e70913099e83c580373d12f9]
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-08-05T06:43:03+0200
severity: high
effort: large
relevant-rules: []
npt: []
eht: []
blocked-by: []
release-via: none
labels: [janitor, daemon-absorption, fleet-guardian, cross-repo]
external-refs: [Emasoft/ai-maestro#111]
---

# Server suppresses the janitor daemon entirely but absorbs only 5 of its 11 global chores

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-08-05

Filed by the janitor as `ai-maestro#111`, **verified first-hand on this side before filing this
card** — do not re-litigate the parts marked VERIFIED, and do not trust the parts marked OPEN
without measuring them.

**The shape of it.** `global_state.py::ensure_daemon_running` refuses to spawn the janitor daemon
at all when a live ai-maestro server owns the host (one-daemon-per-host, TRDD-5ZVS1DDP). But
`harness_backend.py::SERVER_ABSORBED_TASKS` claims only **five** of the daemon's **eleven** global
chores. The suppression is total; the absorption is partial. **The gap between those two numbers
is the bug**, and the janitor cannot close it from its side without violating the invariant this
project asked for.

**✓ VERIFIED — we DO run the five, we just never say so.** The janitor's report states the five
contracted chores show 10-14 day-old stamps and that, from its vantage point, "not running" and
"running without recording" are indistinguishable. They are distinguishable from here, and the
answer is the benign one: `startAbsorbedDutyScheduler` is wired at `server.mjs:1845` behind a live
`setInterval` (`services/auto-update-service.ts:205`). So for those five this is a REPORTING
defect, not a maintenance outage.

**✓ VERIFIED — the stamp is never written.** `grep -rn "last-run"` over `lib/ services/ scripts/`
returns **zero hits**, and `find ~/.claude/janitor-control -name '*.last-run.ts'` returns **0
files**. The contract is one line per chore:

```
~/.claude/janitor-control/<task-name>.last-run.ts     # epoch seconds, plain text
```

`<task-name>` is the exact registry string. The janitor already reads these
(`global_state.read_last_run`) and treats a stale stamp as "this chore is not being done" — so
today every absorbed chore is *correctly* reported dark by a janitor that has no way to see it run.

⚠ Measured with `find`, NOT `ls ~/.claude/janitor-control/*.last-run.ts` — the unmatched glob makes
`ls` list the CWD and return 0, which is a plausible-looking wrong answer.

**✗ OPEN — the six unabsorbed chores really are unowned** while the server is up, and their
stamps are 10-14 days old. The highest-severity is `session-liveness`.

| chore | cadence | cost of it being dark |
|---|---|---|
| `session-liveness` | 2 min | **fleet guardian.** Frozen / cron-dead sessions are never recovered, so every per-session detector they own (GitHub issue watch, reply watch, drift, security) silently stops. This is how an agent stops receiving notifications with nothing appearing broken. |
| `fleet-stop` | 60 s | `/janitor-global-disarm` does not reach other sessions — a machine-wide STOP that stops nothing |
| `memory-guard` | 2 min | no Tier-1 OOM protection |
| `cache-prune` | 6 h | unbounded plugin-cache growth |
| `rules-cleanup` | 1 h | uninstalled plugins keep injecting rules into every session |
| `github-config-audit` | 6 h | fleet-wide config/branch-protection drift unnoticed |

## ⏵ SLICE 1 LANDED — the five stamps (`01a56c40`, 2026-08-05)

`lib/janitor-chore-stamp.ts` + call sites at all five: `marketplace-refresh`, `version-update`,
`user-plugins-update` (the absorbed-duty tick) and `oauth-rotator-tick`,
`oauth-rotator-supervisor` (the rotator's own beats). Written on ATTEMPT, not on success —
the stamp answers *"is anyone doing this chore on cadence"*, and stamping only on total success
would make a flaky chore look UNOWNED, sending the janitor to restart a daemon that is not the
problem. Full suite 362 files / 5104 pass / 2 skip, zero timeouts.

**The writer is a NEW module on purpose.** `lib/janitor-control.ts` states a hard invariant in its
header — *"NEVER WRITE … this module has no writer and exports none"* — because writing a FLAG
there ratchets fleet mode into something nothing lifts. That is about flags, and it is not
weakened: the new module composes `${chore}.last-run.ts` from a CLOSED literal union, so no
argument to it can produce a control-plane flag name. A construction guarantee, not a comment.

**⚠ A defect I introduced and then fixed in the same slice, worth reading before adding a chore.**
The stamp write lives inside each chore's own code path, so ANY test that drives a chore writes
the developer's real `~/.claude/janitor-control/`. Measured immediately: `runOneSupervisorBeat` is
driven by **four** test files, **none** had containment, and one run left a real
`oauth-rotator-supervisor.last-run.ts` on this machine (removed). Fixing those four files would
have left the fifth for whoever comes next, so the redirect went into a vitest `setupFiles` hook
(`tests/setup/janitor-control-containment.ts`) — the guard belongs at the primitive, not the call
sites. A stray stamp is not cosmetic: it tells the janitor a chore ran when only a TEST ran, which
is the false-healthy direction, and a contract tests can forge is not a contract.

## ⏵ SLICE 2 — `session-liveness`: the read is DONE. It is **NEITHER** absorb nor wire-up — 2026-08-05

The question was "ABSORB (new implementation) or WIRE-UP (the existing fleet modules)?" **The
answer is that `session-liveness` is not one chore.** It is two populations with one name, and
each gets a different verdict. This is the counter-example that qualifies this card's own
"absorb all eleven" recommendation — do not read that recommendation as settled for this chore.

**✓ VERIFIED — the server-owned half is already ABSORBED IN FACT, and only the CONTRACT is
missing.** `startFleetLivenessWatchdog()` is wired at `server.mjs:1996`, unconditional, 5-min
default cadence. Actuation is not merely present but ARMED: `AIM_FLEET_RECOVERY_FIRE: '1'` in
`ecosystem.config.js:34` **and confirmed in the LIVE process env** (`ps eww -p 11440` →
`AIM_FLEET_RECOVERY_FIRE=1`) — checked against the process, not the config file, because
`pm2 restart` replays a cached env and the two drift. `runFleetLivenessTick` runs detection, the
recovery ladder, the inbox nudge and the continuity automaton. So for this half the work is
**three lines and a cadence decision**, not an implementation.

**✗ VERIFIED — the other half is a population the server cannot see at all.** The janitor's
chore is not "watch agents"; it is *"find EVERY running claude instance on the host and diagnose
**its janitor's** health from OUTSIDE it"* (`scripts/lib/fleet_scan.py` header — written after a
live scan found 23 instances, 15 with a broken janitor). It reaches them by `ps`/`lsof`/`tmux`/
`osascript`, resolving each by **live TTY** so it can rescue a zombie whose janitor predates
`terminal-identity.json`. The server has no concept of a claude process outside its own registry.

**And the two halves DO NOT OVERLAP — by explicit construction on the janitor's side.**
`session_liveness.py:245` returns `server_owned` **before** it tests dead/frozen, and
`_DIAGNOSIS_RECOVERY['server_owned'] = None`. `harness_backend.instance_is_server_owned` makes
any instance rooted under `~/agents/` owned (the registry-free signal, load-bearing because
`aimaestro-agent.sh list` 401s the daemon — it has no `AID_AUTH`). So the janitor already refuses
our agents, and we already watch them. **The chore is disjoint, and the split is the design.**

| half | population | verdict |
|---|---|---|
| server-owned harness agents | the ai-maestro registry | **WIRE-UP** — running today; add the contract |
| every other claude instance | iTerm tabs, zombies, legacy, non-harness | **HAND BACK** — the server has no reach, and absorbing it means enumerating and TTY-injecting arbitrary processes to guard *the janitor's own* health. That is the daemon's purpose, not the server's. |

**Consequence for this card's recommendation.** "Absorb all eleven" is right as an *intent* and
wrong as a *blanket*: a chore whose population is host-wide is not absorbable by a process that
owns one registry. The honest resolution for `session-liveness` is the SPLIT — and it costs
nothing, because the janitor's exclusion table already implements our half of it.

## ⏵ SLICE 3 LANDED — the hibernation probe, and a SECURITY CORRECTION — 2026-08-05

USER directive: give the janitor a way to tell a HIBERNATED agent from a CRASHED one. It is a
genuine gap — `Agent['status']` is `active | offline | deleted`, so hibernated, crashed and
never-woken all read `offline`. Measured live: **9 agents, every one `offline`; 6 cleanly
hibernated, 3 crashed, plus 14 orphaned persistence rows.** `hibernateAgent` unpersists
(`agents-core-service.ts:2587`), so a surviving record proves the clean path never ran; all 3 were
checked against the stale-by-rename hypothesis and refuted (each row's session id equals its
agent's computed session name).

**⚠ THE FIRST IMPLEMENTATION WAS A SECURITY DEFECT, and the reasoning that produced it is the part
worth keeping.** It shipped as a standalone CLI that read `~/.aimaestro` directly with **no
authentication**, dumped the whole fleet roster (every agent uuid, name and tmux session name), and
**worked with the server down** — which I documented as a FEATURE in both the module header and the
commit message. Reverted in `3f069c22` on the USER's ruling: agent status is not public data; with
no server there is nothing to validate signatures against, so nothing may execute; the
server-integrated daemon is the only party authorized to read this data or run these commands.

The root error: `aimaestro-agent.sh` runs `check_api_running || exit 1` and sends an `AID_AUTH`
bearer. I read that as an **obstacle to route around**, because the janitor daemon has neither. It
is the security boundary. And the premise was false anyway — **the janitor never needs to call in;
the daemon publishes to it.**

**What shipped instead**, all green (365 files / 5137 pass / 2 skip; `pillars:lint` 0;
`trddgrep validate` at its 1-ERROR baseline):

| piece | commit | note |
|---|---|---|
| `lib/agent-hibernation.ts` — the ONE derivation | `eb0e9e95` | `classifyLiveness` now calls it; its 18 tests pass UNCHANGED, which is the proof the extraction is behaviour-preserving |
| `GET /api/agents/hibernation` behind `authenticateFromRequest` | `400e9f9d` | plus `services/agent-hibernation-service.ts` (two in-server callers only) |
| `aimaestro-agent.sh hibernation` | `400e9f9d` | a subcommand on the EXISTING authenticated script, inheriting the boundary rather than duplicating it |
| `lib/janitor-daemon-publisher.ts` → `<project>/.janitor/daemon_responses/` | `28c99c48` | derived paths only; no output-path parameter exists, and adding one would be the bug |

**Least privilege:** an agent workdir receives `agentScopedView` — its own record plus fleet-wide
COUNTS. The full roster goes only to the install tree. The whole map in every workdir would mean
compromising any one agent yields the fleet.

**Three defects the tests caught before landing**, all mine, all in the hardening itself:
`isUnder` is a raw string compare so `<agents>/../../etc` passed; `resolve()` is lexical so a
SYMLINK out of the agents root still passed; and comparing a lexical child against a realpathed
root refused *every* legitimate write (on macOS `/var` → `/private/var`) — a gate that always
refuses fails as quietly as one that always allows. Two neuters now pin the lexical and physical
checks independently, and getting there required fixing the test twice: the first assertion matched
a phrase both refusal messages share, and the fixture was built with `path.join`, which normalizes
`..` away at construction so the "traversal" input contained none.

**NEXT ACTION (the wire-up, small):** name `session-liveness` in `SERVER_ABSORBED_TASKS`, stamp it
from `runFleetLivenessTick`, and decide the cadence (janitor 2 min vs our 5 min default; the stamp's
staleness window is what makes the choice observable). No longer blocked — the hibernated-vs-crashed
answer now exists, so the chore can report a deliberate sleep as healthy instead of as a fault.

**NOT yet done:** `yarn build` + restart, so the new route is not in the running bundle yet (a
restart does NOT rebuild — `app/` is bundled into `.next`). The publisher is in `server.mjs`, which
IS loaded at runtime, so it goes live on a plain restart. Verify by EFFECT, never by `git log`.

⚠ **Adding a chore to `ABSORBED_CHORES` is NOT what absorbs it — running it is.** A stamp for a
chore nobody runs is strictly worse than no stamp: it reports healthy while nothing happens, which
is the failure this card exists to remove, re-created facing the other way.

## The decision this card must make

The janitor states both resolutions are acceptable and that ai-maestro owns the choice:

1. **Absorb all eleven** — the user's stated intent (if the server owns the host, it owns every
   global chore). Run each at or under its cadence and stamp it.
2. **Narrow the suppression to what is actually absorbed** — publish which chores the server
   claims and let the daemon run the remainder. One owner per chore, but two processes per host.

A third option is explicitly *not* acceptable and is what ships today: suppress the whole daemon,
claim part of its work, leave the rest unowned and unreported.

**Recommendation: (1), staged.** The user has said elsewhere that the server owning the host means
owning the global chores, and (2) walks back the one-daemon-per-host invariant that TRDD-5ZVS1DDP
established deliberately. But (1) is not one task — `session-liveness` is a fleet actuator and this
repo already has `lib/fleet-liveness.ts`, `lib/fleet-recovery-actuator.ts` and
`lib/fleet-continuity.ts`, so the question for each of the six is *"absorb, or wire the existing
implementation to the chore contract?"* — and those are very different sizes of work.

## Why this is not one card's worth of work

Six chores, three of them fleet actuators with real blast radius (`session-liveness` injects
recovery into other sessions; `fleet-stop` actuates a machine-wide disarm; `memory-guard` acts on
OOM). Each needs its own decision, its own cadence, and its own stamp. Expect this card to split
into per-chore NPTs once the absorb-vs-narrow decision above is made.

## Verification

```bash
# the stamp contract, per chore
find ~/.claude/janitor-control -maxdepth 1 -name '*.last-run.ts' -type f | wc -l   # today: 0
# and that the server actually schedules what it claims
grep -n "startAbsorbedDutyScheduler" server.mjs services/auto-update-service.ts
```

A chore is only absorbed when BOTH hold: it runs at or under its cadence, AND its stamp is
written where the janitor reads it. Shipping one without the other reproduces exactly today's
condition in a new place.

## Estimated risk

MEDIUM for the stamps (additive writes, no behaviour change). HIGH for the fleet actuators — they
act on other sessions, and a bug there is a fleet-wide event rather than a local one.

## Acceptance

- [x] the absorb-vs-narrow decision recorded here with its reasoning — **(1) absorb all eleven, staged**; (2) would walk back the one-daemon-per-host invariant TRDD-5ZVS1DDP established deliberately
- [x] `<task-name>.last-run.ts` written for all five already-absorbed chores — `01a56c40`, all five sites
- [ ] each of the six unabsorbed chores given a verdict: absorb (with owner + cadence) or hand back — 1 of 6 done (`session-liveness`)
- [x] `session-liveness` **verdict recorded**: SPLIT — wire-up our half (already running, armed, verified in the live process env), hand back the host-wide half (the server has no reach; the janitor's `server_owned` exclusion already makes the two disjoint)
- [ ] `session-liveness` wire-up SHIPPED — no longer blocked; the hibernated-vs-crashed answer now exists
- [x] the janitor can tell HIBERNATED from CRASHED — `lib/agent-hibernation.ts`, served by an AUTHENTICATED route and published per-janitor to `<project>/.janitor/daemon_responses/` (`eb0e9e95`, `400e9f9d`, `28c99c48`; the unauthenticated first attempt reverted in `3f069c22`)
- [ ] `yarn build` + restart so the new route is in the running bundle, then verify by EFFECT
- [x] a test that fails when an absorbed chore runs without writing its stamp — plus its complement (the gate refusing must NOT stamp, or an unowned chore would look owned) and an epoch-SECONDS pin, since a milliseconds value parses fine and reads as permanently fresh for ~55 000 years
- [x] reply on `ai-maestro#111` with the decision, so the janitor can drop its side of the ambiguity — [comment 5187649837](https://github.com/Emasoft/ai-maestro/issues/111#issuecomment-5187649837)

## Approval log

- 2026-08-05T06:43:03+0200 — SELF-MANDATE (min-approval-requirement: none). Bugfix in this repo's
  own scope, sourced from `ai-maestro#111`. No baseline deviation, no governance change. The
  fleet-actuator absorptions may raise the floor when scoped; re-evaluate per NPT.
