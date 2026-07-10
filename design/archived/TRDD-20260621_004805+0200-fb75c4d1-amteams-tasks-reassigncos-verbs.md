---
trdd-id: fb75c4d1-df8b-4f58-993c-cf20e1d71b59
title: Add frozen CLI verbs — teams tasks/reassign-cos + agent presence (decoupling, #45)
column: complete
created: 2026-06-21T00:48:05+0200
updated: 2026-06-21T02:05:00+0200
current-owner: ai-maestro-session
assignee: ai-maestro-session
task-type: feature
release-via: none
parent-trdd: TRDD-903b7a20
relevant-rules: []
external-refs: ["github.com/Emasoft/ai-maestro/issues/45"]
test-requirements: [lint]
labels: [scripts-align, decoupling, frozen-cli, "#45"]
---

# TRDD-fb75c4d1 — aimaestro-teams.sh: tasks + reassign-cos verbs

**Source:** overnight fleet-readiness verification (TRDD-903b7a20), fix-queue #8
(`scripts-skill-align` HIGH findings) — GitHub issue #45. Evidence:
`reports/overnight-verify/scripts-skill-align.findings.json`.

## Problem
Two AMAMA skills needed server data through the FROZEN skill-facing CLI layer
(the decoupling invariant: a plugin element MUST NOT call `/api/...` directly —
it shells out to the immutable `aimaestro-*.sh` intermediary), but the wrapping
verbs did not exist:
- `amama-status-reporting` needs team kanban statuses (GET `/api/teams/{id}/tasks`).
- `amama-amcos-coordination` needs in-host COS reassignment (POST
  `/api/teams/{id}/chief-of-staff`). #45 item-3 floated a `--cos` flag on
  `update`, but that is WRONG — `update` PUTs team fields and does not move the
  COS slot; the dedicated chief-of-staff route is the only correct surface.

Both server endpoints already exist; only the CLI wrappers were missing, forcing
the skills toward a forbidden direct `/api` call.

## Fix
Added two ADDITIVE verbs to `scripts/aimaestro-teams.sh` (FROZEN-contract-safe —
new verbs, zero change to existing ones), mirroring the existing
`cmd_add_agent` / `cmd_kanban_config` conventions and the shared `_api` helper:
- `tasks <teamId>` → `_api GET /api/teams/<id>/tasks`.
- `reassign-cos <teamId> <agentUUID> --password P` → `_api POST
  /api/teams/<id>/chief-of-staff {agentId,password}` (body shape verified against
  the route's Zod schema: `{agentId: uuid|null, password: string}`).
Help text + dispatch + version bumped (v1.1.0 → v1.2.0).

## Verification
- `bash -n` clean.
- `--version` → v1.2.0; `help` lists both verbs.
- Arg validation: `tasks` (no id), `reassign-cos` (no id/agent), `reassign-cos`
  (no `--password`) each error correctly.
- **Live wiring: `tasks <uuid>` → `HTTP 401 — auth_required`** — the verb reached
  the real `/api/teams/<id>/tasks` endpoint (not "unknown command"/bash error),
  proving the wiring. The functional 200-with-data round-trip is AGENT-ONLY
  (owner session 401s on agent routes) — to be verified by a fleet agent.

## Completing #45 — presence verb (2026-06-21)
The third #45 verb — `presence` (GET `/api/users/me/presence`) for
`amama-presence-tracker` — is now ALSO added: `cmd_presence` in
`scripts/agent-commands.sh` (mirroring `cmd_show`'s `get_api_base` +
`_build_auth_args` + `curl` pattern), dispatched + help'd in
`scripts/aimaestro-agent.sh`. **All THREE #45 verbs are done.** Verified:
`bash -n` clean on both files; `cmd_presence` sourced + invoked directly returns
the `auth_required` response FROM `/api/users/me/presence` (wiring proven; the
200-with-data round-trip is agent-only, needs AID_AUTH). NOTE: `aimaestro-agent.sh`'s
`main()` runs `check_api_running` (probes auth-gated `/api/sessions`) BEFORE
dispatch, so a bare owner shell 401s at the pre-gate — agents pass AID_AUTH
(SCEN-022 fix) and reach the verb normally. Deployed `~/.local/bin` copies need an
`install-messaging.sh` re-run (outside-project deploy step, flagged not run).

## Implementation (2026-06-21)
`scripts/aimaestro-teams.sh` (+2 verbs, +help, +dispatch, v1.2.0). NOTE: the
deployed `~/.local/bin/aimaestro-teams.sh` needs `install-messaging.sh` re-run to
pick these up (an outside-project deploy step — flagged, not run). Landed in the
overnight campaign (TRDD-903b7a20). Not pushed.
