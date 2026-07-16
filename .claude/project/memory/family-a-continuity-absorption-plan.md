---
name: family-a-continuity-absorption-plan
description: "the implementation decomposition (NPT map) for absorbing the janitor's continuity daemon into the ai-maestro server — how is Family-A (oauth rotation / account-switch / auto-resume / session-resurrection) broken into tasks, in what order, which are unblocked; the ai-maestro-side plan for TRDD-KCRMSNL7 / janitor#100"
ocd: 2026-07-16
lmd: 2026-07-16
metadata:
  node_type: memory
  type: project
  tier: component
---

The ai-maestro server absorbs the janitor daemon's **Family A** (continuity/guardian) work;
**Family B** (dev-hygiene: plugin/self-update, cache-prune, OOM guard, github audit) STAYS with
the janitor. The server owns Family A when up; the janitor's `#N` daemon is the fallback when
there is NO server (the server can't resurrect itself). See [[server-oauth-token-continuity-design]]
for the R16 token rules (D1–D4, USER-signed-off) that gate NPT2/NPT3.

**Authoritative TRDDs:** parent `TRDD-KCRMSNL7` (ai-maestro side, has the full scope + the
aligned architecture), NPT `TRDD-H24DF6ZC` (the signed token design). Coordination: `janitor#100`
(the 3-way Family-A/B division), `AgentlensPro#3` (observe-only dep). The `#J` (thin local
janitor) + `#N` (scope-flip) side is the JANITOR's TRDDs under #100 — NOT mine.

**The `#J`→server contract (the ONLY new script surface, R23/R42-clean):** two self-scoped verbs
on `aimaestro-continuity.sh` — `status <self>` (5 fields: account_healthy, window_5h_pct,
window_7d_pct, cache_ttl_minutes, next_action — a deliberate ceiling, no token can leak) and
`ensure-resume <self>` (idempotent; server owns the actuation). Everything else reuses existing
`aimaestro-session.sh slash|queue`.

## The 6 NPTs (ids assigned 2026-07-16, authored under KCRMSNL7 — depth-1 derived)

| id | NPT | one-line scope | blocked-by | status |
|---|---|---|---|---|
| **DXJZM3BW** | 1. Continuity CLI surface | `aimaestro-continuity.sh` + the 2 verbs + server route behind the frozen layer | Y916N7WL | ready |
| **1GGQ4HWY** | 2. Server OAuth manager | ROTATE→REFRESH→REAUTH cascade (D4), keychain custody (D2), the machine-wide one-writer lock shared with the `#N` daemon (D3), detached model-free headless-browser process (D1). Built to H24DF6ZC | DXJZM3BW | **UNBLOCKED** (H24DF6ZC signed) |
| **9ZIF82HI** | 3. Account switcher | rotate to a fresh account/token on 429 / dead-refresh / network interruption (passive-switch, TRDD-1222f06a §9 — the process never dies, only the turn does) | 1GGQ4HWY | **UNBLOCKED** |
| **CHN16JXZ** | 4. Fleet recovery | server-internal liveness detection + `ensure-resume` actuation across the fleet (cross-agent = server's job, never a `#J` call; reuses queue/slash) | DXJZM3BW, 1GGQ4HWY | ready |
| **JAU1ES1C** | 5. Session-resurrection hardening | extend `services/boot-restore-service.ts` toward "immortality" (reboot / mid-turn 429 / network drop → resume from durable `session-history.json`). HARDEN, do not rebuild | — (light dep on DXJZM3BW) | ready |
| **Y916N7WL** | 6. AgentlensPro consumption | derive the `status` fields from the AgentlensPro CLI (canonical paths on AgentlensPro#3; CI-locked contract; observe-only) | — (dep landed TRDD-WF0UE9BC) | ready |

**Topological order:** Y916N7WL → DXJZM3BW → 1GGQ4HWY → {9ZIF82HI, CHN16JXZ}; JAU1ES1C parallel.

**Open issues each NPT must honor:** `janitor#82` (oauth_rotator keychain reads RE-PROMPT every
access — NPT2 must fix, likely an EHT) · `ai-maestro#60` (authenticated daemon→agent injection for
freeze-recovery — NPT4) · `ai-maestro#51` (active idle-agent wake — NPT4/NPT5).

**What exists TODAY (build the delta, don't duplicate):** session-resurrection is PARTIAL
(`boot-restore-service.ts::restoreActiveAgentsOnBoot` + `session-history.ts` + `session-persistence.ts`)
→ harden. OAuth rotation / account-switch / rate-limit recovery = NONE server-side yet (net-new).
The 5-state safe-state model (`lib/session-safe-state.ts`) + stop/restart poll are the actuation
substrate `ensure-resume` builds on.

## Notes and lessons learned
[^1]: [id:ATOM-FAMA-NPT, status:valid, keywords:"family_a_npt_map decompose_KCRMSNL7 which_npt_unblocked oauth_manager_blocked_on_design", ocd:2026-07-16, lmd:2026-07-16]
  DO NOT author the 6 NPT ids into KCRMSNL7's `npt:` list before the NPT TRDD FILES exist,
  BECAUSE a parent naming an npt id with no file (or a file that doesn't declare `derived: true`)
  is an orphan-platelet invariant violation the D4 watchdog flags. DO author each NPT file first,
  then wire the id into KCRMSNL7's `npt:` in the same edit.
