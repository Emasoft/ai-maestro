---
trdd-id: 78J4I4QS
title: reliability — detect a keychain-blind tmux server before it silently takes the whole fleet down
column: planned
created: 2026-07-12T12:27:10+0200
updated: 2026-07-12T12:27:10+0200
current-owner: ai-maestro-dev-session
assignee: ai-maestro-dev-session
priority: 1
severity: HIGH
effort: S
labels: [reliability, keychain, watchdog, fleet-health]
task-type: feature
scope: project
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: maestro
approval-datetime: 2026-07-12T12:27:10+0200
created-by: ai-maestro-dev-session
derived: true
derived-kind: eht
parent-trdd: CNF1X3J7
npt: []
eht: []
blocked-by: []
relevant-rules: []
release-via: none
delivery: direct-commit
target-branch: governance-rules
test-requirements: [unit, typecheck]
audit-requirements: []
review-requirements: []
impacts: [agent-lifecycle]
attempts: 0
implementation-commits: []
external-refs: ["memory:tmux-pane-cannot-read-login-keychain", "memory:fleet-auth-outage-2026-07-12-tmux-server-keychain-blind"]
---

# TRDD-78J4I4QS — Fleet-health watchdog: detect a keychain-blind tmux server (EHT of TRDD-CNF1X3J7)

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-12

- **State:** PLANNED. Depends on nothing; can be built before or after its parent, but it
  only becomes *useful* once the parent refuses launches.
- **NEXT ACTION:** add a `tmux-server-keychain` check to the periodic invariants
  watchdog started by `server.mjs` (`startAgentInvariantsWatchdog`, 5 min default).
- **Why this is an EHT, not a nice-to-have:** the parent (TRDD-CNF1X3J7) makes the launch
  path REFUSE when a pane cannot read the keychain. That is correct — but on its own it
  converts a silent outage into *"all my agents refuse to start and I don't know why"*.
  This TRDD supplies the fleet-level explanation and the remediation. **Shipping the
  parent without this closes one wound and opens another.**

## Problem

The blindness is a property of the **tmux server**, not of any one agent — so it is a
**fleet-wide single point of failure that nothing currently monitors.** Today the first
symptom is an agent that looks online and does nothing; with the parent shipped, the
first symptom becomes N refused launches with a per-agent message and no fleet-level
signal. Neither tells the operator the one thing that matters: *the server your whole
fleet is forked from cannot read the login keychain.*

## Proposed fix

Add a **fleet-level** check to the existing periodic invariants watchdog
(`startAgentInvariantsWatchdog()` in `server.mjs`; interval
`AIM_INVARIANTS_WATCHDOG_INTERVAL_MS`, default 5 min, `0` disables):

- Once per interval, run the free probe in a **throwaway pane on the fleet's tmux
  server** (from a script file — never nested quoting):
  `security find-generic-password -s "Claude Code-credentials" -w >/dev/null 2>&1; echo $?`
- `rc != 0` ⇒ raise a **loud, fleet-level alarm**: log at error level and surface a
  persistent dashboard banner naming the actual remedy — *"the tmux server is
  keychain-blind; every agent forked from it will fail to authenticate. Recreate the
  server from a shell verified with the same probe; restarting individual agents will
  NOT help."*
- It is a **detector, not a repairer.** Recreating the tmux server kills every pane on
  it, which is far too big a thing for a background loop to do unasked. Detect, explain,
  and let the operator (or a future, explicitly-triggered repair skill) act.
- Zero cost: one `security` call per interval; no API call, no tokens.
- macOS-only; elsewhere the check is skipped, never failed.

**Also surface the canary.** A secrets CLI whose auto-unlock stashes its passphrase in
the login keychain (e.g. `dotenclave`) **cannot** sit at a passphrase prompt unless that
pane is keychain-blind. A pane stuck at such a prompt is therefore the same alarm,
arriving earlier — during the 2026-07-12 outage three panes sat at exactly that prompt
for hours and were dismissed as junk. If a pane's foreground command is a known
secrets-CLI at a prompt, raise the same fleet-level alarm.

## Verification (TDD)

1. `tests/unit/tmux-server-keychain-watchdog.test.ts` — probe non-zero ⇒ alarm raised
   once (not once per agent), with the remediation text.
2. same — probe `rc=0` ⇒ **silent** (a watchdog that cries wolf gets muted, and a muted
   watchdog is worse than none).
3. same — the watchdog **never** attempts to recreate the tmux server (pins
   detect-not-repair; a future edit that adds a background server-recreate must break
   this test).
4. same — non-macOS ⇒ skipped.
5. `bash scripts/with-node.sh yarn test` + `yarn build` green.

## Estimated risk

**LOW.** Read-only detection on an existing loop, off by the same env var that already
disables the watchdog. The one real risk is alarm fatigue, which test 2 pins: it must be
completely silent when healthy.

## Approval log

- 2026-07-12T12:27:10+0200 — **MANDATE** issued by USER ("create the TRDD"), authored as
  the EHT of TRDD-CNF1X3J7. `min-approval-requirement: none` (Tier 0 — in-scope dev).
  Pre-approved: issuer authority ≥ required approver.
