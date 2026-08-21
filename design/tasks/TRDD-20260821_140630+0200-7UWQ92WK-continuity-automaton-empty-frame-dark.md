---
trdd-id: 7UWQ92WK
title: The continuity automaton went dark for two weeks and nothing could tell — a healthy pass logs nothing at all
column: dev
implementation-commits: [612e9853, c1f8b8c2]
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-21T14:06:30+0200
updated: 2026-08-21T14:26:34+0200
current-owner: ai-maestro-hub
created-by: ai-maestro-hub
assignee: ai-maestro-hub
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro-hub
approval-datetime: 2026-08-21T14:06:30+0200
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 1
severity: high
effort: medium
labels: [bugfix, silent-failure, fleet-continuity, observability]
external-refs: [Emasoft/ai-maestro#90]
---

# The continuity automaton went dark for two weeks, and nothing could tell

> **⚠ CORRECTED 20 MINUTES AFTER FILING — read `## RE-MEASURED` before the section below it.**
> The original headline said the automaton *is* dark. Measured properly, the `empty-frame` run is
> **HISTORICAL** and is **not reproducing now**. The section below is kept verbatim as the dated
> record of what was seen first; the correction and the sharper defect are further down. Filing a
> confidently-wrong mechanism is this repo's most expensive recurring mistake, so the near-miss is
> recorded rather than quietly edited away.

## Problem

`runContinuityTick` (`lib/fleet-continuity.ts`) has run as leg 3 of the fleet liveness watchdog
since **2026-08-06** and has **never once classified a frame**. Every observation it has ever made
is the same skip.

Measured 2026-08-21 from `logs/pm2-out.log` + `logs/pm2-error.log`:

```
526  [FleetContinuity] testbot: not actuated (empty-frame)
 30  [FleetContinuity] frank:   not actuated (empty-frame)
```

**556 lines, 556 skips, zero other outcomes**, spanning `2026-08-06 20:07:15` → `2026-08-20 18:53:37`.

And the frames are there. Captured the same minute this card was filed, from those exact sessions,
both of which are running Claude Code right now:

| session | `tmux capture-pane -p` | `-p -S -0` (what the code asks for) |
|---|---|---|
| `frank` | 954 non-ws chars | 954 |
| `testbot` | 1005 non-ws chars | 1005 |

So the pane is readable, the two capture forms agree, and the automaton still sees nothing.

## Why it stayed invisible — the part worth fixing first

`defaultContinuityDeps.captureFrame` (`lib/fleet-continuity.ts:147-155`) is:

```ts
try { return await getRuntime().capturePane(sessionName, 0) } catch { return '' }
```

A **thrown** capture and a **genuinely blank** pane both become `''`, and `''` becomes the same
benign-sounding `reason: 'empty-frame'` skip (`:77`). The log line reads like a healthy no-op —
*"not actuated"* — so 556 consecutive total failures look exactly like 556 quiet agents. This is
the repo's own lenient-reader / silent-failure family: **a `catch` that returns a neutral value
converts a fault into a normal-looking result**, and no amount of staring at the logs can tell the
two apart.

`capturePane` itself already falls back internally (full history → visible pane) and returns `''`
only if BOTH tmux invocations throw, so the outer `catch` is catching a case that is already
rare — which makes it likelier that the empties are *real* empties from a wrong target, not
exceptions.

## Root cause — NOT yet identified, and deliberately not guessed

Three candidates, none confirmed. **A wrong mechanism published confidently is this repo's most
expensive recurring mistake, so this card records the candidates and stops:**

1. **`sessionName` mismatch.** `listAgents()` maps `sessionName: s.name` — if a registry name and
   the tmux session name diverge for these agents, `-t <name>` targets nothing.
2. **`getRuntime()` is not the local tmux runtime** on the server's execution path (container /
   remote-host runtime), so `capturePane` resolves elsewhere.
3. **Alternate screen buffer.** Claude Code renders into the xterm alt-screen; a capture that
   works from an interactive shell may return empty for the server's invocation.

One hypothesis was already **refuted before it could be filed**: that `capturePane(name, 0)` asks
for zero lines. It does not — the parameter becomes `-S -0`, which measured **identical** to the
default capture on both live panes (954 / 1005). Recorded because it is the obvious-looking answer
and the next reader will think of it too.

## RE-MEASURED 2026-08-21 14:0x — the run is historical, and the real defect is worse

Four measurements, in the order they landed. **Two of the three candidates above are now refuted,
and so is this card's own proposed step 1.**

1. **The production call works RIGHT NOW.** An in-process probe running the exact production
   expression (`scripts_dev/probe-capture-frame.ts`, `bash scripts/with-node.sh npx tsx …`):
   `capturePane('frank', 0)` → **640 chars**, `capturePane('testbot', 0)` → **753**. Not empty. So
   candidate 2 (a non-tmux runtime) is dead — `getRuntime()` returns the local `defaultRuntime` —
   and so is any story about the target name being unresolvable today.
2. **No exception can ever reach the tick's `error:` branch.** `capturePane` swallows internally
   too (`lib/agent-runtime.ts:378-380` — a second `catch { return '' }` after its own fallback), so
   the outer `catch` in `defaultContinuityDeps.captureFrame` is unreachable in practice. **This
   card's proposed step 1 — "split `empty-frame` from `capture-failed`" — would therefore have
   changed NOTHING** if implemented as written: deleting the outer swallow cannot surface an error
   that the inner one already ate. Two stacked swallows, and only the inner one matters.
3. **The dark run stops at the server restart.** Last `[FleetContinuity]` line: `2026-08-20
   18:53:37`. pm2 reports `ai-maestro` up since `2026-08-20 21:24:17` (23 restarts). Since that
   start — **~17 hours** — the leg has logged **zero** lines, while `[FleetLiveness]` has logged
   10,331 in the same file.
4. **…and that silence is AMBIGUOUS, which is the actual bug.** The watchdog logs only `fired` and
   non-`no_event` skips (`lib/fleet-liveness-watchdog.ts:446-449`, with an explicit comment that it
   *"stays quiet on a healthy fleet"*). So **a leg that classifies healthily and a leg that never
   ran at all produce byte-identical output: nothing.** Seventeen hours of silence is equally
   consistent with "fixed" and "not running", and no amount of reading the log can separate them —
   it took an in-process probe to learn that capture works, and that still does not prove the
   *tick* is calling it.

**So the enduring defect is OBSERVABILITY, at two layers, and it is why two weeks passed
unnoticed:** a failure mode that renders as a benign skip, sitting under a healthy mode that
renders as nothing at all. The subsystem has no state in which it says *"I ran and I was fine."*

## Proposed fix

~~1. Split the skip reason first — `empty-frame` vs `capture-failed`, carrying the error.~~
**Struck: measurement 2 above proves this alone changes nothing** — `capturePane`'s own inner
`catch { return '' }` eats the error before the outer one is reached. Revised, in order:

1. **Give the leg a heartbeat line.** One periodic `[FleetContinuity] scanned N, fired F,
   skipped S` (throttled — say once per N ticks, or on change) so that **silence stops being
   ambiguous**. This is the whole reason two weeks passed unnoticed, it is inert, and it is what
   makes every other step verifiable. Do it first even if nothing else is done.
2. **Make the empty case say WHY at the layer that knows.** Either have `capturePane` stop
   swallowing (it has ~10 callers, several of which — `agent-runtime.ts:532,604` — already write
   `.catch(() => '')` at the call site, so they are expecting it to throw and are already
   defended), or have `defaultContinuityDeps.captureFrame` do its own capture so the error is
   local. Prefer the second: it is scoped to this subsystem and touches no shared primitive.
3. **Only then** chase the historical cause, with the ambiguity gone. The remaining candidate is
   that tmux genuinely returned empty for those targets in that window (a session-name or
   render-state condition that the current sessions no longer exhibit) — not a thrown capture, and
   not a wrong runtime.
4. Add a regression test that a live-shaped frame reaches `actuate`, so the automaton cannot go
   dark again behind a neutral-looking skip.

## ✅ LIVE VERIFICATION 2026-08-21 14:26 — step 1 landed, deployed, and OBSERVED

```
2026-08-21 14:26:10 +02:00: [FleetContinuity] pass ok: scanned 2, fired 0, skipped 0
```

Shipped in `612e9853` (+ neuter pair recorded in `c1f8b8c2`), deployed by `pm2 restart` alone —
`server.mjs:2033` imports `lib/fleet-liveness-watchdog.ts` at RUNTIME via tsx, and `.next` carries
zero copies of the new string, so no build was involved. First tick of the new process landed at
boot + ~7 min (bare `setInterval`, no immediate call).

**That one line answers three questions at once, and none of them could be answered before it:**

1. **The leg is running.** Silence is no longer ambiguous — the defect this card exists for is
   closed.
2. **`scanned 2`** matches an independent census of `~/.aimaestro/agents/registry.json` (2 sessions
   `online`, 11 `offline`), so the leg is seeing exactly the agents it should.
3. **`skipped 0`** — **not one `empty-frame`**. Had capture still been failing, both agents would
   have come back as skips. So the two-week dark run is confirmed NOT reproducing, by effect rather
   than by inference.

**A near-miss worth recording, because it is the same trap twice in one hour:** I first read
`[FleetLiveness]` lines at `14:18:57` as proof the new code had run and stayed silent. `pm_uptime`
says the process started at **14:19:11** — those lines were the OLD process's last breath. A
timestamp comparison, not a log grep, is what separated "my fix is inert" from "my fix has not run
yet."

**Instrument note for whoever greps next:** `[FleetContinuity]` writes to **stderr**
(`logs/pm2-error.log`), not `pm2-out.log`. Grepping the wrong file returns a confident zero.

## Acceptance

- [x] The continuity leg emits a positive "I ran and I was fine" signal, so silence means NOT
      RUNNING — landed `612e9853`, deployed, and OBSERVED live at 14:26:10 (above)
- [x] The signal is throttled so it cannot become per-agent-per-tick spam — signature-keyed plus a
      12-tick ceiling; pinned by the throttle test and a neuter pair (`c1f8b8c2`)
- [x] The historical dark run is confirmed present-or-absent by EFFECT, not inference — absent:
      `skipped 0` on a scan of 2 rendering agents
- [ ] The empty case says WHY at the layer that knows (`empty-frame` vs a capture that failed),
      scoped to `captureFrame` — NOT by changing the shared `capturePane` primitive
- [ ] A regression test proves a live-shaped frame reaches `actuate`, so the automaton cannot go
      dark again behind a neutral-looking skip

The two open boxes are hardening, not repair: with the heartbeat in place a recurrence is now
VISIBLE within one tick, which is what made the first one cost two weeks.

## Verification

`[FleetContinuity]` log lines show at least one outcome that is NOT a skip, on a session known to
be rendering. The `TRDD-Y8VPE3NS` empirical-PTY box becomes *observable* — it is currently
un-tickable by construction, not merely unobserved.

## Estimated risk

MEDIUM. The automaton injects ESC into live agent terminals; a fix that makes it start firing is a
behaviour change on real sessions, so land the reason-split (inert, observability-only) first and
watch a full window of logs before changing what it actuates.

## Notes and lessons learned

Found while checking whether `TRDD-Y8VPE3NS` was closeable — its one open box says the automaton's
response *"has still never been watched landing on a real wedge."* That was written as patience.
**An open box that reads as *waiting* can be hiding *broken*, and the two are indistinguishable
from the card.** The discriminator was one grep of the runtime logs.

**And then the same trap caught the investigation itself, 20 minutes later.** From 556/556 skips I
wrote *"the automaton IS dark"* and committed it. The skips had **stopped at a server restart 17
hours earlier**, and the production capture call works today — so the headline was true of a
window that had already closed. What made it feel verified was that every number in it was real:
the 556 was real, the byte counts were real, the swallow was real. **A measurement can be
completely accurate about a period that has ended, and nothing in the measurement says so** — the
missing question is always *"as of when?"*, and log-derived findings need their newest timestamp
read as carefully as their count.

The correction was worth more than the original: chasing it produced measurement 2 (which refutes
this card's own proposed fix) and measurement 4 (that a healthy pass logs nothing, so silence and
death are the same observation) — the finding that actually explains the two weeks.

## Approval log

- 2026-08-21T14:06:30+0200 — MANDATE issued by ai-maestro-hub (min-approval-requirement: none).
  Tier-0 self-mandate: in-scope bugfix in this repo's own tree, reversible, no baseline or
  governance surface touched. Pre-approved; no approval request was sent.
