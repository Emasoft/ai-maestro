---
trdd-id: 14HI8ZPR
title: Server suppresses the janitor daemon entirely but absorbs only 5 of its 11 global chores
column: todo
scope: project
project-id: ai-maestro
created: 2026-08-05T06:43:03+0200
updated: 2026-08-05T06:43:03+0200
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

**NEXT ACTION:** write the five stamps we already earn. It is the smallest change, it converts a
silent handover into a verifiable one, and it immediately shrinks the reported problem from
eleven chores to six — which is the honest number.

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

- [ ] the absorb-vs-narrow decision recorded here with its reasoning
- [ ] `<task-name>.last-run.ts` written for all five already-absorbed chores
- [ ] each of the six unabsorbed chores given a verdict: absorb (with owner + cadence) or hand back
- [ ] `session-liveness` resolved first — it is the one whose darkness hides all the others
- [ ] a test that fails when an absorbed chore runs without writing its stamp
- [ ] reply on `ai-maestro#111` with the decision, so the janitor can drop its side of the ambiguity

## Approval log

- 2026-08-05T06:43:03+0200 — SELF-MANDATE (min-approval-requirement: none). Bugfix in this repo's
  own scope, sourced from `ai-maestro#111`. No baseline deviation, no governance change. The
  fleet-actuator absorptions may raise the floor when scoped; re-evaluate per NPT.
