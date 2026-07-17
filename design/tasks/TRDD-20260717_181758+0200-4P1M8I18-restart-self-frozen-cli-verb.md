---
trdd-id: 4P1M8I18
title: restart-self — self-only-by-construction agent self-restart (me/restart route + frozen CLI verb)
column: planned
created: 2026-07-17T18:17:58+0200
updated: 2026-07-17T18:30:35+0200
current-owner: ai-maestro
task-type: feature
scope: project
min-approval-requirement: none
mandate: true
mandated-by: ai-maestro
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-07-17T18:17:58+0200
relevant-rules: [23, 42]
labels: [family-a, continuity, cli, frozen-layer, restart, self-only, security]
external-refs: [Emasoft/ai-maestro-janitor#75, Emasoft/ai-maestro#69]
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
implementation-commits: [2af0aabf]
---

# restart-self — self-only-by-construction agent self-restart (me/restart route + frozen CLI verb)

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-17

**IN PROGRESS — Phase 1 DONE (`2af0aabf`), Phase 2 NEXT.** A self-mandate (Tier 0: the frozen-layer
script surface + a self-derived route are the ai-maestro server's own scope, reversible, self-only).
Unblocked by the now-FINAL janitor#100 co-ratification (I committed on janitor#75 that restart-self
lands after ratification).

**✅ Phase 1 (`2af0aabf`):** `lib/session-restart.ts` extracted from `[id]/restart` — the ONE
definition of the CC-GOV-002 `programArgs` allowlist (`isValidProgramArgs`), the API-MAJ-03 persona
sanitizer (`sanitizePersonaName`), `resolveRestartBin`, the `--name` injection
(`buildRelaunchCommand`), and the stop→poll→relaunch sequence (`runRestartSequence`, injectable exec
seams). The `[id]/restart` route keeps ALL its gates and now calls the lib — no behavior change (same
400/409/504/500/200, same poll timing, same abandon handling). 17 unit tests (0-IMPACT), tsc 0,
`yarn build` 0.

**The gap this fills (VERIFIED 2026-07-17, `lib/sudo-guard.ts`):** an agent CANNOT restart
itself today. `POST /api/sessions/[id]/restart` maps to the `restart-session` AuthAction
(`STRICT_AGENT_RULES`, sudo-guard.ts:440), and `restart-session` is **NOT** a SELF_DRIVE action —
the `ensure-core` remap comment (sudo-guard.ts:363-365) states it verbatim: *"self denied
(neither is a SELF_DRIVE action), MANAGER (other) allowed, COS own-team allowed."* So the
janitor `#J` continuity path (recover a stuck SELF by relaunching) has no server verb. R42 bans
keystroke-injection at ANOTHER agent (restart does `C-c` + `/exit` + `Enter`), but self-restart
is self-harm-only — an agent can already `/exit` its own REPL; this is the programmatic twin.

**NEXT ACTION — Phase 2: build `POST /api/sessions/me/restart` + security-invariant tests.**
Grounding captured for a clean build (no re-grounding needed):
- **Self-resolution:** `authenticateFromRequest(request)` → `auth.agentId` (the caller's own agent)
  for an AID/Bearer caller; `{ agentId: undefined }` / `{ userId }` for the system-owner. The route
  derives the session SOLELY from `auth.agentId` — NO `[id]` param — so no other agent is nameable.
- **Route flow:** authenticate (401 on `auth.error`) → require `auth.agentId` (AGENT-only; a
  system-owner with no agentId is 400 "use /api/sessions/[id]/restart", since "me" has no agent
  session for the human) → resolve the caller's own agent + its session name from the registry
  (`getAgent(auth.agentId)` → session name; 404/409 if it has no live session) → manager-gate parity
  (a team agent still needs a MANAGER on the host — reuse the same `getManagerId()`+`isAgentInAnyTeam`
  check) → subagent gate (reuse `readSubagentCount`+`evaluateExitGate`, `?force=true`) → optional body
  `{program, programArgs}` (default to registry) → `isValidProgramArgs` (400) → `resolveRestartBin` +
  `sanitizePersonaName` + `buildRelaunchCommand` + `runRestartSequence` (all from `lib/session-restart.ts`)
  → map `RestartOutcome` to HTTP exactly as `[id]/restart` does.
- **NOT sudo-strict:** R32 agents never sudo (`sudo-guard.ts:19-25`); self-only-by-construction has no
  cross-target for sudo to protect. So `me/restart` is a normal authenticated route (the structural
  middleware still blocks anonymous). Do NOT add it to `security-registry.json` strict / STRICT_AGENT_RULES.
- **Security-invariant tests (the gate — Never relax security strictness):** (a) an agent restarts its
  OWN session via `me/restart`; (b) there is NO request shape by which agent A reaches agent B's session
  (the route reads only `auth.agentId`); (c) `[id]/restart`'s existing self-deny for agents is UNCHANGED
  (this route ADDS a capability, it does not loosen `restart-session`); (d) a system-owner without an
  agent session is refused. All four green or it does not ship.
Then Phase 3: the no-arg `aimaestro-continuity.sh restart-self` verb + `docs/SCRIPT-LAYER.md` /
`SCRIPT-MANIFEST.md` registration + a CLI/route smoke test.

## Problem / Goal

The janitor `#J` (and any agent) needs a server verb to **restart ITSELF** — no other target
reachable — so continuity recovery (a stuck self after a compact / rate-limit clear) can relaunch
the session programmatically. It must be **self-only BY CONSTRUCTION** (the investigation's phrase
on #75: *"no `<self>` arg, no `--aid`"*): the target is DERIVED from the authenticated caller, so
there is no parameter through which another agent could ever be named — stronger than
self-only-by-authorization (which relies on `authorize()` rejecting a supplied non-self target).

## Verified findings (claim-verification, 2026-07-17)

- `authenticateFromRequest` returns `{ agentId }` for an AID/Bearer caller, `{ agentId: undefined }`
  / `{ userId }` for the system-owner (`lib/agent-auth.ts`). → the self-resolution seam is
  `auth.agentId`.
- `POST /api/sessions/[id]/restart` is `strict`; for an agent it routes through
  `requireAidTitle` → `authorize(auth, 'restart-session', selfId)` → **self DENIED** (restart-session
  ∉ SELF_DRIVE_ACTIONS). Agents cannot self-restart via the existing route.
- R32: agents NEVER face a sudo gate (`sudo-guard.ts:19-25`). Sudo protects cross-target
  destructive ops from the human; a self-only-by-construction route has no cross-target to protect,
  so it does NOT belong in the sudo-strict registry.
- `app/api/sessions/me/user-input/route.ts` is a `me`-scoped route but resolves the HUMAN user, not
  an agent session — NOT the reuse target. The self-restart route derives an AGENT session from
  `auth.agentId`.
- The relaunch machinery (stop sequence → poll for shell → relaunch with stored program+args +
  `--name` persona injection) lives inline in `app/api/sessions/[id]/restart/route.ts` (~12.8 KB).

## Design (minimal, secure, One Source of Truth)

1. **Extract the shared relaunch machinery** from `[id]/restart` into `lib/session-restart.ts`
   (a pure, behavior-preserving refactor): `restartSessionByName(sessionName, {program, programArgs})`
   → the stop→poll→relaunch cycle. `[id]/restart` calls it; `me/restart` calls it. No duplicated
   restart logic (avoids the two-implementations-drift trap).
2. **New route `POST /api/sessions/me/restart`** — self-only by construction:
   - `authenticateFromRequest`; 401 on `auth.error`.
   - Require `auth.agentId` (AGENT-only). A system-owner (no agentId) is 400/403 with "use
     /api/sessions/[id]/restart" — "me" has no agent session for the human.
   - Resolve the caller's OWN session: `agentId → registry agent → its session name`. No `[id]`
     param exists, so no other agent can be named. Manager-gate parity with `[id]/restart` (a
     team agent still needs a MANAGER on the host).
   - Reuse `restartSessionByName`. NOT sudo-strict (self-only-by-construction; R32 agents never sudo).
3. **New frozen CLI verb `aimaestro-continuity.sh restart-self`** — NO target arg (R23/R42):
   `POST /api/sessions/me/restart` with `AID_AUTH`. Sits beside `status`/`ensure-resume` on the
   same frozen script (installed by the `install-messaging.sh` glob — no installer edit). This is
   the third continuity verb; the 5-field `status` contract ceiling is unaffected.
4. **Docs:** register the verb in `docs/SCRIPT-LAYER.md` + `SCRIPT-MANIFEST.md` so CORE (#69) can
   teach `#J` against the deployed surface (same deploy gate as the other #69 verbs:
   `governance-rules → main` + installed to `~/.local/bin/`).

## THE SECURITY INVARIANT (the load-bearing test — Never relax security strictness)

Cross-agent restart MUST remain impossible. The route exposes NO target parameter and derives the
session solely from `auth.agentId`, so "restart agent B while authenticated as A" is unrepresentable.
A TDD test PROVES this: (a) an agent restarts its own session via `me/restart`; (b) there is no
request shape by which agent A reaches agent B's session through `me/restart`; (c) the existing
`[id]/restart` self-deny for agents is UNCHANGED (this TRDD adds a capability, it does not loosen
`restart-session`); (d) a system-owner without an agent session is refused. If any of (a)-(d) cannot
be shown green, the route does not ship.

## Phases (≤5 files each; plan-and-build separate)

- **Phase 1** — extract `lib/session-restart.ts` from `[id]/restart`; wire `[id]/restart` to it;
  test that `[id]/restart` behavior is byte-identical (no regression). TDD.
- **Phase 2** — `app/api/sessions/me/restart/route.ts` (self-derivation + manager gate) + the
  security-invariant tests above.
- **Phase 3** — `aimaestro-continuity.sh restart-self` verb + `docs/SCRIPT-LAYER.md` /
  `SCRIPT-MANIFEST.md` registration + a CLI/route smoke test.

## Verification

- `bash scripts/with-node.sh npx tsc --noEmit` clean; `bash scripts/with-node.sh yarn test` green
  (incl. the 4 security-invariant assertions); `bash scripts/with-node.sh yarn build` clean.
- `shellcheck scripts/aimaestro-continuity.sh` clean.
- Do NOT push (this is the app, not a plugin) — commit each phase by name with TRDD-4P1M8I18 in the
  subject.

## Approval log

- 2026-07-17T18:17:58+0200 — MANDATE issued by ai-maestro (min-approval-requirement: none).
  Self-mandate: Tier-0 frozen-layer surface within the server's own scope, reversible, self-only.
  Pre-approved: issuer authority >= required approver. No approval request was sent.
