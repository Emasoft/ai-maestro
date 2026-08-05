---
trdd-id: YU37A3M4
title: Owner-authenticated CLI verification run for the two remaining T3FXA0Y0 probes
column: todo
scope: project
project-id: ai-maestro
created: 2026-08-06T00:44:42+0200
updated: 2026-08-06T00:44:42+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: infra
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-08-06T00:44:42+0200
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
relevant-rules: []
labels: [cli, verification, auth-gated, owner-ours]
external-refs: [Emasoft/ai-maestro#121]
---
# Owner-authenticated CLI verification run for the two remaining T3FXA0Y0 probes

## Why this card exists

`TRDD-T3FXA0Y0`'s last two boxes need a LIVE authenticated `create` run against the
server. Every path to that authentication is closed to the dev session, measured
2026-08-06:

- **No AID** — this session is not a registered agent, and borrowing an agent's
  identity is forbidden.
- **`AIM_GOVERNANCE_PASSWORD` is unset** in the session environment (`ENV_UNSET`),
  so `POST /api/auth/login` cannot be driven (the value must travel env → shell,
  never through the model — the hard invariant stands).
- **`.env.local` is permission-denied** to the session — correctly; it holds the
  secret.
- `POST /api/agents` accepts exactly: a web-session cookie, an `aim_tk_*` AID/user
  token, or an `mst_*` server-issued session secret (`lib/agent-auth.ts::
  authenticateAgent`). None is obtainable here without the password or an identity
  that is not ours.

## The action (runnable the moment the env is present)

Precondition: `AIM_GOVERNANCE_PASSWORD` exported into the session environment by
the OWNER (or the owner runs the probes directly). Then:

1. **Box A probe** — disposable agent, exit status is the assertion:
   ```bash
   # login → session cookie (value expands in the shell, never printed)
   curl -s -c /tmp/aim-cookie.txt -X POST http://localhost:23000/api/auth/login \
     -H 'Content-Type: application/json' \
     -d "{\"password\": \"$AIM_GOVERNANCE_PASSWORD\"}"
   # NOTE: the frozen CLI sends only a Bearer (AID_AUTH) — the cookie path needs
   # the API probe; the CLI exit-0 probe needs an AID_AUTH the owner provides, or
   # the owner runs:  aimaestro-agent.sh create t3f-probe-agent --no-session ; echo $?
   # Expected: exit 0, agent registered.
   ```
2. **Box B probe** — a failing `plugin marketplace add` inside the create/install
   flow surfaces the underlying error on stderr and exits non-zero (drive with a
   deliberately-bad `--plugin`/marketplace spec).
3. **Cleanup** — delete the disposable agent through the sanctioned pipeline
   (`aimaestro-agent.sh delete` / the UI Danger Zone with folder deletion), verify
   by absence in the registry, sessions, and `~/agents/`.
4. Tick T3FXA0Y0's two boxes with the observed exit codes, clear the block,
   restore it to its `pre-block-column`, close this card.

## Acceptance criteria

- [ ] Box A probe run: `create` exit status observed and recorded on T3FXA0Y0.
- [ ] Box B probe run: failing marketplace-add stderr + exit status recorded.
- [ ] Disposable agent fully cleaned (registry, cemetery purged, folder, tmux).
- [ ] T3FXA0Y0 unblocked and advanced.

## Approval log

- 2026-08-06T00:44:42+0200 — SELF-MANDATE (Tier 0). A verification chore; the only
  gate is the owner supplying the authenticated context, which is named, not
  worked around.
