---
trdd-id: 5H5PBNEB
title: Revert the inbound daemon channel — the absorbed daemon IS the server
column: complete
scope: project
project-id: ai-maestro
created: 2026-08-06T07:09:37+0200
updated: 2026-08-06T07:09:37+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: security
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-06T07:04:00+0200
severity: high
effort: small
npt: []
eht: []
blocked-by: []
release-via: none
supersedes: [APN5WB2L]
implementation-commits: [c7aaa6ab]
labels: [daemon, security, architecture, correction]
external-refs: [Emasoft/ai-maestro#60]
---
# Revert the inbound daemon channel — the absorbed daemon IS the server

## The ruling (USER, 2026-08-06 07:04)

> *"The daemon IS NOT AN AGENT. Why should it be authenticated? The very reason ai-maestro
> incorporated the functionalities of the janitor daemon was exactly that: an external process
> could never be allowed to manage the agents inside the ai-maestro harness. So it was necessary
> for the ai-maestro server to absorb in itself the functionalities of the daemon, and for the
> original janitor daemon to be switched off every time the ai-maestro server was running. THAT IS
> THE WHOLE POINT OF THE INTEGRATION OF THE DAEMON INSIDE AI-MAESTRO! The daemon functionalities
> are executed by the server itself! SO WHY SHOULD THE SERVER AUTHENTICATE ITSELF???"*

Correct, and verified against this tree before acting:

- the absorbed daemon is `startFleetLivenessWatchdog()` (`server.mjs:1996`) plus
  `lib/fleet-recovery-{runner,actuator}.ts` and `lib/fleet-restart-driver.ts` — in-process;
- `lib/janitor-daemon-publisher.ts` opens with the ruling it implements: *"Only the daemon
  integrated into the ai-maestro server may read agent status or run these commands... Janitor
  processes therefore **never call in**. They RECEIVE, by reading a file the daemon deposited in
  their OWN project folder."*

TRDD-APN5WB2L built the **inbound** direction that sentence forbids. An authenticated injection
endpoint does not solve a credential problem — it re-opens, with a signature ceremony on top, the
hole the absorption closed. The enrollment step was the tell: it is a way to let an EXTERNAL
process in, and the architecture exists to guarantee there is not one.

## Why it happened, recorded because the mechanism will recur

`#60` **asked for** an authenticated daemon→agent channel, and I answered the question as asked
instead of checking whether its premise survived the absorption. The premise was already dead in
our own tree — and I had read the file that says so, THIS SESSION, while adding the derived `since`
field two functions below that paragraph. A cross-repo issue is a request, not a specification of
our architecture; the check that its premise still holds here is ours to run, every time.

## What was done

- **Removed:** `lib/daemon-principal.ts`, `services/daemon-inject-service.ts`, both
  `/api/daemon/*` routes, both headless entries, the `security-registry` strict entry, and the
  **middleware whitelist entry** (the load-bearing one — that list is where a future reader would
  otherwise re-add it). The whitelist now carries a DO-NOT-ADD note naming this incident, so the
  next reader who sees the apparent gap finds the reason instead of rediscovering the wrong fix.
- **Kept:** `interruptSession` — the capability gap is real and independent of the caller
  (`sendCommand` hardcodes `literal: true`, so NO in-process caller could send a raw ESC either).
  Its caller is the server's own recovery machinery; its docstring now states it must never become
  a route. Tests moved to `tests/services/interrupt-session.test.ts`, plus a new case pinning that
  an agent may not interrupt a PEER.
- **Corrected the public record:** `#60` comment 5200624697 retracts the shipped-shape comment and
  tells the janitor Claude to delete anything built against it.

## Verification

```bash
grep -c "api/daemon" <build output>     # 0 routes in the manifest
curl -s -X POST localhost:23000/api/daemon/inject -d '{}'   # the middleware's auth_required,
                                                            # no daemon handler behind it
```
Rebuilt, restarted, health 200. 77 tests green across the surviving session-service suites.

## Acceptance

Added 2026-08-06T08:10 — see the Approval log entry below. This card was closed to `complete`
with NO checklist at all, which is precisely the false-completion the gate catches: the rule is
written over boxes that are unchecked, so a card with ZERO boxes passed it vacuously until the
"≥1 box" half landed (TRDD-9QV4ZCYY). Every item below was in fact done and verified at closing
time; the boxes record that, they do not claim anything new.

- [x] Both `/api/daemon/*` routes removed — Next routes, headless-router entries, the
      `security-registry.json` strict entry, `lib/daemon-principal.ts`,
      `services/daemon-inject-service.ts` and their tests (`c7aaa6ab`).
- [x] The auth-middleware whitelist entry removed — the load-bearing one, since that list is
      where a future reader would otherwise re-add it — and replaced with a DO-NOT-ADD note
      naming this incident.
- [x] `interruptSession` KEPT as an internal function, with a docstring stating it must never
      become a route; tests moved to `tests/services/interrupt-session.test.ts`, including a
      case pinning that an agent may not interrupt a PEER.
- [x] Verified LIVE, not merely by a green suite: rebuilt (zero `api/daemon` routes in the
      manifest), restarted, health 200, and `POST /api/daemon/inject` now returns the
      middleware's `auth_required` with no handler behind it.
- [x] Public record corrected — `Emasoft/ai-maestro#60` comment 5200624697 retracts the
      shipped-shape comment and tells the janitor Claude to delete anything built against it;
      `Emasoft/ai-maestro-janitor#218` carries the full retraction.

## Approval log

- 2026-08-06T07:09:37+0200 — MANDATE issued by USER (the ruling quoted above). Executed
  immediately: the reverted surface was LIVE on a running server, so leaving it up pending
  discussion was not an option. Supersedes TRDD-APN5WB2L.
- 2026-08-06T08:10:00+0200 — GATE REPAIR (append-only log, which is exempt from the terminal
  freeze; the `## Acceptance` section it refers to is the minimum edit that makes this card
  satisfy the gate it was closed in violation of). `TERMINAL-WITHOUT-CHECKLIST` — closed to
  `complete` carrying no checklist. No claim changed: every box records work already described
  in the body and verified at closing. **Worth recording HOW it went unseen for an hour:**
  `tests/unit/trdd-doctor.test.ts` asserts the corpus has ZERO ERROR-level findings, and that
  file was already failing on an unrelated uncommitted neuter in `lib/trdd-doctor.ts` — so a
  red suite masked a NEW red. A pre-existing failure is not a free pass; it is camouflage.
