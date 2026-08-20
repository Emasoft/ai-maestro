---
trdd-id: 4QOWVSLU
title: Absorb the memory-guard Tier-1 OOM lane into the server
column: complete
created: 2026-08-19T15:01:29+0200
updated: 2026-08-20T21:26:59+0200
current-owner: hub-session-brrjk57p-phase2
created-by: hub-session-brrjk57p-phase2
assignee: hub-session-brrjk57p-phase2
task-type: feature
scope: project
min-approval-requirement: none
mandate: true
mandated-by: self
derived: true
derived-kind: npt
parent-trdd: KCRMSNL7
npt: []
eht: []
blocked-by: []
implementation-commits: [e30cf240]
project-id: ai-maestro
labels: [family-a, janitor-absorption, npt]
release-via: none
---

# Absorb the memory-guard Tier-1 OOM lane into the server

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-08-19 21:07

- **Lane: LANDED and LIVE in detect-only** — `lib/memory-guard.ts` (e30cf240), scheduler wired in
  `server.mjs` after cache-prune, 120 s. Verified by effect after `pm2 restart` 21:04: log line
  `[Startup] memory-guard scheduler started (120s, detect-only: AIM_MEMORY_GUARD not set)` at 21:06:55;
  liveness `sha` = `e30cf24071c5` (== HEAD); `absorbed_chores` UNCHANGED (no claim — correct, see below).
- **Flag: `AIM_MEMORY_GUARD=1` ARMS the kill** (default OFF). Unarmed = probe + truth table + log
  `would kill … [detect-only: AIM_MEMORY_GUARD not set]`; no stamp, no claim. Tunables:
  `AIM_MEMORY_GUARD_MIN_FREE_MB` (1024) · `AIM_MEMORY_GUARD_RUNAWAY_ETIME_S` (3600) ·
  `AIM_MEMORY_GUARD_ALERT_RSS_KB` (4 GiB) · `AIM_MEMORY_GUARD_INTERVAL_MS` (120000; 0 disables).
- **Claim follows arming, by construction**: `janitor-chore-stamp.ts` gained `CONDITIONAL_CHORES =
  ['memory-guard']` + `markChoreLive/unmarkChoreLive/activeAbsorbedChores()`; the liveness beat now
  publishes `activeAbsorbedChores()`. The scheduler marks the chore live ONLY when armed AND started,
  so the janitor daemon yields `memory-guard` in the same instant this server performs it. The
  stamp (`memory-guard.last-run.ts`, on attempt = pressure path reached) is written only when armed.
- **Box 3 — the arming decision is the USER's** (destructive lane). NEXT ACTION (USER): decide whether
  this server should run the Tier-1 guard in place of the janitor daemon's; if yes, add
  `AIM_MEMORY_GUARD=1` to `ecosystem.config.js` env and `pm2 restart ecosystem.config.js --update-env`
  (a plain `pm2 restart` replays the CACHED env — see lessons). Nothing else is required: arming
  claims the chore automatically. Until then the janitor's own guard keeps killing; ours only reports.
- **Tier 2: NOT implemented** — no code path, no flag (D1-c). `select_refused_alert` (S6) ported as
  alert-only with an in-process dedupe (the janitor keeps a seen-file; ours re-alerts once per restart).
- **Neuters (scripts/dev/neuter, restore verified by blob hash, 2026-08-19)** — each reds EXACTLY the
  test named: N1 null early-return disabled → 1 red `(D1-f) … NO-OP`; N2 loop over all candidates →
  1 red `(D1-e) … exactly ONE kill`; N3 claude-session clause disabled → 1 red `(D1-b, clause 3)`;
  N4 age gate disabled → 1 red `(D1-g)`; N5 protected pids disabled → 1 red `(D1-b) … protected`;
  N7 signature allowlist disabled → 1 red `(D1-a)` (the D1-b user-session test SURVIVES N7 via clause 3
  — that is the defense-in-depth claim, measured); N8 claim unconditional → 1 red `unarmed scheduler …
  NOT in activeAbsorbedChores()`; N6 `armed` inverted → 4 red (the two armed + two unarmed tests, as
  expected for a polarity flip). 20/20 + server-liveness 19/19 green at HEAD.
- **SUPERSEDED — do NOT carry forward**: "claim token added in the commit that makes the lane live"
  as a COMMIT-discipline rule for this chore — here the claim is a RUNTIME function of arming
  (`activeAbsorbedChores()`), which is the same rule made mechanical. `ABSORBED_CHORES` (the
  unconditional list) deliberately does NOT contain `memory-guard`.

Server-side reimplementation of janitor task_memory_guard (120s), carrying the
USER-SIGNED constraints (TRDD-7100178d Decision 1, 2026-05-31) VERBATIM: free-memory
probe; only under real pressure snapshot the process table TO A FILE; select the single
largest-RSS janitor-owned RUNAWAY via the Tier-1 truth table (signature allowlist +
protected pids + claude-session rejection + age gate); SIGTERM->SIGKILL; at most ONE kill
per beat; unknown reading = NO-OP. Tier 2 stays unimplemented — no code path, no flag.
DESTRUCTIVE => ships default-OFF behind its own flag. NEVER shells out to the janitor's
rolling cache (the 4OFMHOZ7 lesson).

The per-chore disposition table, the three cross-cutting axes (stamp+cadence contract,
claim-only-when-live, default-OFF destructive lanes), and the three measured incident
requirements live on the parent [[KCRMSNL7]] (DESIGN RESOLVED 2026-08-19 section) — read
that FIRST; this card does not restate it.

## Acceptance

- [x] truth table reimplemented server-side with every USER-signed constraint cited line-by-line against the janitor original — `lib/memory-guard.ts` header (D1-a…D1-h) + per-function `memory_guard.py:<lines>` / `daemon.py:<lines>` citations (e30cf240)
- [x] default-OFF flag (`AIM_MEMORY_GUARD=1`); one-kill-per-beat (N2) and no-kill-on-missing-data (N1) pinned by `tests/unit/memory-guard.test.ts` — neuters N1–N8 recorded in STATE
- [x] stamp + cadence contract honored (`memory-guard.last-run.ts` on attempt, armed only; 120 s = janitor roster); claim is a runtime function of arming (`activeAbsorbedChores()`), so it appears only when live — the ARMING itself is surfaced to the USER (STATE → NEXT ACTION) and is not this card's to decide

## Approval log

- 2026-08-19T15:01:29+0200 — MANDATE issued as Tier-0 self-mandate (derived NPT of [[KCRMSNL7]],
  server-internal, reversible, dark-shipped where destructive). No approval request sent.
- 2026-08-19T21:07:43+0200 — moved to human_review by hub-session-brrjk57p-phase2: lane landed + live detect-only (e30cf240), all three boxes satisfied on the engineering side; the USER-gated act is ARMING (`AIM_MEMORY_GUARD=1`), recorded as NEXT ACTION. Closes when the USER arms it or declines (then: complete as detect-only, janitor keeps the kill).
- 2026-08-20T21:26:59+0200 — COMPLETED by ai-maestro hub session under the USER's standing rule of 2026-08-20 (acceptance gate mechanically satisfied: 3/3 boxes checked).
