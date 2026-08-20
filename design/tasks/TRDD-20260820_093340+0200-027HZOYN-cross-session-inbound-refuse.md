---
trdd-id: 027HZOYN
title: crossSessionInbound refuse — the inbound half of the AMP-only harness lockdown
column: dev
created: 2026-08-20T09:33:40+0200
updated: 2026-08-20T09:42:09+0200
current-owner: ai-maestro-hub
created-by: ai-maestro-hub
task-type: security
scope: project
project-id: ai-maestro
priority: 1
min-approval-requirement: user
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-20T09:33:40+0200
implementation-commits: [556f340f]
---

# crossSessionInbound refuse — the inbound half of the AMP-only lockdown

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-08-20T09:33:40+0200

USER DIRECTIVE (2026-08-20, verbatim intent): to enforce the AMP-only governance rule,
ai-maestro must FORCEFULLY write into each agent workdir's `.claude/settings.local.json`:
`{"crossSessionInbound": "refuse"}`. This does NOT affect SendMessage for a session's OWN
sub-agents — that stays permitted. Deliverables the USER named: this TRDD + update the
golden requirements + the governance rules + the specs.

- **DONE before this card:** the OUTBOUND half — `permissions.deny: ["SendMessage"]` via
  the `amp-only-messaging` workdir invariant (556f340f, neuter-attributed, create/wake/
  periodic, self-repairing).
- **NEXT ACTION (implementation):** extend the SAME invariant row in
  `lib/agent-invariants.ts` to also enforce top-level `crossSessionInbound: "refuse"`
  (read → compare → editSettings set op; keep the union/no-churn/refuse-on-corrupt
  properties; update the 5 tests in tests/unit/agent-invariants.test.ts + neuter runs).
- **THEN (documents, in SPEC-FIRST order — the spec LEADS, the catalog follows,
  governance-spec.md frontmatter `authority` says so):**
  1. `design/specs/governance-spec.md`: add `R42.9` clause under GOV-R42
     (~line 1730s, after R42.8); bump `spec-version` 2.4.3 → 2.5.0 (MINOR: new rule),
     bump `updated:`, note in `reconciled-with`/changelog.
  2. `docs/GOVERNANCE-RULES.md`: add the R42.9 row to the R42 table (~line 1543, after
     R42.8), Source: Explicit (USER — 2026-08-20). Check its own version header + §0
     mirror list discipline; catalog v4.7.x bump.
  3. "Golden requirements": NO PRRD.md exists in this repo (verified — design/ has no
     requirements/ folder; the recommended baseline is a bootstrap that never ran).
     The IRON/USER-set marking on R42 IS this repo's golden tier. Record that reading in
     the reply to the USER; bootstrapping a PRRD is its own decision, not smuggled in here.
  4. Specs regen: gen-specs is header-driven and unaffected unless a CLI changes; the
     invariant is not a CLI. specs:check must stay green.
- **R42.9 text core:** inside the harness an agent's client-native cross-session
  messaging is structurally denied BOTH WAYS — outbound `permissions.deny: ["SendMessage"]`,
  inbound `crossSessionInbound: "refuse"` — both forcefully maintained in each agent
  workdir's settings.local.json by the amp-only-messaging invariant (create/wake/periodic,
  self-repairing; an agent that edits either back out is repaired on the next beat).
  EXPLICIT CARVE-OUT: a session's OWN sub-agents (the Agent tool, background subagents)
  are unaffected — the rule binds CROSS-SESSION edges only, because those are the edges
  the R6 graph governs.
- **Gotchas:** settings gate = lib/settings-gate editSettings (the ONE writer);
  refuse-on-unreadable (never rebuild from {}); the invariant tests inject nothing extra —
  extend the same 5 tests; the fleet prose sweep for the OUTBOUND half is already closed
  fleet-wide (8 surfaces + 6 members, 2026-08-20) — the inbound half needs a one-line
  relay to the same sessions, not a re-sweep.

## Acceptance

- [x] invariant enforces crossSessionInbound refuse; properties preserved; 22 tests green; neuter (inboundWrong=false) reddened exactly the 2 inbound tests, outbound tests stayed green
- [x] governance-spec.md R42.9 + spec-version 2.5.0 + reconciled-with entry (SPEC FIRST)
- [x] GOVERNANCE-RULES.md R42.9 row + v5.4.0 changelog; enforcement-map row added (the ratchet demanded it — its test caught the missing row immediately, working as designed)
- [ ] golden-requirements reading recorded (no PRRD.md exists; IRON/USER-set is the tier)
      and surfaced to the USER
- [x] specs:check green; enforcement ratchet 12/12; invariants 22/22; the 10 other governance reds in the full-dir run were 5000ms load-flake timeouts (0 assertions), the recorded contention signature
- [ ] fleet relayed the inbound half (one line to the swept sessions)

## Approval log

- 2026-08-20T09:33:40+0200 — MANDATE issued on direct USER instruction (mid-turn message, 2026-08-20):
  "ai-maestro must forcefully change the .claude/settings.local.json file inside each
  agent workdir, and add crossSessionInbound: refuse. Make a TRDD about this, and update
  the golden requirements, the governance rules and the specs." Sub-agent SendMessage
  explicitly still permitted. approval-judge: user (the directive IS the approval).
