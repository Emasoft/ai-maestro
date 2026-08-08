---
trdd-id: 17K0SHDQ
title: Close ai-maestro#46 — the four remaining work items after the 2026-08-08 defect map
column: dev
created: 2026-08-08T15:19:13+0200
updated: 2026-08-08T15:35:00+0200
current-owner: ai-maestro-hub
assignee: ai-maestro-hub
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: self
project-id: ai-maestro
labels: [amp, identity, fleet-blocker]
external-refs: [ai-maestro#46, ai-maestro#40, ai-maestro#47]
blocked-by: []
---

# Close ai-maestro#46 — the four remaining work items

Evidence base: `reports/fleet-audit/20260808_151552+0200-46-amp-identity-collision.md` (the
full defect map — 18 issue comments enumerated, every resolver read whole, live on-disk
collision measured). Most of #46's machinery is ALREADY fixed and deployed (resolver ladder
P2.5/P3.5, reachable self-heal, hardened P4 refusal, `/api/v1/agents/me` auth fallback —
`6c6b75b4`, `1af95d49`, `ae3414f4`, `439984f9`; `~/.local/bin/amp-helper.sh` byte-identical
to the repo). What remains is exactly four items.

## Ruling that scopes the card

**The P4 refusal the peers keep hitting is the guard WORKING** — AMOA/AMAA run in plugin-dev
repos (`~/Code/...`), not registered `~/agents/<name>/` workdirs, so "Multiple AMP agents
found" on their sessions is correct behavior (issue comments #8/#9 already reached this
consensus; MANAGER accepted it as a launch-day gate). Their unblock is item 4 (a validation
recipe), NOT a resolver change.

## Work items

- [ ] **W-A — non-destructive address-heal sweep.** The `load_config()` self-heal is
      reactive; 26/64 on-disk configs still share the byte-identical address
      `ai-maestro@emasoft.aimaestro.local` (measured 2026-08-08, report §4) because dead/stale
      agents are never used again. Ship `scripts/heal-amp-addresses.sh`: walk
      `~/.agent-messaging/agents/*/config.json`, repair `.agent.address` local-part to the
      registered name using the SAME logic as the fixed self-heal (preserving `id`/`createdAt`
      — the `save_config` regression class from `6c6b75b4` must not recur), report every
      change, DELETE NOTHING (orphan GC is a separate decision, not this card). Idempotent;
      second run reports zero changes.
- [ ] **W-B — kill silent first-match-wins in `_resolve_agent_id`.** Duplicated byte-identically
      in `aimaestro-panel.sh:102-117`, `aimaestro-session.sh:134-`, `aimaestro-continuity.sh:65-`;
      all take `agents[0].id` from an UNSORTED substring search (`lib/agent-registry.ts::
      searchAgents:1236-1251`) with zero ambiguity handling. Fix: extract ONE shared helper
      (sourced), resolution order = UUID-shape → exact-name match (unique) → if multiple
      substring matches and no unique exact match, HARD FAIL listing candidate NAMES (never
      uuids — the `1af95d49` lesson). Also satisfies TRDD-COOLOZ1N hub box 4. Pin with tests
      driving 0/1/N-match cases; falsify by restoring `agents[0]` and observing the red.
- [ ] **W-C — role→name resolution.** MAINTAINER's comment #13 gap: "send to the MANAGER on
      this host" has no deterministic answer; zero `governanceTitle`-aware lookups exist in
      `scripts/*.sh`. Add a `?title=<governance-title>` filter to `GET /api/agents` (registry
      already stores it) + a resolver flag; refuse on 0 and on >1 (two MANAGERs is a
      governance anomaly to surface, never to pick from).
- [ ] **W-D — the fleet validation recipe.** Document (on #46, closing it) how a plugin-dev
      session validates kanban ops against a live board: through a REGISTERED test agent
      session (`~/agents/<scen-fixture>/`), never by exporting identity env vars from a dev
      repo (that is the impersonation shape the P4 guard exists to refuse). Notify AMOA
      (#24/#26) and AMAA (#7/#26) with the recipe when it lands.

## Acceptance

- [x] W-A shipped (`d84249c9`), run once on this host: collision 26 → 0, second run 0 changes,
      apply log in reports/fleet-audit/ (2026-08-08T15:28+0200)
- [x] W-B shipped (`3eed6091`): one shared helper in `shell-helpers/common.sh:327`, 3 call
      sites converted, 7 tests green run by the hub, neuter red d/e/f recorded in the test
      file; deployed to `~/.local/share` + `~/.local/bin` copies with timestamped backups
      and verified on the installed copies (2026-08-08T15:32+0200)
- [ ] W-C shipped: title filter + resolver flag, 0/1/N pinned (deferred — feature, nobody
      blocked; machine burn was ~$480/hr at decision time, 2026-08-08T15:30+0200)
- [ ] W-D posted on #46 ✓ and #46 CLOSED ✓ (comment 5226325800); AMOA and AMAA notified.
      AMAA named its remaining blocker precisely (2026-08-08T15:45+0200): the live round-trip
      needs (1) a registered TEST agent on shared fleet infrastructure and (2) the ops run
      from THAT agent's server-spawned session — neither is a peer's to create unilaterally,
      and AMAA correctly refused to write shared state on a peer's say-so. AMAA also VERIFIED
      the new refusal text deployed (quoted it back verbatim) and correctly declined the
      AMP_HOST=1 circumvention. **CLOSURE PLAN (hub-owned): the hub spawns a short-lived
      registered probe agent (`~/agents/kanban-validation-probe/`), runs AMAA's exact op
      sequence (op-create-kanban-epic.md / op-query-kanban-progress.md — AMAA hands it over),
      both sides verify board state, then the probe is deleted through the full DeleteAgent
      pipeline + cemetery purge (scenario Rule 1 discipline). Execution deferred to a quieter
      machine window (burn ~$480/hr at decision time) and a fresh hub context — the run is a
      real orchestration, not a tail-of-session errand.**
      AMOA accepted the plan (2026-08-08T16:00+0200) and RETRACTED its #40 prerequisite —
      self-caught stale claim; hub-verified: `types/team.ts:36` carries the 17-column default
      (14 lifecycle + 3 exception, sync-pinned to `DEFAULT_STATUSES`), and the CLI enumerates
      the same 17. **The surviving concern becomes the probe's own test, not a delay: a CLI
      that ACCEPTS 17 and a server that COERCES on persist look identical until read-back.**
      PROBE TEST PLAN (AMOA-authored, adopted): P1 create card with `TRDD-<id8>` in the title →
      P2 the discriminating walk design→dispatch→ai_review→live_auditing→blocked→dev with a
      read-back after EACH move — ASSERT-DISTINCT (six read-backs must be six different
      strings; any collapse is the coercion FINDING, never a pass) + ASSERT-REJECT
      (`not_a_column` must fail, else every accept is vacuous) → P3 the ORCH half via
      `amoa_kanban_manager.py::update_task_status` with the TRDD write-through verified by
      `read_column` AND `zone_for_column` vs the file's actual folder (a zone-crossing move
      must have `git mv`'d it) + ASSERT-AUTHORITY (`published` from an ORCH identity must
      RAISE) → P4 teardown (card, then probe, full pipeline). Report: per phase, exact
      command + exact read-back — "all green" without the six quoted read-backs is not a
      verifiable result. AMOA runs the ORCH half given the task-id if the probe has no
      checkout. SIDE HAZARD to carry forward: the registry does not mark fixture vs live
      agents, so amp-identity guidance path (1) invites picking a live agent's workdir by
      mistake — surface when the probe lands.

## Approval log

- 2026-08-08T15:19:13+0200 — MANDATE (self, Tier-0): hub-owned server/CLI repair, in-scope,
  reversible; the one guard-relevant ruling (dev-session P4 is correct) restates the consensus
  already recorded on the issue (#8/#9).
