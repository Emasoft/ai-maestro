---
trdd-id: 5ADHOZE4
title: Measure whether the scopedOnly fallback can flap against the janitor rotator
column: todo
created: 2026-08-22T17:52:41+0200
updated: 2026-08-22T17:52:41+0200
current-owner: user
created-by: user
task-type: audit
min-approval-requirement: manager
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-22T17:52:41+0200
---

# Measure whether the scopedOnly fallback can flap against the janitor rotator

## Problem
`TRDD-DPPYVLVH`'s `scopedOnly` fallback was ratified 2026-08-22 on the grounds that
`isSafeAlternate` is UNCHANGED (verified byte-identical at `lib/oauth-rotator/tick.ts:489`), so the
janitor's `rotator.py` still mirrors the same predicate and no coordination is required.

That is true of the PREDICATE and not of the BEHAVIOUR. Under total scoped exhaustion the hub now
rotates onto a `scopedOnly` account (`:1143` / `:1207` / `:1240`) where `rotator.py` reports
paralysis. The ratifying ruling reasoned that an abstain cannot fight an act, so the two cannot
flap — **that is an inference, not a measurement**, and it was recorded as such rather than
asserted.

It matters because the hub tick is NOT dark: `~/.aimaestro/oauth-rotator-tick.enabled` exists
(2026-07-29) and `oauth-rotator-tick-status.json` was being written minutes before this card was
authored. Measured live at that moment: `nextAction: reauth-needed`, `reason: refresh-dead`,
`stuck: all-maxed`, windows 5h 23% / 7d 99% / Fable 100% — i.e. exactly the exhaustion regime in
which the fallback engages.

## ⚠ NARROWED before it was committed — `DPPYVLVH` already answers half of this

Authoring this card I had read `DPPYVLVH` lines 91-120 and 160-232 but **not 121-140**, which
answer the "is it live here?" half outright:

> *"the divergence risk this card cites is not live on this host — the janitor daemon EXITS while a
> server owns the host (`global_state.py::ensure_daemon_running`), so its `rotator.py` is not
> running here. That makes the coordination a FOLLOW-UP, not a precondition."*

That is a partial-read on my part, and it is exactly the trap already recorded in
`.claude/rules/lessons-verification.md`: never read a section through a window and reason from it
as though it were the whole. Recorded rather than quietly deleted, because a card that silently
re-asks an answered question wastes the next reader's time in a way nothing detects.

## What is left to measure — genuinely open

1. **Does `rotator.py` ever rotate AWAY from a live account it deems unsafe, or only decline to
   rotate ONTO one?** Unanswered anywhere. If it only declines, the no-flap inference holds
   universally and this closes on that one citation. Answer with `file:line` from `rotator.py`.
2. **Verify the exit mechanism rather than inherit it.** `DPPYVLVH`'s claim above is second-hand
   here; confirm `global_state.py::ensure_daemon_running` really does exit while a server owns the
   host, since the whole no-divergence-on-this-host argument rests on it.
3. **It still matters off this host.** The fleet is multi-host; a host where the janitor daemon
   DOES own rotation has both policies live, and (1) is what decides whether that can flap.

## Verification
A written answer to (1) citing `rotator.py` by `file:line`, plus a statement of which rotator is
live on this host. No code change unless (1) shows the janitor can rotate away.

## Approval log

## Approval log

- 2026-08-22T17:52:41+0200 — MANDATE issued by user (min-approval-requirement: manager). Pre-approved: issuer authority >= required approver. No approval request was sent.
