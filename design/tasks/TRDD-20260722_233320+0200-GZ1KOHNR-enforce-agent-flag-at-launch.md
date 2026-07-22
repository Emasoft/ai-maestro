---
trdd-id: GZ1KOHNR
title: Enforce --agent at every launch chokepoint — a titled Claude agent must run its role persona, never generic claude
column: testing
created: 2026-07-22T23:33:20+0200
updated: 2026-07-22T23:50:00+0200
current-owner: session
task-type: bugfix
scope: project
project-id: ai-maestro
min-approval-requirement: none
mandate: true
mandated-by: user
relevant-rules: [9]
eht: []
npt: []
implementation-commits: [eff07647, 2bd8969c]
external-refs:
  - design/tasks/TRDD-20260722_205943+0200-B7G2R0SX-harness-readiness-criteria-and-verification.md
  - design/proposals/TRDD-20260722_231837+0200-F898NXLU-manager-must-create-fleet-and-delegate.md
  - reports/scenarios-runner/SCEN-031_20260722T203644Z.report.md
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-22

**USER MANDATE (2026-07-22):** "the --agent specification must be enforced.. no agent can be executed without it."
This is the harness-readiness blocker SCEN-031 surfaced (see TRDD-B7G2R0SX). Direct in-repo fix (ai-maestro's own
launch pipeline), USER-directed → `mandate: true`.

**ROOT CAUSE (verified this session):** a freshly-created titled Claude agent launches as generic `claude` — its
role-plugin main-agent persona never loads — so a MANAGER behaves like vanilla Claude (builds solo, no fleet). Chain:
CreateAgent G04 stores default `programArgs` = `--dangerously-skip-permissions` (NO `--agent`); G06 ChangeTitle
installs the role-plugin and injects `--agent` into the REGISTRY; but **G11 `createSession` builds the launch command
from a stale/param `programArgs` captured before G06**, so `--agent` is absent from the actual command. `sanitizeArgs`
is NOT the stripper (it keeps `--agent`). Corroborated: fresh MANAGER's live `ps` had no `--agent`; fleet-wide 0/13
running titled agents carry it; OQIA2DCR point 2. The role-plugin IS installed by G11 (G07c hard-rejects otherwise),
so the fix is to DERIVE `--agent` from the installed role-plugin AT the launch chokepoint.

**DESIGN — one shared enforcement helper, called at each Claude launch chokepoint.**
`services/agent-launch-args.ts`:
- pure `enforceLaunchAgentFlag(program, programArgs, mainAgentName): {kind:'ok',args} | {kind:'refuse',reason}` —
  non-Claude → ok(passthrough); Claude+mainAgentName → ok(setClaudeAgentFlag inject/replace); Claude+null → refuse.
  (Pure → unit-testable, no scan/tmux.)
- wired `resolveLaunchArgs(agentId|undefined, program, programArgs, deps?)` — resolves mainAgentName via
  `scanAgentLocalConfig(agentId).data?.rolePlugin?.mainAgentName`; NO agentId (raw session) → passthrough (nothing to
  enforce); else calls the pure fn. Scanner injectable for tests.

**Call sites (fresh/woken launches = the proven bug):**
1. `services/sessions-service.ts` createSession (~1080-1100) — THE fresh-create bug site.
2. `services/agents-core-service.ts` wakeAgent (~2205-2212) — wake path.
Both: on `ok` use `.args`; on `refuse` do NOT launch generic claude — surface an error / mark not-online (mirror the
existing keychain-preflight refuse in wakeAgent). refuse is SAFE: G07c guarantees a role-plugin at create, so a
normally-created agent always resolves mainAgentName; refuse only fires for a genuine R9.13-violating agent (recovery:
Profile → Config "Assign role-plugin").

**Non-Claude untouched** (Codex/Gemini/OpenCode/Kiro load personas via manifest, not `--agent`). **`--continue`/restart
paths** (buildRelaunchCommand — 2 restart routes + headless-router) relaunch an already-titled agent whose registry
programArgs already carries `--agent` (ChangeTitle maintained it), so they are NOT the observed bug — cover as a
fast-follow in this same TRDD once Phase 1 is green.

**DONE (all committed, NOT pushed):** `services/agent-launch-args.ts` (pure `enforceLaunchAgentFlag` +
wired `resolveLaunchArgs`) + `tests/unit/agent-launch-args.test.ts` (9 cases). Wired ALL launch chokepoints:
createSession + wakeAgent (commit `eff07647`), and all 4 restart sites — `[id]/restart` + `me/restart` routes + 2
headless-router handlers (commit `2bd8969c`). Gates: tsc 0 errors · full vitest 226 files green · yarn build clean.
Refuse is fail-fast + safe (fires only for an R9.13-violating agent; before any stop, so a running agent is never
disrupted).

**NEXT ACTION (the live acceptance test):** `pm2 restart ai-maestro`, then RE-RUN SCEN-031 (create a fresh MANAGER via
the Wizard) and confirm its live `ps` now shows `claude … --agent ai-maestro-assistant-manager-agent-main-agent` and
that the MANAGER creates+delegates to AUTONOMOUS+MAINTAINER personas. Only AFTER the persona demonstrably loads can
issue #31's persona-mandate be judged (if the MANAGER STILL builds solo WITH its persona active, #31 is the real fix;
if it now delegates, #31 may be moot). Also still open: delete `Emasoft/zipsearcher` (needs `delete_repo` token scope +
USER go) so SCEN-031's 0-IMPACT holds.

**VERIFY:** after wiring, a freshly-created titled Claude agent's live `ps` shows `claude … --agent <plugin>-main-agent`;
`resolveLaunchArgs` unit test covers inject / passthrough(non-Claude) / passthrough(no agentId) / refuse(no role-plugin).

## Problem
See ROOT CAUSE above. A titled agent that runs generic claude cannot fulfil its governance role (a MANAGER built
zipsearcher solo in SCEN-031 because its persona never loaded).

## Proposed fix
The shared-helper design above. One source of truth for "what --agent must this launch carry", derived from the
installed role-plugin, enforced at every chokepoint. Fail-fast (refuse) when a Claude agent has no resolvable persona.

## Verification
Unit test for `enforceLaunchAgentFlag`; `tsc`/`test`/`build` green; live `ps` of a fresh titled agent shows `--agent`;
SCEN-031 re-run shows the MANAGER creating+delegating (or, if it still builds solo WITH its persona loaded, that then
validly routes to issue #31).

## Estimated risk
MED — fleet-wide launch code. Mitigated: refuse cannot fire for a normally-created agent (G07c); non-Claude and
agentless paths pass through unchanged; covered by tsc/test/build + a re-run.

## Approval log
- 2026-07-22 — MANDATE issued by USER ("the --agent specification must be enforced.. no agent can be executed without
  it"). Pre-approved: issuer authority (USER) >= required approver. In-repo bugfix, min-approval-requirement: none.
