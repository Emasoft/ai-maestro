---
trdd-id: 5ADHOZE4
title: Measure whether the scopedOnly fallback can flap against the janitor rotator
column: complete
created: 2026-08-22T17:52:41+0200
updated: 2026-09-05T21:14:18+0200
current-owner: user
created-by: user
task-type: audit
min-approval-requirement: manager
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-22T17:52:41+0200
assignee: ai-maestro-hub-session
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
- 2026-09-05T21:06:25+0200 — investigation complete by ai-maestro-hub-session; see ## Findings; column left for the coordinator to decide
- 2026-09-05T21:13:56+0200 — investigation answered on the card by ai-maestro-hub-session: is_safe_alternate only gates which alternate to land ON, never the decision to leave the live account; janitor CANNOT rotate away from a live account it deems unsafe; residual chore-ownership flap split to TRDD-OUAQARPL
- 2026-09-05T21:14:18+0200 — COMPLETE by ai-maestro-hub-session. investigation answered on the card; residual flap finding split to TRDD-OUAQARPL.

## Approval log

- 2026-08-22T17:52:41+0200 — MANDATE issued by user (min-approval-requirement: manager). Pre-approved: issuer authority >= required approver. No approval request was sent.

## Findings

1. rotate-AWAY trigger (ai-maestro-janitor/3.4.14/scripts/oauth_rotator/rotator.py:1988-2028) is decided solely from the LIVE account's own signal (429 streak, 401/403, local expiry, is_near_limit, burn_gate, model_fallback_verdict) — is_safe_alternate (ai-maestro-janitor/3.4.14/scripts/oauth_rotator/rotator.py:1727-1730) is never consulted there.
2. is_safe_alternate is called ONLY inside the candidate-filter loop (ai-maestro-janitor/3.4.14/scripts/oauth_rotator/rotator.py:2170) to decide whether to rotate ONTO a given alternate; when no candidate passes it, the function returns 0 and STAYS on the current live account (ai-maestro-janitor/3.4.14/scripts/oauth_rotator/rotator.py:2029-2031, 2239-2246, 2222-2229) — it never triggers an away-move.
3. Therefore rotator.py can only DECLINE to rotate onto an unsafe alternate; it cannot rotate AWAY from a live account it deems unsafe on the strength of an alternate's unsafety. DPPYVLVH's no-flap inference on this axis holds.
4. Exit mechanism verified, and it is NARROWER than DPPYVLVH stated: ai-maestro-janitor/3.4.14/scripts/daemon.py:3454 exits the whole daemon only when harness_backend.server_owns_every_chore() is True, i.e. the server has claimed EVERY name in GLOBAL_CHORES (ai-maestro-janitor/3.4.14/scripts/lib/harness_backend.py:97-131), not merely 'a server owns the host'.
5. On THIS host the daemon does NOT exit: heartbeat fresh (57s old at check time), because unclaimed chores remain (gh-notify-inbox, session-liveness, integrity-repin, oauth-recovery, rules-cleanup absent from server-liveness.json capabilities). Instead it YIELDS oauth-rotator-tick/oauth-rotator-supervisor per-task via _task_yielded_to_server (ai-maestro-janitor/3.4.14/scripts/daemon.py:2973-2979), gated on harness_backend.claimed_chores().
6. Historical residual risk found, not asked for: daemon.log shows the janitor's OWN 'oauth-rotator-tick' task actually RUNNING interleaved with 'yielding to active ai-maestro server' lines between 15:01 and 19:18 today (e.g. lines 8791-8827, 9761-9990) — i.e. claimed_chores() intermittently reported empty (stale/restarted server-liveness.json) and the janitor briefly ran its own tick during a server-live window. Since 19:19:17 the daemon has yielded continuously (no further janitor-run tick through the 21:04 check).
7. That interleaving is a chore-OWNERSHIP flap (who runs the tick), not a rotation-DECISION disagreement — both rotators share the same is_safe_alternate predicate (DPPYVLVH), and ai-maestro-janitor/3.4.14/scripts/oauth_rotator/rotator.py:71,3055 note a machine-wide 'rotator-tick single-writer flock' guarding the keychain write, so a same-moment double-run cannot corrupt state; it can at most run the identical decision twice.
Live rotator on this host (2026-09-05T21:04+0200): the SERVER (lib/oauth-rotator/tick.ts) currently owns and runs oauth-rotator-tick/oauth-rotator-supervisor — evidence: pm2 'ai-maestro' online; ~/.aimaestro/server-liveness.json ts=1788635069 (21s old, inside the 90s staleness window), capabilities/absorbed_chores both list oauth-rotator-tick and oauth-rotator-supervisor; ~/.aimaestro/oauth-rotator-tick-status.json freshly written (2026-09-05T19:04:14.357Z at read time, hub tick alive per TRDD prose too). The janitor daemon is ALSO alive on this host (not exited — GLOBAL_CHORES not fully claimed) but is currently yielding the oauth-rotator chores to the server, per ai-maestro-janitor/3.4.14/scripts/daemon.py's global-state/daemon.log continuous yield lines since 19:19:17+0200.
- Verdict: CANNOT rotate away from a live account it deems unsafe — is_safe_alternate gates only which alternate to land ON, never the decision to leave the current one; code change not needed. (Separately: the chore-ownership handoff itself flaps over hours on this host, guarded only by the shared write-flock, not by the exit/yield logic — worth a follow-up TRDD if the owner wants ownership itself to stop oscillating, but out of scope for this card's question.)

## Acceptance

- [x] Answered on the card: is_safe_alternate only filters which alternate to land ON (rotator.py:2170); the rotate-AWAY decision is the live account's own health (rotator.py:1988-2028); the janitor CANNOT rotate away from a live account it deems unsafe; server rotator live on this host; the residual ownership flap is TRDD-OUAQARPL
