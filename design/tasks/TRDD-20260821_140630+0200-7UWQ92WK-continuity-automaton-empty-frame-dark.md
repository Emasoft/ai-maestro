---
trdd-id: 7UWQ92WK
title: The continuity automaton has been dark for two weeks — 556 of 556 observations skipped as empty-frame
column: planned
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-21T14:06:30+0200
updated: 2026-08-21T14:06:30+0200
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

# The continuity automaton has been dark for two weeks

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

## Proposed fix

1. **Split the skip reason first** — `empty-frame` (genuinely blank) vs `capture-failed` (threw),
   carrying the error. One line each, and the next 24 h of logs names the root cause for free.
   Do this even if the rest waits; it is the change that makes the bug diagnosable at all.
2. Then fix whichever cause the split reveals.
3. Add a regression test that a live-shaped frame reaches `actuate`, so the whole automaton cannot
   go dark again behind a neutral-looking skip.

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
It is not: the response **cannot** land, because the classifier has never received a frame. **An
open box that reads as *waiting* can be hiding *broken*, and the two are indistinguishable from
the card.** The discriminator was one grep of the runtime logs.

## Approval log

- 2026-08-21T14:06:30+0200 — MANDATE issued by ai-maestro-hub (min-approval-requirement: none).
  Tier-0 self-mandate: in-scope bugfix in this repo's own tree, reversible, no baseline or
  governance surface touched. Pre-approved; no approval request was sent.
