---
trdd-id: DXJZM3BW
title: Continuity CLI surface — aimaestro-continuity.sh status + ensure-resume behind the frozen layer
column: testing
created: 2026-07-16T20:06:24+0200
updated: 2026-08-02T02:06:00+0200
current-owner: ai-maestro
task-type: feature
scope: project
min-approval-requirement: none
mandate: true
mandated-by: ai-maestro
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-07-16T20:06:24+0200
relevant-rules: [16, 23, 42]
labels: [family-a, continuity, cli, frozen-layer, status, ensure-resume, npt]
external-refs: [Emasoft/ai-maestro-janitor#100, Emasoft/ai-maestro#69]
parent-trdd: KCRMSNL7
derived: true
derived-kind: npt
npt: []
eht: []
blocked-by: []
release-via: none
implementation-commits: [03c40474]
---

# Continuity CLI surface — aimaestro-continuity.sh status + ensure-resume behind the frozen layer

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-16

The ONLY new script surface the whole Family-A absorption adds (R23/R42-clean).

**✅ IMPLEMENTED 2026-07-16 (commit `03c40474`) — `column: testing`.** `scripts/aimaestro-continuity.sh`
carries `status <self>` + `ensure-resume <self>` (self-contained `_resolve_agent_id` + common.sh
sourcing, same as the other frozen-layer scripts; auto-installed by the `scripts/*.sh` glob).
Behind them: `GET /api/agents/[id]/continuity/status` (composes the 5-field contract via
`lib/continuity-status.ts` — 4 observables from [[Y916N7WL]] + `next_action` computed
server-side, interim from observables until [[1GGQ4HWY]]) and `POST .../ensure-resume`
(idempotent REAL actuation: `getAgentSessionStatus` → `wakeAgent`, no stub). Both enforce R42
self-only. Registered in `docs/SCRIPT-LAYER.md`; 7 unit tests; tsc/lint/shellcheck clean.

**NEXT:** `next_action` gains the cascade states once [[1GGQ4HWY]] lands; live end-to-end
route test needs an authenticated caller (deferred to a scenario/USER).

## Problem / Goal

The `#J` thin local janitor (janitor's side, #100) needs to ask the ai-maestro server two
things without ever touching token material or another agent: "am I healthy / what should I do
next?" and "make sure I'm resumed". Per R42 an agent may act ONLY on itself, and per R23 no
plugin element may call the API directly — so the contract is exactly **two self-scoped verbs**
on a new frozen-layer script, and nothing else. Everything else reuses the existing
`aimaestro-session.sh slash|queue`.

## Scope (the two verbs — a deliberate, minimal contract)

- **`aimaestro-continuity.sh status <self>`** — prints exactly 5 metadata fields:
  `account_healthy, window_5h_pct, window_7d_pct, cache_ttl_minutes, next_action`. A DELIBERATE
  CEILING (Constraint 1 of [[TRDD-H24DF6ZC]]): no token can leak through the one verb an agent
  can call. The first four come from [[Y916N7WL]] (AgentlensPro metadata); `next_action` comes
  from [[1GGQ4HWY]]'s cascade state. A schema test fails CI if a 6th (token-adjacent) field is
  ever added.
- **`aimaestro-continuity.sh ensure-resume <self>`** — idempotent; the SERVER owns the
  actuation ([[CHN16JXZ]] reuses the queue/slash substrate). The verb just requests "ensure I'm
  resumed"; calling it twice is a no-op if already live.
- Both verbs are **self-only** (R42): `<self>` must resolve to the caller's own AID; a request
  naming another agent is refused. No cross-agent reach exists in this surface at all.

## Frozen-layer discipline (R23)

- The script lives in `scripts/` (this repo), is copied to `~/.local/bin/` by the glob in
  `install-messaging.sh` — no installer edit needed.
- It shells to a server route (self-scoped, AID-authenticated); it NEVER embeds `/api/...` in a
  plugin element. The route is the only thing that talks to the server; the `#J` plugin shells
  the script.
- Register both verbs in `docs/SCRIPT-LAYER.md` + SCRIPT-MANIFEST.md so CORE (#69) can teach its
  skills against the deployed surface (same deploy gate as the other #69 verbs:
  `governance-rules` → `main` + installed to `~/.local/bin/`).

## Verification

- Unit: `status` emits exactly the 5 fields; schema test red on a 6th field; `ensure-resume`
  is idempotent (second call within a live window is a no-op).
- `status`/`ensure-resume` refuse a `<self>` that is not the caller's own AID (R42).
- `bash scripts/with-node.sh npx tsc --noEmit` clean; route test green.

## Approval log

- 2026-07-16T20:06:24+0200 — Tier-0 self-mandate (derived NPT of [[KCRMSNL7]], in-scope
  frozen-layer dev). Authored directly as `planned`.
