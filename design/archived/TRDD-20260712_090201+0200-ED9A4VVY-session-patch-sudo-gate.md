---
trdd-id: ED9A4VVY
title: security — sudo-gate the arbitrary-command path of PATCH /api/agents/[id]/session (#54)
column: complete
created: 2026-07-12T09:02:01+0200
updated: 2026-07-12T09:07:30+0200
current-owner: ai-maestro-dev-session
assignee: ai-maestro-dev-session
priority: 1
severity: HIGH
effort: S
labels: [security, sudo, session, gh-issue-54]
task-type: security
parent-trdd: null
npt: []
eht: []
blocked-by: []
relevant-rules: []
release-via: none
delivery: direct-commit
target-branch: governance-rules
test-requirements: [unit, typecheck]
audit-requirements: [adversarial-scan]
review-requirements: []
impacts: [config-schema]
attempts: 1
last-test-result: pass
last-test-at: 2026-07-12T09:06:00+0200
implementation-commits: [8a198248]
external-refs: ["github.com/Emasoft/ai-maestro/issues/54"]
---

# security — sudo-gate the arbitrary-command path of PATCH /api/agents/[id]/session (#54)

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-12

**The gate was inverted with respect to blast radius.** `PATCH /api/agents/[id]/session`
types arbitrary text into a live agent's terminal, yet it was NOT strict-classified — so a
USER (system-owner cookie) faced no `X-Sudo-Token` re-auth. Meanwhile the *safer* deferred
`POST /api/agents/[id]/queue` (inspectable, cancellable) IS strict. The chat-send security
test even names this route as the gated "safe reference" — but the registry never contained
the entry. #54 is real.

**Root cause (verified in code, not assumed):**
- `security-registry.json` has NO `PATCH_/api/agents/[id]/session` entry → `requiresSudo()`
  returns false → `requireSudoToken()` no-ops → a USER caller is never asked for sudo.
- The SERVICE layer (`sendAgentSessionCommand` Gate 0, agents-core-service.ts:1524) already
  authorizes AGENTS via `authorize('send-command')`, but **explicitly skips system-owner**
  (`if (!authContext.isSystemOwner)`). So the gap is precisely the USER path.
- Two send paths share the handler: `commandKey` (allowlist → fixed literal, SAFE) and legacy
  `command` (arbitrary text, DANGEROUS). Only the arbitrary path needs the gate; the allowlist
  path must stay open or curated keystrokes break.

**The fix (3 parts) — make the arbitrary path consistent with `queue`:**
1. `security-registry.json`: add `"PATCH_/api/agents/[id]/session": "strict"`.
2. `lib/sudo-guard.ts` `STRICT_AGENT_RULES`: add
   `'PATCH /api/agents/[id]/session': { action: 'send-command', targetFromPathId: true }`
   (mirrors the `queue` route; also satisfies the strict-route coverage guardrail test).
3. `app/api/agents/[id]/session/route.ts` PATCH handler: call
   `requireSudoToken(request, 'PATCH', '/api/agents/[id]/session')` ONLY in the `else`
   (no-commandKey = arbitrary) branch. The `commandKey` branch never calls the guard → stays
   open (authenticated-only, allowlist is its boundary).

**Why conditional, not first-statement:** the guard is deliberately invoked only on the
arbitrary branch so the curated `commandKey` path is unaffected (the chat-send test's
"don't blanket-strict" caution). Middleware does NOT enforce sudo (Edge runtime), so a
registry-strict route only enforces where the handler actually calls the guard.

**Verified NOT to break anything:**
- Frontend sends no raw `command` to this route (uses `commandKey` / dedicated stop-restart
  routes / the independent deprecated `/api/sessions/[id]/command`).
- Agent path double-checks send-command (guard + service) — same action, same target →
  idempotent, no behavior change.

**Tests:** (a) route-handler test — USER arbitrary-command w/o sudo → 403 `sudo_required`;
USER `commandKey` → NOT sudo-blocked. (b) add the PATCH pair to `sudo-op-binding.test.ts`
`STRICT_ROUTE_PAIRS` (mint→verify round-trip). (c) the coverage test now requires the
STRICT_AGENT_RULES entry — satisfied.

**NEXT ACTION:** none — implemented + gated (see implementation-commits). Answer #54.

## Problem

`PATCH /api/agents/[id]/session` (arbitrary keystroke inject into a live tmux pane) is not
strict-classified, so a USER caller needs no fresh sudo token — while the strictly-safer
`queue` / `prompt/answer` / `panel` routes all are. The gate is inverted vs blast radius.

## Approval log

- 2026-07-12 — USER standing authorization (`/go-on-yourself`: act without waiting;
  never relax security). Security-hardening (adds a gate, never removes one). Proceeding.
