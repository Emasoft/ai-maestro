---
trdd-id: JBFM8XR0
title: Absorb the fleet-plugins-update chore into the server
column: human_review
created: 2026-08-19T15:01:29+0200
updated: 2026-08-20T00:57:26+0200
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
implementation-commits: [f048f9ae, e9b1ba5e]
project-id: ai-maestro
labels: [family-a, janitor-absorption, npt]
release-via: none
---

# Absorb the fleet-plugins-update chore into the server

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-08-20 00:58

- **Reload gap → CLOSED via the janitor-NAMED contract (e9b1ba5e, 2026-08-20).** The body's
  "reload gap, stated not hidden" note below is SUPERSEDED: the janitor peer named the contract
  themselves — the server writes `~/.aimaestro/state/plugins-updated.json`
  (`{updated_at_epoch (SECONDS), updated[], by: "fleet-plugins-update", count}`, atomic
  temp+rename, overwritten only on NON-empty sweeps) and THEIR dispatcher compares the epoch to
  its own last-consumed stamp and surfaces `[janitor-reload]`. Neither side writes the other's
  files. Producer = `lib/plugins-updated-signal.ts`, kept OUT of the lane module so the
  zero-fs-write-primitives scan property survives; call sits in `runFleetPluginsUpdate`
  (injectable `signal` dep — beat is unexported, a text-grep pin would be vacuous). Neuters:
  wiring dropped → 1 red exactly; empty-sweep gate dropped → 1 red exactly (both blob-verified
  restores). Semantics are the janitor original's own (fleet_plugin_updates.py:206 bumps reload
  on a non-empty exit-0 result; their dispatcher dedupes on epoch).
- **Lane LANDED, LIVE, and CLAIMED** — `lib/fleet-plugins-update.ts` (f048f9ae), scheduler in
  `server.mjs` after memory-guard, 6 h (roster cadence; janitor stale bound 3×). Verified by
  effect after `pm2 restart`: startup line 00:47:23; liveness `sha == HEAD`; `absorbed_chores`
  now carries `fleet-plugins-update` (7 names) — the janitor yields it on its next daemon cycle.
  **First live sweep MEASURED 00:48:21: `15 plugin(s) updated across the fleet`** — precisely the
  no-live-session population the janitor module was written for — and the stamp advanced
  (1787179082, the janitor's own last run → 1787179701, ours).
- **The 3 incident requirements, cited (box 1):** all three live in the module header
  (`lib/fleet-plugins-update.ts:16-33`) with the code site for each — (1) atomic cache
  population: the lane's ONLY mutation channel is the `claude plugin update` subprocess
  (`updateTarget`), zero fs write primitives in the module, pinned by the source-scan test with
  a positive control; (2) quarantine: the lane deletes/moves NOTHING (same scan), and the header
  states where a future parking lot must not live; (3) root resolution: `registryPath()` =
  `os.homedir()/.claude/plugins/installed_plugins.json` explicitly (never `__dirname` — the
  ZM5LZ24Y shape), both settings roots stated.
- **Neuters (scripts/dev/neuter, blob-verified restores, 2026-08-20):** cwd dropped → 1 red
  exactly (`… with cwd=<projectPath>` — proven through a REAL shim subprocess printing its own
  cwd, not a mocked execFile); truthy-instead-of-exactly-true → 1 red; silent cap → 1 red;
  stamp-only-on-success → 1 red (stamp-on-attempt); dead-path filter → 0 red BY MEASUREMENT and
  recorded in the test: a non-directory project cannot pass the enabled gate either, so the
  filter is defense-in-depth (named, kept).
- **Litter caught in the same pass:** two NUL bytes materialized in the dedupe-key template
  literal at byte offset 9081 — past git's 8000-byte binary sniff, so the diff looked clean and
  only a later grep's "Binary file matches" exposed it (the lessons-file class, opposite-symptom
  variant). Purged byte-for-byte, amended before anything shipped.
- **Reload gap, stated not hidden:** updated plugins go live only when each session reloads; the
  janitor daemon signalled that via ITS reload-needed.flag, which we must not write (their data
  dir). Parity: our lane logs the count; the sessions' own heartbeat surfaces reloads. If the
  fleet wants a server-side reload signal, that is a NEW card, not this one.
- **NEXT ACTION (USER, closing gate):** none — the lane ships ON (non-destructive) and its first
  sweep is measured. Parked in human_review for the USER's routine review only.

Server-side absorbed lane for per-agent local-scope plugin updates across the registered
fleet (janitor task_fleet_plugins_update, 21600s). The server owns the registry and the
workdirs, so it is the natural owner. ALL THREE measured incident requirements apply
verbatim: atomic cache population (staging dir + rename — the 4OFMHOZ7 hook-blackout is
the acceptance scenario), quarantine outside every scanned tree, explicit cache-parent
root resolution stated in code comments (the ZM5LZ24Y month-dead lesson).

The per-chore disposition table, the three cross-cutting axes (stamp+cadence contract,
claim-only-when-live, default-OFF destructive lanes), and the three measured incident
requirements live on the parent [[KCRMSNL7]] (DESIGN RESOLVED 2026-08-19 section) — read
that FIRST; this card does not restate it.

## Acceptance

- [x] lane implemented server-side with the 3 incident requirements demonstrably honored — cited in STATE (module header lines 16-33 + the code site per requirement)
- [x] completion stamp written via janitor-chore-stamp each run (`stampChoreRun('fleet-plugins-update')` on attempt); cadence 6 h = the roster's own, well inside the 3× stale bound
- [x] claim token 'fleet-plugins-update' added to ABSORBED_CHORES in f048f9ae — the same commit that wires the scheduler; measured live in `absorbed_chores` at 00:47
- [x] one pinning test per requirement, in the shape this lane actually has: req 1+2 = the no-writer source scan (this lane stages nothing and quarantines nothing — the CLI owns the cache transaction; scan carries a positive control), req 3 = the registryPath home-anchor test; plus the cwd fix itself through a real subprocess

## Approval log

- 2026-08-19T15:01:29+0200 — MANDATE issued as Tier-0 self-mandate (derived NPT of [[KCRMSNL7]],
  server-internal, reversible, dark-shipped where destructive). No approval request sent.
- 2026-08-20T00:48:40+0200 — moved to human_review by hub-session-brrjk57p-phase2: lane live+claimed (f048f9ae), all boxes satisfied; parked for USER review only (ships ON, nothing USER-gated).
