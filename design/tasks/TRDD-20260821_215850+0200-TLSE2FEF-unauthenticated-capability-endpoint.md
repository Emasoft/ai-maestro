---
trdd-id: TLSE2FEF
title: Unauthenticated capability-set endpoint with per-verb revision counters
column: todo
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-21T21:58:50+0200
updated: 2026-08-28T23:58:42+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: feature
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-08-21T21:58:50+0200
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 2
severity: medium
effort: M
labels: [fleet-ask, hub-blocked]
external-refs: [Emasoft/ai-maestro#88, Emasoft/ai-maestro#81, Emasoft/ai-maestro#80, Emasoft/ai-maestro#114, Emasoft/ai-maestro#116]
---

## Problem

Auth runs before routing on this server: an unauthenticated request to a real route and to a
nonexistent one both return 401, identically. So no fleet member can answer "is verb X live on
this host?" without credentials — every consumer that wants to gate a skill on a deployed
capability has exactly one way to find out, which is asking the ai-maestro session directly. That
does not scale and makes the session a bottleneck on its own restart cadence.

## Root cause

No public introspection surface exists; the auth boundary was built to gate everything uniformly,
including "does this endpoint exist at all".

## Proposed fix

Per core's answered design questions in the issue thread (already resolved, ready to implement):

1. **Capability set + monotonic per-capability revision counter** — not a global version. Shape:
   `{"hibernation": 1, "list": 3, ...}`. A global semver was explicitly rejected as a signal (see
   #116: the CLI prints a hardcoded version that does not move with its verb set — the same trap
   would apply here).
2. Report the **running process's** actual capability set, never a git ref or installed-artifact
   read — a service can run from a working tree ahead of any readable ref.
3. No auth required; disclosure is capability names + integer revisions only, no build/semantic
   version, no host/environment detail.

## Verification

- `curl http://host:23000/api/capabilities` (or equivalent) with no credentials returns the
  capability map.
- Bumping a verb's contract (e.g. `list --status`'s accepted enum, per #114) increments only that
  verb's counter, not a global version.
- The endpoint reports what the live process actually serves, verified by killing/restarting with
  a different verb set and re-querying.

## Acceptance

- [x] `GET /api/capabilities` — `app/api/capabilities/route.ts` (Next) + `services/headless-router.ts` handler (headless), whitelisted in BOTH `middleware.ts` and `HEADLESS_AUTH_WHITELIST`; body `{capabilities: {verb: revision}}` only (2026-08-28)
- [x] `lib/capabilities.ts` — per-verb integers, all at 1; header says bump ONE integer when THAT verb's contract changes; test pins positive integers and that keys == the CLI's own dispatch verbs (`--capabilities`)
- [x] the map is compiled into the running bundle (Next `.next` / headless tsx) — no git/artifact read anywhere on the path
- [ ] consumer verification — needs a change in `Emasoft/ai-maestro-plugin` (core has no `/api/capabilities` reader yet; grep of its skills/scripts: 0 hits). Other repo → issue/PR route; not done here
- [ ] #88 comment — outward-facing; waits for the owner's go

## Approval log
- 2026-08-28T23:58:42+0200 — boxes 1-3 delivered by hub-claude. Tests: `tests/unit/capabilities.test.ts` (4) + headless mirror case; neuter (drop the headless whitelist entry) reds exactly the mirror case. tsc 0.
- 2026-08-28T23:59:16+0200 — precision on box 3: "the running process" = the code the process is EXECUTING. In headless mode that is the tree via tsx (live); in FULL mode the API route comes from the prebuilt `.next`, so after editing `lib/capabilities.ts` the endpoint reports the LAST BUILD until `yarn build` + restart — which is still the process's own served set (not a git ref, not an install manifest), and CLAUDE.md's "a restart does NOT rebuild" rule is the operator side of it. Verify a bump by its EFFECT (`curl -s :23000/api/capabilities`), never by `git log`.
