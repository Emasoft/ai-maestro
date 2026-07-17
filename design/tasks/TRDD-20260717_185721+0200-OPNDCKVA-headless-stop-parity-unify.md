---
trdd-id: OPNDCKVA
title: headless /stop parity — execFileSync + subagent gate + codex-aware exit (extract lib/session-stop)
column: planned
created: 2026-07-17T18:57:21+0200
updated: 2026-07-17T18:57:21+0200
current-owner: ai-maestro
task-type: refactor
scope: project
min-approval-requirement: none
mandate: true
mandated-by: ai-maestro
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-07-17T18:57:21+0200
relevant-rules: [23, 42]
labels: [headless, session-stop, parity, security, drift-fix]
external-refs: [Emasoft/ai-maestro#69]
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
implementation-commits: []
---

# headless /stop parity — execFileSync + subagent gate + codex-aware exit (extract lib/session-stop)

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-17

**PLANNED — a self-mandate (Tier 0: headless-parity hardening of the server's own /stop route,
reversible, no cross-project reach).** Surfaced building [[TRDD-4P1M8I18]] Phase 2b: the headless
`POST /api/sessions/[id]/stop` in `services/headless-router.ts` is a divergent, less-safe copy of the
Next.js app route `app/api/sessions/[id]/stop/route.ts`. **The shell-INJECTION half is already closed**
(`1fdc3603` added the CC-GOV-001 `^[a-zA-Z0-9_@.-]+$` session-name gate before auth, so the existing
`execSync` interpolation is now provably metachar-free). This TRDD closes the REMAINING behavior-parity
gaps — none of which is a live injection once gated, which is exactly why they are a separate atomic task
rather than part of 4P1M8I18.

**The remaining divergences (headless /stop vs the app /stop route):**
- **shell vs no-shell:** headless uses `execSync("tmux send-keys -t \"${sessionName}\" …")`; the app
  route uses `execFileSync('tmux', ['send-keys','-t',sessionName,…])` (CC-GOV-001 defense-in-depth — no
  shell at all, so a future gate regression cannot re-open injection).
- **no subagent gate:** the app route runs the TRDD-O8NCNRWO `evaluateExitGate(readSubagentCount(...))`
  → 409 `subagents_running` (null/0 never blocks; `?force=true` overrides). Headless /stop has none, so a
  headless `/exit` can land on Claude's abandon-confirmation dialog with live subagents.
- **not codex-aware:** the app route sends codex a double `C-c` (codex exits on two Ctrl+C, not `/exit`);
  headless always sends the Claude `C-c`+`/exit`+`Enter` sequence, so stopping a codex agent in headless
  mode does not actually exit it.
- **raw error leak:** headless returns `(error as Error).message` (API-MIN-03); the app route logs detail
  server-side and returns a generic `Session stop failed`.

**NEXT ACTION:** extract the stop sequence into `lib/session-stop.ts` (the One-Source-of-Truth twin of
`lib/session-restart.ts`) — a `runStopSequence(sessionName, program, deps?)` that encodes the
client-aware exit (claude `/exit` vs codex double-`C-c`) via injected `execFileSync`/`sleep` seams — then
have BOTH `app/api/sessions/[id]/stop/route.ts` and the headless `/stop` handler call it, and add the
subagent gate to the headless handler. This mirrors exactly what P1 did for restart and makes the two
serving modes unable to diverge again.

## Problem / Goal

Two serving modes (FULL Next.js app routes, HEADLESS `services/headless-router.ts`) each carry their own
copy of the session /stop machinery. The copies drifted: the headless one is less safe and less capable.
[[TRDD-4P1M8I18]] fixed the same class for /restart by extracting `lib/session-restart.ts` and having both
modes consume it; this TRDD does the same for /stop.

## Design (minimal, One Source of Truth — mirror the restart extraction)

1. **Extract `lib/session-stop.ts`** — `runStopSequence(sessionName, program, deps={})`:
   - client-aware: `program==='codex'` → `C-c`, sleep, `C-c`; else (claude/gemini/opencode/kiro) →
     `C-c`, `-l '/exit'`, `Enter`.
   - drives tmux via `execFileSync('tmux', [...])` (no shell), injectable `exec`/`sleep` seams for
     0-IMPACT tests (same pattern as `RestartSequenceDeps`).
   - returns `{status:'ok'} | {status:'error';detail}` (generic-error mapping owned by the callers).
2. **Wire both routes to it** — the app `/stop` route replaces its inline `execFileSync` block; the
   headless `/stop` handler replaces its inline `execSync` block AND gains the TRDD-O8NCNRWO subagent
   gate (`evaluateExitGate` + `?force=true`) it currently lacks.
3. **Session-name validation** already lands before auth in both (app route + `1fdc3603`); unchanged.

## THE SECURITY INVARIANT

The CC-GOV-001 session-name gate (already in place both modes) stays. Moving to `execFileSync` REMOVES
the shell entirely, so the route is injection-proof even if the gate regex were ever loosened —
defense-in-depth parity with the app route. No behavior is loosened; the codex path and the subagent gate
are ADDED capabilities, and a self-only-by-authorization gate (`authorize(auth,'send-command',...)`, R42)
is unchanged.

## Phases (≤5 files)

- **Phase 1** — extract `lib/session-stop.ts` + wire the app `/stop` route to it; test byte-identical
  behavior (claude + codex sequences) with injected seams. TDD.
- **Phase 2** — wire the headless `/stop` handler to the lib + add the subagent gate; a mirror test in
  `tests/unit/headless-router-auth-mirror.test.ts` (parity with the restart mirror test 4P1M8I18 added).

## Verification

- `bash scripts/with-node.sh npx tsc --noEmit` clean; `bash scripts/with-node.sh yarn test` green
  (incl. the new session-stop + headless mirror assertions); `bash scripts/with-node.sh yarn build` clean.
- Do NOT push (this is the app, not a plugin) — commit each phase by name with TRDD-OPNDCKVA in the
  subject.

## Approval log

- 2026-07-17T18:57:21+0200 — MANDATE issued by ai-maestro (min-approval-requirement: none).
  Self-mandate: Tier-0 headless-parity hardening within the server's own scope, reversible, no
  cross-project reach. Surfaced by [[TRDD-4P1M8I18]] Phase 2b; the injection half is already closed
  (`1fdc3603`), this handles the remaining behavior parity. Pre-approved: issuer authority >= required
  approver. No approval request was sent.
