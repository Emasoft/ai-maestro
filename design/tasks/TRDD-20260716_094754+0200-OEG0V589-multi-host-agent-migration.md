---
trdd-id: OEG0V589
title: Cross-host agent migration — export bundle + dual-MANAGER approval + automated transfer (R44)
column: planned
created: 2026-07-16T09:47:54+0200
updated: 2026-08-16T16:48:46+0200
current-owner: opus-governance-rules-session
task-type: feature
relevant-rules: [43, 44, 35, 5, 37]
min-approval-requirement: user
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-16T09:47:54+0200
labels: [multi-host, transition-phase]
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-16

**Born approved, NOT started.** USER 2026-07-16: *"we are in a transition phase, so author all
those TRDDs, but wait to implement them."* This is the implementation TRDD for **R44** (committed
`bf70bf47`, GOVERNANCE-RULES v4.4.0). **DO NOT implement** — `column: planned`, held until the
USER lifts the transition-phase hold.

**NEXT ACTION when unheld:** design the `MigrateAgentCrossHost` pipeline in
`services/element-management-service.ts` on top of the existing cross-host governance-request rail
(`app/api/v1/governance/requests/*`, `approveCrossHostRequest`, `lib/manager-trust.ts`,
`lib/governance-peers.ts`) — do NOT invent a second peer channel.

**Load-bearing facts:**
- The bundle (R44.1) is FOUR parts: conversation JSONL (`~/.claude/projects/<slug>/*.jsonl`),
  workdir extensions (`~/agents/<name>/.claude/` local plugins/skills), any Docker container the
  agent manages, and the zipped workdir (`~/agents/<name>/`).
- Dual approval (R44.2/3): BOTH the source and destination MANAGER approve, each under its own
  MAESTRO's authority (R37.1). Only then do the two servers permit start.
- The destination accepts the arriving agent as FOREIGN (R44.4 → R35): its AID is admitted via the
  R35 MAESTRO-approval + signed-ledger path (`lib/foreign-approval-registry.ts`,
  `types/foreign-approval.ts`, `lib/aid-ledger-authority.ts`). R35 enforcement is behind
  `ledger.enforceAidAssociation` (security config, **default OFF**) — migration must work in both
  states.
- DISTINCT from R5 (R44.5): R5 = same-host team move (COS-approved); this = cross-host
  (dual-MANAGER-approved). Do not conflate the pipelines.

## Problem

R44 declares every agent relocatable, but there is no cross-host migration path today. An agent
is pinned to one host's `registry.json` + `~/agents/<name>/` workdir + `~/.claude/projects/<slug>/`
transcript (which is path-bound — TRDD-1ee4a3c1). R5 moves an agent between teams on the SAME host;
nothing moves an agent between hosts.

## Approach (design sketch — detail at implementation)

1. **Export bundle (R44.1).** A packager assembles the four-part bundle into a single transferable
   archive + a manifest (agent id, AID public key, source host id, checksums).
2. **Dual-MANAGER approval handshake (R44.2/3).** New cross-host request type `agent-migration` on
   the existing peer rail. Source MANAGER initiates; destination MANAGER must also approve; the two
   servers gate `permit-start` on BOTH approvals. Reuse `approveCrossHostRequest` +
   `lib/manager-trust.ts` (trusted-MANAGER table) + `lib/governance-peers.ts`.
3. **Automated transfer (R44.3).** Source freezes/hibernates the agent → transfers the bundle to
   the destination server over the Tailscale peer channel → destination imports (unzips workdir,
   places transcript, installs extensions, re-homes the container) → destination activates →
   source tombstones (cemetery soft-delete, never hard). Atomic handoff so a partial transfer
   never leaves the agent live on both hosts or lost on neither.
4. **Foreign accept (R44.4 → R35).** Destination admits the AID via the R35 path (MAESTRO approval
   + signed-ledger association). Works with `enforceAidAssociation` ON or OFF.

## Verification
- Round-trip: export→transfer→import preserves conversation, workdir files, local extensions, and
  (if present) the managed container.
- A single MANAGER approval does NOT permit start (both required).
- Destination R35 gate fires (with enforcement ON) / no-ops cleanly (OFF).
- New `interhosts: true` scenario (SCEN-0NN) drives the full migration through the UI.
- §0 mirror-sync: GOVERNANCE-RULES R44 (built), `docs/API-CHANGES.md`, comm-graph unchanged.

## Estimated risk
HIGH. Moves live agent state across hosts; a non-atomic handoff orphans or duplicates an agent, and
the transcript is path-bound today (TRDD-1ee4a3c1 Phase 4 is a prerequisite for lossless transcript
portability). Depends on the cross-host peer rail + R35 ledger.

## Rollout cohort — multi-host governance (R43-R48), transition phase
Authored together 2026-07-16 as `planned` (implementation HELD). Siblings:
TRDD-W9FA6ACZ (ASSISTANT role-plugin, R39) · TRDD-QR9FSL3Q (cross-host groups, R45) ·
TRDD-HR8CES7H (VPN-unique usernames, R47) · TRDD-40CUZA1Z (unified sidebar, R46) ·
TRDD-PLOVIPZE (MAESTRO console gates, R48) · TRDD-OC9ELGSO (Tailscale HTTPS + per-host RP_ID —
transport/identity substrate, task #40). §0 mirror-sync rides each TRDD's Verification
(staged-rollout: the doc mirrors update as each behavior ships).

## Acceptance
- [ ] `MigrateAgentCrossHost` pipeline built on the existing cross-host governance-request rail
      (`app/api/v1/governance/requests/*`, `approveCrossHostRequest`, `lib/manager-trust.ts`,
      `lib/governance-peers.ts`) — no second peer channel invented.
- [ ] Export bundle packages all FOUR parts (conversation JSONL, workdir extensions, managed
      Docker container if present, zipped workdir) plus a manifest (agent id, AID public key,
      source host id, checksums).
- [ ] Dual-MANAGER approval enforced: a single MANAGER approval does NOT permit start; both
      source and destination MANAGER approvals are required before transfer begins.
- [ ] Round-trip verified: export→transfer→import preserves conversation, workdir files, local
      extensions, and (if present) the managed container.
- [ ] Destination R35 foreign-accept gate fires correctly with `enforceAidAssociation` ON and
      no-ops cleanly with it OFF.
- [ ] New `interhosts: true` scenario (SCEN-0NN) drives the full migration through the UI.
- [ ] §0 mirror-sync done: GOVERNANCE-RULES R44, `docs/API-CHANGES.md`, comm-graph confirmed
      unchanged.

## Approval log
- 2026-07-16T09:47:54+0200 — MANDATE issued by USER (min-approval-requirement: user).
  Pre-approved: issuer authority >= required approver. Verbatim: *"author all those TRDDs, but wait
  to implement them."* No approval request was sent. Implementation HELD (transition phase).

## Notes and lessons learned
