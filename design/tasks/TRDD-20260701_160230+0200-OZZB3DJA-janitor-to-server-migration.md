---
trdd-id: OZZB3DJA
title: Migrate janitor functions into the ai-maestro server as script-wrapped APIs
column: backburner
created: 2026-07-01T16:02:30+0200
updated: 2026-08-16T16:43:45+0200
current-owner: main
assignee: main
priority: 5
severity: MEDIUM
effort: XL
labels: [janitor, server, architecture, api, subconscious, token-economy]
task-type: refactor
parent-trdd: null
npt: []
eht: []
blocked-by: []
supersedes: []
superseded-by: []
relevant-rules: []
release-via: none
delivery: pull-request
target-branch: main
feature-branch: null
test-requirements: [unit, integration]
audit-requirements: []
review-requirements: [human-review]
impacts: [public-api]
runtime-targets: [macos, linux]
external-refs: ["github.com/Emasoft/ai-maestro-janitor"]
---

# TRDD-OZZB3DJA — Migrate janitor functions into the ai-maestro server (script-wrapped APIs)

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-01

- **Status:** DESIGN CAPTURE ONLY — NOT started. Parked in `backburner`. This is a
  future task the USER said "you will be tasked with" AFTER the janitor's functions
  are finalized + tested. Do NOT begin implementation until the gate below clears.
- **GATE (external, not a TRDD blocker):** the janitor's own Claude is finalizing +
  testing the janitor functions RIGHT NOW (2026-07-01). Only once that work is
  COMPLETE and VERIFIED-WORKING does this migration start. Coordinate via the janitor
  repo / the janitor's Claude (GitHub).
- **Origin:** USER directive 2026-07-01 (during the cross-client conversion planning).
  The janitor is EXCLUDED from the plugin client-conversion program (TRDD-S4YA67F5)
  because it is being REPLACED by this server-side migration, not ported.
- **NEXT ACTION (when the gate clears):** inventory the finalized janitor
  functions/commands → partition each as DETERMINISTIC (→ ai-maestro server code) vs
  NEEDS-AGENT-INTELLIGENCE (→ stays a subconscious background-agent task) → design the
  server API surface + the script-wrapper layer → implement + test → thin the janitor
  plugin down to script calls.
- **Load-bearing facts:**
  - ai-maestro UPSTREAM (before this branch's PR) ALREADY has a working **subconscious
    system of background agents** doing chores. This migration EXPANDS on it — it does
    NOT build a background-worker system from scratch. Server code takes over the parts
    that need no agent intelligence; agents keep only the parts that do.
  - **Decoupling invariant (CLAUDE.md "Plugin Abstraction Principle"):** plugins MUST
    NOT call `/api/...` directly. Every janitor→server call goes through a CLI **script**
    in `~/.local/bin/` (owned by + shipped from the ai-maestro repo), exactly like
    `aimaestro-*.sh` / `amp-*.sh` / `aid-*.sh`. The janitor becomes a thin wrapper of
    those script calls.
  - **Why:** the janitor's per-heartbeat model is an agent TURN every ~5 min — a
    standing token cost on every session. Moving the deterministic chores to server
    code eliminates that cost; the heartbeat becomes cheap server work, and agent
    turns fire only for genuinely-intelligent editorial passes.

## Goal

Replace the janitor plugin's agent-driven heartbeat + per-skill logic with
**ai-maestro server functionality**, exposed to the janitor (and any plugin) through
the existing **script abstraction layer**. Net effect: the janitor collapses to a thin
set of script calls; the deterministic guardian work runs as server code / the existing
subconscious background system; per-heartbeat token cost goes to ~zero.

## Motivation

- **Token economy:** the current janitor heartbeat is a recurring `CronCreate` that
  fires a fresh agent TURN every few minutes in every session — a permanent per-session
  token drain, even when nothing needs doing.
- **Right tool for the job:** most janitor chores (drift detectors, supply-chain /
  security scans, branch-protection baseline, credential-window audit, config lint,
  fork-PR cache audit) are DETERMINISTIC — they need code, not an LLM. Only the memory
  editorial passes (split / consolidate / conflict / repair / atomize / harvest) and a
  few judgment calls need agent intelligence.
- **Single home:** ai-maestro is the server that already owns agent state, the registry,
  teams, and a background subconscious. The guardian logic belongs there, not in a
  per-session cron.

## Design (to be detailed when the gate clears)

1. **Inventory** every finalized janitor function/command/skill (from the janitor repo,
   post-finalization) — do NOT design against today's janitor; wait for the finalized set.
2. **Partition** each into:
   - **Deterministic → ai-maestro server code** (a server module + a background-tick in
     the existing subconscious scheduler). Examples (subject to the finalized inventory):
     drift/security detectors, dependency/supply-chain watch, branch-protection baseline
     re-apply, credential-window audit, config lint, fork-PR cache audit, trashcan purge.
   - **Needs agent intelligence → stays a subconscious background AGENT task** (the
     existing `janitor-memory-subconscious-agent` pattern). Examples: the wikimem
     editorial passes, conflict resolution that requires reading + judgment.
3. **Server API surface:** one endpoint per migrated function (naming mirrors the janitor
   verb), served in BOTH full + headless modes (per the headless-router parity rule).
4. **Script abstraction layer (MANDATORY):** for each API, a CLI script in the ai-maestro
   repo (installed to `~/.local/bin/`, e.g. `aimaestro-janitor-*.sh`) that wraps the call.
   Plugins/hooks call the SCRIPT, never the API — decoupling invariant.
5. **Thin the janitor plugin:** its skills/hooks become wrappers over those scripts; the
   agent heartbeat is reduced to (or replaced by) a cheap server tick, with agent turns
   reserved for the intelligence-required passes only.
6. **Cutover + parity tests:** prove each migrated function behaves identically to the
   janitor original before removing the janitor's own implementation.

## Constraints

- **Cross-repo:** ai-maestro server + scripts = THIS repo (edit directly). The janitor
  plugin = a SEPARATE repo (`Emasoft/ai-maestro-janitor`) → coordinate/PR, never edit its
  source from here (cross-project rule).
- **Decoupling invariant:** no plugin element calls `/api/...` directly — scripts only.
- **Headless parity:** every new API works in both full and headless server modes.
- **Fail-fast:** server chores propagate errors; no silent fallbacks.
- **Commit-only until USER approves a push** (ai-maestro is the app, USER-gated).

## Acceptance

- [ ] The finalized janitor function inventory (post the janitor repo's finalization) is read and each function is partitioned as deterministic vs needs-agent-intelligence, per §Design step 2.
- [ ] Each deterministic janitor function has an ai-maestro server equivalent (server module + subconscious-scheduler tick), and each intelligence-required function stays a subconscious background-agent task.
- [ ] Every migrated function is reachable ONLY through a CLI script in `~/.local/bin/` (e.g. `aimaestro-janitor-*.sh`) — no plugin/hook calls `/api/...` directly, per the decoupling invariant.
- [ ] Each new server API is verified working in BOTH full and headless server modes (headless-router parity).
- [ ] Parity tests exist and pass showing each migrated function behaves identically to its janitor original.
- [ ] After cutover, a real janitor heartbeat cycle shows zero per-heartbeat agent turns fired for the migrated deterministic chores — confirmed by a human reading a live session's turn log.

## Open questions (resolve when the gate clears)

- Exact finalized janitor function inventory (wait for the janitor's Claude to finish).
- The precise deterministic-vs-intelligence partition per function.
- Scheduler: extend the existing subconscious tick, or a dedicated guardian scheduler?
- How the janitor plugin is thinned without breaking existing installs (migration path).
