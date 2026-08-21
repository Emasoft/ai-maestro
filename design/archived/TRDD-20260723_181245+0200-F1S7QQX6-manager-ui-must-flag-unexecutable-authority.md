---
trdd-id: F1S7QQX6
title: The MANAGER's decision UI must detect an unexecutable authorization up front, not via a live 403
column: cancelled
created: 2026-07-23T18:12:45+0200
updated: 2026-08-21T22:02:08+0200
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-08-21T22:02:08+0200
current-owner: scenario-runner
task-type: feature
scope: project
min-approval-requirement: manager
approval-tier: 2
priority: 2
severity: minor
effort: medium
labels: [scenario-improvement, scen-031, batch-manual-harvest, r42]
external-refs: [reports/scenarios-runner/SCEN-031-phase-1_20260723T133825Z.report.md]
---

# The MANAGER must not offer an authorization the server cannot execute

> **Canonical mechanism (2026-07-24):** two halves. The *server* half — the R42 fan-out authority
> that has no working caller — is tracked at **ai-maestro#89**; until it exists, an authorization of
> that class is genuinely unroutable. The *UI* half — surfacing the limitation up front (disable or
> omit an ungrantable option) rather than via a live 403 — routes with the MANAGER role-plugin issue
> (Flock C, [[TRDD-H4L3HHKX]]) and, where the dashboard must reflect it, the terminal automaton work
> [[TRDD-5CIL7A07]]. This proposal makes the gap HONEST; it does not require #89 to be closed first.

## Problem

Observed in SCEN-031 phase 1 (`S008`, "the 403 after granted authorization"). The MANAGER's own
AskUserQuestion menu framed a "Standing authorization" as something the USER could GRANT and the
MANAGER would then EXECUTE. The user answered — and only THEN did a live `403` reveal that the
server has **no caller path for this at all** (a confirmed architecture gap, admitted in CLAUDE.md
itself, and the subject of the R42 own-authority finding filed as ai-maestro#89).

So the MANAGER asked the human to grant a capability that could never be exercised, and the human
learned this the hard way — after committing to an answer, via an error rather than a heads-up.

## Root cause

The MANAGER's decision tooling constructs its option menu from what the governance model *says* a
title could authorize, not from what the running server can actually *route*. R42 makes
`send-command` self-only for every title, so a "standing authorization for the MANAGER to command
another agent" has no server-side execution path — but the UI has no pre-flight check for that, so
the impossibility surfaces only at call time as a 403.

## Proposed fix

Before the MANAGER presents an authorization option to the user, pre-flight it against the actual
server capability (the same registry/route check the eventual call would hit). When the capability
is unroutable:

1. **Do not offer it as grantable.** Either omit the option or render it disabled with a one-line
   reason ("no server path — R42 self-only; see ai-maestro#89").
2. If the model is genuinely unsure, ask the *diagnostic* question ("does a caller path exist?")
   before the *authorization* question — never ask the human to grant first and discover the
   impossibility second.

This is the general principle "surface the limitation up front" applied to the MANAGER's own UI; it
does not require the underlying R42 capability gap (ai-maestro#89) to be closed first — it makes the
gap honest instead of a trap.

## Verification

Re-run the SCEN-031 S008 path: the MANAGER either does not present the unexecutable authorization,
or presents it disabled with the reason — and the user never receives a post-answer 403 for it.

## Estimated risk

MEDIUM. Touches the MANAGER role-plugin's decision tooling (a separate repo,
`ai-maestro-assistant-manager-agent`) — so it is cross-repo and routes as a Tier-2 MANAGER decision,
likely implemented there rather than here. Depends on a reliable pre-flight capability probe; if the
probe is wrong it could hide a genuinely grantable option, so the probe must fail OPEN (offer the
option) on uncertainty, not fail closed.

## Approval log

- 2026-08-21T22:02:08+0200 — CANCELLED (OBSOLETE) by ai-maestro-hub-session (min-approval-requirement:
  manager). Re-measured on two independent grounds: (1) `ai-maestro#89` (the specific incident) is
  CLOSED — the USER auth path was delivered via `#55` and verified live (script emits the human
  cookie, server accepts it, `authorize(human, 'send-command', 'manager-1').allowed === true`), so
  the standing authorization this card describes is no longer genuinely unroutable for a human caller.
  (2) The exact UI fix this proposal asks for is already shipped in the MANAGER role-plugin persona
  (`ai-maestro-assistant-manager-agent-main-agent.md:296`): *"Pre-flight each option against a real,
  authenticated path before you present it (or omit it). An option you cannot execute is a trap, not
  a choice"* — citing this same SCEN-031 phase-1 incident and ai-maestro#89 by name. Nobody declined
  this proposal; it was repaired between filing and now.
